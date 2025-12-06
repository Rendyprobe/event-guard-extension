(() => {
  const DEFAULT_CONFIG = {
    stealth: true,
    forceVisible: true,
    blockOutbound: true,
    blockWebSocket: true,
    blockWorkers: true,
    blockEvents: [
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
      "unload"
    ],
    log: false
  };

  injectPagePatch(DEFAULT_CONFIG);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "EVENT_GUARD_UPDATE") {
      postConfig(msg.config || {});
      sendResponse({ ok: true });
    } else if (msg?.type === "EVENT_GUARD_DROP") {
      postDrop(msg.eventTypes || []);
      sendResponse({ ok: true });
    }
  });

  function postConfig(config) {
    window.postMessage({ source: "event-guard", type: "CONFIG_UPDATE", config }, "*");
  }

  function postDrop(eventTypes) {
    window.postMessage({ source: "event-guard", type: "DROP", eventTypes }, "*");
  }

  function injectPagePatch(config) {
    const patchFn = function pagePatch(initialConfig) {
      const BLOCK_URL_PATTERNS = [
        "player-infraction",
        "/frontend",
        "sentry",
        "envelope",
        "analytics",
        "collect",
        "hotjar",
        "segment"
      ];
      const nativeAdd = EventTarget.prototype.addEventListener;
      const nativeRemove = EventTarget.prototype.removeEventListener;
      const nativeSendBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
      const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
      const NativeXHR = window.XMLHttpRequest;
      const NativeWebSocket = window.WebSocket;
      const nativeWebSocketSend =
        NativeWebSocket && NativeWebSocket.prototype && NativeWebSocket.prototype.send
          ? NativeWebSocket.prototype.send
          : null;
      const NativeWorker = window.Worker;
      const NativeSharedWorker = window.SharedWorker;
      const NativeBroadcastChannel = window.BroadcastChannel;
      const registry = [];
      const cfg = Object.assign(
        {
          stealth: true,
          blockOutbound: true,
          blockWebSocket: true,
          blockWorkers: true,
          blockEvents: [],
          forceVisible: true,
          log: false
        },
        initialConfig || {}
      );

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
        "auxclick",
        "fullscreenchange",
        "webkitfullscreenchange"
      ];
      if (cfg.stealth) {
        cfg.blockEvents = HARD_BLOCK_EVENTS;
      }
      if (!cfg.blockEvents || !cfg.blockEvents.length) {
        cfg.blockEvents = HARD_BLOCK_EVENTS;
      }

      const shouldBlock = (type) => Array.isArray(cfg.blockEvents) && cfg.blockEvents.includes(type);
      const urlToString = (url) => {
        if (!url) return "";
        if (typeof url === "string") return url;
        if (url.url) return url.url;
        try {
          return String(url);
        } catch (_) {
          return "";
        }
      };
      const shouldBlockUrl = (url) => {
        const s = urlToString(url);
        return BLOCK_URL_PATTERNS.some((p) => s.includes(p));
      };
      const log = (...args) => cfg.log && console.debug("[EventGuard]", ...args);

      const setConst = (target, prop, value) => {
        try {
          Object.defineProperty(target, prop, {
            configurable: true,
            enumerable: false,
            get: () => value,
            set: () => undefined
          });
        } catch (_) {
          /* ignore */
        }
      };
      const setGetter = (target, prop, getter) => {
        try {
          Object.defineProperty(target, prop, {
            configurable: true,
            enumerable: false,
            get: getter,
            set: () => undefined
          });
        } catch (_) {
          /* ignore */
        }
      };

      const lockMethod = (obj, prop, fn) => {
        try {
          Object.defineProperty(obj, prop, {
            configurable: false,
            enumerable: false,
            writable: false,
            value: fn
          });
        } catch (_) {
          obj[prop] = fn;
        }
      };

      function patchedAdd(type, listener, options) {
        if (shouldBlock(type)) {
          log("blocked addEventListener for", type, this);
          return;
        }
        registry.push({ target: this, type, listener, options });
        return nativeAdd.call(this, type, listener, options);
      }

      function patchedRemove(type, listener, options) {
        for (let i = registry.length - 1; i >= 0; i -= 1) {
          const r = registry[i];
          if (r.target === this && r.type === type && r.listener === listener) {
            registry.splice(i, 1);
          }
        }
        return nativeRemove.call(this, type, listener, options);
      }

      lockMethod(EventTarget.prototype, "addEventListener", patchedAdd);
      lockMethod(EventTarget.prototype, "removeEventListener", patchedRemove);

      const drop = (types) => {
        for (let i = registry.length - 1; i >= 0; i -= 1) {
          const r = registry[i];
          const match = !types || types.length === 0 || types.includes(r.type);
          if (match) {
            try {
              nativeRemove.call(r.target, r.type, r.listener, r.options);
            } catch (err) {
              log("failed to remove listener", err);
            }
            registry.splice(i, 1);
          }
        }
      };

      const guardAddRemove = () => {
        if (EventTarget.prototype.addEventListener !== patchedAdd) {
          lockMethod(EventTarget.prototype, "addEventListener", patchedAdd);
        }
        if (EventTarget.prototype.removeEventListener !== patchedRemove) {
          lockMethod(EventTarget.prototype, "removeEventListener", patchedRemove);
        }
      };
      setInterval(guardAddRemove, 500);

      const applyForceVisible = () => {
        try {
          const fullscreenSelectors = [
            ":fullscreen",
            ":-webkit-full-screen",
            ":-moz-full-screen",
            ":-ms-fullscreen",
            ":full-screen"
          ];

          const spoofFullscreen = () => {
            try {
              const fakeElement = document.documentElement || document.body || document;
              const fullscreenState = { el: fakeElement, active: true };
              setGetter(Document.prototype, "fullscreenElement", () =>
                fullscreenState.active ? fullscreenState.el : null
              );
              setGetter(document, "fullscreenElement", () => (fullscreenState.active ? fullscreenState.el : null));
              setConst(Document.prototype, "fullscreenEnabled", true);
              setConst(document, "fullscreenEnabled", true);
              setGetter(Document.prototype, "webkitFullscreenElement", () =>
                fullscreenState.active ? fullscreenState.el : null
              );
              setGetter(document, "webkitFullscreenElement", () =>
                fullscreenState.active ? fullscreenState.el : null
              );
              setGetter(Document.prototype, "webkitIsFullScreen", () => fullscreenState.active);
              setGetter(document, "webkitIsFullScreen", () => fullscreenState.active);
              setGetter(Document.prototype, "mozFullScreen", () => fullscreenState.active);
              setGetter(document, "mozFullScreen", () => fullscreenState.active);
              setGetter(Document.prototype, "msFullscreenElement", () =>
                fullscreenState.active ? fullscreenState.el : null
              );
              setGetter(document, "msFullscreenElement", () => (fullscreenState.active ? fullscreenState.el : null));
              setConst(Document.prototype, "fullscreen", true);
              setConst(document, "fullscreen", true);
              setConst(Document.prototype, "webkitFullscreenEnabled", true);
              setConst(document, "webkitFullscreenEnabled", true);
              setConst(Document.prototype, "mozFullScreenEnabled", true);
              setConst(document, "mozFullScreenEnabled", true);
              setConst(Document.prototype, "msFullscreenEnabled", true);
              setConst(document, "msFullscreenEnabled", true);

              const spoofState = () => {
                fullscreenState.active = true;
                try {
                  const evt = new Event("fullscreenchange");
                  document.dispatchEvent(evt);
                  if (fullscreenState.el && fullscreenState.el.dispatchEvent) {
                    fullscreenState.el.dispatchEvent(evt);
                  }
                } catch (_) {
                  /* ignore */
                }
              };
              const fsProps = [
                "requestFullscreen",
                "webkitRequestFullscreen",
                "mozRequestFullScreen",
                "msRequestFullscreen"
              ];
              const fakeRequest = function () {
                fullscreenState.el = this || fakeElement;
                spoofState();
                return Promise.resolve();
              };
              fsProps.forEach((p) => {
                if (Element.prototype[p]) {
                  lockMethod(Element.prototype, p, fakeRequest);
                }
                if (document[p]) {
                  lockMethod(document, p, fakeRequest);
                }
              });
              const exitProps = ["exitFullscreen", "webkitExitFullscreen", "mozCancelFullScreen", "msExitFullscreen"];
              const fakeExit = () => {
                spoofState(); // keep state active to appear still fullscreen
                return Promise.resolve();
              };
              exitProps.forEach((p) => {
                if (document[p]) {
                  lockMethod(document, p, fakeExit);
                }
              });
              spoofState();
            } catch (_) {
              /* ignore */
            }
          };
          spoofFullscreen();

          const spoofViewport = () => {
            try {
              const width = screen?.width || window.innerWidth || 1920;
              const height = screen?.height || window.innerHeight || 1080;
              const setWin = (prop, val) => {
                try {
                  Object.defineProperty(window, prop, { configurable: true, get: () => val });
                } catch (_) {
                  /* ignore */
                }
              };
              const setScreen = (prop, val) => {
                try {
                  Object.defineProperty(screen, prop, { configurable: true, get: () => val });
                } catch (_) {
                  /* ignore */
                }
              };
              setWin("innerHeight", height);
              setWin("outerHeight", height);
              setWin("innerWidth", width);
              setWin("outerWidth", width);
              setScreen("availHeight", height);
              setScreen("availWidth", width);
              setScreen("height", height);
              setScreen("width", width);
              const vvTarget = window.visualViewport || {
                width: width,
                height: height,
                scale: 1
              };
              const spoofedVV = new Proxy(vvTarget, {
                get(obj, prop) {
                  if (prop === "height") return height;
                  if (prop === "width") return width;
                  if (prop === "scale") return 1;
                  return obj[prop];
                }
              });
              setConst(window, "visualViewport", spoofedVV);
              const docEl = document.documentElement;
              if (docEl) {
                setGetter(docEl, "clientHeight", () => height);
                setGetter(docEl, "clientWidth", () => width);
              }
              setGetter(document, "clientHeight", () => height);
              setGetter(document, "clientWidth", () => width);
              const nativeMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
              if (nativeMatchMedia) {
                const spoofedMatchMedia = (query) => {
                  if (typeof query === "string" && query.includes("display-mode: fullscreen")) {
                    return {
                      matches: true,
                      media: query,
                      onchange: null,
                      addListener: () => undefined,
                      removeListener: () => undefined,
                      addEventListener: () => undefined,
                      removeEventListener: () => undefined,
                      dispatchEvent: () => false
                    };
                  }
                  return nativeMatchMedia(query);
                };
                lockMethod(window, "matchMedia", spoofedMatchMedia);
              }
            } catch (_) {
              /* ignore */
            }
          };
          spoofViewport();

          const spoofRects = () => {
            try {
              const width = screen?.width || window.innerWidth || 1920;
              const height = screen?.height || window.innerHeight || 1080;
              const makeRect = () => ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                width,
                height,
                toJSON() {
                  return {
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: width,
                    bottom: height,
                    width,
                    height
                  };
                }
              });
              const patchRect = (obj) => {
                if (!obj) return;
                try {
                  Object.defineProperty(obj, "getBoundingClientRect", {
                    configurable: true,
                    enumerable: false,
                    value: () => makeRect()
                  });
                } catch (_) {
                  /* ignore */
                }
              };
              patchRect(document.documentElement);
              patchRect(document.body);
            } catch (_) {
              /* ignore */
            }
          };
          spoofRects();

          const spoofSelectors = () => {
            try {
              const includesFS = (sel) =>
                typeof sel === "string" && fullscreenSelectors.some((s) => sel.includes(s));
              const nativeMatches =
                Element.prototype.matches ||
                Element.prototype.msMatchesSelector ||
                Element.prototype.webkitMatchesSelector;
              if (nativeMatches) {
                const fakeMatches = function (sel) {
                  if (includesFS(sel)) return true;
                  return nativeMatches.call(this, sel);
                };
                lockMethod(Element.prototype, "matches", fakeMatches);
                lockMethod(Element.prototype, "webkitMatchesSelector", fakeMatches);
                lockMethod(Element.prototype, "msMatchesSelector", fakeMatches);
              }
              const nativeQS = Document.prototype.querySelector;
              const nativeQSA = Document.prototype.querySelectorAll;
              const nativeElQS = Element.prototype.querySelector;
              const nativeElQSA = Element.prototype.querySelectorAll;
              const fsQS = function (sel) {
                if (includesFS(sel)) return document.documentElement || document.body || document;
                return nativeQS.call(this, sel);
              };
              const fsQSA = function (sel) {
                if (includesFS(sel)) {
                  const el = document.documentElement || document.body || document;
                  return [el];
                }
                return nativeQSA.call(this, sel);
              };
              if (nativeQS) {
                lockMethod(Document.prototype, "querySelector", fsQS);
                lockMethod(Document.prototype, "querySelectorAll", fsQSA);
              }
              if (nativeElQS) {
                lockMethod(Element.prototype, "querySelector", fsQS);
              }
              if (nativeElQSA) {
                lockMethod(Element.prototype, "querySelectorAll", fsQSA);
              }
            } catch (_) {
              /* ignore */
            }
          };
          spoofSelectors();

          const nudgeEvents = () => {
            try {
              window.dispatchEvent(new Event("resize"));
              document.dispatchEvent(new Event("fullscreenchange"));
            } catch (_) {
              /* ignore */
            }
          };

          const removeFullscreenPrompt = () => {
            try {
              const candidates = Array.from(document.querySelectorAll("div,section,article,button"));
              candidates.forEach((el) => {
                const txt = (el.innerText || "").toLowerCase();
                if (txt.includes("layar penuh")) {
                  el.style.display = "none";
                }
              });
            } catch (_) {
              /* ignore */
            }
          };
          removeFullscreenPrompt();

          const keepSpoofing = () => {
            try {
              spoofFullscreen();
              spoofViewport();
              spoofRects();
              spoofSelectors();
              removeFullscreenPrompt();
              nudgeEvents();
            } catch (_) {
              /* ignore */
            }
          };
          setInterval(keepSpoofing, 500);

          setConst(Document.prototype, "hidden", false);
          setConst(document, "hidden", false);
          setConst(Document.prototype, "visibilityState", "visible");
          setConst(document, "visibilityState", "visible");
          setConst(Document.prototype, "hasFocus", () => true);
          setConst(document, "hasFocus", () => true);
          try {
            Document.prototype.hasFocus = () => true;
            document.hasFocus = () => true;
          } catch (_) {
            /* ignore */
          }
          try {
            document.__defineGetter__("hidden", () => false);
            document.__defineGetter__("visibilityState", () => "visible");
            document.__defineGetter__("webkitHidden", () => false);
          } catch (_) {
            /* ignore */
          }
          setConst(Window.prototype, "onfocus", null);
          setConst(Window.prototype, "onblur", null);
          setConst(Document.prototype, "onvisibilitychange", null);
          setConst(Document.prototype, "onwebkitvisibilitychange", null);
          setConst(Document.prototype, "onblur", null);
          setConst(Document.prototype, "onfocus", null);
          setConst(Document.prototype, "onfocusin", null);
          setConst(Document.prototype, "onfocusout", null);
          setConst(Document.prototype, "onpagehide", null);
          setConst(Document.prototype, "onpageshow", null);
          setConst(Document.prototype, "onbeforeunload", null);
          setConst(Document.prototype, "onunload", null);
          setConst(Document.prototype, "onfreeze", null);
          setConst(Document.prototype, "onresume", null);
          setConst(Window.prototype, "onresize", null);
          setConst(Window.prototype, "onorientationchange", null);
          setConst(Window.prototype, "onpointerout", null);
          setConst(Window.prototype, "onpointerleave", null);
          setConst(Window.prototype, "onmouseout", null);
          setConst(Window.prototype, "onmouseleave", null);
          setConst(Window.prototype, "oncontextmenu", null);
          setConst(Window.prototype, "onauxclick", null);
          setConst(Window.prototype, "onfullscreenchange", null);
          setConst(Window.prototype, "onwebkitfullscreenchange", null);
          const nullHandlerDescriptor = { get: () => null, set: () => undefined, configurable: true };
          const onProps = [
            "onvisibilitychange",
            "onwebkitvisibilitychange",
            "onblur",
            "onfocus",
            "onfocusin",
            "onfocusout",
            "onpagehide",
            "onpageshow",
            "onbeforeunload",
            "onunload",
            "onfreeze",
            "onresume",
            "onresize",
            "onorientationchange",
            "onpointerout",
            "onpointerleave",
            "onmouseout",
            "onmouseleave",
            "oncontextmenu",
            "onauxclick",
            "onfullscreenchange",
            "onwebkitfullscreenchange"
          ];
          onProps.forEach((prop) => {
            try {
              Object.defineProperty(document, prop, nullHandlerDescriptor);
            } catch (err) {
              log("defineProperty document", prop, err);
            }
            try {
              Object.defineProperty(window, prop, nullHandlerDescriptor);
            } catch (err) {
              log("defineProperty window", prop, err);
            }
          });
          const blocker = (e) => {
            e.stopImmediatePropagation();
            e.stopPropagation();
          };
          const eventsToBlock = [
            "visibilitychange",
            "webkitvisibilitychange",
            "blur",
            "focus",
            "focusin",
            "focusout",
            "pagehide",
            "pageshow",
            "beforeunload",
            "unload",
            "freeze",
            "resume",
            "resize",
            "orientationchange",
            "pointerout",
            "pointerleave",
            "mouseout",
            "mouseleave",
            "contextmenu",
            "auxclick",
            "fullscreenchange",
            "webkitfullscreenchange"
          ];
          eventsToBlock.forEach((evt) => {
            nativeAdd.call(document, evt, blocker, { capture: true });
            nativeAdd.call(window, evt, blocker, { capture: true });
          });
          log("forced visibility");
        } catch (err) {
          log("forceVisible error", err);
        }
      };

      const restoreOutbound = () => {
        if (nativeSendBeacon) navigator.sendBeacon = nativeSendBeacon;
        if (nativeFetch) window.fetch = nativeFetch;
        if (NativeXHR) window.XMLHttpRequest = NativeXHR;
        if (NativeWebSocket) {
          window.WebSocket = NativeWebSocket;
          if (nativeWebSocketSend) {
            NativeWebSocket.prototype.send = nativeWebSocketSend;
          }
        }
        if (NativeWorker) window.Worker = NativeWorker;
        if (NativeSharedWorker) window.SharedWorker = NativeSharedWorker;
        if (NativeBroadcastChannel) window.BroadcastChannel = NativeBroadcastChannel;
      };

      const applyOutboundBlock = () => {
        try {
          if (nativeSendBeacon) {
            const blockedSendBeacon = (url, data) => {
              if (cfg.blockOutbound || shouldBlockUrl(url)) {
                log("blocked sendBeacon", url);
                return true;
              }
              return nativeSendBeacon(url, data);
            };
            lockMethod(navigator, "sendBeacon", blockedSendBeacon);
          }
          if (nativeFetch) {
            const blockedFetch = (input, init) => {
              if (cfg.blockOutbound || shouldBlockUrl(input)) {
                log("blocked fetch", input);
                return Promise.resolve(
                  new Response("", { status: 204, statusText: "blocked by EventGuard", headers: {} })
                );
              }
              return nativeFetch(input, init);
            };
            lockMethod(window, "fetch", blockedFetch);
          }
          if (NativeXHR) {
            const proto = NativeXHR.prototype;
            if (!proto.__eg_patched) {
              const origOpen = proto.open;
              const origSend = proto.send;
              const origSetHeader = proto.setRequestHeader;
              proto.open = function (method, url, ...rest) {
                this.__eg_block = cfg.blockOutbound || shouldBlockUrl(url);
                this.__eg_url = url;
                return origOpen.call(this, method, url, ...rest);
              };
              proto.send = function (...args) {
                if (this.__eg_block) {
                  log("blocked xhr send", this.__eg_url);
                  try {
                    Object.defineProperty(this, "readyState", { value: 4 });
                    Object.defineProperty(this, "status", { value: 204 });
                  } catch (_) {
                    /* ignore */
                  }
                  try {
                    this.dispatchEvent(new Event("load"));
                    this.dispatchEvent(new Event("loadend"));
                  } catch (_) {
                    /* ignore */
                  }
                  return undefined;
                }
                return origSend.apply(this, args);
              };
              if (origSetHeader) {
                proto.setRequestHeader = function (...args) {
                  if (this.__eg_block) return undefined;
                  return origSetHeader.apply(this, args);
                };
              }
              Object.defineProperty(proto, "__eg_patched", { value: true });
            }
            lockMethod(window, "XMLHttpRequest", NativeXHR);
          }
          if (NativeWebSocket && cfg.blockWebSocket !== false) {
            const GuardedWS = function (url, protocols) {
              const ws = new NativeWebSocket(url, protocols);
              try {
                ws.send = (...args) => {
                  const payload = args?.[0];
                  if (cfg.blockOutbound || shouldBlockUrl(url) || (typeof payload === "string" && shouldBlockUrl(payload))) {
                    log("blocked websocket send", payload || url);
                    return undefined;
                  }
                  return nativeWebSocketSend.call(ws, payload);
                };
              } catch (_) {
                /* noop */
              }
              return ws;
            };
            GuardedWS.prototype = NativeWebSocket.prototype;
            window.WebSocket = GuardedWS;
            if (nativeWebSocketSend) {
              NativeWebSocket.prototype.send = (...args) => {
                const payload = args?.[0];
                if (cfg.blockOutbound || shouldBlockUrl(payload)) {
                  log("blocked websocket send(proto)", payload);
                  return undefined;
                }
                return nativeWebSocketSend.apply(this, args);
              };
            }
          }
          if (NativeWorker && cfg.blockWorkers !== false) {
            window.Worker = function GuardedWorker() {
              log("blocked Worker creation");
              return { postMessage: () => undefined, terminate: () => undefined };
            };
          }
          if (NativeSharedWorker && cfg.blockWorkers !== false) {
            window.SharedWorker = function GuardedSharedWorker() {
              log("blocked SharedWorker creation");
              return { port: { postMessage: () => undefined, close: () => undefined } };
            };
          }
          if (NativeBroadcastChannel && cfg.blockWorkers !== false) {
            window.BroadcastChannel = function GuardedBroadcastChannel() {
              log("blocked BroadcastChannel creation");
              return { postMessage: () => undefined, close: () => undefined, onmessage: null };
            };
          }
        } catch (err) {
          log("blockOutbound error", err);
        }
      };

      if (cfg.forceVisible) {
        applyForceVisible();
      }
      applyOutboundBlock();
      setInterval(applyOutboundBlock, 1000);

      window.__eventGuard = {
        config: cfg,
        registry,
        drop,
        restore() {
          EventTarget.prototype.addEventListener = nativeAdd;
          EventTarget.prototype.removeEventListener = nativeRemove;
          restoreOutbound();
        },
        forceVisible: applyForceVisible
      };

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "event-guard") return;
        if (data.type === "CONFIG_UPDATE" && data.config) {
          Object.assign(cfg, data.config);
          if (cfg.forceVisible) {
            applyForceVisible();
          }
          applyOutboundBlock();
        }
        if (data.type === "DROP") {
          drop(data.eventTypes || []);
        }
      });
    };

    const script = document.createElement("script");
    script.textContent = `(${patchFn.toString()})(${JSON.stringify(config)});`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }
})();
