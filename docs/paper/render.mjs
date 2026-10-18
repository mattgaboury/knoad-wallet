/**
 * Builds the formatted white paper PDF from docs/KNOAD_WALLET_WHITE_PAPER.md.
 * Run from the repository root: node docs/paper/render.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const htmlPath = resolve(here, "white-paper.html");
const pdfPath = resolve(root, "KNOAD_Wallet_White_Paper.pdf");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const markdown = readFileSync(resolve(root, "docs/KNOAD_WALLET_WHITE_PAPER.md"), "utf8");
const body = markdown.slice(markdown.indexOf("## Synopsis"));

function slug(title) {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function docPath(href) {
  if (href.startsWith("spec/")) return `docs/${href}`;
  if (href.startsWith("threat-model")) return `docs/${href}`;
  return href;
}

function inline(value) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let html = "";
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    html += escapeHtml(value.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) html += `<strong>${inline(token.slice(2, -2))}</strong>`;
    else if (token.startsWith("`")) html += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else {
      const link = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const label = inline(link[1]);
      const href = link[2];
      const shown = docPath(href);
      if (href.startsWith("#")) html += `<a href="${escapeHtml(href)}">${label}</a>`;
      else if (link[1] === href || link[1] === shown) html += label;
      else html += `${label} <span class="path">${escapeHtml(shown)}</span>`;
    }
    cursor = match.index + token.length;
  }
  html += escapeHtml(value.slice(cursor));
  return html;
}

function isRule(line) {
  return /^\|?\s*:?-{3,}/.test(line) && !/[a-z0-9]/i.test(line);
}

function table(block) {
  const rows = block
    .split("\n")
    .filter((line) => !isRule(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => inline(cell.trim())),
    );
  const head = rows[0].map((cell) => `<th>${cell}</th>`).join("");
  const bodyRows = rows
    .slice(1)
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function list(block) {
  const items = block
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => `<li>${inline(line.slice(2))}</li>`)
    .join("");
  return `<ul>${items}</ul>`;
}

function paragraph(block) {
  const html = inline(block.replace(/\n/g, " "));
  const step = html.startsWith("<strong>") ? " step" : "";
  return `<p class="${step.trim()}">${html}</p>`;
}

function figure(block) {
  const lines = block.split("\n").map((line) => line.trim()).filter((line) => line && line !== ":::");
  const kind = lines[0].startsWith(":::steps") ? "steps" : "grid";
  const title = lines[0].replace(/^:::(steps|grid)\s+/, "");
  const rows = lines.slice(1).map((line) => {
    const cut = line.indexOf(" | ");
    return {
      label: cut === -1 ? line : line.slice(0, cut),
      detail: cut === -1 ? "" : line.slice(cut + 3),
    };
  });
  const caption = `<figcaption>${escapeHtml(title)}</figcaption>`;
  if (kind === "steps") {
    const items = rows
      .map((row) => `<li><strong>${inline(row.label)}</strong>${row.detail ? `<span>${inline(row.detail)}</span>` : ""}</li>`)
      .join("");
    return `<figure class="map steps">${caption}<ol>${items}</ol></figure>`;
  }
  const cards = rows
    .map((row) => `<article><strong>${inline(row.label)}</strong>${row.detail ? `<p>${inline(row.detail)}</p>` : ""}</article>`)
    .join("");
  return `<figure class="map grid">${caption}<div>${cards}</div></figure>`;
}

function render(source) {
  const headings = [];
  const parts = [];
  for (const block of source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
    if (block.startsWith("### ")) {
      const title = block.slice(4);
      const id = slug(title);
      headings.push({ level: 3, title, id });
      parts.push(`<h3 id="${id}">${escapeHtml(title)}</h3>`);
    } else if (block.startsWith("## ")) {
      const title = block.slice(3);
      const id = slug(title);
      headings.push({ level: 2, title, id });
      parts.push(`<h2 id="${id}">${escapeHtml(title)}</h2>`);
    } else if (block === "---") {
      parts.push("<hr>");
    } else if (block.startsWith("|")) {
      parts.push(table(block));
    } else if (block.split("\n").every((line) => line.startsWith("- "))) {
      parts.push(list(block));
    } else if (block.startsWith(":::steps ") || block.startsWith(":::grid ")) {
      parts.push(figure(block));
    } else {
      parts.push(paragraph(block));
    }
  }
  return { headings, html: parts.join("\n") };
}

function toc(headings, pages) {
  const items = [];
  for (const heading of headings) {
    if (heading.level === 2) items.push({ ...heading, children: [] });
    else items.at(-1)?.children.push(heading);
  }
  const entry = (item) =>
    `<a href="#${item.id}">${escapeHtml(item.title)}<span class="pg">${pages[item.id] ?? ""}</span></a>`;
  return items
    .map((item) => {
      const children = item.children.length
        ? `<ol>${item.children.map((child) => `<li>${entry(child)}</li>`).join("")}</ol>`
        : "";
      return `<li>${entry(item)}${children}</li>`;
    })
    .join("");
}

const rendered = render(body);

function documentHtml(pages) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KNOAD Wallet — Technical white paper</title>
<style>
@font-face { font-family: Sora; src: url("fonts/Sora.ttf") format("truetype"); font-weight: 100 800; font-display: block; }
@font-face { font-family: Inter; src: url("fonts/Inter-Regular.woff2") format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: Inter; src: url("fonts/Inter-Medium.woff2") format("woff2"); font-weight: 500; font-display: block; }
@font-face { font-family: Inter; src: url("fonts/Inter-SemiBold.woff2") format("woff2"); font-weight: 600; font-display: block; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
@page {
  size: letter;
  margin: 0.78in 0.72in 0.68in;
  @top-left { content: "KNOAD Wallet"; font-family: Sora, sans-serif; font-size: 9pt; color: #14603f; }
  @bottom-left { content: "Pre-audit  ·  Not for assets of value"; font-family: Inter, sans-serif; font-size: 8pt; color: #5d7366; }
  @bottom-right { content: counter(page); font-family: Sora, sans-serif; font-size: 9pt; color: #14603f; }
}
@page cover {
  margin: 0;
  @top-left { content: none; }
  @top-right { content: none; }
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
html, body { margin: 0; background: #f4f8f5; color: #14261c; font-family: Inter, sans-serif; font-size: 11pt; line-height: 1.48; }
.cover {
  page: cover;
  min-height: 11in;
  background: #07140d;
  color: rgba(255, 255, 255, 0.93);
  padding: 0.72in 0.78in 0.62in;
  display: flex;
  flex-direction: column;
}
.cover-logo { width: 228px; height: auto; }
.eyebrow { margin: 0.46in 0 0; letter-spacing: 0.18em; text-transform: uppercase; font-size: 10pt; color: #3dd68c; font-family: Sora, sans-serif; }
h1 { margin: 0.06em 0 0.12em; font-family: Sora, sans-serif; font-weight: 600; font-size: 46pt; letter-spacing: -0.035em; line-height: 0.95; }
.deck { margin: 0.2em 0 0; max-width: 6.5in; font-family: Sora, sans-serif; font-weight: 600; font-size: 20pt; line-height: 1.22; letter-spacing: -0.025em; color: white; }
.glance { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.glance article { border-top: 2px solid #3dd68c; padding-top: 8px; }
.glance-title { margin: 0 0 0.15em; font-family: Sora, sans-serif; font-weight: 600; font-size: 12pt; color: white; }
.glance p { margin: 0; font-size: 9.5pt; line-height: 1.38; color: rgba(255, 255, 255, 0.72); }
.cover .status { margin: 0.28in 0 0; font-size: 8.5pt; line-height: 1.4; color: rgba(255, 255, 255, 0.55); }
.front { break-after: page; }
h2 { font-family: Sora, sans-serif; font-weight: 600; font-size: 20pt; letter-spacing: -0.03em; color: #0d1f14; margin: 1.15em 0 0.35em; padding-top: 0.35em; border-top: 3px solid #3dd68c; break-after: avoid; }
.front h2:first-child, h2#synopsis { margin-top: 0; }
h3 { font-family: Sora, sans-serif; font-weight: 600; font-size: 13.5pt; color: #14603f; margin: 1.15em 0 0.3em; break-after: avoid; }
p { margin: 0 0 0.7em; }
p.step strong { color: #14603f; font-family: Sora, sans-serif; }
a { color: #14603f; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.lead { font-size: 12pt; color: #1c3b2c; }
.callout { border-left: 3px solid #f97316; background: rgba(249, 115, 34, 0.09); padding: 0.55em 0.75em; margin: 0 0 0.9em; font-size: 10pt; }
.jumps { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.2em 0 0.8em; }
.jumps a { border: 1px solid rgba(20, 96, 63, 0.35); border-radius: 999px; padding: 0.18em 0.65em; text-decoration: none; font-size: 9pt; font-family: Sora, sans-serif; }
ol.toc { list-style: none; margin: 0; padding: 0; }
ol.toc > li { border-bottom: 1px solid rgba(20, 96, 63, 0.14); }
ol.toc a { display: block; text-decoration: none; color: #14261c; padding: 0.12em 0; font-family: Sora, sans-serif; font-size: 10.5pt; }
ol.toc .pg { float: right; color: #14603f; font-variant-numeric: tabular-nums; }
ol.toc ol { list-style: none; margin: 0 0 0.1em 0.85em; padding: 0; }
ol.toc ol a { font-family: Inter, sans-serif; font-size: 9.5pt; color: #3d5c4c; padding: 0.04em 0; }
ul { margin: 0 0 0.75em; padding-left: 1.15em; }
li { margin: 0.22em 0; }
ol.toc li { margin: 0; }
table { width: 100%; border-collapse: collapse; margin: 0.35em 0 0.85em; font-size: 9.2pt; line-height: 1.35; }
th { text-align: left; background: #0d1f14; color: white; font-family: Sora, sans-serif; font-weight: 500; padding: 5px 7px; }
td { padding: 5px 7px; vertical-align: top; border-bottom: 1px solid rgba(20, 96, 63, 0.16); }
tbody tr:nth-child(even) td { background: rgba(61, 214, 140, 0.12); }
code { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 0.84em; background: rgba(20, 96, 63, 0.08); padding: 0 0.18em; border-radius: 3px; }
.path { color: #5d7366; font-size: 0.86em; }
hr { border: 0; border-top: 1px solid rgba(20, 96, 63, 0.2); margin: 1em 0; }
h2 + p, h3 + p, h2 + ul, h3 + table, h2 + figure { break-before: avoid; }
figure.map { margin: 0.15em 0 1em; break-inside: avoid; }
figure.map figcaption { font-family: Sora, sans-serif; font-weight: 600; font-size: 11pt; color: #14603f; margin: 0 0 0.4em; }
figure.steps ol { list-style: none; margin: 0; padding: 0; }
figure.steps li { margin: 0; padding: 0 0 0.65em 0.85em; border-left: 3px solid #3dd68c; }
figure.steps li strong { display: block; font-family: Sora, sans-serif; font-size: 11pt; color: #0d1f14; }
figure.steps li span { display: block; color: #3d5c4c; font-size: 10pt; line-height: 1.35; }
figure.grid > div { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
figure.grid article { border-top: 2px solid #3dd68c; padding-top: 6px; }
figure.grid strong { display: block; font-family: Sora, sans-serif; font-size: 10.5pt; color: #0d1f14; margin-bottom: 0.12em; }
figure.grid p { margin: 0; font-size: 9.5pt; line-height: 1.35; color: #3d5c4c; }
</style>
</head>
<body>
<section class="cover">
  <img class="cover-logo" src="assets/logo-light.png" alt="knoad">
  <p class="eyebrow">Illuminary Labs</p>
  <h1>KNOAD Wallet</h1>
  <p class="deck">KNOAD keeps you safe from intrusion<br>by ending the standing access<br>every other wallet leaves in place.</p>
  <div class="glance">
    <article><p class="glance-title">Standing access is the intrusion</p><p>Every other wallet authorizes one key for the life of the account. Whoever holds that key is in, and they stay in.</p></article>
    <article><p class="glance-title">KNOAD ends that access</p><p>The key that can spend does not keep its seat. A leak is not a permanent place inside the wallet.</p></article>
    <article><p class="glance-title">You do not have to start over</p><p>Cutting an intruder off does not mean a new wallet, or moving what you already hold.</p></article>
    <article><p class="glance-title">We do not hold a way in</p><p>The way back is yours. We never see it, and we cannot open the wallet for anyone.</p></article>
  </div>
  <p class="status">Technical white paper · 16 October 2026 · Pre-audit. This is an explanation of the implementation, not a security certification, and not a clearance to put assets of value on these contracts.</p>
</section>
<section class="front">
  <h2 id="how-to-read-this">How to read this</h2>
  <p class="lead">The synopsis is the full easy read. It is enough on its own. The chapters after it tell the same story and put the comparisons, the maps, and the measurements next to each part. The appendices are lookup cards. You do not need one to understand the paper.</p>
  <p>Jump if you already know the question.</p>
  <div class="jumps">
    <a href="#synopsis">Synopsis</a>
    <a href="#3-using-it">Using it</a>
    <a href="#5-recovery-and-the-optional-waits">Recovery</a>
    <a href="#7-optional-commerce">Fees</a>
    <a href="#8-if-knoad-is-gone">If KNOAD is gone</a>
    <a href="#9-what-this-is-not">What this is not</a>
    <a href="#appendices">Appendices</a>
  </div>
  <p class="callout">Spec 1.4 is the normative contract text. This paper is the explanation. Spec 1.3, spec 1.2, and spec 1.1 remain the previous texts. The PDF named v1.0 is the earlier design draft.</p>
  <h2 id="contents">Contents</h2>
  <ol class="toc">${toc(rendered.headings, pages)}</ol>
</section>
${rendered.html}
</body>
</html>
`;
}

const port = 9334;
const profile = "/tmp/knoad-paper-chrome";
const child = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function debuggerUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      return version.webSocketDebuggerUrl;
    } catch {
      await sleep(150);
    }
  }
  throw new Error("Chrome did not open a debugging port.");
}

function connect(url) {
  const socket = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  const ready = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", () => resolvePromise());
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome.")));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = ++next;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      socket.close();
    },
  };
}

function pageNumbers(file) {
  const script = `
import PDFKit
import Foundation
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var found: [String: Int] = [:]
func walk(_ item: PDFOutline?) {
  guard let item else { return }
  if let label = item.label, let page = item.destination?.page {
    found[label] = doc.index(for: page) + 1
  }
  for index in 0..<item.numberOfChildren { walk(item.child(at: index)) }
}
walk(doc.outlineRoot)
print(String(data: try JSONSerialization.data(withJSONObject: found), encoding: .utf8)!)
`;
  const byTitle = JSON.parse(execFileSync("swift", ["-e", script, file], { encoding: "utf8" }));
  const pages = {};
  for (const heading of rendered.headings) pages[heading.id] = byTitle[heading.title];
  return pages;
}

async function printDocument(browser, pages) {
  writeFileSync(htmlPath, documentHtml(pages));
  const target = await browser.send("Target.createTarget", { url: `file://${htmlPath}?run=${Date.now()}` });
  const attached = await browser.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await browser.send("Page.enable", {}, sessionId);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await browser.send("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => document.readyState)",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (state.result?.value === "complete") break;
    await sleep(100);
  }
  const printed = await browser.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
    displayHeaderFooter: false,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  }, sessionId);
  writeFileSync(pdfPath, Buffer.from(printed.data, "base64"));
  await browser.send("Target.closeTarget", { targetId: target.targetId });
}

try {
  const browser = connect(await debuggerUrl());
  await browser.ready;
  await printDocument(browser, {});
  const pages = pageNumbers(pdfPath);
  await printDocument(browser, pages);
  browser.close();
  console.log(pdfPath);
  console.log(JSON.stringify(pages));
} finally {
  child.kill();
}
