/** Runs in the page before its own scripts. The page never receives a key. */
export const PAGE_BRIDGE = `
(function () {
  if (window.__knoad) return;
  window.__knoad = true;
  var pending = {};
  var listeners = {};
  function post(payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
  }
  function watch(url) {
    if (typeof url !== "string") return;
    if (url.indexOf("wc:") === 0 || url.indexOf("uri=wc:") !== -1 || url.indexOf("uri=wc%3A") !== -1) post({ type: "wc", url: url });
  }
  try {
    var open = window.open;
    window.open = function (url) {
      var target = String(url || "");
      watch(target);
      if (target.indexOf("wc:") === 0) return null;
      return open ? open.apply(window, arguments) : null;
    };
    ["assign", "replace"].forEach(function (name) {
      var orig = window.location[name];
      if (typeof orig !== "function") return;
      window.location[name] = function (url) {
        var target = String(url || "");
        watch(target);
        if (target.indexOf("wc:") === 0) return;
        return orig.call(window.location, url);
      };
    });
  } catch (e) {}
  window.__knoadDone = function (id, body) {
    var wait = pending[id];
    if (!wait) return;
    delete pending[id];
    if (body && body.ok) wait.resolve(body.result);
    else {
      var error = new Error((body && body.error) || "Rejected");
      error.code = (body && body.code) || 4001;
      wait.reject(error);
    }
  };
  window.__knoadEmit = function (event, payload) {
    (listeners[event] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) {}
    });
  };
  var ethereum = {
    isKnoad: true,
    request: function (args) {
      var id = String(Date.now()) + Math.random();
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        post({ type: "rpc", id: id, method: args && args.method, params: args && args.params });
      });
    },
    on: function (event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      return ethereum;
    },
    removeListener: function (event, fn) {
      listeners[event] = (listeners[event] || []).filter(function (item) { return item !== fn; });
    },
    enable: function () {
      return ethereum.request({ method: "eth_requestAccounts" });
    }
  };
  window.ethereum = ethereum;
  try {
    document.addEventListener("click", function (event) {
      var node = event.target && event.target.closest ? event.target.closest("a") : null;
      if (node && node.href) watch(node.href);
    }, true);
  } catch (e) {}
})();
true;
`;
