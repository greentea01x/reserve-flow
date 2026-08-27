#!/usr/bin/env python
"""build.py — final as-built spec Markdown -> ONE self-contained ReserveFlow HTML document.

  python build.py                    # assemble + check (the usual call)
  python build.py --assemble         # write docs/ReserveFlow_Spec.html (+ .artifact.html copy)
  python build.py --check            # balance / dup ids / leftovers / diagrams / external refs; exit 1 on failure
  python build.py --only api         # limit to one section (debug; combines with the above)
  python build.py --screenshot [--at ID]
  python build.py --selftest         # asserts the md->html contract on a tiny sample

Markdown -> HTML (see BUILD-CONTRACT.md):
  `## NN · Thai (English)`      section head (kicker / h2 / desc); 00 = hero
  ### / #### / #####            h3/h4/h5, id "<section>-<slug>", h3 gets an anchor + feeds the sub-nav
  table                         div.tableWrap.scroll-x.matrix (+ .ticket-table, .id-first); known cells -> chips
  ```lang                       div.code[data-lang] > pre   (JS adds ขยาย/ย่อ)
  ```mermaid  %% title: %% id:  pre-rendered inline SVG in <figure class="diagram">, cached in ../diagrams/<id>.svg
  ``` w/ tree or box glyphs     pre.tree / pre.diagram
  :::details[open] summary…:::  <details class="dt"> (+ count badge from a trailing "(n …)"), nests one level
  :::chart {json}:::            inline SVG chart (bar | hbar | heatmap), no chart library
  :icon[name]                   <svg class="ic"><use href="#i-name"></use></svg> from the sprite in assets/icons.svg
  > quote                       div.note; "ต้องยืนยันกับบริษัท…"/"Open…" -> div.open-box
  ---                           div.divider;   raw HTML -> escaped text, except <br>
"""
import argparse, hashlib, html, json, os, re, subprocess, sys, tempfile, unicodedata
from xml.etree import ElementTree as ET
import markdown
from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor
from markdown.inlinepatterns import InlineProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.dirname(HERE)                       # docs/spec
DOCS = os.path.dirname(SPEC)                       # docs
SEC_DIR = os.path.join(SPEC, "sections")
DIA_DIR = os.path.join(SPEC, "diagrams")
ASSETS = os.path.join(HERE, "assets")
OUT_HTML = os.path.join(DOCS, "ReserveFlow_Spec.html")
ART_HTML = os.path.join(DOCS, "ReserveFlow_Spec.artifact.html")
RENDERER = os.path.join(HERE, "render-mermaid.mjs")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# IA (BUILD-CONTRACT.md). Order = file order = nav order; nav label is the short Thai one.
SECTIONS = [("overview", "ภาพรวม"), ("product", "ระบบทำอะไร"), ("requirements", "ความต้องการ"),
            ("flows", "เส้นทางผู้ใช้"), ("architecture", "สถาปัตยกรรม"), ("data-model", "โครงสร้างข้อมูล"),
            ("api", "API"), ("folders", "โครงสร้างโค้ด"), ("plan", "แผนพัฒนา"), ("devops", "DevOps/QA"),
            ("mockups", "UI/UX"), ("appendix", "ภาคผนวก")]
ORDER = [s for s, _ in SECTIONS]
NUM2ID = {f"{i:02d}": s for i, s in enumerate(ORDER)}
DOC_TITLE = "ReserveFlow — สเปกระบบฉบับใช้งานจริง"
DOC_DESC = ("ReserveFlow — สเปกระบบจองห้องประชุมฉบับใช้งานจริง: ความต้องการ, user flow, สถาปัตยกรรม, "
            "โครงสร้างข้อมูล, API, โครงสร้างโค้ด, แผนพัฒนา, DevOps/QA และ UI/UX")
DOC_REV = "เอกสารรุ่น 2"

WARNINGS = []                                       # build warnings (printed by --check)
DIAGRAMS = {}                                       # id -> {"code","title","sec"}


def warn(msg):
    WARNINGS.append(msg)


# ---------- chip / class vocabularies (exact cell text, after strip) ----------
SEV = {"critical": "sev-critical", "blocking": "sev-critical", "high": "sev-high", "สูง": "sev-high",
       "medium": "sev-medium", "กลาง": "sev-medium", "low": "sev-low", "ต่ำ": "sev-low", "nit": "sev-low"}
PRIO = {"must": "must", "should": "should", "could": "could"}
PHASE = {"mvp": "ph mvp", "1.1": "ph v11", "phase 1.1": "ph v11", "2": "ph v2", "phase 2": "ph v2"}
PHASE.update({f"w{i}": "ph mvp" for i in range(0, 9)})
SIZE = {"s": "sz s", "m": "sz m", "l": "sz l", "xs": "sz s", "xl": "sz l"}
STATUS = {"ตัดสินใจแล้ว": "st done", "ยืนยันกับบริษัท": "st confirm", "ต้องยืนยันกับบริษัท": "st confirm"}
CHANGE = {"kept": "kept", "changed": "changed", "added": "added", "cut": "cut",
          "เก็บไว้": "kept", "เก็บ": "kept", "เปลี่ยน": "changed", "เพิ่ม": "added", "ตัด": "cut"}
YESNO = {"✓": "yes", "✔": "yes", "yes": "yes", "ใช่": "yes", "✗": "no", "✖": "no", "no": "no", "ไม่": "no",
         "partial": "part", "บางส่วน": "part"}
GATED = [(re.compile(r"ขนาด|size", re.I), SIZE), (re.compile(r"phase|เฟส|version|เวอร์ชัน", re.I), PHASE)]
PHASE_SAFE = {k: v for k, v in PHASE.items() if k == "mvp" or k.startswith("w")}
PREFIX_VOCABS = [SEV, STATUS, PHASE_SAFE]           # "High (ปรับ…)" -> chip + tail text
DELIM = re.compile(r"^(?:$|[\s(·/:,;])")
GLANCE_RE = re.compile(r"at a glance|โดยสรุป|key facts", re.I)
OPEN_RE = re.compile(r"^\s*(?:\*\*)?(?:ต้องยืนยันกับบริษัท|Open\b)")
OPEN_STRIP = re.compile(r"^\s*ต้องยืนยันกับบริษัท\s*(?:\([^)]*\))?\s*[:：—–-]?\s*")
HEAD_RE = re.compile(r"^##\s+(\d\d)\s*[·•:\-–]\s*(.*?)\s*(?:\(([^()]*)\))?\s*$")
ID_RE = re.compile(r"^\s*<!--\s*id:\s*([a-z][\w-]*)\s*-->\s*$", re.M)
TREE_RE = re.compile(r"^[\s│]*[├└]─+", re.M)
BOX_RE = re.compile(r"[┌┐┬┼═╔╗╭╮▶►]|──+>|<──+")
LANG = {"ts": "TS", "tsx": "TSX", "js": "JS", "sql": "SQL", "json": "JSON", "http": "HTTP", "yaml": "YAML", "yml": "YAML",
        "bash": "BASH", "sh": "BASH", "shell": "BASH", "dockerfile": "DOCKERFILE", "caddyfile": "CADDY", "env": "ENV",
        "txt": "TXT", "text": "TXT", "": "TXT", "none": "TXT", "md": "MD", "html": "HTML", "css": "CSS", "toml": "TOML"}
