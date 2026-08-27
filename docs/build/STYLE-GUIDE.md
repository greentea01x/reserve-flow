# ReserveFlow v2 — HTML style guide for section writers

All CSS is already in `skeleton.html` (`v1.css` + `v2-extra.css`). Write **fragments only**: one `<section id="…">…</section>` per file, inserted at `<!--SECTION:id-->`. A rendered sample of every new v2 class is in `_sample-section.html` (open `_check.html` to see it).

## Hard rules
- Section ids, exactly and in this order: `overview review decisions requirements flows architecture data-model api folders plan devops mockups appendix`. `<section id="x">` is the root of the fragment; `scroll-margin-top` comes from the global `section` rule — do not add it.
- Kicker numbering: `00` overview (hero, no kicker), `01 review`, `02 decisions`, `03 requirements`, `04 flows`, `05 architecture`, `06 data-model`, `07 api`, `08 folders`, `09 plan`, `10 devops`, `11 mockups`, `12 appendix`.
- Headings: one `<h2>` per section (inside `.head`), `<h3>` for subsections, `<h4>` inside cards/steps/boxes. Never `<h1>` (hero only).
- All ids unique; prefix sub-ids with the section id (`id="api-errors"`, `id="plan-w3"`).
- No `<script>`, no `<style>`, no external resources (fonts/images/CDN). Inline SVG is fine.
- No inline styles except rare `style="width:…"` / `margin-top` on a wrapper. Colors only via classes.
- Every `<table>` goes inside `<div class="tableWrap scroll-x">`. Wide `pre` (tree/diagram/code) already scroll on their own.
- Thai text as-is (UTF-8). Escape `<` `>` `&` in code as `&lt; &gt; &amp;`.
- Mobile: nothing may force the page wider than the viewport — use grids (they collapse), `.scroll-x`, and `.flow-steps` (wraps) instead of fixed widths.

## Section header (copy exactly)
```html
<section id="api"><div class="head"><div><div class="kicker">07 · API</div><h2>สัญญา API</h2><p class="desc">หนึ่งประโยคอธิบาย</p></div><div class="meta"><span class="tag proposed">REST · JSON</span></div></div>
…content…
</section>
```
Separate blocks with `<div class="divider"></div>`; put an `<h3>` before each block.

## v1 building blocks (real class names)
| Need | Markup |
|---|---|
| Cards grid | `<div class="grid3">` (`grid2`/`grid4`) → `<article class="card"><div class="icon">🎯</div><h3>…</h3><p>…</p></article>` (icon optional) |
| Stat tiles | `<div class="metrics four">` → `<div class="metric"><b>12</b><span>label</span></div>` (`.metrics` = 2 cols, `.metrics.four` = 4) |
| Table | `<div class="tableWrap scroll-x"><table><thead><tr><th>…</th></tr></thead><tbody><tr><td><b>ID</b></td><td>…</td></tr></tbody></table></div>`; priority cells `<td class="must">Must</td>` / `.should` / `.could`; severity text cells `.sevH .sevM .sevL` |
| Badges / tags | `<span class="badge ok">✓ Confirmed</span>` `.badge.pending` `.badge.bad`; `<span class="tag source">จากเอกสาร</span>` `.tag.proposed` `.tag.open` `.tag.conflict` |
| Buttons (demo only) | `<button class="btn primary smallBtn">` `.secondary` `.warn` `.danger` |
| Checklist | `<ul class="list"><li>…</li></ul>` (green ✓ bullets) |
| Scope columns | `<div class="scope"><div><h3>MVP</h3><ul class="list">…</ul></div><div>…</div><div>…</div></div>` (3 columns: green/yellow/red top border) |
| Numbered rules | `<div class="rules"><article class="rule"><div class="num">1</div><h4>…</h4><p>…</p></article></div>` |
| Status lifecycle | `<div class="states"><div class="stateRow"><div class="state">DRAFT</div><div class="arrow">→</div><div class="state y">PENDING</div><div class="state g">CONFIRMED</div><div class="state r">REJECTED</div></div></div>` |
| Flow (horizontal, scrolls) | `<div class="flows"><article class="flow"><h3>Employee</h3><div class="flowRow"><div class="step"><small>01</small><h4>Login</h4><p>…</p></div>…</div></article></div>` |
| Architecture boxes | `<div class="arch"><div class="archGrid"><div class="stack"><div class="box g"><h4>Next.js</h4><p>…</p></div></div><div class="arrow" style="font-size:24px;text-align:center">→</div>…</div></div>` (5 columns: stack, arrow, stack, arrow, stack) |
| Stack table (3 col) | `<div class="stackTable"><div>Layer</div><div><b>Choice</b></div><div>Rationale</div>…</div>` (groups of 3 divs) |
| Dark code (v1 look) | `<pre><code>…</code></pre>` — prefer the light `.code` below for v2 |
| ERD cards | `<div class="erd"><article class="entity"><h4>bookings</h4><ul><li><b>id</b> uuid PK</li><li>room_id FK</li></ul></article></div>` |
| Week timeline | `<div class="timeline"><div class="week"><small>WEEK 1</small><h4>…</h4><p>…</p></div>…</div>` (6 per row) |
| Test cards | `<div class="tests"><article class="test"><code>TC-001</code><h4>…</h4><p>…</p></article></div>` |
| Neutral callout | `<div class="note"><b>หมายเหตุ:</b> …</div>` |
| Two columns | `<div class="grid2"><div>…</div><div>…</div></div>` |
| Filter buttons | `<div class="filters" data-target="#sec-table"><button class="filter on" data-filter="all">ทั้งหมด</button><button class="filter" data-filter="critical">Critical</button></div>` then rows `<tr data-type="critical">` (or any element with `data-type`, space-separated multi-types OK). `data-target` optional: defaults to the next sibling. |

