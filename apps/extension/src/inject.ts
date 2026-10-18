(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const icon = script?.dataset.icon ?? "";
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let nextId = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "knoad-content") return;
    if (event.data.event) {
      listeners.get(event.data.event)?.forEach((listener) => listener(event.data.payload));
      return;
    }
    const waiter = pending.get(event.data.id);
    if (!waiter) return;
    pending.delete(event.data.id);
    if (event.data.error) waiter.reject(new Error(String(event.data.error)));
    else waiter.resolve(event.data.result);
  });

  const provider = {
    isKnoad: true,
    request(args: { method: string; params?: unknown }) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.postMessage({ source: "knoad-page", id, args }, "*");
      });
    },
    on(event: string, listener: (payload: unknown) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event: string, listener: (payload: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
  };

  function announce() {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({
          info: {
            uuid: "8d6c0c1e-7a1a-4e0a-9c1a-000000000001",
            name: "KNOAD Wallet",
            icon,
            rdns: "io.knoad.wallet",
          },
          provider,
        }),
      }),
    );
  }

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  if (!(window as Window & { ethereum?: unknown }).ethereum) {
    (window as Window & { ethereum?: unknown }).ethereum = provider;
  }
})();