ICONS = ["calendar", "clock", "room", "users", "user-check", "shield", "lock", "mail", "bell", "qr", "chart",
         "database", "server", "browser", "gear", "check", "x", "warn", "info", "arrow-right", "doc", "tag",
         "key", "refresh"]

esc = lambda t: html.escape(t, quote=False)          # noqa: E731
attr = lambda t: html.escape(t, quote=True)          # noqa: E731


# ---------- conversion context (one per section; shared by nested :::details) ----------
class Ctx:
    def __init__(self, sec):
        self.sec = sec
        self.used = set()        # heading slugs -> no duplicate ids
        self.blocks = {}         # token -> html
        self.depth = 0           # ::: nesting
        self.n = 0

    def token(self, html_):
        self.n += 1
        t = f"@@RFB{self.n}@@"
        self.blocks[t] = html_
        return t


# ---------- fenced code ----------
def make_fence(ctx):
    def fence(source, language, css_class, options, md, **kw):
        lang = (language or "").lower()
        plain = lang in ("", "text", "txt", "tree", "diagram", "ascii")
        if lang == "mermaid":
            return mermaid_figure(source, ctx)
        if plain and BOX_RE.search(source):
            return f'<pre class="diagram">{esc(source)}</pre>'
        if plain and TREE_RE.search(source):
            lines = []
            for ln in source.split("\n"):            # folders bold, trailing # comments muted
                ln = esc(ln)
                ln = re.sub(r"(\S)(\s{2,}|\s#)(\S.*)$", r"\1\2<i>\3</i>", ln, count=1)
                ln = re.sub(r"(?<![\w./-])([\w.@\-]+/)(?=\s|$|<)", r"<b>\1</b>", ln)
                lines.append(ln)
            return '<pre class="tree">' + "\n".join(lines) + "</pre>"
        label = LANG.get(lang, lang.upper() or "TXT")
        return f'<div class="code" data-lang="{attr(label)}"><pre>{esc(source)}</pre></div>'
    return fence


def mermaid_figure(source, ctx):
    """```mermaid -> <figure class="diagram"> with a token the diagram pass fills with inline SVG."""
    t = re.search(r"^%%\s*title:\s*(.+?)\s*$", source, re.M)
    i = re.search(r"^%%\s*id:\s*([\w-]+)\s*$", source, re.M)
    did = i.group(1) if i else None
    if not did:
        did = f"{ctx.sec}-{len(DIAGRAMS) + 1:02d}"
        warn(f"{ctx.sec}: mermaid block without '%% id:' -> {did}")
    if not t:
        warn(f"{ctx.sec}: mermaid '{did}' has no '%% title:'")
    if did in DIAGRAMS:
        warn(f"duplicate diagram id '{did}' ({DIAGRAMS[did]['sec']} and {ctx.sec})")
        did += "-2"
    DIAGRAMS[did] = {"code": source, "title": t.group(1) if t else "", "sec": ctx.sec}
    cap = f"<figcaption>{esc(t.group(1))}</figcaption>" if t else ""
    return f'<figure class="diagram" id="dg-{attr(did)}"><div class="dg">@@RFD:{did}@@</div>{cap}</figure>'


# ---------- tree helpers ----------
def text_of(el):
    return "".join(el.itertext()).strip()


def slugify(text, used):
    t = unicodedata.normalize("NFKD", text)
    num = re.match(r"^\s*(\d+(?:\.\d+)*)", t)
    words = re.findall(r"[A-Za-z0-9]+", t[num.end():] if num else t)
    base = "-".join(([num.group(1).replace(".", "-")] if num else []) + [w.lower() for w in words][:6]) or "h"
    s, i = base, 2
    while s in used:
        s, i = f"{base}-{i}", i + 1
    used.add(s)
    return s


def add_class(el, cls):
    el.set("class", (el.get("class", "") + " " + cls).strip())


def move_kids(src, dst):
    dst.text = src.text
    for c in list(src):
        src.remove(c)
        dst.append(c)


def set_chip(td, cls, text, as_span=True):
    for c in list(td):
        td.remove(c)
    if as_span:
        td.text = None
        sp = ET.SubElement(td, "span", {"class": cls})
        sp.text = text
    else:
        td.text = text
        td.set("class", (td.get("class", "") + " " + cls).strip())


