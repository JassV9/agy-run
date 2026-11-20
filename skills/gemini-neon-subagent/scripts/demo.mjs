// agy-run demo: the whole loop, safely, with no brief to write. Makes a throwaway folder
// with a tiny project, asks the cheapest available model to analyse it and fix a one-line
// bug (with --mode accept-edits, inside that folder only), shows the live view and diff,
// checks the fix landed and the brief arrived intact, then deletes the folder.
//
// Usage: agy-run demo [--model M] [--no-tab] [--keep]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agyCommand, cmdQuote, ECHO_LINE, echoMatched, pickCheapModel } from './common.mjs';
import { run } from './run.mjs';

const STATS = `// tiny-stats: helpers used by the agy-run demo
function mean(xs) {
  let sum = 0;
  for (let i = 0; i <= xs.length; i++) sum += xs[i];
  return sum / xs.length;
}

function max(xs) {
  return xs.reduce((a, b) => (b > a ? b : a), -Infinity);
}

module.exports = { mean, max };
`;
const README = '# tiny-stats\n\nTwo small helpers (`mean`, `max`). Used by the agy-run demo.\n';

export async function demo(argv) {
  const keep = argv.includes('--keep');
  const noTab = argv.includes('--no-tab');
  let model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : null;
  if (!model) {
    const a = agyCommand();
    if (!a) { console.error('agy-run demo: agy not found. Run "agy-run doctor".'); process.exit(1); }
    const r = a.needsShell ? spawnSync(`${cmdQuote(a.file)} models`, { encoding: 'utf8', shell: true, timeout: 60000 })
      : spawnSync(a.file, ['models'], { encoding: 'utf8', timeout: 60000 });
    model = pickCheapModel((r.stdout || '').split('\n').map((l) => l.split(/\s/)[0]).filter(Boolean));
    if (!model) { console.error('agy-run demo: could not list models. Run "agy-run doctor".'); process.exit(1); }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-run-demo-'));
  const work = path.join(root, 'tiny-stats');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'stats.js'), STATS);
  fs.writeFileSync(path.join(work, 'README.md'), README);
  const brief = path.join(root, 'brief.md');
  fs.writeFileSync(brief, `# agy-run demo task

You are in a tiny JavaScript project (README.md, stats.js). This is a demo of a delegation tool.

1. Read both files. In your reply, give a 3-bullet analysis of stats.js: what it does, and any bugs.
2. Fix the off-by-one bug in \`mean\` by changing exactly ONE line of stats.js. Do not change any other line or file.
3. End your reply with the line below copied exactly, character for character, on its own line (it checks this brief arrived intact):

${ECHO_LINE}
`);
  console.log(`agy-run demo: ${model} on a throwaway copy in ${work}\n`);

  const here = process.cwd();
  let res;
  try {
    res = await run([model, brief, '--cwd', work, '--mode', 'accept-edits', ...(noTab ? ['--no-tab'] : [])]);
  } finally { process.chdir(here); }

  const s = res.summary;
  let answer = '';
  try { answer = fs.readFileSync(s.answer, 'utf8'); } catch {}
  const after = fs.readFileSync(path.join(work, 'stats.js'), 'utf8');
  const fixed = /i < xs\.length/.test(after) && !/i <= xs\.length/.test(after);
  const changedLines = after.split('\n').filter((l, i) => l !== STATS.split('\n')[i]).length;
  const readmeSame = fs.readFileSync(path.join(work, 'README.md'), 'utf8') === README;
  const checks = [
    ['run', s.status === 'SUCCESS', `status ${s.status} on ${s.model}${s.hint ? ` (${s.hint})` : ''}`],
    ['brief intact', echoMatched(answer), echoMatched(answer) ? 'the echo line came back exactly' : 'the echo line did not come back exactly: quoting or encoding may be mangling briefs'],
    ['edit landed', fixed, fixed ? `mean() fixed (${changedLines} line changed)` : 'stats.js not fixed (edit soft-denied or model mistake: see stderr / answer)'],
    ['scope kept', readmeSame && changedLines <= 1, readmeSame && changedLines <= 1 ? 'nothing else touched' : 'other lines or files changed'],
  ];
  console.log('\nagy-run demo results:');
  for (const [id, ok, d] of checks) console.log(`${ok ? '✓' : '✗'} ${id.padEnd(12)} ${d}`);
  if (keep) console.log(`\nkept: ${root}`);
  else { fs.rmSync(root, { recursive: true, force: true }); console.log('\nthrowaway folder removed'); }
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}
