const statusEl = document.getElementById("status");
const goBtn = document.getElementById("go");
const opts = ["sections", "videos"];

chrome.storage.sync.get({ sections: true, videos: true }, (s) => {
  for (const k of opts) {
    const box = document.getElementById(k);
    box.checked = s[k];
    box.onchange = () => chrome.storage.sync.set({ [k]: box.checked });
  }
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/([a-z0-9-]+\.)?pinterest\./i.test(tab.url)) {
    statusEl.textContent = "Abra uma pasta do Pinterest para baixar.";
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "ptd-status" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      statusEl.textContent = "Recarregue a página do Pinterest (F5) e tente de novo.";
      return;
    }
    if (resp.running) {
      statusEl.textContent = "Download em andamento — veja o progresso na página.";
    } else if (resp.isBoard) {
      statusEl.textContent = "Pasta detectada. Pronto para baixar!";
      goBtn.disabled = false;
    } else {
      statusEl.textContent = "Esta página não é uma pasta. Abra uma pasta (pinterest.com/usuario/pasta/).";
    }
  });
  goBtn.onclick = () => {
    chrome.tabs.sendMessage(tab.id, { type: "ptd-start" });
    window.close();
  };
})();
