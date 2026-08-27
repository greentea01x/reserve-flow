#!/usr/bin/env python
"""md2html.py — deterministic Markdown -> HTML fragments for ReserveFlow v2.

  python md2html.py                # write sec-<id>.html for every md file
  python md2html.py --assemble     # + fill skeleton.html -> ReserveFlow_Spec_v2.html
  python md2html.py --check        # report (balance, dup ids, placeholders, leftovers)
  python md2html.py --screenshot [--at ID]  # headless Chrome: _shot-1280[-ID].png / _shot-390[-ID].png
  python md2html.py --selftest     # asserts the md->html contract on a tiny sample
Flags combine. Re-runnable; content-agnostic (re-reads md each time).

Mapping (md -> html), see STYLE-GUIDE.md for the classes:
  first `## NN · Thai (English)`  -> section .head (kicker "NN · English", h2 Thai, .desc English)
  ### / #### / #####              -> h3/h4/h5 with id "<sec>-<slug>" (h3 gets a.anchor); h1/h2 in body -> h3
  table                           -> div.tableWrap.scroll-x.matrix (ticket-table when header has DoD / T-xxx ids)
  known cell tokens               -> chips (.sev-*, .sz, .ph, .st, .kept/.changed/.added/.cut) or td classes (.yes/.no/.part, .must/.should/.could)
  ```lang                         -> div.code[data-lang] > pre  (JS adds ขยาย/ย่อ)
  ```mermaid / box-drawing text   -> pre.diagram (plain text)
  ```text|tree|'' with ├ └        -> pre.tree (folders <b>, # comments <i>)
  > quote                         -> div.note;  "ต้องยืนยันกับบริษัท…" / "Open…" para or quote -> div.open-box
  ---                             -> div.divider
  raw HTML in md                  -> escaped text, except <br>
  00-overview.md                  -> hero (h1 -> .heroMain h1, first para -> .heroLead, rest -> .md)
  11-ui-mockups-notes.md          -> v1 head replaced by md head; v1 stage kept byte-identical; notes AFTER the stage
"""
import argparse, html, os, re, subprocess, sys, unicodedata
from xml.etree import ElementTree as ET
import markdown
from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor
from markdown.inlinepatterns import InlineProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
MD_DIR = os.path.join(HERE, "..", "md")
ORDER = ["overview", "review", "decisions", "requirements", "flows", "architecture", "data-model",
         "api", "folders", "plan", "devops", "mockups", "appendix"]
NUM2ID = {f"{i:02d}": s for i, s in enumerate(ORDER)}  # 00..12

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
# header-gated vocabularies (too ambiguous to chip everywhere)
GATED = [(re.compile(r"ขนาด|size", re.I), SIZE), (re.compile(r"phase|เฟส|version|เวอร์ชัน", re.I), PHASE)]
PHASE_SAFE = {k: v for k, v in PHASE.items() if k == "mvp" or k.startswith("w")}
GLANCE_RE = re.compile(r"at a glance|โดยสรุป|key facts", re.I)  # overview h3 whose 2-col table becomes .metric tiles
OPEN_RE = re.compile(r"^\s*(?:\*\*)?(?:ต้องยืนยันกับบริษัท|Open\b)")
OPEN_STRIP = re.compile(r"^\s*ต้องยืนยันกับบริษัท\s*(?:\([^)]*\))?\s*[:：—–-]?\s*")
HEAD_RE = re.compile(r"^##\s+(\d\d)\s*[·•:\-–]\s*(.*?)\s*(?:\(([^()]*)\))?\s*$")
TREE_RE = re.compile(r"^[\s│]*[├└]─+", re.M)  # folder tree lines
BOX_RE = re.compile(r"[┌┐┬┼═╔╗╭╮▶►]|──+>|<──+")  # box corners / arrows = diagram (trees only use ├ └ │ ─)
LANG = {"ts": "TS", "tsx": "TSX", "js": "JS", "sql": "SQL", "json": "JSON", "http": "HTTP", "yaml": "YAML", "yml": "YAML",
        "bash": "BASH", "sh": "BASH", "shell": "BASH", "dockerfile": "DOCKERFILE", "caddyfile": "CADDY", "env": "ENV",
        "txt": "TXT", "text": "TXT", "": "TXT", "none": "TXT", "md": "MD", "html": "HTML", "css": "CSS", "toml": "TOML"}

