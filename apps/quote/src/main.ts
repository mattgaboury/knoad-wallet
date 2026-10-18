import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listen } from "./server";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (!existsSync(envPath)) {
  console.error("Copy apps/quote/.env.example to apps/quote/.env, then run npm run quote again.");
  process.exit(1);
}
loadEnv(envPath);
const port = Number(process.env.PORT);
listen(Number.isInteger(port) && port > 0 ? port : 8787);

function loadEnv(path: string): void {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
