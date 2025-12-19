const getConfig = () =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type: "EVENT_GUARD_GET_CONFIG" }, resolve));

const getActiveTabId = () =>
  new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]?.id));
  });

document.addEventListener("DOMContentLoaded", async () => {
  const stealthEl = document.getElementById("stealth");
  const logEl = document.getElementById("log");
  const statusEl = document.getElementById("status");
  const cheatBtn = document.getElementById("cheatnet");
  const codeInput = document.getElementById("quizizzCode");

  const cfg = await getConfig();
  stealthEl.checked = cfg.stealth !== false;
  logEl.checked = !!cfg.log;

  document.getElementById("apply").addEventListener("click", async () => {
    const config = {
      stealth: stealthEl.checked,
      forceVisible: true,
      blockOutbound: stealthEl.checked,
      blockWebSocket: stealthEl.checked,
      stripFullscreenCode: true,
      log: logEl.checked,
      blockEvents: [] // server will merge defaults
    };

    const tabId = await getActiveTabId();
    chrome.runtime.sendMessage({ type: "EVENT_GUARD_SET_CONFIG", config, tabId }, () => {
      statusEl.textContent = "Applied";
      setTimeout(() => (statusEl.textContent = ""), 1200);
    });
  });

  document.getElementById("drop").addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    chrome.runtime.sendMessage({ type: "EVENT_GUARD_DROP", tabId }, () => {
      statusEl.textContent = "Dropped tracked listeners";
      setTimeout(() => (statusEl.textContent = ""), 1200);
    });
  });

  document.getElementById("stop").addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    const config = {
      stealth: false,
      forceVisible: false,
      blockOutbound: false,
      blockWebSocket: false,
      blockWorkers: false,
      stripFullscreenCode: false,
      log: false,
      blockEvents: []
    };
    chrome.runtime.sendMessage({ type: "EVENT_GUARD_SET_CONFIG", config, tabId }, () => {
      statusEl.textContent = "Shield stopped";
      setTimeout(() => (statusEl.textContent = ""), 1200);
    });
  });

  if (cheatBtn) {
    cheatBtn.addEventListener("click", () => {
      getActiveTabId().then((originTabId) => {
        const code = (codeInput?.value || "").trim();
        if (!code) {
          statusEl.textContent = "Masukkan kode Quizizz dulu";
          setTimeout(() => (statusEl.textContent = ""), 1500);
          return;
        }
        // buka akses outbound/WS di tab aktif supaya payload cheat bisa fetch
        const unlockCfg = {
          stealth: stealthEl.checked,
          forceVisible: true,
          blockOutbound: false,
          blockWebSocket: false,
          blockWorkers: false,
          stripFullscreenCode: true,
          log: logEl.checked,
          blockEvents: []
        };
        chrome.runtime.sendMessage({ type: "EVENT_GUARD_SET_CONFIG", config: unlockCfg, tabId: originTabId }, () => {
          void chrome.runtime.lastError;
        });
        statusEl.textContent = "Membuka CheatNetwork (latar)...";
        chrome.runtime.sendMessage({ type: "CHEATNET_OPEN", code, originTabId }, (resp) => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = "Gagal mengirim perintah";
            setTimeout(() => (statusEl.textContent = ""), 1500);
            return;
          }
          if (!resp?.ok) {
            statusEl.textContent = resp?.error || "Gagal membuka";
            setTimeout(() => (statusEl.textContent = ""), 1500);
            return;
          }
          statusEl.textContent = "CheatNetwork dibuka di latar";
          setTimeout(() => (statusEl.textContent = ""), 1500);
        });
      });
    });
  }
});