esc = lambda t: html.escape(t, quote=False)  # noqa: E731
PREFIX_VOCABS = [SEV, STATUS, PHASE_SAFE]  # "High (ปรับ…)" -> chip + tail text (CHANGE excluded: "เปลี่ยน …" is a common verb)
DELIM = re.compile(r"^(?:$|[\s(·/:,;])")


# ---------- fenced code (pymdownx.superfences catch-all) ----------
def fence(source, language, css_class, options, md, **kw):
    lang = (language or "").lower()
    plain = lang in ("", "text", "txt", "tree", "diagram", "ascii")
    if lang == "mermaid" or (plain and BOX_RE.search(source)):
        return f'<pre class="diagram">{esc(source)}</pre>'
    if plain and TREE_RE.search(source):
        lines = []
        for ln in source.split("\n"):  # folders bold, trailing # comments muted
            ln = esc(ln)
            ln = re.sub(r"(\S)(\s{2,}|\s#)(\S.*)$", r"\1\2<i>\3</i>", ln, count=1)  # trailing description / # comment
            ln = re.sub(r"(?<![\w./-])([\w.@\-]+/)(?=\s|$|<)", r"<b>\1</b>", ln)
            lines.append(ln)
        return '<pre class="tree">' + "\n".join(lines) + "</pre>"
    label = LANG.get(lang, lang.upper() or "TXT")
    return f'<div class="code" data-lang="{label}"><pre>{esc(source)}</pre></div>'


# ---------- tree post-processing ----------
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
    """Move src's text + child elements into dst (src is discarded afterwards)."""
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


class V2Tree(Treeprocessor):
    def __init__(self, md, sec):
        super().__init__(md)
        self.sec = sec
        self.used = set()
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
                hid = f"{self.sec}-{slugify(text_of(el), self.used)}"
                el.set("id", hid)
                if tag == "h3":
                    a = ET.SubElement(el, "a", {"class": "anchor", "href": "#" + hid, "aria-label": "link"})
                    a.text = "#"
                    a.tail = None
                    # keep visual order: anchor last, add a space before it
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
        """Drop a leading 'ต้องยืนยันกับบริษัท (...):' — the .open-box label already says it."""
        first = el[0] if (len(el) and el[0].tag == "p" and not (el.text or "").strip()) else el  # quote -> its first <p>
        if first.text and OPEN_STRIP.match(first.text):
            first.text = OPEN_STRIP.sub("", first.text, count=1)
        elif len(first) and first[0].tag == "strong" and OPEN_STRIP.fullmatch(first[0].text or ""):
            tail = first[0].tail or ""
            first.remove(first[0])
            first.text = re.sub(r"^\s*[:：—–-]?\s*", "", (first.text or "") + tail)

    def tiles(self, tbl, par, body):
        """2-column key/value table -> v1 .metrics/.metric tiles (overview 'at a glance')."""
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
        if heads and not any(heads):  # empty header row (key/value tables) -> drop thead
            thead = tbl.find("thead")
            if thead is not None:
                tbl.remove(thead)
            if self.sec == "overview" and GLANCE_RE.search(self.last_h3) and body and max(len(r) for r in body) == 2:
                return self.tiles(tbl, par, body)
        for tr in body:
            for i, td in enumerate(tr):
                if td.tag != "td":
                    continue
                t = text_of(td)
                k = t.lower()
                h = heads[i] if i < len(heads) else ""
                if t and len(t) <= 16 and " " not in t:  # short single-token cell: never wrap "FR-001" into two lines
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
        # wrap; an ID-ish first column gets shrink-to-fit so the wide prose columns keep the room
        narrow = sum(1 for c in first_col if c and len(c) <= 26 and c.count(" ") <= 1)
        cls = "tableWrap scroll-x " + ("ticket-table" if ticket else "matrix")
        if first_col and narrow >= max(2, int(len(first_col) * 0.6)):
            cls += " id-first"
        idx = list(par).index(tbl)
        wrap = ET.Element("div", {"class": cls})
        wrap.tail = tbl.tail
        tbl.tail = None
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


