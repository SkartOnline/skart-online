import "./rulebook.css";
import { useMemo, useState } from "react";
import fullSource from "../../docs/szabaly-teljes.md?raw";
import quickSource from "../../docs/szabaly-gyors.md?raw";

/**
 * The rulebook, read straight out of `docs/`, so there is only ever one copy of
 * the rules and replacing the file replaces this screen. The full rulebook is
 * the authority — every numbered point is quotable, and the engine follows it —
 * with the quick rules kept as the read-first version.
 *
 * The renderer covers what the documents actually use: headings, rules, lists,
 * tables, fenced code and inline emphasis. It is not a general Markdown
 * implementation and does not need to be.
 */

const BOOKS = [
  { id: "teljes", label: "Teljes szabályzat", source: fullSource },
  { id: "gyors", label: "Gyorsszabályok", source: quickSource },
] as const;

export default function Rulebook({ onLeave }: { onLeave: () => void }) {
  const [which, setWhich] = useState<(typeof BOOKS)[number]["id"]>("teljes");
  const book = BOOKS.find((b) => b.id === which) ?? BOOKS[0];
  const blocks = useMemo(() => parse(book.source), [book.source]);
  return (
    <div className="tome">
      <div className="crossbar">
        <button className="quiet" onClick={onLeave}>
          Vissza
        </button>
        <h2>Szabály</h2>
        <span className="right tabs">
          {BOOKS.map((b) => (
            <button
              key={b.id}
              className={b.id === which ? "here" : ""}
              onClick={() => setWhich(b.id)}
            >
              {b.label}
            </button>
          ))}
        </span>
      </div>
      <div className="tome-page" key={which}>
        <article className="prose">{blocks}</article>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Block = JSX.Element;

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let key = 0;
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length === 0) return;
    out.push(<p key={key++}>{inline(buffer.join(" "))}</p>);
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph(paragraph);
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph(paragraph);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph(paragraph);
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      out.push(<Tag key={key++}>{inline(heading[2])}</Tag>);
      i++;
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      flushParagraph(paragraph);
      const rows: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(lines[i++]);
      out.push(table(rows, key++));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph(paragraph);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      }
      out.push(
        <ul key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paragraph);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      }
      out.push(
        <ol key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }

  flushParagraph(paragraph);
  return out;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function table(rows: string[], key: number): Block {
  const head = cells(rows[0]);
  const body = rows.slice(rows.length > 1 && /^[\s|:-]+$/.test(rows[1]) ? 2 : 1).map(cells);
  return (
    <div className="prose-table" key={key}>
      <table>
        <thead>
          <tr>
            {head.map((c, n) => (
              <th key={n}>{inline(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, n) => (
            <tr key={n}>
              {row.map((c, m) => (
                <td key={m}>{inline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `**bold**`, `` `code` `` and `*emphasis*`, in one pass. */
function inline(text: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith("**")) out.push(<b key={key++}>{token.slice(2, -2)}</b>);
    else if (token.startsWith("`")) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else out.push(<i key={key++}>{token.slice(1, -1)}</i>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
