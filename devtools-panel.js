const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

const getConfig = () =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type: "EVENT_GUARD_GET_CONFIG" }, resolve));

function updateStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text || "";
  if (text) {
    setTimeout(() => (el.textContent = ""), 1500);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const stealthEl = document.getElementById("stealth");
  const logEl = document.getElementById("log");

  const cfg = await getConfig();
  stealthEl.checked = cfg.stealth !== false;
  logEl.checked = !!cfg.log;

  document.getElementById("save").addEventListener("click", () => {
    const config = {
      stealth: stealthEl.checked,
      forceVisible: true,
      blockOutbound: stealthEl.checked,
      blockWebSocket: stealthEl.checked,
      stripFullscreenCode: true,
      log: logEl.checked,
      blockEvents: []
    };

    chrome.runtime.sendMessage(
      { type: "EVENT_GUARD_SET_CONFIG", config, tabId: inspectedTabId },
      () => updateStatus("Applied")
    );
  });

  document.getElementById("drop").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "EVENT_GUARD_DROP", tabId: inspectedTabId }, () =>
      updateStatus("Dropped tracked listeners")
    );
  });

  document.getElementById("showReg").addEventListener("click", () => {
    chrome.devtools.inspectedWindow.eval("window.__eventGuard ? __eventGuard.registry.length : 0", (result, err) => {
      if (err) {
        updateStatus("Cannot read registry");
      } else {
        updateStatus(`Registry size: ${result}`);
      }
    });
  });
});
