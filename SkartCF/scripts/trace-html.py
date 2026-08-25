#!/usr/bin/env python3
"""
Turn `npm run replay` output into a page a person will actually read.

    npm run replay -- --seed 7 --decks magus,felindori > game.txt
    python3 scripts/trace-html.py game.txt game.html

The trace is the only tool that has found a real bug in this bot first — the
one-placement-deep board search, the tutor picking by list order, the composition
enumerated twice — so it is worth reading properly rather than in a terminal.
Lives in the repo because it kept being lost from scratch directories.
"""
import html, re, sys, os

src = sys.argv[1] if len(sys.argv) > 1 else "game.txt"
dst = sys.argv[2] if len(sys.argv) > 2 else "game.html"
raw = open(src, encoding="utf-8").read().split("\n")
esc = lambda s: html.escape(s, quote=True)

fields, cur, final, thinking, title_line = [], None, "", "", ""
open_units = open_spells = ""
for i, L in enumerate(raw):
    m = re.match(r"^Game (\S+) — (.*)$", L)
    if m:
        title_line = f"Game {m.group(1)} — {m.group(2)}"
    if L.startswith("   units: ") and not open_units:
        open_units = L[10:]
    if L.startswith("   spells: ") and not open_spells:
        open_spells = L[11:]
    m = re.match(r"^BATTLEFIELD (\d+): (.*?) \((.*)\)$", L)
    if m:
        cur = {"n": m.group(1), "name": m.group(2), "meta": m.group(3),
               "text": raw[i + 1].strip() if i + 1 < len(raw) else "",
               "units": "", "spells": "", "body": []}
        fields.append(cur)
    if cur is not None:
        if L.startswith("   units: ") and not cur["units"]:
            cur["units"] = L[10:]
        elif L.startswith("   spells: ") and not cur["spells"]:
            cur["spells"] = L[11:]
        elif L.startswith("-- "):
            cur["body"].append(("phase", L.strip("- ").strip()))
        elif L.startswith("   me ") and "them" in L:
            cur["body"].append(("snaphead", L.strip()))
        elif L.startswith("   my side:") or L.startswith("   their side:") or re.match(r"^   [FB]: ", L):
            cur["body"].append(("board", L))
        elif L.startswith("   ME: "):
            cur["body"].append(("me", L[7:]))
        elif L.startswith("   THEM: "):
            cur["body"].append(("them", L[9:]))
        elif L.startswith("      · "):
            cur["body"].append(("log", L[8:]))
        elif L.startswith("      "):
            cur["body"].append(("why", L.strip()))
        elif L.startswith("   >>> "):
            cur["body"].append(("result", L[7:]))
    if L.startswith("FINAL"):
        final = L
    if L.startswith("Thinking:"):
        thinking = L


def render_body(body):
    out, boards, logs, whys = [], [], [], []

    def flush_board():
        nonlocal boards
        if boards:
            out.append('<pre class="board">' + esc("\n".join(boards)) + "</pre>")
            boards = []

    def flush_log():
        nonlocal logs
        if logs:
            out.append('<ul class="log">' + "".join(f"<li>{esc(x)}</li>" for x in logs) + "</ul>")
            logs = []

    def flush_why():
        nonlocal whys
        if whys:
            out.append('<div class="why">' + "".join(f"<p>{esc(x)}</p>" for x in whys) + "</div>")
            whys = []

    for kind, text in body:
        if kind != "board":
            flush_board()
        if kind != "log":
            flush_log()
        if kind != "why":
            flush_why()
        if kind == "phase":
            out.append(f'<h3 class="phase">{esc(text)}</h3>')
        elif kind == "snaphead":
            out.append(f'<div class="snap-head">{esc(text)}</div>')
        elif kind == "board":
            boards.append(text)
        elif kind == "log":
            logs.append(text)
        elif kind == "why":
            whys.append(text)
        elif kind == "me":
            ms = re.search(r"\[(\d+)ms\]", text)
            label = re.sub(r"\s*\[\d+ms\]", "", text)
            t = f'<span class="ms">{esc(ms.group(1))}ms</span>' if ms else ""
            out.append(f'<div class="move me"><span class="who">Bot</span>'
                       f'<div class="what"><p>{esc(label)}{t}</p></div></div>')
        elif kind == "them":
            out.append(f'<div class="move them"><span class="who">Opp</span>'
                       f'<div class="what"><p>{esc(text)}</p></div></div>')
        elif kind == "result":
            cls = "win" if "I TAKE" in text else "loss" if "THEY TAKE" in text else "void"
            out.append(f'<div class="result {cls}">{esc(text)}</div>')
    flush_board(); flush_log(); flush_why()
    return "".join(out)


