// Service worker: recebe pedidos do content script e entrega ao gerenciador de downloads do Chrome.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ptd-download") return false;

  chrome.downloads.download(
    {
      url: msg.url,
      filename: msg.filename,
      conflictAction: "uniquify",
      saveAs: false,
    },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "falha desconhecida" });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    }
  );
  return true; // resposta assíncrona
});
