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