class SpecTree(Treeprocessor):
    def __init__(self, md, ctx):
        super().__init__(md)
        self.ctx = ctx
        self.last_h3 = ""

    def run(self, root):
        parent = {c: p for p in root.iter() for c in p}
        for el in list(root.iter()):
            tag = el.tag
            if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                if tag in ("h1", "h2"):
                    el.tag = tag = "h3"
                if tag == "h3":
                    self.last_h3 = text_of(el)
                hid = f"{self.ctx.sec}-{slugify(text_of(el), self.ctx.used)}"
                el.set("id", hid)
                if tag == "h3":
                    a = ET.SubElement(el, "a", {"class": "anchor", "href": "#" + hid, "aria-label": "link"})
                    a.text, a.tail = "#", None
                    prev = list(el)[-2] if len(el) > 1 else None
                    if prev is not None:
                        prev.tail = (prev.tail or "") + " "
                    else:
                        el.text = (el.text or "") + " "
            elif tag == "table":
                self.table(el, parent[el])
            elif tag == "blockquote":
                el.tag = "div"
                el.set("class", "open-box" if OPEN_RE.match(text_of(el)) else "note")
                if el.get("class") == "open-box":
                    self.strip_open(el)
            elif tag == "p" and OPEN_RE.match(text_of(el)) and parent[el].tag not in ("li", "td", "th"):
                el.tag = "div"
                el.set("class", "open-box")
                self.strip_open(el)
            elif tag == "hr":
                el.tag = "div"
                el.set("class", "divider")

    def strip_open(self, el):
        first = el[0] if (len(el) and el[0].tag == "p" and not (el.text or "").strip()) else el
        if first.text and OPEN_STRIP.match(first.text):
            first.text = OPEN_STRIP.sub("", first.text, count=1)
        elif len(first) and first[0].tag == "strong" and OPEN_STRIP.fullmatch(first[0].text or ""):
            tail = first[0].tail or ""
            first.remove(first[0])
            first.text = re.sub(r"^\s*[:：—–-]?\s*", "", (first.text or "") + tail)

    def tiles(self, tbl, par, body):
        """2-column key/value table under an 'at a glance' h3 -> .metric tiles."""
        idx = list(par).index(tbl)
        div = ET.Element("div", {"class": "metrics glance"})
        div.tail = tbl.tail
        for r in body:
            cells = [c for c in r if c.tag in ("td", "th")]
            if len(cells) < 2:
                continue
            m = ET.SubElement(div, "div", {"class": "metric"})
            move_kids(cells[0], ET.SubElement(m, "b"))
            move_kids(cells[1], ET.SubElement(m, "span"))
        par.remove(tbl)
        par.insert(idx, div)

    def table(self, tbl, par):
        heads = [text_of(th) for th in tbl.iter("th")]
        body = [r for r in tbl.iter("tr") if any(c.tag == "td" for c in r)]
        first_col = [text_of(r[0]) for r in body if len(r)]
        ticket = any(re.search(r"\bDoD\b|Definition of Done", h) for h in heads) or \
            (first_col and sum(bool(re.fullmatch(r"T-\d{3}", c)) for c in first_col) > len(first_col) // 2)
        if heads and not any(heads):                 # empty header row -> drop thead
            thead = tbl.find("thead")
            if thead is not None:
                tbl.remove(thead)
            if GLANCE_RE.search(self.last_h3) and body and max(len(r) for r in body) == 2:
                return self.tiles(tbl, par, body)
        for tr in body:
            for i, td in enumerate(tr):
                if td.tag != "td":
                    continue
                t = text_of(td)
                k = t.lower()
                h = heads[i] if i < len(heads) else ""
                if t and len(t) <= 16 and " " not in t:
                    add_class(td, "nw")
                if k in SEV:
                    set_chip(td, SEV[k], t)
                elif k in PRIO:
                    set_chip(td, PRIO[k], t, as_span=False)
                elif k in STATUS:
                    set_chip(td, STATUS[k], t)
                elif k in CHANGE:
                    set_chip(td, CHANGE[k], t)
                elif k in YESNO:
                    set_chip(td, YESNO[k], t, as_span=False)
                elif k in PHASE_SAFE:
                    set_chip(td, PHASE_SAFE[k], t)
                else:
                    for rx, vocab in GATED:
                        if k in vocab and rx.search(h):
                            set_chip(td, vocab[k], t)
                            break
                    else:
                        self.prefix_chip(td)
        narrow = sum(1 for c in first_col if c and len(c) <= 26 and c.count(" ") <= 1)
        cls = "tableWrap scroll-x " + ("ticket-table" if ticket else "matrix")
        if first_col and narrow >= max(2, int(len(first_col) * 0.6)):
            cls += " id-first"
        idx = list(par).index(tbl)
        wrap = ET.Element("div", {"class": cls})
        wrap.tail, tbl.tail = tbl.tail, None
        par.remove(tbl)
        wrap.append(tbl)
        par.insert(idx, wrap)

    def prefix_chip(self, td):
        lead = td.text or ""
        low = lead.lower().lstrip()
        for vocab in PREFIX_VOCABS:
            for tok in sorted(vocab, key=len, reverse=True):
                if low.startswith(tok) and DELIM.match(low[len(tok):]):
                    n = len(lead) - len(low)
                    sp = ET.Element("span", {"class": vocab[tok]})
                    sp.text, sp.tail = lead[n:n + len(tok)], lead[n + len(tok):]
                    td.text = None
                    td.insert(0, sp)
                    return


class BrPattern(InlineProcessor):
    def handleMatch(self, m, data):
        return ET.Element("br"), m.start(0), m.end(0)


class IconPattern(InlineProcessor):
    def handleMatch(self, m, data):
        name = m.group(1)
        if name not in ICONS:
            warn(f"unknown icon ':icon[{name}]' (sprite has: {', '.join(ICONS)})")
            return None, None, None
        svg = ET.Element("svg", {"class": "ic", "aria-hidden": "true"})
        ET.SubElement(svg, "use", {"href": f"#i-{name}"})
        return svg, m.start(0), m.end(0)


class SpecExt(Extension):
    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx

    def extendMarkdown(self, md):
        md.preprocessors.deregister("html_block")    # raw HTML -> text
        md.inlinePatterns.deregister("html")
        md.inlinePatterns.register(BrPattern(r"<br\s*/?>", md), "br", 95)
        md.inlinePatterns.register(IconPattern(r":icon\[([a-z][\w-]*)\]", md), "icon", 185)  # before link (160)
        md.treeprocessors.register(SpecTree(md, self.ctx), "spec", 15)


# ---------- ::: blocks (details / chart) ----------
FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
BLK_OPEN = re.compile(r"^\s{0,3}:::[ \t]*([a-z][\w-]*)(\[open\])?[ \t]*(.*?)\s*$")
BLK_CLOSE = re.compile(r"^\s{0,3}:::\s*$")
COUNT_RE = re.compile(r"^(.*?)\s*[（(](\d[^()（）]*)[）)]\s*$")


def extract_blocks(text, ctx):
    """Replace every top-level ::: block with a token; nested ones are handled by the recursive convert."""
    lines, out, i, fence = text.split("\n"), [], 0, None
    while i < len(lines):
        ln = lines[i]
        m = FENCE_RE.match(ln)
        if fence:
            out.append(ln)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            i += 1
            continue
        if m:
            fence, _ = m.group(1), out.append(ln)
            i += 1
            continue
        o = BLK_OPEN.match(ln)
        if not o:
            out.append(ln)
            i += 1
            continue
        depth, body, j, f2 = 1, [], i + 1, None
        while j < len(lines):
            l2 = lines[j]
            m2 = FENCE_RE.match(l2)
            if f2:
                if m2 and m2.group(1)[0] == f2[0] and len(m2.group(1)) >= len(f2):
                    f2 = None
            elif m2:
                f2 = m2.group(1)
            elif BLK_CLOSE.match(l2):
                depth -= 1
                if depth == 0:
                    break
            elif BLK_OPEN.match(l2):
                depth += 1
            body.append(l2)
            j += 1
        if depth:
            warn(f"{ctx.sec}: unclosed ':::{o.group(1)}' block ({o.group(3)[:40]!r})")
        out += ["", ctx.token(render_block(o.group(1), bool(o.group(2)), o.group(3), "\n".join(body), ctx)), ""]
        i = j + 1
    return "\n".join(out)


def render_block(name, is_open, summary, body, ctx):
    if name == "chart":
        return chart_svg(body, ctx)
    if name != "details":
        warn(f"{ctx.sec}: unknown block ':::{name}' — rendered as plain markdown")
        return convert_body(body, ctx)
    if ctx.depth >= 2:
        warn(f"{ctx.sec}: ':::details' nested deeper than one level ({summary[:40]!r})")
    ctx.depth += 1
    inner = convert_body(body, ctx)
    ctx.depth -= 1
    m = COUNT_RE.match(summary or "")
    label, badge = (m.group(1), m.group(2)) if m else (summary or "ดูรายละเอียด", "")
    sm = inline_md(label, ctx) + (f'<span class="dt-n">{esc(badge)}</span>' if badge else "")
    return (f'<details class="dt"{" open" if is_open else ""}><summary>{sm}</summary>'
            f'<div class="dt-body">\n{inner}\n</div></details>')


# ---------- charts (inline SVG; no library) ----------
CW = 360                                             # viewBox width: ~1:1 at 390px, scales up on desktop
TONE = {"green": "#427b5a", "yellow": "#a8802a", "red": "#a04f4f", "blue": "#3d6b93", "grey": "#7b8a95"}
INK, INK2, LINE, MUTED = "#17324d", "#3f586c", "#dfe7df", "#5e6f7c"


def num(v):
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def sv_text(x, y, t, size=11, fill=INK2, anchor="start", weight=None):
    w = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x:g}" y="{y:g}" font-size="{size:g}" fill="{fill}" text-anchor="{anchor}"{w}>'
            f"{esc(str(t))}</text>")


