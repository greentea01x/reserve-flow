#!/usr/bin/env node
// render-mermaid.mjs — pre-render mermaid to inline-ready SVG with headless Chrome.
//
//   node render-mermaid.mjs <in.json> <outdir>
//     in.json  = [{"id":"booking-lifecycle","code":"stateDiagram-v2\n..."}]
//     writes     <outdir>/<id>.svg
//     stdout     one JSON line per diagram: {id, ok, w, h, bytes, error?}
//
// ALL diagrams render in ONE Chrome invocation (a temp HTML harness renders them
// in sequence, then serialises {id: svg} into a <pre> that --dump-dom hands back).
//
// Env overrides: MERMAID_JS (path to mermaid.min.js), CHROME (path to Chrome binary).
// ponytail: no puppeteer — one --dump-dom call does the whole job.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MERMAID_JS = process.env.MERMAID_JS ||
  resolve('node_modules/mermaid/dist/mermaid.min.js');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The document's own font stack — Chrome measures label widths with exactly the
// fonts the reader's browser will use, so nothing overflows its box.
const FONT = "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Thai',Tahoma,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose',
  htmlLabels: false,            // pure <text>/<tspan> — no foreignObject, no doc CSS leaking in
  theme: 'base',
  fontFamily: FONT,
  themeVariables: {
    background: 'transparent',
    fontFamily: FONT,
    fontSize: '15px',
    primaryColor: '#D9F1E0',
    primaryTextColor: '#17324d',
    primaryBorderColor: '#7F9A88',
    secondaryColor: '#F9E9B9',
    secondaryTextColor: '#17324d',
    secondaryBorderColor: '#D9BE72',
    tertiaryColor: '#F1F6FA',
    tertiaryTextColor: '#17324d',
    tertiaryBorderColor: '#B4C7D6',
    lineColor: '#7F9A88',
    textColor: '#17324d',
    mainBkg: '#D9F1E0',
    nodeBorder: '#7F9A88',
    nodeTextColor: '#17324d',
    clusterBkg: '#F1FBF4',
    clusterBorder: '#B9E3C5',
    titleColor: '#17324d',
    edgeLabelBackground: '#F7F9F5',
    // state diagram
    labelBackgroundColor: '#F7F9F5',
    transitionColor: '#7F9A88',
    transitionLabelColor: '#17324d',
    stateBkg: '#D9F1E0',
    altBackground: '#F1FBF4',
    compositeBackground: '#F1FBF4',
    compositeBorder: '#B9E3C5',
    compositeTitleBackground: '#E8F5EC',
    specialStateColor: '#427b5a',
    innerEndBackground: '#427b5a',
    // sequence diagram
    actorBkg: '#D9F1E0',
    actorBorder: '#7F9A88',
    actorTextColor: '#17324d',
    actorLineColor: '#A9BDB0',
    signalColor: '#3f586c',
    signalTextColor: '#17324d',
    labelBoxBkgColor: '#F9E9B9',
    labelBoxBorderColor: '#D9BE72',
    labelTextColor: '#17324d',
    loopTextColor: '#17324d',
    noteBkgColor: '#FFFAF0',
    noteTextColor: '#17324d',
    noteBorderColor: '#EFD58A',
    activationBkgColor: '#B9E3C5',
    activationBorderColor: '#427b5a',
    sequenceNumberColor: '#ffffff',
    // ER diagram
    attributeBackgroundColorOdd: '#FFFFFF',
    attributeBackgroundColorEven: '#F1FBF4',
  },
  flowchart: { htmlLabels: false, useMaxWidth: true, padding: 14, nodeSpacing: 45, rankSpacing: 55, curve: 'basis', diagramPadding: 8 },
  state: { useMaxWidth: true, padding: 12, nodeSpacing: 45, rankSpacing: 55 },
  sequence: { useMaxWidth: true, diagramMarginX: 20, diagramMarginY: 12, boxMargin: 10, width: 150, actorMargin: 46, noteMargin: 10, messageMargin: 34, mirrorActors: false, wrap: false },
  er: { useMaxWidth: true, entityPadding: 12, minEntityWidth: 110, diagramPadding: 12 },
  gantt: { useMaxWidth: true },
};

