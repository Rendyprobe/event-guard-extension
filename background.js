const HARD_BLOCK_EVENTS = [
  "visibilitychange",
  "webkitvisibilitychange",
  "blur",
  "focus",
  "focusin",
  "focusout",
  "pagehide",
  "pageshow",
  "freeze",
  "resume",
  "beforeunload",
  "unload",
  "resize",
  "orientationchange",
  "pointerout",
  "pointerleave",
  "mouseout",
  "mouseleave",
  "contextmenu",
  "auxclick"
];

const DEFAULT_CONFIG = {
  stealth: true,
  forceVisible: true,
  blockOutbound: true,
  blockWebSocket: true,
  blockWorkers: true,
  blockEvents: HARD_BLOCK_EVENTS,
   stripFullscreenCode: true,
  log: false
};

const BLOCK_URL_PATTERNS = [
  "*player-infraction*",
  "*frontend*",
  "*sentry*",
  "*envelope*",
  "*analytics*",
  "*collect*",
  "*hotjar*",
  "*segment*"
];

const CHEATNET_URL = "https://cheatnetwork.eu/services/quizizz";
const cheatnetQueue = {};

const sanitizeCheatCode = (raw) => {
  let t = (raw || "").trim();
  if (!t) return "";
  if (t.toLowerCase().startsWith("javascript:")) {
    t = t.slice("javascript:".length);
    try {
      t = decodeURIComponent(t);
    } catch (_) {
      /* ignore */
    }
  }
  return t;
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ eventGuardConfig: DEFAULT_CONFIG });
  applyNetRules();
});

chrome.runtime.onStartup.addListener(() => {
  applyNetRules();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "EVENT_GUARD_GET_CONFIG") {
    chrome.storage.local.get("eventGuardConfig", (data) => {
      const cfg = { ...DEFAULT_CONFIG, ...(data.eventGuardConfig || {}) };
      if (!cfg.blockEvents || !cfg.blockEvents.length) {
        cfg.blockEvents = HARD_BLOCK_EVENTS;
      }
      chrome.storage.local.set({ eventGuardConfig: cfg });
      sendResponse(cfg);
    });
    return true;
  }

  if (msg?.type === "EVENT_GUARD_SET_CONFIG") {
    const cfg = { ...DEFAULT_CONFIG, ...(msg.config || {}) };
    if (cfg.stealth || !cfg.blockEvents || !cfg.blockEvents.length) {
      cfg.blockEvents = HARD_BLOCK_EVENTS;
    }
    chrome.storage.local.set({ eventGuardConfig: cfg }, () => {
      const targetTabId = msg.tabId || sender?.tab?.id;
      if (targetTabId) {
        sendConfigToTab(targetTabId, cfg);
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            sendConfigToTab(tabs[0].id, cfg);
          }
        });
      }
      sendResponse({ ok: true, cfg });
    });
    return true;
  }

  if (msg?.type === "EVENT_GUARD_DROP") {
    const targetTabId = msg.tabId || sender?.tab?.id;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: "EVENT_GUARD_DROP", eventTypes: msg.eventTypes || [] }, () => {
        void chrome.runtime.lastError;
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "CHEATNET_OPEN") {
    const code = (msg.code || "").toString().trim();
    const originTabId = msg.originTabId || sender?.tab?.id;
    if (!code) {
      sendResponse({ ok: false, error: "Kode kosong" });
      return true;
    }
    chrome.tabs.create({ url: CHEATNET_URL, active: false }, (tab) => {
      if (tab?.id) {
        cheatnetQueue[tab.id] = { code, originTabId };
        sendResponse({ ok: true, tabId: tab.id });
      } else {
        sendResponse({ ok: false, error: "Gagal membuka tab" });
      }
    });
    return true;
  }

  if (msg?.type === "CHEATNET_READY") {
    const tabId = sender?.tab?.id;
    const queue = tabId ? cheatnetQueue[tabId] : null;
    if (tabId && queue) {
      chrome.tabs.sendMessage(tabId, { type: "CHEATNET_FILL", code: queue.code }, () => {
        void chrome.runtime.lastError;
      });
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: "CHEATNET_FILL", code: queue.code }, () => {
          void chrome.runtime.lastError;
        });
      }, 1500);
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: "CHEATNET_FILL", code: queue.code }, () => {
          void chrome.runtime.lastError;
        });
      }, 3000);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "CHEATNET_CODE") {
    const tabId = sender?.tab?.id;
    const queue = tabId ? cheatnetQueue[tabId] : null;
    const code = sanitizeCheatCode(msg.code);
    if (queue?.originTabId && code) {
      chrome.scripting.executeScript(
        {
          target: { tabId: queue.originTabId },
          args: [code],
          world: "MAIN",
          func: (payload) => {
            try {
              console.info("[EventGuard] executing cheat payload", payload.slice(0, 80));
              (0, eval)(payload);
            } catch (err) {
              console.error("EventGuard cheat exec failed", err);
            }
          }
        },
        () => void chrome.runtime.lastError
      );
      delete cheatnetQueue[tabId];
    }
    sendResponse({ ok: true });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!cheatnetQueue[tabId]) return;
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith(CHEATNET_URL)) {
    chrome.tabs.sendMessage(tabId, { type: "CHEATNET_FILL", code: cheatnetQueue[tabId].code }, () => {
      void chrome.runtime.lastError;
    });
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "CHEATNET_FILL", code: cheatnetQueue[tabId].code }, () => {
        void chrome.runtime.lastError;
      });
    }, 1500);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (cheatnetQueue[tabId]) {
    delete cheatnetQueue[tabId];
  }
});

function sendConfigToTab(tabId, config) {
  chrome.tabs.sendMessage(tabId, { type: "EVENT_GUARD_UPDATE", config }, () => {
    void chrome.runtime.lastError; // swallow errors when tab has no content script (chrome:// pages)
  });
}

function applyNetRules() {
  try {
    const rules = BLOCK_URL_PATTERNS.map((pattern, idx) => ({
      id: idx + 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: pattern,
        resourceTypes: ["xmlhttprequest", "other", "ping", "main_frame", "sub_frame"]
      }
    }));
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: rules.map((r) => r.id), addRules: rules },
      () => void chrome.runtime.lastError
    );
  } catch (err) {
    // ignore
  }
}