class V2Ext(Extension):
    def __init__(self, sec):
        super().__init__()
        self.sec = sec

    def extendMarkdown(self, md):
        md.preprocessors.deregister("html_block")  # raw HTML -> text
        md.inlinePatterns.deregister("html")
        md.inlinePatterns.register(BrPattern(r"<br\s*/?>", md), "br", 95)
        md.treeprocessors.register(V2Tree(md, self.sec), "v2", 15)  # after 'inline' (20)


def convert_body(body, sec):
    md = markdown.Markdown(output_format="html", extensions=["tables", "sane_lists", "attr_list", "pymdownx.superfences", V2Ext(sec)],
                           extension_configs={"pymdownx.superfences": {"custom_fences": [{"name": "*", "class": "", "format": fence}]}})
    return md.convert(body).strip()


# ---------- per-file ----------
def split_head(text):
    """-> (num, thai, english, body) from the first '## NN · Thai (English)' line."""
    lines = text.lstrip("﻿").split("\n")
    for i, ln in enumerate(lines):
        m = HEAD_RE.match(ln.strip())
        if m:
            return m.group(1), m.group(2).strip(), (m.group(3) or "").strip(), "\n".join(lines[i + 1:])
        if ln.strip():
            break
    return None, "", "", text


def head_html(num, thai, eng):
    return (f'<div class="head"><div><div class="kicker">{num} · {esc(eng or thai)}</div><h2>{esc(thai)}</h2>'
            f'<p class="desc">{esc(eng)}</p></div></div>')


H3_RE = re.compile(r'<h3 id="([^"]+)">(.*?)</h3>', re.S)
ANCHOR_RE = re.compile(r'<a\b[^>]*class="anchor"[^>]*>.*?</a>', re.S)
TAG_RE = re.compile(r"<[^>]+>")


def secnav_html(inner, minimum=4):
    """'On this page' chip row built from the h3s already emitted for this section."""
    items = []
    for hid, raw in H3_RE.findall(inner):
        t = TAG_RE.sub("", ANCHOR_RE.sub("", raw)).strip()
        if t:
            items.append((hid, t))
    if len(items) < minimum:
        return ""
    links = "".join(f'<a href="#{hid}" title="{t.replace(chr(34), "&quot;")}">{t}</a>' for hid, t in items)  # chips ellipsise
    return f'<nav class="secnav" aria-label="ในหัวข้อนี้"><b>ในหัวข้อนี้</b><div class="secnavList">{links}</div></nav>\n'