## New v2 classes (one example each)
- `.toc` — `<div class="toc"><a href="#api"><b>07</b>API<small>endpoints, errors</small></a>…</div>`
- `.code` / `.ddl` (light, labelled, collapsible >28rem) — `<div class="code" data-lang="SQL"><pre>CREATE TABLE …</pre></div>` (`.ddl` is an alias; the ขยาย/ย่อ button is added by JS; print expands all)
- `pre.tree` — `<pre class="tree"><b>apps/</b>\n├── <b>web/</b>   <i># Next.js</i>\n└── <b>api/</b></pre>` (`<b>` folders, `<i>` comments; guide chars muted automatically)
- `.diagram` — `<pre class="diagram">┌───┐ ascii/mermaid-as-text …</pre>` or `<div class="diagram"><svg viewBox="0 0 600 200">…</svg></div>`. No mermaid.js.
- `.matrix` — `<div class="tableWrap scroll-x matrix"><table>…<td class="yes">✓</td><td class="no">✗</td><td class="part">บางส่วน</td>…</table></div>` (dense, zebra, sticky head)
- `.ticket-table` — `<div class="tableWrap scroll-x ticket-table"><table>…</table></div>` (dense, max-height 72vh so the header sticks)
- Size / phase chips — `<span class="sz s">S</span>` `.sz.m` `.sz.l`; `<span class="ph mvp">MVP</span>` `.ph.v11` (1.1) `.ph.v2` (2)
- Severity chips — `<span class="sev-critical">Critical</span>` `.sev-high` `.sev-medium` `.sev-low`
- Changelog chips — `<span class="kept">kept</span>` `.changed` `.added` `.cut`
- `.decision-card` — `<article class="decision-card"><h4>D-03 · Pending ไม่ถือ slot <span class="st done">ตัดสินใจแล้ว</span></h4><p>…</p></article>` (status chip: `.st.done` ตัดสินใจแล้ว / `.st.confirm` ยืนยันกับบริษัท). Put several in `.grid3`.
- `.adr` — `<article class="adr"><h4><code>ADR-002</code> Postgres + btree_gist <span class="st done">ตัดสินใจแล้ว</span></h4><dl><dt>Context</dt><dd>…</dd><dt>Decision</dt><dd>…</dd><dt>Consequences</dt><dd>…</dd></dl></article>`
- `.open-box` — `<div class="open-box"><b>โดเมนอีเมล</b> — …<ul><li>…</li></ul></div>` (yellow callout; auto label "⚠ ต้องยืนยันกับบริษัท", override with `data-label="…"`)
- `.flow-steps` (wraps on mobile, auto-numbered) — `<div class="flow-steps"><div class="step"><h4>Login</h4><p>…</p></div>…</div>` (omit `<small>NN</small>`)
- `.pill` — same look as `.filter`; usable inside `.filters` or as a static label
- `.scroll-x` — generic horizontal-scroll wrapper for anything wide

## Prose wrapper `.md` (md2html output)
Converted markdown bodies sit in ONE `<div class="md">…</div>` right after `.head` (mockups: after `#prototype`, before `</section>`). Scoped rules: `.md h3` (20px, +anchor `a.anchor`), `.md h4`, `.md p/ul/ol/li`, `.md code` (light inline chip), `.md a:not([class])` (underlined, g6), `.md strong`, and 10px/16px vertical margins on `.tableWrap .code .ddl pre.tree pre.diagram .open-box .note .grid* .toc .flow-steps .states .flows`. Nothing in `.md` touches `.proto`.

## Mockups section
`mockups-v1-full.html` is the finished `#mockups` section (12 panels: Login, Employee dashboard, Available rooms, Room & time, Booking form, My bookings, Admin dashboard, Approval center, Admin · Users, Admin · Rooms, Reports, QR check-in). Add v2 text (UX fixes list, design tokens) **after** `</div></div>` of `#prototype` and before `</section>`; do not edit inside `.proto`. Demo handlers available globally: `showScreen('panel')`, `toast('msg')`, `approve('idA','idB')`, `reject('id')`.
