// agy-run doctor: one command that checks everything the skill needs, with a one-line
// fix for each problem.
//
// Usage: agy-run doctor [--json] [--out FILE] [--offline] [--smoke]
//   --json     print only machine-readable JSON
//   --out F    also write the JSON to F (run this in the Terminal panel to check *its* shell)
//   --offline  skip the network checks (model list and the cheap credentials call)
//   --smoke    also run a realistic brief (multi-line, quotes, backticks, #, $, %, &, |, unicode)
//              through agy-run itself on the cheapest model, and check it arrives intact
// Exit: 0 when nothing failed (warnings allowed), 1 otherwise.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION, IS_WIN, SCRIPTS_DIR, which, agyCommand, cmdQuote, binDir, shareDir, installedCopies, readVersion, cmpVersion, normPath, ECHO_LINE, echoMatched, pickCheapModel } from './common.mjs';

const RL_RE = /resource.?exhausted|code 429|\b429\b|rate.?limit|quota/i;

function runAgy(args, timeoutMs) {
  const a = agyCommand();
  if (!a) return { error: new Error('agy not found') };
  return a.needsShell
    ? spawnSync([cmdQuote(a.file), ...args.map(cmdQuote)].join(' '), { encoding: 'utf8', timeout: timeoutMs, shell: true })
    : spawnSync(a.file, args, { encoding: 'utf8', timeout: timeoutMs });
}

function detectShell() {
  if (IS_WIN) {
    if (process.env.MSYSTEM) return 'git-bash';
    if (process.env.WSL_DISTRO_NAME) return 'wsl';
    return 'windows (cmd or PowerShell)';
  }
  // The launcher execs node, so our parent is the shell that ran the command.
  let parent = '';
  try { parent = fs.readFileSync(`/proc/${process.ppid}/comm`, 'utf8').trim(); } catch {
    const r = spawnSync('ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf8' });
    parent = (r.stdout || '').trim();
  }
  parent = path.basename(parent.replace(/^-/, ''));
  return /^(fish|bash|zsh|sh|dash|nu|pwsh|elvish|xonsh|tcsh|ksh)$/.test(parent) ? parent : path.basename(process.env.SHELL || 'sh');
}

function pathFix(dir, shell) {
  if (IS_WIN && shell !== 'git-bash') return `PowerShell: [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';${dir}', 'User')  (then reopen the terminal)`;
  if (shell === 'fish') return `fish_add_path ${dir}`;
  const rc = shell === 'zsh' ? '~/.zshrc' : '~/.bashrc';
  return `echo 'export PATH="${dir}:$PATH"' >> ${rc}  (then reopen the terminal)`;
}