def balanced_end(s, start, name):
    depth = 0
    for m in re.compile(rf"<(/?){name}\b[^>]*>").finditer(s, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return m.end()
    raise SystemExit(f"unbalanced <{name}> in mockups stage")


def render(sec, text):
    num, thai, eng, body = split_head(text)
    if sec == "overview":
        return render_overview(thai, eng, body)
    if num is None:
        sys.exit(f"{sec}: first heading must be '## NN · Thai (English)'")
    inner = convert_body(body, sec)
    nav = secnav_html(inner)
    if sec == "mockups":
        stage = open(os.path.join(HERE, "mockups-v1-full.html"), encoding="utf-8").read().rstrip()
        assert stage.startswith('<section id="mockups">') and stage.endswith("</section>")
        hs = stage.index('<div class="head">')
        he = balanced_end(stage, hs, "div")
        # v1 head -> md head; stage (everything up to </section>) byte-identical; notes AFTER the stage
        return stage[:hs] + head_html(num, thai, eng) + stage[he:-len("</section>")] + f'\n<div class="md">\n{nav}{inner}\n</div></section>\n'
    return f'<section id="{sec}">{head_html(num, thai, eng)}\n<div class="md">\n{nav}{inner}\n</div></section>\n'


# derived from the md itself, so the hero card never goes stale: (regex, label, section it lives in)
FACT_SPECS = [("decisions", r"\bD-\d{2}\b", "การตัดสินใจที่ปิดแล้ว"),
              ("plan", r"\bT-\d{3}\b", "tickets ระดับงาน"),
              ("requirements", r"\bFR-\d{3}\b", "ความต้องการเชิงหน้าที่"),
              ("devops", r"\bTC-[A-Z]{2,4}-\d{3}\b", "test cases")]
FACTS = []


def doc_facts(files):
    """[(number, label)] counted across the whole md set — hero side card content."""
    out = [(str(len(files)), "หัวข้อในเอกสาร")]
    for sec, rx, label in FACT_SPECS:
        p = files.get(sec)
        n = len(set(re.findall(rx, open(p, encoding="utf-8").read()))) if p else 0
        if n:
            out.append((str(n), label))
    return out[:4]


def split_title(h1):
    """'ReserveFlow v2 — ระบบจองห้องประชุม (Meeting Room …)' -> short name + subtitle."""
    parts = re.split(r"\s*[—–]\s*|\s+[-:]\s+", h1, maxsplit=1)
    name, sub = parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")
    if len(name) > 40 and not sub:  # no separator: keep the leading clause only
        cut = h1.find("(")
        name, sub = (h1[:cut].strip(), h1[cut:].strip()) if cut > 0 else (h1, "")
    return name, sub


def render_overview(thai, eng, body):
    # hero: '# title' -> h1 + subtitle, first paragraph -> heroLead, other intro paragraphs -> heroSide notes, rest -> .md
    lines = body.split("\n")
    h1, lead, side, rest, i = "", "", [], [], 0
    while i < len(lines) and not lines[i].startswith("###"):
        ln = lines[i]
        if ln.startswith("# ") and not h1:
            h1 = ln[2:].strip()
        elif ln.strip():
            para = [ln]
            while i + 1 < len(lines) and lines[i + 1].strip() and not lines[i + 1].startswith("#"):
                i += 1
                para.append(lines[i])
            if lead:
                side.append("\n".join(para))
            else:  # first line = lead; a soft-wrapped continuation becomes the side note
                lead, side = para[0], para[1:] and ["\n".join(para[1:])]
        i += 1
    rest = "\n".join(lines[i:])
    inline = lambda s: re.sub(r"^<p>|</p>$", "", convert_body(s, "overview"))  # noqa: E731
    name, sub = split_title(h1 or "ReserveFlow v2")
    tiles = "".join(f'<div class="metric"><b>{esc(n)}</b><span>{esc(lbl)}</span></div>' for n, lbl in FACTS)
    side_html = "".join(f'<div class="note">{inline(p)}</div>' for p in side)
    out = ['<section id="overview" class="hero"><div class="heroGrid"><article class="heroMain">',
           f'<span class="eyebrow">00 · {esc(eng or "Overview")}</span><h1>{esc(name)}</h1>',
           f'<p class="heroSub">{esc(sub)}</p>' if sub else "",
           f'<p class="heroLead">{inline(lead)}</p>' if lead else "",
           '<div class="actions"><a class="btn primary" href="#mockups">เปิดดู UI Mockups</a>'
           '<a class="btn secondary" href="#decisions">ดูการตัดสินใจ</a></div></article>',
           f'<aside class="heroSide"><div><span class="tag source">{esc(thai or "ภาพรวม")}</span></div>'
           f'<h2>เอกสารนี้โดยย่อ</h2><div class="metrics">{tiles}</div>{side_html}</aside>' if (tiles or side) else "",
           "</div>"]
    if rest.strip():
        inner = convert_body(rest, "overview")
        out.append(f'\n<div class="md">\n{secnav_html(inner, 3)}{inner}\n</div>')
    out.append("</section>\n")
    return "".join(out)


def fallback_overview(heads):
    toc = "".join(f'<a href="#{s}"><b>{n}</b>{esc(e or t)}<small>{esc(t)}</small></a>' for s, (n, t, e) in heads.items())
    return ('<section id="overview" class="hero"><div class="heroGrid"><article class="heroMain"><span class="eyebrow">00 · Overview</span>'
            '<h1>ReserveFlow v2</h1><p class="heroLead">สเปกระบบจองห้องประชุม — ฉบับ v2</p></article></div>'
            f'<div class="md"><div class="toc">{toc}</div></div></section>\n')


def md_files():
    out = {}
    for fn in sorted(os.listdir(MD_DIR)):
        m = re.match(r"^(\d\d)[-_].*\.md$", fn)
        if m and m.group(1) in NUM2ID:
            out[NUM2ID[m.group(1)]] = os.path.join(MD_DIR, fn)
    return out


# ---------- check ----------
VOID = {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area", "base", "embed", "track", "param"}


def check_html(s, label):
    from html.parser import HTMLParser
    errs, ids, stack, texts = [], {}, [], []
    in_code = [0]

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
                for j in range(len(stack) - 1, -1, -1):  # resync
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
    left = []
    for rx, what in [(r"\*\*[^*\n]+\*\*", "**bold**"), (r"(?m)^\s*\|.*\|\s*$", "| table row |"), (r"`[^`\n]+`", "`code`"),
                     (r"\]\(#?[\w./-]+\)", "[link](..)"), (r"(?m)^\s*#{1,6}[ \t]+\S", "# heading"), (r"```", "``` fence")]:
        n = len(re.findall(rx, prose))
        if n:
            left.append(f"{what}×{n}")
    return errs, dups, left, len(re.findall(r"<!--SECTION:", s))


def report(paths, assembled):
    ok = True
    print(f"{'section':14}{'bytes':>8}{'tables':>7}{'code':>6}{'tree':>5}{'diag':>5}{'note':>5}{'open':>5}  issues")
    for sec in ORDER:
        p = paths.get(sec)
        if not p:
            print(f"{sec:14}  (missing)")
            continue
        s = open(p, encoding="utf-8").read()
        errs, dups, left, _ = check_html(s, sec)
        cnt = [len(re.findall(r"<table", s)), len(re.findall(r'class="code"', s)), len(re.findall(r'<pre class="tree"', s)),
               len(re.findall(r'class="diagram"', s)), len(re.findall(r'class="note"', s)), len(re.findall(r'class="open-box"', s))]
        issues = errs[:3] + [f"dup id {d}" for d in dups[:5]] + left
        ok &= not (errs or dups or left)
        print(f"{sec:14}{len(s.encode()):8d}{cnt[0]:7d}{cnt[1]:6d}{cnt[2]:5d}{cnt[3]:5d}{cnt[4]:5d}{cnt[5]:5d}  {'; '.join(issues) or 'ok'}")
    if assembled and os.path.exists(assembled):
        s = open(assembled, encoding="utf-8").read()
        errs, dups, left, ph = check_html(s, "assembled")
        ok &= not (errs or dups or ph)
        print(f"\nassembled {os.path.basename(assembled)}: {len(s.encode())/1024:.0f} KB, balance errors {len(errs)}, dup ids {len(dups)} {dups[:8]}, "
              f"unresolved placeholders {ph}, leftovers {left or 'none'}")
        for e in errs[:5]:
            print("  ", e)
    print("\nCHECK", "CLEAN" if ok else "FAILED")
    return ok


def screenshot(page, at=None):
    """_shot-1280.png + _shot-390.png (mobile via 390px iframe); --at ID scrolls an iframe so the shot starts at #ID."""
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    helper = os.path.join(HERE, "_shot-frame.html")
    shots = [(1280, "_shot-1280.png"), (390, "_shot-390.png")]
    for w, out in shots:
        name = out if not at else out.replace(".png", f"-{at}.png")
        open(helper, "w").write(
            f'<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><iframe id="f" src="{os.path.basename(page)}" '
            f'style="position:absolute;left:0;top:0;width:{w}px;height:12000px;border:0"></iframe>'
            + (f'<script>f.onload=()=>{{const e=f.contentDocument.getElementById("{at}");if(!e)return;const y=e.getBoundingClientRect().top+f.contentWindow.scrollY-8;f.style.top=-y+"px";f.style.height=(y+6200)+"px"}}</script>' if at else ""))
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                        f"--screenshot={os.path.join(HERE, name)}", f"--window-size={w},6000", "--virtual-time-budget=4000",
                        "file://" + os.path.abspath(helper)], check=False, capture_output=True)
        print("screenshot:", os.path.join(HERE, name))


