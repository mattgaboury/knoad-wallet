/**
 * Prints docs/paper/reimagined.html to KNOAD_Wallet_White_Paper_Reimagined.pdf.
 * Run from the repository root: node docs/paper/render-reimagined.mjs
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const htmlPath = resolve(here, "reimagined.html");
const pdfPath = resolve(root, "KNOAD_Wallet_White_Paper_Reimagined.pdf");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pdf-header-footer",
  "--virtual-time-budget=15000",
  `--print-to-pdf=${pdfPath}`,
  `file://${htmlPath}`,
], { stdio: "inherit" });

console.log(pdfPath);