export async function doctor(argv) {
  const json = argv.includes('--json');
  const offline = argv.includes('--offline');
  const smoke = argv.includes('--smoke');
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? normPath(argv[outIdx + 1]) : null;
  const shell = detectShell();
  const inPanel = process.env.TERM_PROGRAM === 'claude-desktop';
  const checks = [];
  const add = (id, status, detail, fix) => checks.push({ id, status, detail, ...(fix ? { fix } : {}) });

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 18 ? 'ok' : 'fail', `v${process.versions.node}`, major >= 18 ? null : 'Install Node.js 18 or newer from https://nodejs.org');

  // 2. agy
  const agy = agyCommand();
  let neon = [], models = [];
  if (!agy) {
    add('agy', 'fail', 'agy (Antigravity CLI) not found on PATH',
      IS_WIN ? 'Install Antigravity CLI with the Windows installer from https://antigravity.google, then reopen the terminal'
        : 'curl -fsSL https://antigravity.google/cli/install.sh | bash');
  } else {
    const v = runAgy(['--version'], 20000);
    add('agy', v.status === 0 ? 'ok' : 'fail', `${(v.stdout || '').trim() || '?'} at ${agy.file}`, v.status === 0 ? null : `agy --version failed: ${(v.stderr || v.error?.message || '').trim().slice(0, 200)}`);

    // 3. models
    if (!offline) {
      const m = runAgy(['models'], 60000);
      models = (m.stdout || '').split('\n').map((l) => l.split(/\s/)[0]).filter((x) => /^[a-z0-9.-]+-(low|medium|high|xhigh|max)$/.test(x));
      neon = models.filter((x) => x.startsWith('gemini-4-neon-'));
      if (m.status !== 0) add('models', 'fail', `agy models failed: ${(m.stderr || m.error?.message || '').trim().slice(0, 200)}`, 'Run `agy` once interactively and sign in');
      else if (!neon.length) add('models', 'fail', `no gemini-4-neon-* model (${models.length} models listed)`, 'Neon needs a paid Google AI plan or a GEMINI_API_KEY; or use another model from `agy models`');
      else add('models', 'ok', neon.join(' '));
    }

    // 4. credentials, with a tiny call on the cheapest model
    if (!offline && models.length) {
      const cheap = pickCheapModel(models);
      const r = runAgy(['--model', cheap, '--output-format', 'json', '--print-timeout', '90s', '-p', 'Reply with exactly: OK'], 120000);
      let res = null;
      try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
      const errText = `${res?.error || ''} ${r.stderr || ''} ${r.error?.message || ''}`;
      if (res?.status === 'SUCCESS') add('auth', 'ok', `test call on ${cheap} succeeded`);
      else if (/auth|sign.?in|login|credential/i.test(errText)) add('auth', 'fail', 'not signed in', 'Run `agy` once interactively and sign in');
      else if (RL_RE.test(errText)) add('auth', 'warn', `${cheap} is rate limited right now (credentials look fine)`, 'Wait a few minutes, or use a different model');
      else add('auth', 'fail', `test call failed: ${errText.trim().slice(0, 300) || `exit ${r.status}`}`, 'Run the same call by hand: agy --model ' + cheap + ' -p "hi"');
    }
  }

  // 4b. smoke test: a realistic brief through agy-run's own spawn path
  if (smoke && models.length) {
    const cheap = pickCheapModel(models);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-run-smoke-'));
    const brief = path.join(tmp, 'brief.md');
    fs.writeFileSync(brief, `# Smoke test\n\nThis brief has several lines, "quotes", 'apostrophes', \`backticks\`, #hashes,\n$VARS, %VARS%, & | < > ^ (parens) and unicode: é ü → ✓.\nDo not use any tools. Reply with only the next line, copied exactly:\n\n${ECHO_LINE}\n`);
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'cli.mjs'), cheap, brief, '--no-tab', '--cwd', tmp],
      { encoding: 'utf8', timeout: 180000, env: { ...process.env, AGY_RUN_DIR: path.join(tmp, 'runs') } });
    let sum = null, answer = '';
    try { sum = JSON.parse(fs.readFileSync(`${brief}.done`, 'utf8')); answer = fs.readFileSync(sum.answer, 'utf8'); } catch {}
    if (sum?.status === 'SUCCESS' && echoMatched(answer)) add('smoke', 'ok', `realistic brief ran through agy-run on ${cheap} and arrived intact`);
    else if (sum?.status === 'SUCCESS') add('smoke', 'warn', `ran, but the echo came back different: ${JSON.stringify(answer.trim().slice(0, 160))}`, 'Usually the model paraphrasing; rerun once. If it repeats, briefs are being mangled: report it to the user as an agy-run bug');
    else if (sum?.status === 'RATE_LIMITED') add('smoke', 'warn', `${cheap} is rate limited right now; could not complete the smoke test`, 'Retry in a few minutes');
    else add('smoke', 'fail', `agy-run failed: ${sum?.status || `exit ${r.status}`}${sum?.hint ? ` (${sum.hint})` : ''} ${(r.stdout || r.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`, 'Report this to the user as an agy-run bug, with this output and the agy version');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  // 5. launchers on PATH (in the shell that ran this), and which copy they run
  const runCmd = which('agy-run'), waitCmd = which('agy-wait');
  const installFix = `node "${path.join(SCRIPTS_DIR, 'cli.mjs')}" install`;
  if (runCmd && waitCmd) {
    let old = false;
    try { old = !IS_WIN && !fs.readFileSync(runCmd, 'utf8').includes('launch.mjs'); } catch {}
    add('launchers', old ? 'warn' : 'ok', `${runCmd}, ${waitCmd}${old ? ' (pre-v4 launcher)' : ''}`, old ? `Update them: ${installFix}` : null);
  } else {
    add('launchers', 'warn', `agy-run/agy-wait not on PATH in ${shell}${runCmd || waitCmd ? ' (only one found)' : ''}`,
      `${installFix}   (or call node "${path.join(SCRIPTS_DIR, 'cli.mjs')}" directly)`);
  }
  if (!(process.env.PATH || '').split(path.delimiter).some((d) => d && path.resolve(d) === path.resolve(binDir()))) {
    add('path', 'warn', `${binDir()} is not on PATH in ${shell}`, pathFix(binDir(), shell));
  }
  const copies = installedCopies();
  const share = shareDir();
  const shareV = readVersion(share);
  const pick = [...copies, ...(shareV ? [{ dir: share, version: shareV, source: 'local fallback' }] : [])]
    .sort((a, b) => cmpVersion(b.version, a.version))[0];
  const target = process.env.AGY_RUN_HOME ? `AGY_RUN_HOME=${process.env.AGY_RUN_HOME}` : pick ? `${pick.source} v${pick.version} (${pick.dir})` : 'no v4+ copy installed yet (pre-v4 launchers use their own lookup)';
  add('version', pick && cmpVersion(pick.version, VERSION) < 0 ? 'warn' : 'info', `launchers run: ${target}; this doctor: v${VERSION}`,
    pick && cmpVersion(pick.version, VERSION) < 0 ? `A newer copy is running this doctor than the launchers would use: ${installFix}` : null);

  // 6. shell facts and known Terminal-panel problems
  add('shell', 'info', `${shell}${inPanel ? ' (inside the Claude Terminal panel)' : ' (not the Terminal panel)'}`,
    inPanel ? null : 'To check the Terminal panel shell itself, run `agy-run doctor --out <file>` in a Terminal tab and read the file');
  if (which('fish')) {
    const f = spawnSync('fish', ['-c', 'status features'], { encoding: 'utf8', timeout: 10000 });
    const line = (f.stdout || '').split('\n').find((l) => /^query-term\s/.test(l));
    if (line && /\son\s/.test(line)) add('fish', 'warn', 'fish waits 10 s for a terminal reply the Terminal panel never sends, which swallows typed commands', 'set -Ua fish_features no-query-term');
    else add('fish', 'ok', line ? 'query-term off' : 'fish older than 4.1 (not affected)');
  }
  const home = os.homedir();
  const rcFiles = IS_WIN
    ? ['Documents/PowerShell/Microsoft.PowerShell_profile.ps1', 'Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1', '.bashrc', '.bash_profile']
    : ['.config/fish/config.fish', '.config/fish/functions/fish_greeting.fish', '.bashrc', '.bash_profile', '.zshrc', '.profile',
      ...(() => { try { return fs.readdirSync(path.join(home, '.config/fish/conf.d')).map((f) => `.config/fish/conf.d/${f}`); } catch { return []; } })()];
  const FETCH = /\b(fastfetch|neofetch|pfetch|screenfetch|hyfetch|macchina|onefetch)\b/;
  for (const rf of rcFiles) {
    let txt; try { txt = fs.readFileSync(path.join(home, rf), 'utf8'); } catch { continue; }
    const hit = txt.split('\n').find((l) => FETCH.test(l) && !/^\s*#/.test(l));
    if (!hit || txt.includes('claude-desktop')) continue;
    const tool = hit.match(FETCH)[1];
    const fix = rf.endsWith('.fish') ? `In ~/${rf}: if test "$TERM_PROGRAM" != claude-desktop; ${tool}; end`
      : rf.endsWith('.ps1') ? `In ${rf}: if ($env:TERM_PROGRAM -ne 'claude-desktop') { ${tool} }`
        : `In ~/${rf}: [ "$TERM_PROGRAM" != claude-desktop ] && ${tool}`;
    add('greeting', 'warn', `~/${rf} runs ${tool} at startup, which can swallow the command typed into a Terminal tab`, fix);
  }

  // 7. diff tool for the live diffs
  add('diff', which('git') || which('diff') ? 'ok' : 'warn', which('git') ? 'git' : which('diff') ? 'diff' : 'neither git nor diff found', which('git') || which('diff') ? null : 'Install git to see diffs of Gemini\'s edits');

  const ok = !checks.some((x) => x.status === 'fail');
  const report = { ok, version: VERSION, platform: process.platform, shell, inPanel, scriptsDir: SCRIPTS_DIR, checks, at: new Date().toISOString() };
  if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(report, null, 2)); }
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    const icon = { ok: '✓', warn: '!', fail: '✗', info: '·' };
    console.log(`agy-run doctor v${VERSION} · ${process.platform} · shell ${shell}${inPanel ? ' · Terminal panel' : ''}`);
    for (const x of checks) {
      console.log(`${icon[x.status]} ${x.id.padEnd(9)} ${x.detail}`);
      if (x.fix) console.log(`    fix: ${x.fix}`);
    }
    console.log(ok ? 'Ready.' : 'Not ready: fix the ✗ lines above.');
    if (outFile) console.log(`(wrote ${outFile})`);
  }
  process.exit(ok ? 0 : 1);
}
