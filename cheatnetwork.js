(() => {
  const BASE = "https://cheatnetwork.eu/services/quizizz";
  const ANSWERS_PATH = "/services/quizizz/answers";
  const AUTO_PATH = "/services/quizizz/autoanswer";
  let codeSent = false;
  let pendingCode = "";

  const decodeMaybe = (txt) => {
    const s = (txt || "").trim();
    if (!s) return "";
    if (s.toLowerCase().startsWith("javascript:")) {
      const stripped = s.slice("javascript:".length);
      try {
        return decodeURIComponent(stripped);
      } catch (_) {
        return stripped;
      }
    }
    return s;
  };

  const toStr = (v) => (v == null ? "" : String(v));

  const dispatchInputEvents = (el) => {
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (_) {
      /* ignore */
    }
  };

  const setValue = (el, value) => {
    try {
      el.focus();
      el.value = value;
      dispatchInputEvents(el);
    } catch (_) {
      /* ignore */
    }
  };

  const looksLikeCodeInput = (el) => {
    const attrs = [el.name, el.id, el.placeholder, el.getAttribute?.("aria-label")].map(toStr).join(" ").toLowerCase();
    if (attrs.includes("quizizz")) return true;
    if (attrs.includes("code")) return true;
    if (attrs.includes("pin")) return true;
    return false;
  };

  const findCodeInput = () => {
    const candidates = Array.from(
      document.querySelectorAll('input[type="text"],input[type="search"],input[type="tel"],input[type="number"],input:not([type])')
    );
    let best = candidates.find(looksLikeCodeInput);
    if (!best) {
      best = candidates.find((el) => (el.maxLength || 0) >= 5);
    }
    return best || candidates[0] || null;
  };

  const looksLikeSubmit = (el) => {
    const text = (el.innerText || el.value || "").toLowerCase();
    if (!text && el.getAttribute) {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if (aria) return /check|submit|enter|start|unlock|next|get|answers|search/.test(aria);
    }
    return /check|submit|enter|start|unlock|next|get|answers|search|confirm/.test(text);
  };

  const findSubmit = () => {
    const nodes = Array.from(
      document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')
    );
    return nodes.find(looksLikeSubmit) || nodes[0] || null;
  };

  const clickNode = (el) => {
    if (!el) return;
    try {
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const detail = { bubbles: true, cancelable: true };
      const coords = rect
        ? { ...detail, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
        : detail;
      const makeEvt = (type) => {
        try {
          if (typeof PointerEvent !== "undefined") return new PointerEvent(type, coords);
        } catch (_) {
          /* ignore */
        }
        try {
          return new MouseEvent(type, coords);
        } catch (_) {
          return null;
        }
      };
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        const evt = makeEvt(type);
        if (evt) {
          try {
            el.dispatchEvent(evt);
          } catch (_) {
            /* ignore */
          }
        }
      });
      el.click?.();
    } catch (_) {
      /* ignore */
    }
  };

  const fillAndSubmit = (code) => {
    if (!code) return;
    const input = findCodeInput();
    if (input) {
      setValue(input, code);
    }
    const submit = findSubmit();
    if (submit) {
      clickNode(submit);
    }
  };

  const extractHashFromAnchors = () => {
    const anchors = Array.from(document.querySelectorAll("a[href*='/services/quizizz/answers#']"));
    for (const a of anchors) {
      const href = a.href || "";
      const idx = href.indexOf("#");
      if (idx >= 0) {
        const hash = href.slice(idx + 1);
        if (hash) return hash;
      }
    }
    return "";
  };

  const goAutoAnswer = () => {
    const href = window.location.href;
    const hash = (window.location.hash || "").replace(/^#/, "");
    const anchorHash = extractHashFromAnchors();
    const finalHash = hash || anchorHash;
    if (!finalHash) return;

    if (href.includes("/autoanswer#")) return;
    if (href.includes("/answers#") || anchorHash) {
      const target = `${BASE}/autoanswer#${finalHash}`;
      if (href !== target) {
        window.location.href = target;
      }
    }
  };

  const observeAnchors = () => {
    const observer = new MutationObserver(() => goAutoAnswer());
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  };

  const tryFillLoop = () => {
    if (!pendingCode) return;
    try {
      fillAndSubmit(pendingCode);
    } catch (_) {
      /* ignore */
    }
  };

  const grabConsoleCode = () => {
    if (codeSent) return;
    const hash = (window.location.hash || "").replace(/^#/, "");
    const href = window.location.href;
    if (!href.includes(AUTO_PATH) && !href.includes(ANSWERS_PATH)) return;
    let best = "";
    const consoleTextarea =
      document.querySelector("textarea") ||
      Array.from(document.querySelectorAll("textarea")).find((t) => (t.textContent || "").includes("let data")) ||
      null;
    if (consoleTextarea) {
      best = consoleTextarea.value || consoleTextarea.textContent || "";
    }
    if (!best) {
      const buckets = Array.from(document.querySelectorAll("textarea,code,pre"));
      for (const el of buckets) {
        const txt = (el.value || el.textContent || "").trim();
        if (!txt) continue;
        if (txt.toLowerCase().includes("let data") || txt.toLowerCase().includes("javascript:")) {
          if (txt.length > best.length) best = txt;
        }
      }
    }
    best = decodeMaybe(best);
    if (best) {
      codeSent = true;
      chrome.runtime.sendMessage(
        { type: "CHEATNET_CODE", code: best, hash },
        () => void chrome.runtime.lastError
      );
    }
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CHEATNET_FILL") {
      pendingCode = toStr(msg.code).trim();
      fillAndSubmit(pendingCode);
      goAutoAnswer();
    }
  });

  // Let background know we're ready to receive code.
  chrome.runtime.sendMessage({ type: "CHEATNET_READY" }, () => void chrome.runtime.lastError);

  window.addEventListener("hashchange", goAutoAnswer, false);
  window.addEventListener("hashchange", grabConsoleCode, false);
  document.addEventListener("DOMContentLoaded", () => {
    goAutoAnswer();
    grabConsoleCode();
    observeAnchors();
  });
  setInterval(() => {
    goAutoAnswer();
    grabConsoleCode();
    tryFillLoop();
  }, 800);
})();
