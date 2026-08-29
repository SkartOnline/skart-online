import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunReport } from "./report";

/**
 * Turns a run's JSON into a page you can click through.
 *
 *   npm run sim -- --games 100 --report reports/run.json
 *   npm run stats -- reports/run.json
 *   npm run stats -- reports/run.json --out anywhere.html
 *
 * The output is one self-contained HTML file with the report embedded in it:
 * no server, no build step, no network. Open it, mail it, keep it next to the
 * numbers it describes. That last part is the point — a balance report that
 * cannot be opened in six months is a balance report nobody checks against.
 *
 * Every statistic is computed in the browser from the raw match log rather than
 * baked in here, so the page can answer questions this script never thought of.
 * `viewer.html` holds the whole of it; this only does the substitution.
 */

const here = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const argv = process.argv.slice(2);
  const input = argv.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("usage: npm run stats -- <report.json> [--out <page.html>]");
    process.exit(1);
  }
  const outFlag = argv.indexOf("--out");
  const output = outFlag !== -1 ? argv[outFlag + 1] : input.replace(/\.json$/, "") + ".html";

  const raw = readFileSync(resolve(input), "utf8");
  const report = JSON.parse(raw) as RunReport;
  const template = readFileSync(join(here, "viewer.html"), "utf8");

  // `</script>` anywhere inside the JSON would close the tag holding it, and a
  // card called "</script>" is not the failure worth risking. The escape is
  // invisible to `JSON.parse`, which reads < as "<".
  const safe = raw.replace(/</g, "\\u003c");
  const page = template.replace("/*__REPORT__*/", safe);

  writeFileSync(resolve(output), page, "utf8");
  const mb = (page.length / 1024 / 1024).toFixed(1);
  console.log(
    `${output}  (${mb} MB)\n` +
      `  ${report.matches.length} matches, ` +
      `${report.matches.reduce((n, m) => n + m.log.length, 0).toLocaleString()} actions, ` +
      `${Object.keys(report.cards).length} cards`,
  );
}

main();
