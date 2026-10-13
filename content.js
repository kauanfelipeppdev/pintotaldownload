// PinTotalDownload — roda nas páginas do Pinterest.
// Usa a mesma API interna (/resource/...) que o site usa, com os cookies da sua sessão,
// para listar todos os pins de uma pasta e mandá-los para o gerenciador de downloads.

(() => {
  if (window.__ptdLoaded) return;
  window.__ptdLoaded = true;

  const ROOT_FOLDER = "PinTotalDownload";
  const PAGE_SIZE = 25;
  const PARALLEL_DOWNLOADS = 4;

  // Primeiros segmentos de URL que não são nomes de usuário.
  const RESERVED = new Set([
    "pin", "search", "ideas", "today", "settings", "_", "business", "news_hub",
    "explore", "videos", "categories", "topics", "login", "signup", "logout",
    "password", "resource", "notifications", "inbox", "homefeed", "shopping",
    "about", "help", "privacy", "terms", "creator", "edit", "pin-builder",
  ]);
  // Segundos segmentos que são abas do perfil, não pastas.
  const PROFILE_TABS = new Set(["_saved", "_created", "pins", "boards", "followers", "following", "_shop", "_tried"]);

  let job = null; // { cancelled, ... }

  // ---------- Utilidades ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function parseBoardUrl(href = location.href) {
    const u = new URL(href);
    const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2 || parts.length > 3) return null;
    const [username, slug, section] = parts;
    if (RESERVED.has(username.toLowerCase())) return null;
    if (PROFILE_TABS.has(slug.toLowerCase()) || slug.startsWith("_")) return null;
    if (section && (section.startsWith("_") || section === "more_ideas")) return { username, slug };
    return { username, slug, section };
  }

  function sanitize(name, max = 80) {
    let s = String(name || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "");
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = "_" + s;
    if (s.length > max) s = s.slice(0, max).trim();
    return s || "sem_nome";
  }

  function extFromUrl(url, fallback) {
    const m = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url);
    return m ? m[1].toLowerCase() : fallback;
  }

  async function api(resource, options, sourceUrl, attempt = 0) {
    const params = new URLSearchParams({
      source_url: sourceUrl,
      data: JSON.stringify({ options, context: {} }),
      _: String(Date.now()),
    });
    const res = await fetch(`/resource/${resource}/get/?${params}`, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Pinterest-AppState": "active",
        "X-Pinterest-Source-Url": sourceUrl,
        // Sem este cabeçalho o Pinterest responde 403 "Invalid Resource Request".
        "X-Pinterest-PWS-Handler": "www/[username]/[slug].js",
      },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(1500 * 2 ** attempt);
      return api(resource, options, sourceUrl, attempt + 1);
    }
    if (!res.ok) throw new Error(`${resource}: HTTP ${res.status}`);
    const json = await res.json();
    const resp = json.resource_response || {};
    // O cursor da próxima página vem em resource.options.bookmarks.
    resp.bookmark = json.resource?.options?.bookmarks?.[0] ?? resp.bookmark;
    return resp;
  }

  async function* paginate(resource, baseOptions, sourceUrl) {
    let bookmark = null;
    while (true) {
      if (job?.cancelled) return;
      const options = { ...baseOptions, page_size: PAGE_SIZE };
      if (bookmark) options.bookmarks = [bookmark];
      const resp = await api(resource, options, sourceUrl);
      const items = Array.isArray(resp.data) ? resp.data : [];
      for (const it of items) yield it;
      bookmark = resp.bookmark;
      if (!bookmark || bookmark === "-end-" || items.length === 0) return;
      await sleep(250);
    }
  }

  // Extrai as URLs de mídia de um pin (imagem original, vídeo mp4, carrossel, idea pins).
  function mediaOf(pin, wantVideos) {
    const out = [];
    const bestImage = (images) => {
      if (!images) return null;
      if (images.orig?.url) return images.orig.url;
      if (images.originals?.url) return images.originals.url;
      let best = null;
      for (const v of Object.values(images)) {
        if (v?.url && (!best || (v.width || 0) > (best.width || 0))) best = v;
      }
      return best?.url || null;
    };
    const bestVideo = (videoList) => {
      if (!videoList) return null;
      const mp4s = Object.values(videoList).filter((v) => v?.url && /\.mp4(\?|$)/i.test(v.url));
      mp4s.sort((a, b) => (b.width || 0) - (a.width || 0));
      return mp4s[0]?.url || null;
    };

    const addImage = (images) => {
      const u = bestImage(images);
      if (u) out.push({ url: u, ext: extFromUrl(u, "jpg") });
    };

    // Carrossel: uma imagem por slide
    const slots = pin.carousel_data?.carousel_slots;
    if (Array.isArray(slots) && slots.length) {
      slots.forEach((s) => addImage(s.images));
    }

    // Idea pins / story pins: cada página pode ter vídeo ou imagem
    const pages = pin.story_pin_data?.pages;
    if (!out.length && Array.isArray(pages) && pages.length) {
      for (const p of pages) {
        for (const b of p.blocks || []) {
          const v = wantVideos && bestVideo(b.video?.video_list);
          if (v) out.push({ url: v, ext: "mp4" });
          else addImage(b.image?.images);
        }
      }
    }

    // Pin simples: vídeo (se ativado) ou a imagem original
    if (!out.length) {
      const v = wantVideos && bestVideo(pin.videos?.video_list);
      if (v) out.push({ url: v, ext: "mp4" });
      else addImage(pin.images);
    }
    return out;
  }

  function sendDownload(url, filename) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "ptd-download", url, filename }, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false });
      });
    });
  }

  // ---------- Fluxo principal ----------

  async function getSettings() {
    try {
      return await chrome.storage.sync.get({ videos: true, sections: true });
    } catch {
      return { videos: true, sections: true };
    }
  }

  async function downloadBoard() {
    if (job) return;
    const target = parseBoardUrl();
    if (!target) {
      panel.show();
      panel.set("Abra uma pasta do Pinterest (ex.: pinterest.com/usuario/nome-da-pasta/).", true);
      return;
    }

    job = { cancelled: false };
    const settings = await getSettings();
    const sourceUrl = `/${target.username}/${target.slug}/`;
    panel.show();
    panel.running(true);
    panel.set("Lendo informações da pasta…");

    try {
      const boardResp = await api(
        "BoardResource",
        { username: target.username, slug: target.slug, field_set_key: "detailed" },
        sourceUrl
      );
      const board = boardResp.data;
      if (!board?.id) throw new Error("Pasta não encontrada (é privada de outra pessoa?).");

      const boardFolder = `${ROOT_FOLDER}/${sanitize(board.owner?.username || target.username)} - ${sanitize(board.name)}`;

      // Monta a lista de "fontes": a pasta principal e cada seção.
      const sources = [];
      let sections = [];
      if (settings.sections || target.section) {
        for await (const s of paginate("BoardSectionsResource", { board_id: board.id }, sourceUrl)) {
          sections.push(s);
        }
      }

      if (target.section) {
        const sec = sections.find((s) => s.slug === target.section || s.title === target.section);
        if (!sec) throw new Error("Seção não encontrada.");
        sources.push({ label: sec.title, folder: `${boardFolder}/${sanitize(sec.title)}`, resource: "BoardSectionPinsResource", options: { section_id: sec.id } });
      } else {
        sources.push({ label: board.name, folder: boardFolder, resource: "BoardFeedResource", options: { board_id: board.id, board_url: sourceUrl, field_set_key: "react_grid_pin", filter_section_pins: !!settings.sections } });
        if (settings.sections) {
          for (const sec of sections) {
            sources.push({ label: sec.title, folder: `${boardFolder}/${sanitize(sec.title)}`, resource: "BoardSectionPinsResource", options: { section_id: sec.id } });
          }
        }
      }

      const total = target.section ? null : board.pin_count;
      const seen = new Set();
      const queue = [];
      let found = 0, sent = 0, failed = 0;
      let collecting = true;

      const updateText = () =>
        panel.set(
          `${collecting ? "Coletando pins" : "Baixando"}… ${found}${total ? "/" + total : ""} pins encontrados\n` +
          `${sent} arquivos enviados para download${failed ? ` · ${failed} falharam` : ""}`
        );

      // Workers que consomem a fila enquanto a coleta acontece.
      const worker = async () => {
        while (!job.cancelled) {
          const item = queue.shift();
          if (!item) {
            if (!collecting) return;
            await sleep(200);
            continue;
          }
          const r = await sendDownload(item.url, item.filename);
          if (r.ok) sent++; else failed++;
          if (total) panel.progress(found / total);
          updateText();
        }
      };
      const workers = Array.from({ length: PARALLEL_DOWNLOADS }, worker);

      for (const src of sources) {
        let index = 0;
        for await (const pin of paginate(src.resource, src.options, sourceUrl)) {
          if (job.cancelled) break;
          if (!pin || pin.type && pin.type !== "pin") continue;
          if (seen.has(pin.id)) continue;
          seen.add(pin.id);
          found++;
          index++;
          const media = mediaOf(pin, settings.videos);
          media.forEach((m, i) => {
            const suffix = media.length > 1 ? `_${i + 1}` : "";
            queue.push({
              url: m.url,
              filename: `${src.folder}/${String(index).padStart(4, "0")}_${pin.id}${suffix}.${m.ext}`,
            });
          });
          updateText();
        }
        if (job.cancelled) break;
      }
      collecting = false;
      updateText();
      await Promise.all(workers);

      if (job.cancelled) {
        panel.set(`Cancelado. ${sent} arquivos já tinham sido enviados.`, true);
      } else {
        panel.progress(1);
        // Sem login o Pinterest só entrega os primeiros ~25 pins.
        const incomplete = total && found < total * 0.9;
        panel.set(
          `Pronto! ${found}${total ? "/" + total : ""} pins · ${sent} arquivos enviados para download${failed ? ` · ${failed} falharam` : ""}.\n` +
          `Pasta: Downloads/${boardFolder}` +
          (incomplete ? `\n\nFaltaram pins — faça login no Pinterest para baixar a pasta inteira.` : ""),
          failed > 0 || incomplete
        );
      }
    } catch (err) {
      console.error("[PinTotalDownload]", err);
      panel.set(`Erro: ${err.message}`, true);
    } finally {
      job = null;
      panel.running(false);
    }
  }

  // ---------- Interface na página ----------

  const panel = (() => {
    let el, textEl, barEl, btnEl;
    const build = () => {
      if (el) return;
      el = document.createElement("div");
      el.className = "ptd-panel";
      el.innerHTML = `
        <div class="ptd-head">
          <strong>PinTotalDownload</strong>
          <button class="ptd-close" title="Fechar">×</button>
        </div>
        <div class="ptd-text"></div>
        <div class="ptd-bar"><div></div></div>
        <button class="ptd-cancel">Cancelar</button>`;
      document.documentElement.appendChild(el);
      textEl = el.querySelector(".ptd-text");
      barEl = el.querySelector(".ptd-bar > div");
      btnEl = el.querySelector(".ptd-cancel");
      el.querySelector(".ptd-close").onclick = () => { if (!job) el.classList.remove("ptd-show"); };
      btnEl.onclick = () => { if (job) { job.cancelled = true; panel.set("Cancelando…"); } };
    };
    return {
      show() { build(); el.classList.add("ptd-show"); },
      set(text, isError = false) { build(); textEl.textContent = text; el.classList.toggle("ptd-error", isError); },
      progress(f) { build(); barEl.style.width = `${Math.min(100, Math.round(f * 100))}%`; },
      running(on) { build(); btnEl.style.display = on ? "" : "none"; if (on) this.progress(0); fab.disabled = on; },
    };
  })();

  const fab = document.createElement("button");
  fab.className = "ptd-fab";
  fab.textContent = "⬇ Baixar pasta";
  fab.title = "Baixar todos os pins desta pasta";
  fab.onclick = downloadBoard;

  function refreshFab() {
    const isBoard = !!parseBoardUrl();
    if (isBoard && !fab.isConnected) document.documentElement.appendChild(fab);
    if (!isBoard && fab.isConnected && !job) fab.remove();
  }
  refreshFab();
  // O Pinterest é uma SPA: acompanha mudanças de URL.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; refreshFab(); }
  }, 700);

  // Mensagens do popup
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "ptd-status") {
      sendResponse({ isBoard: !!parseBoardUrl(), running: !!job });
    } else if (msg?.type === "ptd-start") {
      downloadBoard();
      sendResponse({ ok: true });
    }
  });
})();
