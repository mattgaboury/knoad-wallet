import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
};

await build({ ...shared, entryPoints: [join(root, "src/background.ts")], outfile: join(dist, "background.js"), format: "esm" });
await build({ ...shared, entryPoints: [join(root, "src/content.ts")], outfile: join(dist, "content.js"), format: "iife" });
await build({ ...shared, entryPoints: [join(root, "src/inject.ts")], outfile: join(dist, "inject.js"), format: "iife" });
await build({ ...shared, entryPoints: [join(root, "src/popup/main.tsx")], outfile: join(dist, "popup.js"), format: "iife" });

cpSync(join(root, "popup.html"), join(dist, "popup.html"));
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "src/popup/popup.css"), join(dist, "popup.css"));
cpSync(join(root, "../../packages/brand/brand.css"), join(dist, "brand.css"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