def wrap_label(s, per, lines=2):
    out = []
    while s and len(out) < lines:
        out.append(s[:per] if len(s) > per else s)
        s = s[per:]
    if s and out:
        out[-1] = out[-1][:max(1, per - 1)] + "…"
    return out


def chart_svg(body, ctx):
    try:
        d = json.loads(body)
    except Exception as e:                            # never drop the payload silently
        warn(f"{ctx.sec}: bad :::chart JSON — {e}")
        return f'<div class="note"><b>chart JSON ผิดรูป:</b> {esc(str(e))}<pre>{esc(body.strip())}</pre></div>'
    kind = d.get("type", "bar")
    try:
        svg = {"bar": bar_chart, "hbar": hbar_chart, "heatmap": heat_chart}[kind](d)
    except KeyError:
        warn(f"{ctx.sec}: unknown chart type {kind!r} (bar | hbar | heatmap)")
        return f'<div class="note"><b>chart type ไม่รู้จัก:</b> {esc(str(kind))}</div>'
    cap = []
    if d.get("title"):
        cap.append(esc(d["title"]))
    if d.get("sample"):
        cap.append('<span class="chart-sample">ตัวอย่าง</span>')
    if d.get("note"):
        cap.append(f'<small>{esc(d["note"])}</small>')
    caption = f'<figcaption>{" ".join(cap)}</figcaption>' if cap else ""
    return f'<figure class="chart">{svg}{caption}</figure>'


def axis_max(vals, given):
    m = given if given else max(vals + [0]) * 1.1 or 1
    return m if m > 0 else 1


def hbar_chart(d):
    ser = d.get("series", [])
    unit = d.get("unit", "")
    mx = axis_max([s.get("value", 0) for s in ser], d.get("max"))
    lab_w = min(140, max(52, int(max((len(str(s.get("label", ""))) for s in ser), default=6) * 6.0)))
    x0, val_w, row, top = lab_w + 8, 42 + 5 * len(unit), 25, 8
    bw = CW - x0 - val_w - 6
    h = top + row * len(ser) + 6
    p = [f'<svg class="cv" viewBox="0 0 {CW} {h}" style="max-width:{CW}px" role="img" xmlns="http://www.w3.org/2000/svg">']
    p.append(f'<line x1="{x0}" y1="{top - 2}" x2="{x0}" y2="{h - 8}" stroke="{LINE}"/>')
    for i, s in enumerate(ser):
        v = s.get("value", 0)
        y = top + i * row
        w = max(1.5, bw * min(1.0, v / mx))
        c = TONE.get(s.get("tone", "green"), TONE["green"])
        p.append(sv_text(x0 - 7, y + 13, s.get("label", ""), 11, INK2, "end"))
        p.append(f'<rect x="{x0 + 1}" y="{y + 3.5:g}" width="{w:g}" height="13" rx="3" fill="{c}"/>')
        p.append(sv_text(x0 + w + 7, y + 13.5, num(v) + unit, 11, INK, "start", 700))
    p.append("</svg>")
    return "".join(p)


def bar_chart(d):
    ser = d.get("series", [])
    unit = d.get("unit", "")
    mx = axis_max([s.get("value", 0) for s in ser], d.get("max"))
    n = max(1, len(ser))
    x0, top, plot, lab_h = 6, 16, 116, 30
    h = top + plot + lab_h
    step = (CW - x0 * 2) / n
    bw = min(38, step * 0.62)
    per = max(4, int(step / 5.6))
    p = [f'<svg class="cv" viewBox="0 0 {CW} {h}" style="max-width:{CW}px" role="img" xmlns="http://www.w3.org/2000/svg">']
    for g in (0, 0.5, 1):                             # grid: 0 / 50% / max
        y = top + plot - plot * g
        p.append(f'<line x1="{x0}" y1="{y:g}" x2="{CW - x0}" y2="{y:g}" stroke="{LINE}"/>')
    for i, s in enumerate(ser):
        v = s.get("value", 0)
        cx = x0 + step * (i + 0.5)
        bh = max(1.5, plot * min(1.0, v / mx))
        c = TONE.get(s.get("tone", "green"), TONE["green"])
        p.append(f'<rect x="{cx - bw / 2:g}" y="{top + plot - bh:g}" width="{bw:g}" height="{bh:g}" rx="3" fill="{c}"/>')
        p.append(sv_text(cx, top + plot - bh - 4, num(v) + unit, 10.5, INK, "middle", 700))
        for k, line in enumerate(wrap_label(str(s.get("label", "")), per)):
            p.append(sv_text(cx, top + plot + 13 + k * 11, line, 10, INK2, "middle"))
    p.append("</svg>")
    return "".join(p)


def heat_chart(d):
    xs, ys, data = d.get("x", []), d.get("y", []), d.get("data", [])
    unit = d.get("unit", "")
    flat = [v for row in data for v in row if isinstance(v, (int, float))]
    mx = axis_max(flat, d.get("max"))
    lab_w = min(76, max(30, int(max((len(str(y)) for y in ys), default=4) * 5.8)))
    cols = max(1, len(xs) or max((len(r) for r in data), default=1))
    cw = max(22, (CW - lab_w - 4) / cols)
    ch, top = 20, 16
    w = lab_w + cw * cols + 4
    h = top + ch * len(data) + 30
    p = [f'<svg class="cv" viewBox="0 0 {w:g} {h:g}" style="max-width:{max(CW, w):g}px" role="img" xmlns="http://www.w3.org/2000/svg">']
    for j, xl in enumerate(xs):
        p.append(sv_text(lab_w + cw * (j + 0.5), top - 4, xl, 9.5, INK2, "middle"))
    for i, rowv in enumerate(data):
        y = top + i * ch
        p.append(sv_text(lab_w - 5, y + 13.5, ys[i] if i < len(ys) else "", 9.5, INK2, "end"))
        for j, v in enumerate(rowv):
            r = min(1.0, (v or 0) / mx)
            fill = mix((241, 251, 244), (66, 123, 90), r)
            p.append(f'<rect x="{lab_w + cw * j:g}" y="{y:g}" width="{cw - 1.5:g}" height="{ch - 1.5:g}" rx="2.5" '
                     f'fill="{fill}" stroke="{LINE}" stroke-width=".5"/>')
            p.append(sv_text(lab_w + cw * (j + 0.5), y + 12.5, num(v), 8.5,
                             "#ffffff" if r > 0.55 else INK, "middle", 700))
    ly = top + ch * len(data) + 16
    p.append(sv_text(lab_w, ly, "น้อย", 9.5, MUTED, "start"))
    for k in range(5):
        p.append(f'<rect x="{lab_w + 28 + k * 15:g}" y="{ly - 8:g}" width="13" height="9" rx="2" '
                 f'fill="{mix((241, 251, 244), (66, 123, 90), k / 4)}" stroke="{LINE}" stroke-width=".5"/>')
    p.append(sv_text(lab_w + 108, ly, f"มาก ({num(mx)}{unit})", 9.5, MUTED, "start"))
    p.append("</svg>")
    return "".join(p)


