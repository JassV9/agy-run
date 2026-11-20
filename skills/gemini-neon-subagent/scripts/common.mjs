// Shared helpers for agy-run (run, wait, doctor, install). No dependencies; Node 18+.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '4.0.0';
export const IS_WIN = process.platform === 'win32';
export const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RL_EXIT = 75;

// Where things live.
export const runsDir = () => process.env.AGY_RUN_DIR || path.join(os.homedir(), '.cache', 'agy-runs');
export const shareDir = () => (IS_WIN
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agy-run')
  : path.join(os.homedir(), '.local', 'share', 'agy-run'));
export const binDir = () => path.join(os.homedir(), '.local', 'bin');
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// Accept Git Bash style /c/Users/... paths on Windows as well as C:\ and C:/ forms.
export function normPath(p) {
  if (IS_WIN && /^\/[a-zA-Z]\//.test(p)) p = `${p[1]}:\\${p.slice(3).replace(/\//g, '\\')}`;
  return path.resolve(p);
}

// Find an executable on PATH (honours PATHEXT on Windows). Returns full path or null.
export function which(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of IS_WIN && path.extname(cmd) ? [''] : exts) {
      const f = path.join(dir, cmd + ext);
      try { if (fs.statSync(f).isFile()) { if (!IS_WIN) fs.accessSync(f, fs.constants.X_OK); return f; } } catch {}
    }
  }
  return null;
}

// How to launch agy: { file, needsShell } (a .cmd/.bat on Windows has to go through cmd.exe).
export function agyCommand() {
  const f = which('agy');
  if (!f) return null;
  return { file: f, needsShell: IS_WIN && /\.(cmd|bat)$/i.test(f) };
}

// Quote one argument for cmd.exe (only used for short, simple args).
export const cmdQuote = (a) => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

