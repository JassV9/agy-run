#!/usr/bin/env node
// agy-wait: block until the agy-run started with BRIEF_FILE finishes, then print a
// compact report (done line, files changed, the answer) and exit with its status.
// Meant to be run by Claude as a *background* shell command, so Claude is notified
// when Gemini finishes instead of polling the terminal.
//
// Usage: agy-wait BRIEF_FILE [--timeout SECONDS] [--max-chars N] [--resume]
//   --resume  also accept a run that started/finished before agy-wait was launched
//             (use when waiting again after a timeout, or picking up a finished run)
// Exit:  0 SUCCESS · 75 RATE_LIMITED · 130 CANCELED · 1 other failure
//        3 run never started (check the Terminal tab) · 4 agy-run died · 124 timed out

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (!argv.length) { console.error('usage: agy-wait BRIEF_FILE [--timeout SECONDS] [--max-chars N]'); process.exit(2); }
const brief = path.resolve(argv[0]);
let timeout = 3600, maxChars = 30000, resume = false;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--timeout') timeout = Number(argv[++i]);
  else if (argv[i] === '--max-chars') maxChars = Number(argv[++i]);
  else if (argv[i] === '--resume') resume = true;
}
const DONE = `${brief}.done`, STARTED = `${brief}.started`;
const t0 = Date.now();
const START_GRACE = 90_000;     // how long agy-run gets to start in the Terminal tab
const FRESH = resume ? Infinity : 60_000; // markers older than (t0 - FRESH) belong to an earlier run
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const briefMtime = mtime(brief) ?? 0;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(s) {
  const out = [s.doneLine];
  if (s.attempts?.length > 1) out.push(`attempts: ${s.attempts.map((a) => `${a.model}=${a.status}`).join(' → ')}`);
  const files = Object.entries(s.edits || {});
  if (files.length) {
    out.push(`files changed (${files.length}):`);
    for (const [f, e] of files) out.push(`  ${f} +${e.add} -${e.del}${e.created ? ' (new)' : ''}${e.deleted ? ' (deleted)' : ''}`);
  }
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
  console.log(out.join('\n'));
  const code = { SUCCESS: 0, RATE_LIMITED: 75, CANCELED: 130 }[s.status];
  process.exit(code ?? 1);
}

let deadSince = null;
for (;;) {
  const dm = mtime(DONE);
  if (dm && (resume || (dm >= briefMtime && dm >= t0 - FRESH))) {
    try { report(JSON.parse(fs.readFileSync(DONE, 'utf8'))); } catch { await sleep(300); continue; } // half-written
  }
  const sm = mtime(STARTED);
  const started = sm && sm >= t0 - FRESH;
  const elapsed = Date.now() - t0;
  if (!started && elapsed > START_GRACE) {
    console.log(`agy-wait: no agy-run started for ${brief} within ${START_GRACE / 1000}s. The Terminal tab command probably never ran (check the tab).`);
    process.exit(3);
  }
  if (started) {
    let pid = null;
    try { pid = JSON.parse(fs.readFileSync(STARTED, 'utf8')).pid; } catch {}
    if (pid && !alive(pid)) {
      deadSince ??= Date.now();
      if (Date.now() - deadSince > 5000 && !mtime(DONE)) {
        console.log(`agy-wait: agy-run (pid ${pid}) exited without writing a result. Logs: ~/.cache/agy-runs/latest.*`);
        process.exit(4);
      }
    } else deadSince = null;
  }
  if (timeout > 0 && elapsed > timeout * 1000) {
    console.log(`agy-wait: still running after ${timeout}s; giving up waiting (the run continues in its tab). Run "agy-wait BRIEF --resume" to keep waiting.`);
    process.exit(124);
  }
  await sleep(1000);
}