sections = []
for f in fields:
    sections.append(f'''<section class="field">
<header class="field-head"><span class="num">{esc(f["n"])}</span>
<div><h2>{esc(f["name"])}</h2><p class="meta">{esc(f["meta"])}</p><p class="rule">{esc(f["text"])}</p></div>
</header>
<div class="hand"><div><span class="lbl">units</span><p>{esc(f["units"])}</p></div>
<div><span class="lbl">spells</span><p>{esc(f["spells"])}</p></div></div>
{render_body(f["body"])}
</section>''')

NOTE = ("<p>Under each of the bot's moves is what it weighed. In the <b>gathering</b>: every "
        "<b>composition</b> that fits the cost cap, enumerated rather than searched, with the total "
        "power of my side, the power that composition adds, and <b>&Delta;&Theta;</b> — how much it "
        "adds to what my hand could still swing, over and above what the board already had. In the "
        "<b>battle</b>: the ceiling on what the opponent could do with the best hand they might "
        "still hold, then each line the search looked at.</p>"
        "<p><b>Score = power difference + 0.8 &middot; &Theta;.</b></p>"
        "<p><b>Read the &Delta;&Theta; column first.</b> It is <b>+0.0</b> on nearly every row, and "
        "that is the finding this page exists to show: during the gathering, &Theta; is measured "
        "against the opponent's board <i>as it stands</i> — one or two units — so a removal spell "
        "has nothing lethal to aim at, and a caster composition scores the same as a pile of bodies. "
        "The composition is being chosen on power alone.</p>")