const semver = (v) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
export function cmpVersion(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

// Every installed copy of these scripts that has cli.mjs: newest plugin version first,
// then claude.ai-synced skill copies. [{ dir, version, source }]
export function installedCopies() {
  const out = [];
  const cache = path.join(claudeDir(), 'plugins', 'cache');
  for (const mkt of safeDir(cache)) {
    const base = path.join(cache, mkt, 'gemini-neon-subagent');
    for (const ver of safeDir(base)) {
      const dir = path.join(base, ver, 'skills', 'gemini-neon-subagent', 'scripts');
      if (fs.existsSync(path.join(dir, 'cli.mjs'))) out.push({ dir, version: ver, source: `plugin ${mkt}` });
    }
  }
  out.sort((a, b) => cmpVersion(b.version, a.version));
  const synced = path.join(claudeDir(), 'skills');
  for (const a of safeDir(synced)) for (const b of safeDir(path.join(synced, a))) {
    const dir = path.join(synced, a, b, 'gemini-neon-subagent', 'scripts');
    if (fs.existsSync(path.join(dir, 'cli.mjs'))) out.push({ dir, version: readVersion(dir) || '?', source: 'claude.ai skill' });
  }
  return out;
}
function safeDir(d) { try { return fs.readdirSync(d); } catch { return []; } }
export function readVersion(dir) {
  try { return fs.readFileSync(path.join(dir, 'common.mjs'), 'utf8').match(/VERSION = '([^']+)'/)?.[1] || null; } catch { return null; }
}

// ---------- report shared by `agy-wait` and `agy-run --no-tab` ----------
export function formatReport(s, maxChars = 30000) {
  const out = [s.doneLine];
  if (s.attempts?.length > 1) out.push(`attempts: ${s.attempts.map((a) => `${a.model}=${a.status}`).join(' → ')}`);
  const files = Object.entries(s.edits || {});
  if (files.length) {
    out.push(`files changed (${files.length}):`);
    for (const [f, e] of files) out.push(`  ${f} +${e.add} -${e.del}${e.created ? ' (new)' : ''}${e.deleted ? ' (deleted)' : ''}`);
    if (s.beforeDir) out.push(`pre-edit copies of those files: ${s.beforeDir}`);
  }
  if (s.hint) out.push(`hint: ${s.hint}`);
  if (s.status === 'RATE_LIMITED') {
    out.push(`rate limited on ${s.model}${s.reason ? ` (${s.reason})` : ''}.` +
      (s.next ? ` One step down: ${s.next}.` : ' No lower model on the ladder.') +
      (s.nextFamily && s.nextFamily !== s.next ? ` Next model family: ${s.nextFamily}.` : ''));
  }
  if (s.status !== 'SUCCESS') {
    try { const err = fs.readFileSync(s.err, 'utf8').trim(); if (err) out.push(`stderr (${s.err}):`, err.slice(-2000)); } catch {}
  }
  let answer = '';
  try { answer = fs.readFileSync(s.answer, 'utf8'); } catch {}
  if (answer.trim()) {
    out.push(`--- answer (${s.answer}) ---`);
    out.push(answer.length > maxChars ? `${answer.slice(0, maxChars)}\n… [${answer.length - maxChars} more chars in ${s.answer}]` : answer);
  } else out.push('(no answer text)');
  return out.join('\n');
}
export const statusExit = (st) => ({ SUCCESS: 0, RATE_LIMITED: RL_EXIT, CANCELED: 130 }[st] ?? 1);

// One actionable sentence for a failed run, from agy's stderr / result error.
export function failureHint({ status, errText = '', resultError, spawnError, abortReason }) {
  const t = `${errText}\n${typeof resultError === 'string' ? resultError : JSON.stringify(resultError || '')}`;
  if (spawnError) return 'agy could not be started: it is not on PATH for this shell. Run "agy-run doctor".';
  if (status === 'CANCELED') return null;
  if (status === 'RATE_LIMITED' || /resource.?exhausted|code 429|\b429\b|rate.?limit|quota/i.test(t)) return 'rate limited: try one step down (next=) or another model family (next_family=).';
  if (/flag provided but not defined|unknown flag|flag needs an argument|took ".*" as its prompt|invalid argument|Usage of agy/i.test(t)) return 'agy rejected the arguments: this is an agy-run bug (or an agy version change). Report it to the user with the agy version and this command; do not patch installed copies.';
  if (/auth|sign.?in|log.?in|credential|unauthori[sz]ed|\b401\b|\b403\b/i.test(t)) return 'not signed in or not allowed: run "agy" once interactively and sign in; Neon needs a paid plan or GEMINI_API_KEY.';
  if (/(unknown|invalid|unsupported|not (found|available)).{0,40}model|model.{0,40}(unknown|invalid|not (found|available))/i.test(t)) return 'that model slug is not available: check "agy models".';
  if (/timeout|deadline exceeded|timed out/i.test(t)) return 'hit the time limit: raise AGY_PRINT_TIMEOUT (default 15m) or split the task.';
  if (/ENOSPC|no space/i.test(t)) return 'disk full.';
  if (/network|ECONNRE|ENOTFOUND|dns|unreachable|tls|certificate/i.test(t)) return 'network problem reaching Google: check the connection or proxy, then retry.';
  if (status === 'NO_RESULT') return errText.trim() ? 'agy exited without a result; its stderr (above / in the .err file) has the cause.' : 'agy exited without a result and printed nothing: run "agy-run doctor --smoke".';
  return null;
}

// A brief line full of characters that shells and Windows quoting mangle. The smoke test
// and the demo ask the model to echo it back; a match proves the brief arrived intact.
export const ECHO_LINE = 'ECHO: "double" \'single\' `tick` #hash $HOME %PATH% & | < > ^ (paren) 100% ü→✓';
export const echoMatched = (answer = '') => answer.includes(ECHO_LINE);

// The cheapest model `agy models` offers (for smoke tests and demos).
export function pickCheapModel(models) {
  return models.find((x) => x === 'gemini-3.8-flash-low') || models.find((x) => /flash-low$/.test(x))
    || models.find((x) => x === 'gemini-4-neon-low') || models.find((x) => /-low$/.test(x)) || models.at(-1) || null;
}