def mix(a, b, t):
    return "#%02x%02x%02x" % tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ---------- markdown -> html ----------
def convert_body(body, ctx):
    body = extract_blocks(body, ctx)
    md = markdown.Markdown(output_format="html",
                           extensions=["tables", "sane_lists", "attr_list", "pymdownx.superfences", SpecExt(ctx)],
                           extension_configs={"pymdownx.superfences": {
                               "custom_fences": [{"name": "*", "class": "", "format": make_fence(ctx)}]}})
    out = md.convert(body).strip()
    if ctx.blocks:                                    # <p>@@RFB1@@</p> -> the block's html
        out = re.sub(r"<p>\s*(@@RFB\d+@@)\s*</p>|(@@RFB\d+@@)",
                     lambda m: ctx.blocks.get(m.group(1) or m.group(2), m.group(0)), out)
    return out


def inline_md(s, ctx):
    return re.sub(r"^<p>|</p>$", "", convert_body(s, ctx))


# ---------- diagrams ----------
def diagram_pass(fragments):
    """Render every ```mermaid block to inline SVG (cached by content hash) and fill the tokens."""
    todo, svgs = [], {}
    for did, d in DIAGRAMS.items():
        h = hashlib.sha256(d["code"].encode()).hexdigest()[:12]
        path = os.path.join(DIA_DIR, f"{did}.svg")
        cached = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        if cached.startswith(f"<!--h:{h}-->"):
            svgs[did] = cached
        else:
            todo.append({"id": did, "code": d["code"], "hash": h})
    if todo:
        os.makedirs(DIA_DIR, exist_ok=True)
        if not os.path.exists(RENDERER):
            warn(f"render-mermaid.mjs missing — {len(todo)} diagram(s) fall back to source text")
        else:
            fd, tmp = tempfile.mkstemp(suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump([{"id": t["id"], "code": t["code"]} for t in todo], f, ensure_ascii=False)
            r = subprocess.run(["node", RENDERER, tmp, DIA_DIR], capture_output=True, text=True)
            os.unlink(tmp)
            if r.returncode:
                tail = [ln for ln in (r.stderr or "").strip().split("\n") if ln][-1:] or ["see per-diagram warnings"]
                warn(f"render-mermaid.mjs exited {r.returncode}: {tail[0][:200]}")
            for t in todo:
                p = os.path.join(DIA_DIR, f"{t['id']}.svg")
                s = open(p, encoding="utf-8").read().strip() if os.path.exists(p) else ""
                i = s.find("<svg")
                if i < 0:
                    warn(f"diagram '{t['id']}' did not render")
                    continue
                s = f"<!--h:{t['hash']}-->" + clean_svg(s[i:])
                open(p, "w", encoding="utf-8").write(s)
                svgs[t["id"]] = s
    def fill(m):
        did = m.group(1)
        if did in svgs:
            return ns_svg(svgs[did], did)
        warn(f"diagram '{did}' unrendered — emitted as source")
        return f'<pre class="diagram">{esc(DIAGRAMS[did]["code"].strip())}</pre>'
    return {sec: re.sub(r"@@RFD:([\w-]+)@@", fill, frag) for sec, frag in fragments.items()}


def ns_svg(svg, did):
    """Prefix every id (and every #-reference to one, incl. url(#…) and the <style>
    selectors) with the diagram id — N inlined mermaid SVGs can never collide on ids
    (BUILD-CONTRACT: no duplicate DOM ids). mermaid stamps an edge's path and its label
    with the SAME data-id by design; nothing in this static page reads data-id, so those
    are dropped rather than namespaced. Applied at inline time; the cache stays raw."""
    p = did + "-"
    svg = re.sub(r'\sdata-id="[^"]*"', "", svg)
    ids = set(re.findall(r'(?<=\s)id="([^"]+)"', svg))
    svg = re.sub(r'(?<=\s)(id=")([^"]+)', lambda m: m.group(1) + p + m.group(2), svg)
    return re.sub(r"#([\w-]+)", lambda m: "#" + p + m.group(1) if m.group(1) in ids else m.group(0), svg)


def clean_svg(s):
    """Drop the fixed width/height so the diagram scales with its container; keep the viewBox."""
    m = re.match(r"<svg\b[^>]*>", s)
    if not m:
        return s
    tag = re.sub(r'\s(?:width|height)="[^"]*"', "", m.group(0))
    tag = re.sub(r'\sstyle="[^"]*"', "", tag)
    if 'class="' in tag:
        tag = re.sub(r'class="', 'class="dgsvg ', tag, count=1)
    else:
        tag = tag[:-1] + ' class="dgsvg">'
    return tag + s[m.end():]


# ---------- per-file rendering ----------
def split_head(text):
    """-> (num, thai, english, body) from the first '## NN · Thai (English)' line."""
    lines = ID_RE.sub("", text.lstrip("﻿")).split("\n")
    for i, ln in enumerate(lines):
        m = HEAD_RE.match(ln.strip())
        if m:
            return m.group(1), m.group(2).strip(), (m.group(3) or "").strip(), "\n".join(lines[i + 1:])
        if ln.strip():
            break
    return None, "", "", text


def head_html(num, thai, eng):
    return (f'<div class="head"><div><div class="kicker">{esc(num)} · {esc(eng or thai)}</div><h2>{esc(thai)}</h2>'
            f'<p class="desc">{esc(eng)}</p></div></div>')


H3_RE = re.compile(r'<h3 id="([^"]+)">(.*?)</h3>', re.S)
ANCHOR_RE = re.compile(r'<a\b[^>]*class="anchor"[^>]*>.*?</a>', re.S)
TAG_RE = re.compile(r"<[^>]+>")


def secnav_html(inner, minimum=4):
    """'ในหัวข้อนี้' — built from this section's h3s; a <details> so mobile can fold it away."""
    items = []
    for hid, raw in H3_RE.findall(inner):
        t = TAG_RE.sub("", ANCHOR_RE.sub("", raw)).strip()
        if t:
            items.append((hid, t))
    if len(items) < minimum:
        return ""
    links = "".join(f'<a href="#{attr(hid)}" title="{attr(t)}">{esc(t)}</a>' for hid, t in items)
    return ('<details class="secnav" open><summary>ในหัวข้อนี้ '
            f'<span class="dt-n">{len(items)}</span></summary><div class="secnavList">{links}</div></details>\n')


def render(sec, text):
    num, thai, eng, body = split_head(text)
    ctx = Ctx(sec)
    if sec == "overview":
        return render_overview(thai, eng, body, ctx)
    if num is None:
        sys.exit(f"{sec}: first heading must be '## NN · Thai (English)'")
    inner = convert_body(body, ctx)
    nav = secnav_html(inner)
    return f'<section id="{sec}">{head_html(num, thai, eng)}\n<div class="md">\n{nav}{inner}\n</div></section>\n'


FACT_SPECS = [(r"\bD-\d{2}\b", "การตัดสินใจที่ปิดแล้ว"), (r"\bT-\d{3}\b", "tickets ระดับงาน"),
              (r"\bFR-\d{3}\b", "ความต้องการเชิงหน้าที่"), (r"\bTC-[A-Z]{2,4}-\d{3}\b", "test cases")]
FACTS = []


def doc_facts(files):
    """[(number, label)] counted across the whole md set — the hero side card."""
    blob = "\n".join(open(p, encoding="utf-8").read() for p in files.values())
    out = [(str(len(files)), "หัวข้อในเอกสาร")]
    for rx, label in FACT_SPECS:
        n = len(set(re.findall(rx, blob)))
        if n:
            out.append((str(n), label))
    return out[:4]


def split_title(h1):
    parts = re.split(r"\s*[—–]\s*|\s+[-:]\s+", h1, maxsplit=1)
    name, sub = parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")
    if len(name) > 40 and not sub:
        cut = h1.find("(")
        name, sub = (h1[:cut].strip(), h1[cut:].strip()) if cut > 0 else (h1, "")
    return name, sub


def render_overview(thai, eng, body, ctx):
    lines = body.split("\n")
    h1, lead, side, i = "", "", [], 0
    while i < len(lines) and not lines[i].startswith("###"):
        ln = lines[i]
        # a fence / block marker ends the hero: diagrams, charts and code need full width,
        # not the narrow heroSide column (they render illegibly there)
        if ln.lstrip().startswith(("```", ":::")):
            break
        if ln.startswith("# ") and not h1:
            h1 = ln[2:].strip()
        elif ln.strip():
            para = [ln]
            while i + 1 < len(lines) and lines[i + 1].strip() and not lines[i + 1].startswith("#"):
                i += 1
                para.append(lines[i])
            if lead:
                side.append("\n".join(para))
            else:
                lead, side = para[0], para[1:] and ["\n".join(para[1:])]
        i += 1
    rest = "\n".join(lines[i:])
    name, sub = split_title(h1 or "ReserveFlow")
    tiles = "".join(f'<div class="metric"><b>{esc(n)}</b><span>{esc(lbl)}</span></div>' for n, lbl in FACTS)
    side_html = "".join(f'<div class="note">{inline_md(p, ctx)}</div>' for p in side)
    out = ['<section id="overview" class="hero"><div class="heroGrid"><article class="heroMain">',
           f'<span class="eyebrow">00 · {esc(eng or "Overview")}</span><h1>{esc(name)}</h1>',
           f'<p class="heroSub">{esc(sub)}</p>' if sub else "",
           f'<p class="heroLead">{inline_md(lead, ctx)}</p>' if lead else "",
           '<div class="actions"><a class="btn primary" href="#mockups">เปิดดู UI/UX</a>'
           '<a class="btn secondary" href="#requirements">ดูความต้องการ</a></div></article>',
           f'<aside class="heroSide"><div><span class="tag source">{esc(thai or "ภาพรวม")}</span></div>'
           f'<h2>เอกสารนี้โดยย่อ</h2><div class="metrics">{tiles}</div>{side_html}</aside>' if (tiles or side) else "",
           "</div>"]
    if rest.strip():
        inner = convert_body(rest, ctx)
        out.append(f'\n<div class="md">\n{secnav_html(inner, 3)}{inner}\n</div>')
    out.append("</section>\n")
    return "".join(out)


def fallback_overview(heads):
    toc = "".join(f'<a href="#{s}"><b>{esc(n or "")}</b>{esc(e or t)}<small>{esc(t)}</small></a>'
                  for s, (n, t, e) in heads.items())
    return ('<section id="overview" class="hero"><div class="heroGrid"><article class="heroMain">'
            '<span class="eyebrow">00 · Overview</span><h1>ReserveFlow</h1>'
            '<p class="heroLead">สเปกระบบจองห้องประชุม</p></article></div>'
            f'<div class="md"><div class="toc">{toc}</div></div></section>\n')


def md_files():
    """{section id: path}. id = '<!-- id: x -->' if present, else the leading NN per the contract IA."""
    out = {}
    for fn in sorted(os.listdir(SEC_DIR)):
        if not fn.endswith(".md"):
            continue
        path = os.path.join(SEC_DIR, fn)
        m = ID_RE.search(open(path, encoding="utf-8").read(400))
        num = re.match(r"^(\d\d)[-_]", fn)
        if m:
            sec = m.group(1)
        elif num and num.group(1) in NUM2ID:
            sec = NUM2ID[num.group(1)]
        else:
            sec = re.sub(r"^\d+[-_]|\.md$", "", fn)
            warn(f"{fn}: no '<!-- id: -->' and no known NN prefix — using id {sec!r}")
        if sec in out:
            warn(f"{fn}: skipped — section id {sec!r} already taken by {os.path.basename(out[sec])}")
            continue
        out[sec] = path
    return out


# ---------- page assembly ----------
def read_asset(name):
    return open(os.path.join(ASSETS, name), encoding="utf-8").read()


def doc_date(files):
    import datetime
    ts = max([os.path.getmtime(p) for p in files.values()] or [0]) or None
    d = datetime.date.fromtimestamp(ts) if ts else datetime.date.today()
    th = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
          "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
    return f"{d.day} {th[d.month - 1]} {d.year + 543} ({d.year})"


def assemble(fragments, files):
    nav = "".join(f'<a href="#{s}">{esc(lbl)}</a>' for s, lbl in SECTIONS if s in fragments)
    body = "\n".join(fragments[s] for s, _ in SECTIONS if s in fragments)
    css = read_asset("base.css") + "\n" + read_asset("v3.css")
    return (f'<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            f'<meta name="description" content="{attr(DOC_DESC)}">\n<title>{esc(DOC_TITLE)}</title>\n'
            f"<style>\n{css}</style>\n</head>\n<body>\n{read_asset('icons.svg')}"
            f'<header class="top"><div class="topin"><a class="brand" href="#overview"><span class="mark">◉</span>'
            f'<span><b>ReserveFlow</b><small>ระบบจองห้องประชุม</small></span></a>'
            f'<nav class="nav">{nav}</nav>'
            f'<button class="print" onclick="window.print()">พิมพ์ / Save PDF</button></div></header>\n<main>\n{body}\n'
            f'<footer class="footer"><div><b>ReserveFlow · {DOC_REV} · {doc_date(files)}</b><br>'
            f'ไฟล์ HTML ไฟล์เดียว · ไม่เรียกทรัพยากรภายนอก · เปิดจากดิสก์ได้</div>'
            f'<div>ตัวเลขในกราฟที่ติดป้าย “ตัวอย่าง” เป็นข้อมูลสมมติ<br>'
            f'ที่มาของเอกสารและการตัดสินใจที่ปิดแล้วอยู่ในภาคผนวก</div></footer>\n</main>'
            f'<div class="toast" id="toast" role="status" aria-live="polite"></div>'
            f'<a class="toTop" href="#overview" aria-label="กลับขึ้นด้านบน" title="กลับขึ้นด้านบน">↑</a>\n'
            f"<script>\n{read_asset('app.js')}</script>\n</body>\n</html>\n")


def artifact_page(page):
    """Artifact-shaped copy: same styles + body, but no doctype/html/head/body wrapper,
    <title> first, and a light-only guard (the doc paints its own ground)."""
    style = page[page.index("<style>\n"):page.index("</style>\n") + len("</style>\n")]
    body = page[page.index("<body>\n") + len("<body>\n"):page.rindex("</body>")]
    return ("<title>ReserveFlow Spec</title>\n"
            "<style>/* This document commits to one light, pastel visual world (it mirrors the product's own\n"
            "   palette), so it paints its own ground rather than following the host theme. */\n"
            ":root{color-scheme:light}\n"
            "html,body{background:var(--bg,#f7f9f5);color:var(--ink,#17324d)}</style>\n"
            + style + body)


# ---------- checks ----------
VOID = {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area", "base", "embed", "track", "param",
        "path", "circle", "rect", "line", "ellipse", "polygon", "polyline", "stop", "use"}
EXTERNAL = [(re.compile(r'\bsrc\s*=\s*["\']https?:', re.I), "src=http"),
            (re.compile(r"<link\b", re.I), "<link>"),
            (re.compile(r"@import", re.I), "@import"),
            (re.compile(r"url\(\s*['\"]?https?:", re.I), "url(http"),
            (re.compile(r'xlink:href\s*=\s*["\']https?:', re.I), "xlink:href=http"),
            (re.compile(r"fonts\.(?:googleapis|gstatic)\.com", re.I), "google fonts")]
LEFTOVERS = [(r"\*\*[^*\n]+\*\*", "**bold**"), (r"(?m)^\s*\|.*\|\s*$", "| table row |"), (r"`[^`\n]+`", "`code`"),
             (r"\]\(#?[\w./-]+\)", "[link](..)"), (r"(?m)^\s*#{1,6}[ \t]+\S", "# heading"), (r"```", "``` fence"),
             (r"(?m)^\s*:::", "::: block"), (r"@@RF[BD]", "unfilled token"), (r":icon\[", ":icon[]")]


def check_html(s):
    from html.parser import HTMLParser
    errs, ids, stack, texts, in_code = [], {}, [], [], [0]

    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag not in VOID:
                stack.append((tag, self.getpos()[0]))
            if tag in ("pre", "code"):
                in_code[0] += 1
            for k, v in attrs:
                if k == "id":
                    ids[v] = ids.get(v, 0) + 1

        def handle_endtag(self, tag):
            if tag in VOID:
                return
            if stack and stack[-1][0] == tag:
                stack.pop()
            else:
                errs.append(f"line {self.getpos()[0]}: </{tag}> but open is {stack[-1] if stack else None}")
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j][0] == tag:
                        del stack[j:]
                        break
            if tag in ("pre", "code"):
                in_code[0] -= 1

        def handle_data(self, d):
            if not in_code[0]:
                texts.append(d)

    P(convert_charrefs=True).feed(s)
    errs += [f"unclosed <{t}> from line {ln}" for t, ln in stack]
    dups = [k for k, v in ids.items() if v > 1]
    prose = "\n".join(texts)
    left = [f"{what}×{n}" for rx, what in LEFTOVERS if (n := len(re.findall(rx, prose)))]
    return errs, dups, left


