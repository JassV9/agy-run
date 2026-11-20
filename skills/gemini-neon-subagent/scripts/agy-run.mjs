#!/usr/bin/env node
// agy-run: run one Gemini task through the Antigravity CLI (agy) with a live, readable
// view in the terminal: steps, file reads, commands, and a colored diff of every file
// Gemini edits. Detects rate limits early, can step down a model ladder, and writes a
// done-file next to the brief so `agy-wait` (and Claude) get told when it finishes.
//
// Usage:  agy-run MODEL BRIEF_FILE [--descend] [--floor MODEL] [extra agy flags...]
//   --descend      on a rate limit (and only if no files were edited yet), retry
//                  automatically with the next model down the ladder
//   --floor MODEL  with --descend: never go below this model
// Env:
//   AGY_RUN_DIR            logs dir (default ~/.cache/agy-runs)
//   AGY_LADDER             space-separated step-down order (else ~/.config/agy-run/ladder)
//   AGY_RATE_LIMIT_ERRORS  consecutive error steps before calling it a rate limit (default 3)
//   AGY_DIFF_LINES         max diff lines shown per edit (default 80; 0 = summary only)
//   AGY_PRINT_TIMEOUT      agy --print-timeout per attempt (default 15m)
// Files: <logs>/<stamp>.{ndjson,err,md,json}, latest.* symlinks,
//        <brief>.started while running, <brief>.done (JSON) when finished.
// Last line printed: [agy-run done: STATUS model=… conv=… exit=… edits=N answer=… (next=…)]

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_LADDER = [
  'gemini-4-neon-xhigh', 'gemini-4-neon-high', 'gemini-4-neon-medium', 'gemini-4-neon-low',
  'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
];
const EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low'];
const RL_RE = /resource.?exhausted|code 429|\b429\b|rate.?limit|quota/i;
const RL_EXIT = 75;

// ---------- args ----------
const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('usage: agy-run MODEL BRIEF_FILE [--descend] [--floor MODEL] [extra agy flags...]');
  process.exit(2);
}
let model = argv[0];
const brief = path.resolve(argv[1]);
let descend = false, floor = null;
const extra = [];
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--descend') descend = true;
  else if (argv[i] === '--floor') floor = argv[++i];
  else extra.push(argv[i]);
}
if (!fs.existsSync(brief)) { console.error(`agy-run: brief file not found: ${brief}`); process.exit(2); }
const briefText = fs.readFileSync(brief, 'utf8');

const DIR = process.env.AGY_RUN_DIR || path.join(os.homedir(), '.cache', 'agy-runs');
fs.mkdirSync(DIR, { recursive: true });
const STARTED = `${brief}.started`, DONE = `${brief}.done`;
try { fs.unlinkSync(DONE); } catch {}
fs.writeFileSync(STARTED, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), model, cwd: process.cwd() }));

const RL_ERRORS = Number(process.env.AGY_RATE_LIMIT_ERRORS || 3);
const DIFF_LINES = Number(process.env.AGY_DIFF_LINES ?? 80);

// ---------- ladder ----------
function loadLadder() {
  if (process.env.AGY_LADDER) return process.env.AGY_LADDER.split(/\s+/).filter(Boolean);
  try {
    const f = path.join(os.homedir(), '.config', 'agy-run', 'ladder');
    const l = fs.readFileSync(f, 'utf8').split(/\s+/).filter((s) => s && !s.startsWith('#'));
    if (l.length) return l;
  } catch {}
  return DEFAULT_LADDER;
}
const LADDER = loadLadder();
const family = (m) => m.replace(new RegExp(`-(${EFFORTS.join('|')})$`), '');
function nextModel(m) {
  const i = LADDER.indexOf(m);
  if (i >= 0) return LADDER[i + 1] || null;
  const e = m.match(new RegExp(`-(${EFFORTS.join('|')})$`));
  if (e) { const j = EFFORTS.indexOf(e[1]); if (j < EFFORTS.length - 1) return `${family(m)}-${EFFORTS[j + 1]}`; }
  return null;
}
function nextFamily(m) {
  const i = LADDER.indexOf(m);
  return LADDER.slice(i + 1).find((x) => family(x) !== family(m)) || null;
}
function belowFloor(m) {
  if (!floor) return false;
  const a = LADDER.indexOf(m), b = LADDER.indexOf(floor);
  return a >= 0 && b >= 0 && a > b;
}

