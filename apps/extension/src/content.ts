const script = document.createElement("script");
script.src = chrome.runtime.getURL("inject.js");
script.dataset.icon = chrome.runtime.getURL("icons/icon128.png");
script.async = false;
document.documentElement.prepend(script);

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.source !== "knoad-page") return;
  const { id, args } = event.data as { id: number; args: { method: string; params?: unknown } };
  chrome.runtime
    .sendMessage({ type: "provider-request", origin: location.origin, method: args.method, params: args.params })
    .then((response) => {
      const body = (response ?? {}) as { result?: unknown; error?: string };
      window.postMessage({ source: "knoad-content", id, result: body.result, error: body.error }, "*");
    })
    .catch((error: unknown) => {
      window.postMessage(
        { source: "knoad-content", id, error: error instanceof Error ? error.message : "KNOAD Wallet did not answer." },
        "*",
      );
    });
});

chrome.runtime.onMessage.addListener((message) => {
  const body = message as { type?: string; chainId?: string; accounts?: string[] };
  if (body.type === "chain-changed") {
    window.postMessage({ source: "knoad-content", event: "chainChanged", payload: body.chainId }, "*");
  }
  if (body.type === "accounts-changed") {
    window.postMessage({ source: "knoad-content", event: "accountsChanged", payload: body.accounts }, "*");
  }
});
