// Token Launch Radar: the entrypoint.
//
// What it does, in order:
//   1. reads the sealed snapshot (at /input/snapshot.json in the grader, or wherever --input points),
//   2. scores every pre-token protocol with the model in lib/model.ts and refuses to hand in a board
//      the gate would refuse (boardIssue says why),
//   3. writes the ranked board to board.json and the dashboard's dataset to data.js,
//   4. copies this repository's dashboard/ and screenshots/ beside them (dotfiles stay behind: they
//      are scaffolding, not part of the entry),
//   5. writes dossier.json last, with the vendored make.fun library, because the scorer rebuilds the
//      dossier from the finished output and compares bytes — it must describe the final state.
//
// Run it outside the grader like this (MAKEFUN_OUTPUT_DIR stands in for /output):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Node 22, standard library only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The caps the scorer applies to a dossier, mirrored here so a bad hand-in fails at build time. */
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };

/** A dossier image's name: letters, digits and . _ -, 1 to 128 characters, never a leading dot. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** Read --<name> from the command line, in either `--name value` or `--name=value` form. */
function readArg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at !== -1 && process.argv[at + 1] !== undefined) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

/** Fail loudly, with the radar's own prefix, and stop. */
function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Copy a directory's regular files into place, skipping dotfiles; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

// --- 1. the snapshot -----------------------------------------------------------------------------

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));

// --- 2. the board, gated ---------------------------------------------------------------------------

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`, 1);

// --- 3. board and dashboard data -------------------------------------------------------------------

const outDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

// --- 4. the dashboard and the screenshots ------------------------------------------------------------

const dashboardFiles = copyDir(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const shotNames = copyDir(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3) {
  die(`screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shotNames) {
  if (!IMAGE_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
}

// --- 5. the dossier, last ----------------------------------------------------------------------------

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: SCREENSHOT_LIMITS, dashboard: DASHBOARD_LIMITS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early finds, ${radar.live_size} live set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shotNames.length} images) and dossier.json to ${outDir}\n`,
);
