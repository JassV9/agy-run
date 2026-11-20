// agy-wait: block until the agy-run started with BRIEF_FILE finishes, then print a
// compact report (done line, files changed, the answer) and exit with its status.
// Meant to be run by Claude as a *background* shell command, so Claude is notified
// when Gemini finishes instead of polling the terminal.
//
// Usage: agy-wait BRIEF_FILE [--timeout SECONDS] [--max-chars N] [--resume]
//        agy-wait --file PATH [--timeout SECONDS]   wait for any file to appear, print it
//   --resume  also accept a run that started/finished before agy-wait was launched
// Exit:  0 SUCCESS · 75 RATE_LIMITED · 130 CANCELED · 1 other failure
//        3 run never started (check the Terminal tab) · 4 agy-run died · 124 timed out
import fs from 'node:fs';
import { normPath, formatReport, statusExit } from './common.mjs';

export async function wait(argv) {
  if (!argv.length) { console.error('usage: agy-wait BRIEF_FILE [--timeout SECONDS] [--max-chars N] [--resume]\n       agy-wait --file PATH [--timeout SECONDS]'); process.exit(2); }
  let timeout = 3600, maxChars = 30000, resume = false, file = null, target = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--timeout') timeout = Number(argv[++i]);
    else if (argv[i] === '--max-chars') maxChars = Number(argv[++i]);
    else if (argv[i] === '--resume') resume = true;
    else if (argv[i] === '--file') file = normPath(argv[++i]);
    else target = normPath(argv[i]);
  }
  const t0 = Date.now();
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (file) { // generic: wait for a fresh file (used for the doctor panel check)
    for (;;) {
      const m = mtime(file);
      if (m && (resume || m >= t0 - 60_000)) { await sleep(300); process.stdout.write(fs.readFileSync(file, 'utf8')); process.exit(0); }
      if (timeout > 0 && Date.now() - t0 > timeout * 1000) { console.log(`agy-wait: ${file} did not appear within ${timeout}s`); process.exit(124); }
      await sleep(500);
    }
  }

  const brief = target;
  const DONE = `${brief}.done`, STARTED = `${brief}.started`;
  const START_GRACE = 90_000;               // how long agy-run gets to start in the Terminal tab
  const FRESH = resume ? Infinity : 60_000; // markers older than (t0 - FRESH) belong to an earlier run
  const briefMtime = mtime(brief) ?? 0;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

  let deadSince = null;
  for (;;) {
    const dm = mtime(DONE);
    if (dm && (resume || (dm >= briefMtime && dm >= t0 - FRESH))) {
      let s;
      try { s = JSON.parse(fs.readFileSync(DONE, 'utf8')); } catch { await sleep(300); continue; } // half-written
      console.log(formatReport(s, maxChars));
      process.exit(statusExit(s.status));
    }
    const sm = mtime(STARTED);
    const started = sm && sm >= t0 - FRESH;
    const elapsed = Date.now() - t0;
    if (!started && elapsed > START_GRACE) {
      console.log(`agy-wait: no agy-run started for ${brief} within ${START_GRACE / 1000}s. The Terminal tab command probably never ran: check the tab once, and see the skill's troubleshooting notes.`);
      process.exit(3);
    }
    if (started) {
      let pid = null;
      try { pid = JSON.parse(fs.readFileSync(STARTED, 'utf8')).pid; } catch {}
      if (pid && !alive(pid)) {
        deadSince ??= Date.now();
        if (Date.now() - deadSince > 5000 && !mtime(DONE)) {
          console.log(`agy-wait: agy-run (pid ${pid}) exited without writing a result. Logs: ~/.cache/agy-runs/latest.json`);
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
}