// ---------- output helpers ----------
const TTY = process.stdout.isTTY;
const c = TTY || process.env.FORCE_COLOR
  ? { dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m', reset: '\x1b[0m' }
  : { dim: '', bold: '', cyan: '', green: '', yellow: '', red: '', magenta: '', blue: '', reset: '' };
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let statusText = null, statusSince = Date.now(), statusShown = false, inText = false;
const rawOut = (s) => process.stdout.write(s);
function clearStatus() { if (statusShown) { rawOut('\r\x1b[2K'); statusShown = false; } }
function print(s) { clearStatus(); rawOut(s); }
function drawStatus() {
  if (!TTY || inText || !statusText) return;
  const el = fmtDur((Date.now() - statusSince) / 1000);
  const width = (process.stdout.columns || 100) - el.length - 4;
  rawOut(`\r\x1b[2K${c.dim}${trunc(statusText, width)} ${el}${c.reset}`);
  statusShown = true;
}
function setStatus(t) { statusText = t; statusSince = Date.now(); drawStatus(); }
const ticker = TTY ? setInterval(drawStatus, 1000) : null;
ticker?.unref();
function endText() { if (inText) { rawOut(`${c.reset}\n`); inText = false; } }

// ---------- file snapshots + diffs ----------
const MUTATE_RE = /write|edit|replace|sed|create|delete|move|rename|notebook_edit|patch/i;
const PATH_KEYS = ['Path', 'TargetFile', 'AbsolutePath', 'FilePath', 'File', 'path', 'file_path', 'target_file'];
const getPath = (p = {}) => { for (const k of PATH_KEYS) if (typeof p[k] === 'string') return p[k]; return null; };
let cwd = process.cwd();
const rel = (p) => { if (!p) return p; const r = path.relative(cwd, path.resolve(cwd, p)); return r && !r.startsWith('..') ? r : p; };
function readSafe(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    if (st.size > 2_000_000) return null;
    const buf = fs.readFileSync(abs);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch { return undefined; } // undefined = does not exist
}
// Contents seen earlier in this run (reads and finished edits), used as the "before"
// copy when a write lands before we could snapshot the file.
const readCache = new Map();
function gitHead(abs) {
  const r = spawnSync('git', ['-C', path.dirname(abs), 'show', `HEAD:./${path.basename(abs)}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.error || r.status !== 0 ? undefined : r.stdout;
}
function snapshot(abs) {
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (st && Date.now() - st.mtimeMs < 1500) {
    // Modified a moment ago: the tool probably already wrote it before we got here.
    if (readCache.has(abs)) return { content: readCache.get(abs), guessed: true };
    return { content: gitHead(abs), guessed: true };
  }
  return { content: readSafe(abs), guessed: false };
}
function unifiedDiff(before, abs) {
  const tmp = path.join(os.tmpdir(), `agy-run-before-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, before ?? '');
  try {
    let r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', tmp, abs], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.error) r = spawnSync('diff', ['-U2', tmp, abs], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.error) return null;
    const lines = (r.stdout || '').split('\n');
    const start = lines.findIndex((l) => l.startsWith('@@'));
    return start < 0 ? [] : lines.slice(start).filter((l, i, a) => !(i === a.length - 1 && l === ''));
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
function showDiff(lines) {
  if (DIFF_LINES > 0) {
    let shown = 0;
    for (const l of lines) {
      if (shown >= DIFF_LINES) { print(`    ${c.dim}… ${lines.length - shown} more diff lines${c.reset}\n`); break; }
      const col = l.startsWith('@@') ? c.cyan : l.startsWith('+') ? c.green : l.startsWith('-') ? c.red : c.dim;
      print(`    ${col}${trunc(l, (process.stdout.columns || 160) - 6)}${c.reset}\n`);
      shown++;
    }
  }
}

// ---------- one attempt ----------
function runOnce(model) {
  return new Promise((resolve) => {
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${model}`;
    const RAW = path.join(DIR, `${stamp}.ndjson`), ERR = path.join(DIR, `${stamp}.err`), OUT = path.join(DIR, `${stamp}.md`);
    for (const [ext, f] of [['ndjson', RAW], ['err', ERR], ['md', OUT]]) {
      const l = path.join(DIR, `latest.${ext}`);
      try { fs.unlinkSync(l); } catch {}
      try { fs.symlinkSync(f, l); } catch {}
    }
    const rawStream = fs.createWriteStream(RAW), errStream = fs.createWriteStream(ERR);
    print(`${c.dim}agy-run: ${model} in ${process.cwd()}\nagy-run: log ${RAW}${c.reset}\n`);
    setStatus('⏳ starting agy…');

    const child = spawn('agy', ['-p', briefText, '--model', model, '--output-format', 'stream-json',
      '--print-timeout', process.env.AGY_PRINT_TIMEOUT || '15m', ...extra],
    { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });

    const snapshots = new Map();
    const edits = {};
    let result = null, conv = null, consecutiveErrors = 0, errorCount = 0, progressed = false;
    let abortReason = null, stderrRL = false, spawnError = null;
    const onSigint = () => { abortReason = abortReason || 'canceled'; child.kill('SIGINT'); };
    process.on('SIGINT', onSigint);

    function abort(reason) {
      if (abortReason) return;
      abortReason = reason;
      print(`${c.yellow}${c.bold}⚠ ${reason}: stopping this attempt${c.reset}\n`);
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref();
    }

    function onEvent(ev) {
      if (ev.event === 'init') {
        conv = ev.conversation_id;
        if (ev.init?.cwd) cwd = ev.init.cwd;
        print(`${c.bold}${c.cyan}▶ Gemini ${ev.init?.model}${c.reset} ${c.dim}in ${ev.init?.cwd} · mode ${ev.init?.permission_mode} · conv ${conv}${c.reset}\n\n`);
        setStatus('🧠 thinking…');
        return;
      }
      if (ev.event === 'result') {
        endText();
        result = ev.result;
        return;
      }
      const s = ev.step_update;
      if (!s) { endText(); print(`${c.dim}${trunc(JSON.stringify(ev), 300)}${c.reset}\n`); return; }

      if (s.step_type === 'agent_response') {
        if (s.text_delta !== undefined) {
          if (!inText) { clearStatus(); rawOut(`${c.green}💬 ${c.reset}`); inText = true; }
          rawOut(s.text_delta);
        }
        if (s.state === 'DONE') {
          progressed = true; consecutiveErrors = 0;
          const had = inText;
          endText();
          if (!had && s.duration_seconds) {
            const tok = s.usage?.output_tokens ? ` · ${fmtTok(s.usage.output_tokens)} tokens out` : '';
            print(`${c.blue}🧠 thought for ${fmtDur(s.duration_seconds)}${c.reset}${c.dim}${tok}${c.reset}\n`);
          }
          setStatus('🧠 thinking…');
        }
        return;
      }

      if (s.step_type === 'error_message') {
        endText();
        errorCount++; consecutiveErrors++;
        print(`${c.yellow}⚠ error / retry #${consecutiveErrors}${progressed ? '' : ' (no progress yet: usually a Google rate limit)'}${c.reset}\n`);
        setStatus('⏳ agy retrying…');
        if (consecutiveErrors >= RL_ERRORS) abort(`rate limited (${consecutiveErrors} errors in a row)`);
        return;
      }

      if (s.step_type === 'user_input') return;

      if (s.step_type === 'tool') {
        const info = s.tool_info || {};
        const name = info.name || s.tool_name || 'tool';
        const params = info.parameters || {};
        const p = getPath(params);
        const abs = p ? path.resolve(cwd, p) : null;
        const mutating = abs && MUTATE_RE.test(name);

        if (s.state === 'ACTIVE') {
          if (mutating && !snapshots.has(abs)) snapshots.set(abs, snapshot(abs));
          setStatus(`${mutating ? '✏️  ' : '🔧 '}${name} ${describe(name, params)}`);
          return;
        }
        endText();
        progressed = true; consecutiveErrors = 0;
        const dur = s.duration_seconds ? ` ${c.dim}${fmtDur(s.duration_seconds)}${c.reset}` : '';
        if (s.state === 'ERROR' || info.error) {
          const msg = info.error?.message || JSON.stringify(info.error || 'failed');
          print(`${c.red}✗ ${name} ${describe(name, params)}${c.reset}${dur} ${c.red}${c.dim}${trunc(msg, 200)}${c.reset}\n`);
          snapshots.delete(abs);
          setStatus('🧠 thinking…');
          return;
        }
        if (mutating) {
          const snap = snapshots.get(abs) || snapshot(abs);
          const before = snap.content;
          snapshots.delete(abs);
          const after = readSafe(abs);
          if (after !== undefined) readCache.set(abs, after);
          const r = rel(abs);
          const e = (edits[r] ||= { add: 0, del: 0, ops: 0, created: before === undefined && !snap.guessed, deleted: false, changed: false });
          e.ops++;
          if (after === undefined) {
            e.deleted = true; e.changed = true;
            print(`${c.red}🗑  ${name} ${r} (deleted)${c.reset}${dur}\n`);
          } else if (before === null || after === null) {
            e.changed = true;
            print(`${c.magenta}✏️  ${name} ${r}${c.reset}${dur} ${c.dim}(binary or large file, no diff)${c.reset}\n`);
          } else if (before === after) {
            print(`${c.magenta}✏️  ${name} ${r}${c.reset}${dur} ${c.dim}(no change)${c.reset}\n`);
          } else {
            const lines = unifiedDiff(before, abs);
            const tag = before === undefined ? (snap.guessed ? 'written (no earlier copy to diff against)' : 'new file') : '';
            if (!lines) {
              print(`${c.magenta}✏️  ${name} ${r}${c.reset}${dur} ${c.dim}${tag || 'changed'} (git/diff not found)${c.reset}\n`);
              e.changed = true;
            } else {
              let add = 0, del = 0;
              for (const l of lines) { if (l.startsWith('+')) add++; else if (l.startsWith('-')) del++; }
              print(`${c.magenta}${c.bold}✏️  ${name} ${r}${c.reset}${dur} ${c.green}+${add}${c.reset} ${c.red}−${del}${c.reset}${tag ? ` ${c.dim}${tag}${c.reset}` : ''}\n`);
              showDiff(lines);
              e.add += add; e.del += del; e.changed = true;
            }
          }
          setStatus('🧠 thinking…');
          return;
        }
        // non-mutating tool
        if (abs && /read|view/.test(name)) { const cur = readSafe(abs); if (cur !== undefined && cur !== null) readCache.set(abs, cur); }
        const icon = /read|view/.test(name) ? '📖' : /command|shell|exec/.test(name) ? '⚙️ ' : /grep|search|find|list/.test(name) ? '🔍' : /browser|url/.test(name) ? '🌐' : '🔧';
        const outStr = typeof info.output === 'string' ? info.output : info.output ? JSON.stringify(info.output) : '';
        const oneLine = outStr && !outStr.includes('\n') && outStr.length < 80;
        print(`${c.magenta}${icon} ${name}${c.reset} ${describe(name, params)}${dur}${oneLine ? ` ${c.dim}· ${outStr}${c.reset}` : ''}\n`);
        if (outStr && !oneLine) {
          const ls = outStr.split('\n');
          for (const l of ls.slice(0, 12)) print(`    ${c.dim}${trunc(l, (process.stdout.columns || 160) - 6)}${c.reset}\n`);
          if (ls.length > 12) print(`    ${c.dim}… ${ls.length - 12} more lines${c.reset}\n`);
        }
        setStatus('🧠 thinking…');
        return;
      }

      // anything else: print once when it finishes
      if (s.state !== 'DONE') return;
      endText();
      progressed = true; consecutiveErrors = 0;
      const IGN = new Set(['conversation_id', 'step_index', 'state', 'step_type', 'text_delta', 'duration_seconds', 'usage']);
      const ex = Object.entries(s).filter(([k]) => !IGN.has(k)).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
      print(`${c.magenta}• ${s.step_type}${c.reset}${ex ? ` ${c.dim}${trunc(ex, 300)}${c.reset}` : ''}\n`);
    }

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      rawStream.write(`${line}\n`);
      let ev;
      try { ev = JSON.parse(line); } catch { endText(); print(`${c.dim}${line}${c.reset}\n`); return; }
      try { onEvent(ev); } catch (e) { print(`${c.dim}(agy-run: could not render event: ${e.message})${c.reset}\n`); }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      errStream.write(`${line}\n`);
      if (!line.trim()) return;
      let shown = line;
      const m = line.match(/^AGY_ERROR:\s*(\{.*\})/);
      if (m) { try { shown = `AGY_ERROR ${JSON.parse(m[1]).short_error}`; } catch {} }
      endText();
      print(`${c.yellow}${c.dim}stderr: ${trunc(shown, 300)}${c.reset}\n`);
      if (RL_RE.test(line)) { stderrRL = true; if (!result) abort('rate limited (agy reported RESOURCE_EXHAUSTED / 429)'); }
    });
    child.on('error', (e) => { spawnError = e; });

    child.on('close', (code, signal) => {
      process.off('SIGINT', onSigint);
      endText(); clearStatus(); statusText = null;
      rawStream.end(); errStream.end();
      let status;
      if (spawnError) status = 'NO_AGY';
      else if (abortReason === 'canceled') status = 'CANCELED';
      else if (abortReason) status = 'RATE_LIMITED';
      else if (result) status = result.status !== 'SUCCESS' && (RL_RE.test(String(result.error || '')) || stderrRL) ? 'RATE_LIMITED' : result.status;
      else status = stderrRL ? 'RATE_LIMITED' : 'NO_RESULT';
      fs.writeFileSync(OUT, result?.response || '');
      if (spawnError) print(`${c.red}agy-run: could not start agy: ${spawnError.message}${c.reset}\n`);
      const ok = status === 'SUCCESS';
      const dur = result?.duration_seconds ? fmtDur(Number(result.duration_seconds)) : '';
      const tok = result?.usage?.total_tokens ? ` · ${fmtTok(result.usage.total_tokens)} tokens` : '';
      print(`\n${ok ? c.green : status === 'RATE_LIMITED' ? c.yellow : c.red}${c.bold}■ ${status}${c.reset} ${c.dim}${model}${dur ? ` · ${dur}` : ''}${tok} · conv ${result?.conversation_id || conv || '-'}${c.reset}\n`);
      if (result?.error && !ok) print(`${c.red}${trunc(String(typeof result.error === 'string' ? result.error : JSON.stringify(result.error)), 400)}${c.reset}\n`);
      let exit = code ?? (signal ? 1 : 0);
      if (status === 'RATE_LIMITED') exit = RL_EXIT;
      else if (status === 'CANCELED') exit = 130;
      else if (!ok && exit === 0) exit = 1;
      resolve({ status, model, conv: result?.conversation_id || conv, exit, answer: OUT, raw: RAW, err: ERR,
        edits: Object.fromEntries(Object.entries(edits).filter(([, e]) => e.changed)), errorCount, reason: abortReason, durationSeconds: result?.duration_seconds ?? null,
        usage: result?.usage ?? null, stamp });
    });
  });
}

function describe(name, p = {}) {
  const parts = [];
  const fp = getPath(p);
  if (fp) parts.push(rel(fp));
  if (p.StartLine || p.EndLine) parts.push(`L${p.StartLine ?? 1}-${p.EndLine ?? ''}`);
  const cmd = p.CommandLine ?? p.command ?? p.Command ?? p.cmd;
  if (typeof cmd === 'string') parts.push(`$ ${trunc(cmd.replace(/\s+/g, ' '), 140)}`);
  const q = p.Query ?? p.query ?? p.Pattern ?? p.pattern ?? p.SearchPattern ?? p.SearchPath;
  if (typeof q === 'string' && q !== fp) parts.push(`"${trunc(q, 80)}"`);
  const dir = p.DirectoryPath ?? p.SearchDirectory ?? p.Directory;
  if (typeof dir === 'string') parts.push(`in ${rel(dir)}`);
  const url = p.Url ?? p.url ?? p.URL;
  if (typeof url === 'string') parts.push(trunc(url, 100));
  if (parts.length) return parts.join(' ');
  const s = Object.entries(p).map(([k, v]) => `${k}=${trunc(typeof v === 'string' ? v : JSON.stringify(v), 60)}`).join(' ');
  return trunc(s, 160);
}

// ---------- main ----------
const attempts = [];
let final;
for (;;) {
  final = await runOnce(model);
  attempts.push({ model, status: final.status, conv: final.conv, raw: final.raw });
  if (final.status !== 'RATE_LIMITED') break;
  const n = nextModel(model);
  const editedFiles = Object.keys(final.edits).length;
  if (!descend) break;
  if (editedFiles) { print(`${c.yellow}--descend: not retrying, this attempt already edited ${editedFiles} file(s)${c.reset}\n`); break; }
  if (!n || belowFloor(n)) { print(`${c.yellow}--descend: no model left above the floor${c.reset}\n`); break; }
  print(`\n${c.yellow}${c.bold}↓ ${model} is rate limited, stepping down to ${n}${c.reset}\n\n`);
  model = n;
}

const files = Object.entries(final.edits);
if (files.length) {
  print(`\n${c.bold}Files changed (${files.length}):${c.reset}\n`);
  for (const [f, e] of files) print(`  ${f} ${c.green}+${e.add}${c.reset} ${c.red}−${e.del}${c.reset}${e.created ? ' (new)' : ''}${e.deleted ? ' (deleted)' : ''}\n`);
}
const next = final.status === 'RATE_LIMITED' ? nextModel(final.model) : null;
const nextFam = final.status === 'RATE_LIMITED' ? nextFamily(final.model) : null;
const doneLine = `[agy-run done: ${final.status} model=${final.model} conv=${final.conv || '-'} exit=${final.exit} edits=${files.length} answer=${final.answer}${next ? ` next=${next}` : ''}${nextFam && nextFam !== next ? ` next_family=${nextFam}` : ''}]`;
const summary = { ...final, next, nextFamily: nextFam, attempts, brief, cwd: process.cwd(), finished: new Date().toISOString(), doneLine };
fs.writeFileSync(path.join(DIR, `${final.stamp}.json`), JSON.stringify(summary, null, 2));
fs.writeFileSync(DONE, JSON.stringify(summary, null, 2));
try { fs.unlinkSync(STARTED); } catch {}
if (fs.existsSync(final.err) && fs.statSync(final.err).size) print(`${c.dim}agy-run: stderr kept in ${final.err}${c.reset}\n`);
print(`${doneLine}\n`);
process.exit(final.exit);