def report(fragments, page):
    ok = True
    print(f"{'section':13}{'bytes':>8}{'tbl':>5}{'code':>5}{'dtl':>5}{'dgm':>5}{'cht':>5}{'ico':>5}  issues")
    for sec, _ in SECTIONS:
        if sec not in fragments:
            print(f"{sec:13}  (missing)")
            continue
        s = fragments[sec]
        errs, dups, left = check_html(s)
        cnt = [len(re.findall(r"<table", s)), len(re.findall(r'class="code"', s)),
               len(re.findall(r"<details class=\"dt\"", s)), len(re.findall(r'<figure class="diagram"', s)),
               len(re.findall(r'<figure class="chart"', s)), len(re.findall(r'class="ic"', s))]
        issues = errs[:3] + [f"dup id {d}" for d in dups[:5]] + left
        ok &= not (errs or dups or left)
        print(f"{sec:13}{len(s.encode()):8d}" + "".join(f"{c:5d}" for c in cnt) + f"  {'; '.join(issues) or 'ok'}")
    if page:
        errs, dups, left = check_html(page)
        ext = [what for rx, what in EXTERNAL if rx.search(page)]
        ok &= not (errs or dups or left or ext)
        print(f"\nassembled: {len(page.encode()) / 1024:.0f} KB · balance {len(errs)} · dup ids {len(dups)} {dups[:6]} · "
              f"leftovers {left or 'none'} · external refs {ext or 'none'}")
        for e in errs[:5]:
            print("  ", e)
    bad = [w for w in WARNINGS if "diagram" in w or "unclosed" in w or "chart" in w]
    if WARNINGS:
        print(f"\nwarnings ({len(WARNINGS)}):")
        for w in WARNINGS[:30]:
            print("  -", w)
    ok &= not bad
    print("\nCHECK", "CLEAN" if ok else "FAILED")
    return ok


