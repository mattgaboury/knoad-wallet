import { Path, Svg } from "react-native-svg";

export type IconName =
  | "wallet"
  | "walletFill"
  | "activity"
  | "shield"
  | "shieldCheck"
  | "browser"
  | "gear"
  | "send"
  | "receive"
  | "swap"
  | "bridge"
  | "scan"
  | "bell"
  | "copy"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "more"
  | "menu"
  | "close"
  | "filter"
  | "contacts"
  | "share"
  | "search"
  | "external"
  | "plus"
  | "info"
  | "check"
  | "checkCircle"
  | "lock"
  | "fingerprint"
  | "faceId"
  | "key"
  | "rotate"
  | "permissions"
  | "link"
  | "plug"
  | "clock"
  | "rocket"
  | "xCircle"
  | "wand"
  | "gas"
  | "nonce"
  | "hash"
  | "asset"
  | "pending"
  | "included"
  | "failed"
  | "replaced"
  | "dropped"
  | "star"
  | "pencil"
  | "bookmark"
  | "history"
  | "explore";

type Mark = { d: string; fill?: boolean };

const PATHS: Record<IconName, Mark[]> = {
  wallet: [
    { d: "M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" },
    { d: "M2 12h20" },
    { d: "M16 15h2" },
  ],
  walletFill: [
    { d: "M4 7h16a2 2 0 0 1 2 2v2H3V9a2 2 0 0 1 1-1z", fill: true },
    { d: "M3 11h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z" },
    { d: "M16 15h2" },
  ],
  activity: [{ d: "M12 7v5l3 2" }, { d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }],
  shield: [{ d: "M12 3.5 19 6.2v5.3c0 4.2-2.9 6.9-7 8.5-4.1-1.6-7-4.3-7-8.5V6.2L12 3.5z" }],
  shieldCheck: [
    { d: "M12 3.5 19 6.2v5.3c0 4.2-2.9 6.9-7 8.5-4.1-1.6-7-4.3-7-8.5V6.2L12 3.5z" },
    { d: "M9 12.2 11 14.2 15.2 10" },
  ],
  browser: [
    { d: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" },
    { d: "M5 14c2.2-2 11.8-2 14 0" },
  ],
  gear: [
    { d: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
    { d: "M12 3.5v2.2M12 18.3V20.5M4.8 7.2l1.8 1.1M17.4 15.7l1.8 1.1M4.8 16.8l1.8-1.1M17.4 8.3l1.8-1.1" },
  ],
  send: [{ d: "M7 17 17 7" }, { d: "M9 7h8v8" }],
  receive: [{ d: "M12 5v10" }, { d: "M8 11l4 4 4-4" }, { d: "M6 19h12" }],
  swap: [{ d: "M7 8h11l-3-3" }, { d: "M17 16H6l3 3" }],
  bridge: [{ d: "M4 16c2.2-6 13.8-6 16 0" }, { d: "M8 16v3M16 16v3M4 19h16" }],
  scan: [{ d: "M7 4H4v3M17 4h3v3M7 20H4v-3M17 20h3v-3" }],
  bell: [{ d: "M6 16V10a6 6 0 0 1 12 0v6l1.5 2h-15L6 16z" }, { d: "M10 19a2 2 0 0 0 4 0" }],
  copy: [{ d: "M9 9h10v11H9z" }, { d: "M5 15V4h10" }],
  chevronRight: [{ d: "M9 6l6 6-6 6" }],
  chevronLeft: [{ d: "M15 6l-6 6 6 6" }],
  chevronDown: [{ d: "M6 9l6 6 6-6" }],
  more: [{ d: "M6 12h.01M12 12h.01M18 12h.01" }],
  menu: [{ d: "M4 7h16M4 12h16M4 17h16" }],
  close: [{ d: "M6 6l12 12M18 6 6 18" }],
  filter: [{ d: "M4 7h16M7 12h10M10 17h4" }],
  contacts: [{ d: "M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" }, { d: "M6 19c1.2-2.4 3-3.5 6-3.5S16.8 16.6 18 19" }],
  share: [{ d: "M12 4v10" }, { d: "M8 8l4-4 4 4" }, { d: "M6 13v6h12v-6" }],
  search: [{ d: "M11 6a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" }, { d: "M15 15l4 4" }],
  external: [{ d: "M10 6H6v12h12v-4" }, { d: "M13 5h6v6" }, { d: "M19 5l-8 8" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  info: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M12 11v5M12 8h.01" }],
  check: [{ d: "M5 12.5 10 17l9-10" }],
  checkCircle: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M8.5 12.2 11 14.6 15.5 9.5" }],
  lock: [{ d: "M8 11V8a4 4 0 0 1 8 0v3" }, { d: "M6 11h12v8H6z" }],
  fingerprint: [
    { d: "M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4" },
    { d: "M6 14c0-3.3 2.7-6 6-6s6 2.7 6 6c0 1.6-.3 3-.8 4" },
    { d: "M12 10v5c0 1.4-.4 2.6-1 3.6" },
    { d: "M9.5 16.5c.6 1.2 1.6 2 2.8 2.4" },
  ],
  faceId: [{ d: "M8 5H6v2M16 5h2v2M8 19H6v-2M16 19h2v-2" }, { d: "M9 10h.01M15 10h.01" }, { d: "M9 15c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5" }],
  key: [{ d: "M14 8a4 4 0 1 0-3.5 5.9L10 14.5 8.5 16 10 17.5 8.5 19H6v-2.2L9.2 13.5A4 4 0 0 0 14 8z" }],
  rotate: [{ d: "M19 12a7 7 0 1 1-2-4.9" }, { d: "M19 4v4h-4" }],
  permissions: [{ d: "M8 4h6l4 4v12H8z" }, { d: "M14 4v4h4" }, { d: "M10 13h6M10 16h4" }],
  link: [{ d: "M10 13l4-4" }, { d: "M8.5 15.5l-1 1a3 3 0 0 1-4.2-4.2l2-2a3 3 0 0 1 4.2 0" }, { d: "M15.5 8.5l1-1a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2 0" }],
  plug: [{ d: "M8 8V4M16 8V4" }, { d: "M7 8h10v4a5 5 0 0 1-10 0V8z" }, { d: "M12 17v3" }],
  clock: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M12 8v4l3 2" }],
  rocket: [{ d: "M14 10l-6 6" }, { d: "M9 14c-2 .4-3 2-3 2s1.6-1 2-3" }, { d: "M14 5c3 1 5 4 5 7-2 0-4-1-5-2 0 0-4 1-6 5 2-1 3-3 3-5 1-1 2-3 3-5z" }],
  xCircle: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M9 9l6 6M15 9l-6 6" }],
  wand: [{ d: "M5 19 15 9" }, { d: "M14 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" }, { d: "M18 13l.6 1.2L20 15l-1.4.6L18 17l-.6-1.4L16 15l1.4-.8L18 13z" }],
  gas: [{ d: "M7 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14" }, { d: "M6 20h12" }, { d: "M16 9h2l2 2v5a1.5 1.5 0 0 1-3 0" }],
  nonce: [{ d: "M5 8h14M5 12h14M5 16h10" }],
  hash: [{ d: "M9 5 7 19M17 5l-2 14M5 9h14M4 15h14" }],
  asset: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M12 8v8M9.5 10c.5-1 1.4-1.5 2.5-1.5 1.4 0 2.5.7 2.5 1.8S13.4 12 12 12s-2.5.7-2.5 1.8 1.1 1.7 2.5 1.7c1.1 0 2-.5 2.5-1.5" }],
  pending: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M12 8v4l2 2" }],
  included: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M8.5 12.2 11 14.6 15.5 9.5" }],
  failed: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M9 9l6 6M15 9l-6 6" }],
  replaced: [{ d: "M7 8h11l-3-3" }, { d: "M17 16H6l3 3" }],
  dropped: [{ d: "M12 4 20 18H4L12 4z" }, { d: "M12 10v4M12 16h.01" }],
  star: [{ d: "M12 4.5 14.2 9l5 .6-3.7 3.4.9 4.9L12 15.6 7.6 17.9l.9-4.9L4.8 9.6l5-.6L12 4.5z" }],
  pencil: [{ d: "M4 20h4l10-10-4-4L4 16v4z" }, { d: "M12 8l4 4" }],
  bookmark: [{ d: "M7 4h10v16l-5-3-5 3V4z" }],
  history: [{ d: "M4 12a8 8 0 1 0 2.2-5.5" }, { d: "M4 5v4h4" }, { d: "M12 8v4l3 2" }],
  explore: [{ d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "M14.5 9.5 11 13l3.5 1.5L13 11l1.5-1.5z" }],
};

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  const size = props.size ?? 24;
  const color = props.color ?? "#2EE6AF";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[props.name].map((mark, index) => (
        <Path
          key={`${props.name}-${index}`}
          d={mark.d}
          stroke={color}
          strokeWidth={props.name === "more" ? 2.6 : 1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={mark.fill ? color : "none"}
        />
      ))}
    </Svg>
  );
}