const usage = () => { console.error('usage: node render-mermaid.mjs <in.json> <outdir>'); process.exit(2); };
const [inFile, outDir] = process.argv.slice(2);
if (!inFile || !outDir) usage();
if (!existsSync(MERMAID_JS)) { console.error(`mermaid.min.js not found: ${MERMAID_JS} (set MERMAID_JS=)`); process.exit(2); }

const diagrams = JSON.parse(readFileSync(inFile, 'utf8'));
if (!Array.isArray(diagrams) || diagrams.some(d => !d || typeof d.id !== 'string' || typeof d.code !== 'string')) {
  console.error('in.json must be [{"id":"…","code":"…"}]'); process.exit(2);
}
mkdirSync(resolve(outDir), { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'rf-mermaid-'));
const harness = join(work, 'harness.html');
writeFileSync(harness, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff;font-family:${FONT}}</style>
<div id="stage"></div><pre id="rf-out"></pre>
<script src="${pathToFileURL(resolve(MERMAID_JS)).href}"></script>
<script>
const DIAGRAMS = ${JSON.stringify(diagrams)};
mermaid.initialize(${JSON.stringify(MERMAID_CONFIG)});
(async () => {
  const out = {};
  for (const d of DIAGRAMS) {
    try {
      const { svg } = await mermaid.render('rf-' + d.id, d.code, document.getElementById('stage'));
      out[d.id] = { ok: true, svg };
    } catch (e) {
      out[d.id] = { ok: false, error: String((e && e.message) || e) };
    }
  }
  document.getElementById('stage').remove();
  document.getElementById('rf-out').textContent = JSON.stringify(out);
})();
</script>`);

let dom;
try {
  dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--virtual-time-budget=60000', '--run-all-compositor-stages-before-draw',
    '--dump-dom', pathToFileURL(harness).href,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.error('chrome failed: ' + (e.message || e)); rmSync(work, { recursive: true, force: true }); process.exit(1);
}

const m = dom.match(/<pre id="rf-out">([\s\S]*?)<\/pre>/);
if (!m || !m[1].trim()) {
  console.error('no render output — mermaid never finished (check MERMAID_JS)');
  rmSync(work, { recursive: true, force: true }); process.exit(1);
}
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const results = JSON.parse(unescape(m[1]));
rmSync(work, { recursive: true, force: true });

// --- post-process: scale-to-fit, doc font, no fixed width -------------------
function polish(svg) {
  // mermaid emits its own <style> block; make every font-family the doc's stack
  svg = svg.replace(/font-family\s*:\s*[^;}]+/g, m2 =>
    /monospace|courier/i.test(m2) ? `font-family:${MONO}` : `font-family:${FONT}`);

  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) return { svg, w: 0, h: 0 };
  let tag = open[0];
  const vb = tag.match(/viewBox="([\d.\-\s]+)"/i);
  let w = 0, h = 0;
  if (vb) { const p = vb[1].trim().split(/\s+/).map(Number); w = Math.round(p[2]); h = Math.round(p[3]); }
  else {
    // no viewBox (shouldn't happen) — synthesise one from width/height
    w = Math.round(parseFloat((tag.match(/\bwidth="([\d.]+)/) || [])[1] || 0));
    h = Math.round(parseFloat((tag.match(/\bheight="([\d.]+)/) || [])[1] || 0));
    if (w && h) tag = tag.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
  }
  tag = tag.replace(/\s(width|height|style)="[^"]*"/g, '');
  tag = tag.replace('<svg', `<svg style="max-width:100%;height:auto;font-family:${FONT}"`);
  if (!/\brole=/.test(tag)) tag = tag.replace('<svg', '<svg role="img"');
  if (!/preserveAspectRatio=/.test(tag)) tag = tag.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
  return { svg: svg.replace(open[0], tag), w, h };
}

let bad = 0;
for (const d of diagrams) {
  const r = results[d.id];
  if (!r) { console.log(JSON.stringify({ id: d.id, ok: false, error: 'not rendered' })); bad++; continue; }
  if (!r.ok) { console.log(JSON.stringify({ id: d.id, ok: false, error: r.error })); bad++; continue; }
  const { svg, w, h } = polish(r.svg);
  const file = join(resolve(outDir), `${d.id}.svg`);
  writeFileSync(file, svg);
  console.log(JSON.stringify({ id: d.id, ok: true, w, h, bytes: Buffer.byteLength(svg) }));
}
process.exit(bad ? 1 : 0);