BRAND_EXEMPT_RE = re.compile(r"/api/v1\b|stateDiagram-v2\b")
BRAND_RE = re.compile(r"(?<![\w-])[vV][12](?![\w.])|เวอร์ชัน\s*[12]")


def brand_hits(text):
    return BRAND_RE.findall(BRAND_EXEMPT_RE.sub("", text))


def brand_scan(files):
    """Contract: no 'v1/v2' branding in the main body — appendix only."""
    for sec, p in files.items():
        if sec == "appendix":
            continue
        hits = brand_hits(open(p, encoding="utf-8").read())
        if hits:
            warn(f"{sec}: {len(hits)}× v1/v2 branding in the main body (contract: appendix + footer only)")


# ---------- screenshots ----------
def screenshot(page_path, at=None):
    helper = os.path.join(HERE, "_shot-frame.html")
    for w, out in ((1280, "_shot-1280.png"), (390, "_shot-390.png")):
        name = out if not at else out.replace(".png", f"-{at}.png")
        open(helper, "w").write(
            f'<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><iframe id="f" '
            f'src="{os.path.relpath(page_path, HERE)}" style="position:absolute;left:0;top:0;width:{w}px;'
            f'height:12000px;border:0"></iframe>'
            + (f'<script>f.onload=()=>{{const e=f.contentDocument.getElementById("{at}");if(!e)return;'
               f'const y=e.getBoundingClientRect().top+f.contentWindow.scrollY-8;f.style.top=-y+"px";'
               f'f.style.height=(y+6200)+"px"}}</script>' if at else ""))
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                        f"--screenshot={os.path.join(HERE, name)}", f"--window-size={w},6000",
                        "--virtual-time-budget=4000", "file://" + os.path.abspath(helper)],
                       check=False, capture_output=True)
        print("screenshot:", os.path.join(HERE, name))


