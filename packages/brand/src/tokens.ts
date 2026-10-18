/**
 * Snapshot of the knoad website theme.
 * Source: knoad/theme/index.ts (Chakra, dark by default).
 * Danger is new: the website has no semantic red. Warning reuses the bouncr orange.
 */
export const brand = {
  color: {
    deep: "#050807",
    forest: "#0d1f14",
    moss: "#1a3d2e",
    signal: "#3dd68c",
    signalHover: "#5ee3a2",
    signalMuted: "#2a9d5c",
    signalStrong: "#14603f",
    mist: "#dce8df",
    haze: "#f2f7f3",
    warning: "#f97316",
    danger: "#e11d48",
    dark: {
      bg: {
        base: "#050807",
        hero: "#0d1f14",
        elevated: "#1a3d2e",
        glass: "rgba(10, 22, 16, 0.58)",
        glassSolid: "rgba(13, 31, 20, 0.94)",
      },
      accent: {
        primary: "#3dd68c",
        hover: "#5ee3a2",
        soft: "rgba(61, 214, 140, 0.14)",
        glow: "rgba(61, 214, 140, 0.45)",
      },
      text: {
        primary: "rgba(255, 255, 255, 0.93)",
        muted: "rgba(255, 255, 255, 0.58)",
        faint: "rgba(255, 255, 255, 0.32)",
      },
      border: {
        subtle: "rgba(61, 214, 140, 0.38)",
        faint: "rgba(255, 255, 255, 0.12)",
        strong: "rgba(61, 214, 140, 0.55)",
      },
    },
    light: {
      bg: {
        base: "#f2f7f3",
        hero: "#dce8df",
        elevated: "#ffffff",
        glass: "rgba(255, 255, 255, 0.72)",
        glassSolid: "rgba(255, 255, 255, 0.96)",
      },
      accent: {
        primary: "#14603f",
        hover: "#2a9d5c",
        soft: "rgba(42, 157, 92, 0.18)",
        glow: "rgba(42, 157, 92, 0.35)",
      },
      text: {
        primary: "#050807",
        muted: "rgba(5, 8, 7, 0.62)",
        faint: "rgba(5, 8, 7, 0.35)",
      },
      border: {
        subtle: "rgba(13, 31, 20, 0.18)",
        faint: "rgba(0, 0, 0, 0.1)",
        strong: "rgba(20, 96, 63, 0.35)",
      },
    },
  },
  font: {
    heading: "Sora",
    body: "Inter",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    headingFamily: "Sora_600SemiBold",
    bodyFamily: "Inter_400Regular",
    bodyStrongFamily: "Inter_600SemiBold",
  },
  radius: {
    brand: 10,
    brandLg: 16,
    brandXl: 20,
  },
  shadow: {
    lift: "0 8px 24px rgba(0, 0, 0, 0.4)",
    glowSm: "0 0 14px rgba(61, 214, 140, 0.32)",
    glow: "0 0 28px rgba(61, 214, 140, 0.45)",
  },
  type: {
    caption: 13,
    headingSpacing: -0.02,
    labelTracking: 0.08,
  },
} as const;

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

export function renderBrandCss(): string {
  const dark = brand.color.dark;
  return `/* Generated from packages/brand/src/tokens.ts. Source: knoad/theme/index.ts. */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Sora:wght@600&display=swap");

:root {
  color-scheme: dark;
  --bg-base: ${dark.bg.base};
  --bg-hero: ${dark.bg.hero};
  --bg-elevated: ${dark.bg.elevated};
  --bg-glass: ${dark.bg.glass};
  --bg-glass-solid: ${dark.bg.glassSolid};
  --accent-primary: ${dark.accent.primary};
  --accent-hover: ${dark.accent.hover};
  --accent-soft: ${dark.accent.soft};
  --text-primary: ${dark.text.primary};
  --text-muted: ${dark.text.muted};
  --text-faint: ${dark.text.faint};
  --border-subtle: ${dark.border.subtle};
  --border-faint: ${dark.border.faint};
  --border-strong: ${dark.border.strong};
  --color-deep: ${brand.color.deep};
  --color-warning: ${brand.color.warning};
  --color-danger: ${brand.color.danger};
  --font-heading: "${brand.font.heading}", system-ui, sans-serif;
  --font-body: "${brand.font.body}", system-ui, sans-serif;
  --font-mono: ${brand.font.mono};
  --radius-brand: ${brand.radius.brand}px;
  --radius-brand-lg: ${brand.radius.brandLg}px;
  --radius-brand-xl: ${brand.radius.brandXl}px;
  --shadow-lift: ${brand.shadow.lift};
  --shadow-glow-sm: ${brand.shadow.glowSm};
  --shadow-glow: ${brand.shadow.glow};
  --caption: ${brand.type.caption}px;
}

html, body {
  margin: 0;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 16px;
}

.knoad-label {
  display: block;
  margin: 12px 0 6px;
  color: var(--text-muted);
  font-family: var(--font-heading);
  font-size: var(--caption);
  font-weight: 600;
  letter-spacing: ${brand.type.labelTracking}em;
  text-transform: uppercase;
}

.knoad-address {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--caption);
  line-height: 1.5;
  word-break: break-all;
}

.knoad-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-brand-lg);
  background: var(--bg-glass-solid);
  box-shadow: var(--shadow-lift);
  padding: 16px;
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .knoad-card {
    background: var(--bg-glass);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
  }
}

.knoad-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.09), transparent);
  pointer-events: none;
}

.knoad-button {
  appearance: none;
  width: 100%;
  margin-top: 12px;
  border-radius: var(--radius-brand);
  border: 1px solid transparent;
  padding: 12px 14px;
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.42, 0, 0.58, 1), box-shadow 0.18s ease, background 0.18s ease, filter 0.18s ease;
}

.knoad-button:active:not(:disabled) {
  transform: scale(0.98);
}

.knoad-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.knoad-button-primary {
  background: var(--accent-primary);
  color: var(--color-deep);
  box-shadow: var(--shadow-glow-sm);
}

.knoad-button-primary:hover:not(:disabled) {
  filter: brightness(1.12);
  box-shadow: var(--shadow-glow);
}

.knoad-button-outline {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

.knoad-button-outline:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent-primary);
}

.knoad-button-ghost {
  background: transparent;
  color: var(--text-muted);
}

.knoad-button-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}

.knoad-button-danger {
  background: transparent;
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.knoad-field {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-brand);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 15px;
  padding: 12px;
}

.knoad-field::placeholder {
  color: var(--text-faint);
}

.knoad-field:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.knoad-title {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 600;
  letter-spacing: ${brand.type.headingSpacing}em;
  color: var(--text-primary);
}
`;
}