doc = f'''<title>Bot Game Seven</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
:root {{
  --ink:#16181d; --ink-2:#41454f; --ink-3:#767c88;
  --paper:#fbfaf9; --panel:#f2f1ee; --line:#e0dedb;
  --me:#37458f; --me-soft:#eceefa;
  --them:#6b6259; --them-soft:#f4f1ed;
  --win:#2f6b46; --loss:#8c3a3a;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ink:#e8e7e4; --ink-2:#b0aeaa; --ink-3:#83817d;
    --paper:#14151a; --panel:#1c1e25; --line:#2c2f38;
    --me:#93a2ee; --me-soft:#1e2340;
    --them:#b7ab9c; --them-soft:#241f1b;
    --win:#7fc79b; --loss:#e08e8e;
  }}
}}
:root[data-theme="dark"] {{
  --ink:#e8e7e4; --ink-2:#b0aeaa; --ink-3:#83817d;
  --paper:#14151a; --panel:#1c1e25; --line:#2c2f38;
  --me:#93a2ee; --me-soft:#1e2340;
  --them:#b7ab9c; --them-soft:#241f1b;
  --win:#7fc79b; --loss:#e08e8e;
}}
* {{ box-sizing:border-box; }}
body {{ background:var(--paper); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,sans-serif; line-height:1.55;
  margin:0; padding:2.5rem 1.25rem 6rem; }}
.wrap {{ max-width:64rem; margin:0 auto; display:flex; flex-direction:column; gap:2rem; }}
h1 {{ font-family:Newsreader,Georgia,serif; font-weight:600; font-size:2.6rem;
  line-height:1.1; margin:0; text-wrap:balance; letter-spacing:-.01em; }}
.sub {{ color:var(--ink-2); margin:.4rem 0 0; max-width:64ch; }}
.opening, .changed {{ background:var(--panel); border:1px solid var(--line); border-radius:6px;
  padding:1rem 1.15rem; display:flex; flex-direction:column; gap:.5rem; }}
.changed {{ background:var(--me-soft); border:none; border-left:3px solid var(--me); }}
.changed p {{ margin:0; font-size:.95rem; color:var(--ink-2); max-width:68ch; }}
.changed b {{ color:var(--ink); }}
.lbl {{ font-family:"IBM Plex Mono",monospace; font-size:.68rem; text-transform:uppercase;
  letter-spacing:.09em; color:var(--ink-3); }}
.opening p, .hand p {{ margin:.15rem 0 0; font-family:"IBM Plex Mono",monospace;
  font-size:.79rem; color:var(--ink-2); }}
.field {{ border-top:2px solid var(--ink); padding-top:1.25rem;
  display:flex; flex-direction:column; gap:.75rem; }}
.field-head {{ display:flex; gap:1rem; align-items:baseline; }}
.num {{ font-family:Newsreader,Georgia,serif; font-size:2.4rem; line-height:1;
  color:var(--ink-3); font-variant-numeric:tabular-nums; }}
.field-head h2 {{ font-family:Newsreader,Georgia,serif; font-weight:600;
  font-size:1.55rem; margin:0; }}
.meta {{ margin:.1rem 0 0; font-family:"IBM Plex Mono",monospace; font-size:.74rem;
  color:var(--ink-3); }}
.rule {{ margin:.35rem 0 0; color:var(--ink-2); font-size:.92rem; max-width:60ch; }}
.hand {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));
  gap:.75rem; background:var(--panel); border:1px solid var(--line);
  border-radius:6px; padding:.85rem 1rem; }}
.phase {{ font-family:"IBM Plex Mono",monospace; font-size:.72rem; font-weight:600;
  text-transform:uppercase; letter-spacing:.14em; color:var(--ink-3);
  margin:.9rem 0 0; padding-bottom:.3rem; border-bottom:1px solid var(--line); }}
.snap-head {{ font-family:"IBM Plex Mono",monospace; font-size:.76rem;
  color:var(--ink-2); font-variant-numeric:tabular-nums; margin-top:.6rem; }}
.board {{ font-family:"IBM Plex Mono",monospace; font-size:.7rem; line-height:1.5;
  color:var(--ink-3); margin:.2rem 0 0; overflow-x:auto;
  border-left:2px solid var(--line); padding-left:.8rem; }}
.move {{ display:flex; gap:.75rem; align-items:flex-start;
  padding:.5rem .8rem; border-radius:5px; }}
.move .who {{ font-family:"IBM Plex Mono",monospace; font-size:.66rem; font-weight:600;
  text-transform:uppercase; letter-spacing:.08em; padding:.18rem .45rem;
  border-radius:3px; flex:none; min-width:3.1rem; text-align:center; }}
.move .what {{ flex:1; min-width:0; }}
.move p {{ margin:0; font-size:.95rem; }}
.ms {{ font-family:"IBM Plex Mono",monospace; font-size:.68rem; color:var(--ink-3);
  margin-left:.5rem; font-weight:400; }}
.me {{ background:var(--me-soft); border-left:3px solid var(--me); }}
.me .who {{ background:var(--me); color:var(--paper); }}
.me p {{ font-weight:600; color:var(--ink); }}
.them {{ background:var(--them-soft); border-left:3px solid var(--them); }}
.them .who {{ background:var(--them); color:var(--paper); }}
.them p {{ color:var(--ink-2); }}
.why {{ font-family:"IBM Plex Mono",monospace; font-size:.73rem; line-height:1.6;
  color:var(--ink-2); border-left:2px dashed var(--me); margin:.1rem 0 .3rem 1rem;
  padding:.45rem 0 .45rem .85rem; overflow-x:auto; }}
.why p {{ margin:0; white-space:pre; }}
.log {{ list-style:none; margin:.25rem 0 0; padding:0;
  font-family:"IBM Plex Mono",monospace; font-size:.72rem; color:var(--ink-3); }}
.log li {{ padding-left:.9rem; position:relative; }}
.log li::before {{ content:"·"; position:absolute; left:.15rem; }}
.result {{ font-family:"IBM Plex Mono",monospace; font-size:.85rem; font-weight:600;
  padding:.6rem .9rem; border-radius:5px; letter-spacing:.02em; margin-top:.4rem; }}
.result.win {{ background:color-mix(in srgb,var(--win) 14%,transparent); color:var(--win); }}
.result.loss {{ background:color-mix(in srgb,var(--loss) 14%,transparent); color:var(--loss); }}
.result.void {{ background:var(--panel); color:var(--ink-2); }}
.final {{ font-family:Newsreader,Georgia,serif; font-size:1.9rem; font-weight:600;
  border-top:2px solid var(--ink); padding-top:1.1rem; }}
.final small {{ display:block; font-family:"IBM Plex Mono",monospace; font-size:.75rem;
  font-weight:400; color:var(--ink-3); margin-top:.4rem; }}
</style>
<div class="wrap">
<header>
<h1>One game, every decision</h1>
<p class="sub">{esc(title_line)}. Only what this seat may see — a face-down enemy prints as face-down, and the opponent's hand never appears. Opponent is <code>sim/baseline.ts</code>.</p>
</header>
<div class="changed">
<span class="lbl">how to read the dashed blocks</span>
{NOTE}
</div>
<div class="opening">
<div><span class="lbl">opening units</span><p>{esc(open_units)}</p></div>
<div><span class="lbl">opening spells</span><p>{esc(open_spells)}</p></div>
</div>
{"".join(sections)}
<div class="final">{esc(final)}<small>{esc(thinking)}</small></div>
</div>
'''
open(dst, "w", encoding="utf-8").write(doc)
print(f"wrote {dst}: {len(doc)} bytes, {len(fields)} battlefields")