def selftest():
    out = convert_body("""## x\n\nraw <b>b</b> <br> `<t>` 5 < 6\n\n### 1.1 H (T)\n\n| ID | Sev | ขนาด | Phase | ok |\n|---|---|---|---|---|\n"""
                       """| T-001 | High (ปรับ) | M | 1.1 | ✓ |\n| T-002 | ตัดสินใจแล้ว | L | 2 | บางส่วน |\n\n> ต้องยืนยันกับบริษัท (x): ใคร\n\n---\n\n"""
                       """```mermaid\nA-->B\n```\n\n```\nroot/\n├─ a/  d\n```\n\n```ts\n1 < 2\n```\n""", "t")
    for frag in ['<h3 id="t-x">x <a', 'raw &lt;b&gt;b&lt;/b&gt; <br>\n<code>&lt;t&gt;</code> 5 &lt; 6', '<h3 id="t-1-1-h-t">',
                 'class="tableWrap scroll-x ticket-table id-first"', '<td><span class="sev-high">High</span> (ปรับ)</td>', '<span class="sz m">M</span>',
                 '<td class="nw">T-001</td>', '<span class="ph v11">1.1</span>', '<td class="nw yes">✓</td>', '<span class="st done">ตัดสินใจแล้ว</span>',
                 '<span class="ph v2">2</span>',
                 '<td class="nw part">บางส่วน</td>', '<div class="open-box">\n<p>ใคร</p>', '<div class="divider"></div>', '<pre class="diagram">A--&gt;B</pre>',
                 '<pre class="tree"><b>root/</b>\n├─ <b>a/</b>  <i>d</i></pre>', '<div class="code" data-lang="TS"><pre>1 &lt; 2</pre></div>']:
        assert frag in out, f"selftest: missing {frag!r}\n{out}"
    # glance table (overview only, 2 cols, empty header, under an "at a glance" h3) -> .metric tiles
    g = convert_body("### สรุป (At a glance)\n\n| | |\n|---|---|\n| ขนาด | **3 ห้อง** |\n| เวลา | 08:30 |\n", "overview")
    assert '<div class="metrics glance">' in g and '<div class="metric"><b>ขนาด</b><span><strong>3 ห้อง</strong></span></div>' in g, g
    assert "<table" not in g, g
    assert 'class="secnav"' in secnav_html(out, 2) and "#t-1-1-h-t" in secnav_html(out, 2)
    assert split_title("ReserveFlow v2 — ระบบจอง (Meeting)") == ("ReserveFlow v2", "ระบบจอง (Meeting)")
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assemble", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--screenshot", action="store_true")
    ap.add_argument("--only", help="section id, e.g. api")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--at", help="with --screenshot: start the shot at this element id (e.g. data-model, api-errors)")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    files = md_files()
    FACTS[:] = doc_facts(files)
    heads, written = {}, {}
    for sec, path in files.items():
        if a.only and sec != a.only:
            continue
        text = open(path, encoding="utf-8").read()
        num, thai, eng, _ = split_head(text)
        heads[sec] = (num, thai, eng)
        out = os.path.join(HERE, f"sec-{sec}.html")
        open(out, "w", encoding="utf-8").write(render(sec, text))
        written[sec] = out
    # mockups without md: still emit the v1 stage
    if "mockups" not in files and not a.only:
        stage = open(os.path.join(HERE, "mockups-v1-full.html"), encoding="utf-8").read()
        written["mockups"] = os.path.join(HERE, "sec-mockups.html")
        open(written["mockups"], "w", encoding="utf-8").write(stage)
    paths = {s: os.path.join(HERE, f"sec-{s}.html") for s in ORDER if os.path.exists(os.path.join(HERE, f"sec-{s}.html"))}
    assembled = os.path.join(HERE, "ReserveFlow_Spec_v2.html")
    if a.assemble:
        page = open(os.path.join(HERE, "skeleton.html"), encoding="utf-8").read()
        for sec in ORDER:
            frag = open(paths[sec], encoding="utf-8").read() if sec in paths else (fallback_overview(heads) if sec == "overview" else "")
            if not frag:
                print("WARN: no fragment for", sec)
            page = page.replace(f"<!--SECTION:{sec}-->", frag, 1)
        open(assembled, "w", encoding="utf-8").write(page)
        print("assembled:", assembled, f"{os.path.getsize(assembled)/1024:.0f} KB")
    if a.check:
        ok = report(paths, assembled if a.assemble or os.path.exists(assembled) else None)
    if a.screenshot:
        screenshot(assembled, a.at)
    if a.check and not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
