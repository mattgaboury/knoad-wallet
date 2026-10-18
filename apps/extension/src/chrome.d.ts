export {};

declare global {
  const chrome: {
    storage: {
      local: {
        get(key: string | string[] | null): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(key: string | string[]): Promise<void>;
      };
    };
    runtime: {
      getURL(path: string): string;
      sendMessage(message: unknown): Promise<unknown>;
      onMessage: {
        addListener(
          listener: (
            message: unknown,
            sender: { origin?: string; url?: string; tab?: { id?: number } },
            sendResponse: (response: unknown) => void,
          ) => boolean | void,
        ): void;
      };
    };
    action: {
      setBadgeText(details: { text: string }): Promise<void>;
      setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    };
    tabs: {
      query(query: Record<string, unknown>): Promise<{ id?: number }[]>;
      sendMessage(tabId: number, message: unknown): Promise<unknown>;
    };
  };
}