# ---------- selftest ----------
def selftest():
    global DIA_DIR
    DIA_DIR = tempfile.mkdtemp(prefix="rf-diagrams-")      # never touch the real cache
    ctx = Ctx("t")
    out = convert_body(
        "## x\n\nraw <b>b</b> <br> `<t>` 5 < 6 :icon[calendar] :icon[nope]\n\n### 1.1 H (T)\n\n"
        "| ID | Sev | ขนาด | Phase | ok |\n|---|---|---|---|---|\n"
        "| T-001 | High (ปรับ) | M | 1.1 | ✓ |\n| T-002 | ตัดสินใจแล้ว | L | 2 | บางส่วน |\n\n"
        "> ต้องยืนยันกับบริษัท (x): ใคร\n\n---\n\n"
        ":::details ดู DDL (14 ตาราง)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sql\nSELECT 1 < 2;\n```\n\n"
        ":::details ชั้นใน\ninner text\n:::\n\n:::\n\n"
        ':::chart\n{"type":"hbar","title":"ใช้งานห้อง","unit":"%","max":100,"sample":true,'
        '"series":[{"label":"Horizon","value":82},{"label":"Grove","value":53}]}\n:::\n\n'
        "```mermaid\n%% title: วงจรสถานะ\n%% id: t-life\nstateDiagram-v2\n  A --> B\n```\n\n"
        "```\nroot/\n├─ a/  d\n```\n\n```ts\n1 < 2\n```\n", ctx)
    for frag in ['<h3 id="t-x">x <a', "raw &lt;b&gt;b&lt;/b&gt; <br>", '<h3 id="t-1-1-h-t">',
                 '<svg aria-hidden="true" class="ic"><use href="#i-calendar"></use></svg>',
                 'class="tableWrap scroll-x ticket-table id-first"', '<td><span class="sev-high">High</span> (ปรับ)</td>',
                 '<span class="sz m">M</span>', '<td class="nw">T-001</td>', '<span class="ph v11">1.1</span>',
                 '<td class="nw yes">✓</td>', '<span class="st done">ตัดสินใจแล้ว</span>', '<span class="ph v2">2</span>',
                 '<td class="nw part">บางส่วน</td>', '<div class="open-box">\n<p>ใคร</p>', '<div class="divider"></div>',
                 '<details class="dt"><summary>ดู DDL<span class="dt-n">14 ตาราง</span></summary>',
                 '<div class="dt-body">', '<div class="code" data-lang="SQL"><pre>SELECT 1 &lt; 2;</pre></div>',
                 '<details class="dt"><summary>ชั้นใน</summary>',
                 '<figure class="chart"><svg class="cv"', 'ใช้งานห้อง <span class="chart-sample">ตัวอย่าง</span>',
                 '<figure class="diagram" id="dg-t-life"><div class="dg">@@RFD:t-life@@</div>',
                 "<figcaption>วงจรสถานะ</figcaption>",
                 '<pre class="tree"><b>root/</b>\n├─ <b>a/</b>  <i>d</i></pre>',
                 '<div class="code" data-lang="TS"><pre>1 &lt; 2</pre></div>']:
        assert frag in out, f"selftest: missing {frag!r}\n\n{out}"
    assert "@@RFB" not in out, "unfilled block token"
    assert out.count("<details") == 2 and out.count("</details>") == 2, out
    assert any("unknown icon ':icon[nope]'" in w for w in WARNINGS), WARNINGS
    filled = diagram_pass({"t": out})["t"]
    assert "@@RFD" not in filled and ("<svg" in filled or "stateDiagram" in filled)
    g = convert_body("### สรุป (At a glance)\n\n| | |\n|---|---|\n| ขนาด | **3 ห้อง** |\n", Ctx("overview"))
    assert '<div class="metrics glance">' in g and "<table" not in g, g
    assert 'class="secnav"' in secnav_html(out, 2) and "#t-1-1-h-t" in secnav_html(out, 2)
    assert split_title("ReserveFlow — ระบบจอง (Meeting)") == ("ReserveFlow", "ระบบจอง (Meeting)")
    for kind in ("bar", "hbar", "heatmap"):
        s = chart_svg(json.dumps({"type": kind, "title": "t", "series": [{"label": "ห้อง A", "value": 8}],
                                  "x": ["จ"], "y": ["09:00"], "data": [[3]]}), Ctx("t"))
        assert s.startswith('<figure class="chart"><svg') and "</svg>" in s, s
    assert '<div class="note"><b>chart JSON ผิดรูป' in chart_svg("{oops", Ctx("t"))
    errs, dups, left = check_html("<div><p>ok</p></div>")
    assert not errs and not dups and not left
    assert not brand_hits("`/api/v1/bookings`\nstateDiagram-v2")
    assert brand_hits("/api/v1 แล้ว product v2") == ["v2"]
    assert brand_hits("stateDiagram-v2 แล้ว product v1; เวอร์ชัน 2") == ["v1", "เวอร์ชัน 2"]
    print("selftest ok")


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assemble", action="store_true", help=f"write {os.path.relpath(OUT_HTML, DOCS)}")
    ap.add_argument("--check", action="store_true", help="verify and exit non-zero on failure")
    ap.add_argument("--only", help="build one section only (debug), e.g. --only api")
    ap.add_argument("--screenshot", action="store_true")
    ap.add_argument("--at", help="with --screenshot: start the shot at this element id")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not (a.assemble or a.check or a.screenshot):
        a.assemble = a.check = True

    files = md_files()
    FACTS[:] = doc_facts(files)
    brand_scan(files)
    fragments, heads = {}, {}
    for sec, path in files.items():
        text = open(path, encoding="utf-8").read()
        num, thai, eng, _ = split_head(text)
        heads[sec] = (num, thai, eng)
        if a.only and sec != a.only:
            continue
        fragments[sec] = render(sec, text)
    fragments = diagram_pass(fragments)
    if "overview" not in fragments and not a.only:
        fragments["overview"] = fallback_overview(heads)
    for sec in fragments:
        if sec not in ORDER:
            warn(f"section id {sec!r} is not in the contract IA — dropped from the page")
    fragments = {s: f for s, f in fragments.items() if s in ORDER}

    page = assemble(fragments, files) if (a.assemble or a.check) else None
    if a.assemble:
        open(OUT_HTML, "w", encoding="utf-8").write(page)
        print(f"assembled: {OUT_HTML} {os.path.getsize(OUT_HTML) / 1024:.0f} KB")
        open(ART_HTML, "w", encoding="utf-8").write(artifact_page(page))
        print(f"assembled: {ART_HTML} {os.path.getsize(ART_HTML) / 1024:.0f} KB")
    if a.screenshot:
        screenshot(OUT_HTML, a.at)
    if a.check and not report(fragments, page):
        sys.exit(1)


if __name__ == "__main__":
    main()
