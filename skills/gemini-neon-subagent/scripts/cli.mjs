#!/usr/bin/env node
// agy-run's single entry point. Same on every platform: node cli.mjs <command> ...
//   agy-run MODEL BRIEF_FILE [options]   run Gemini on a brief (see run.mjs)
//   agy-run wait BRIEF_FILE              same as agy-wait (see wait.mjs)
//   agy-run doctor [--json] [--out F]    check the setup (see doctor.mjs)
//   agy-run demo [--model M] [--keep]    a safe end-to-end demo in a temp folder (see demo.mjs)
//   agy-run install                      put agy-run/agy-wait on PATH (see install.mjs)
//   agy-run --version
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION, SCRIPTS_DIR } from './common.mjs';

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === 'version' || cmd === '-v') { console.log(`agy-run ${VERSION} (${SCRIPTS_DIR})`); return; }
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(`agy-run ${VERSION}
usage: agy-run MODEL BRIEF_FILE [--cwd DIR] [--no-tab] [--descend] [--floor MODEL] [agy flags...]
       agy-wait BRIEF_FILE [--timeout S] [--resume]     (or: agy-run wait ...)
       agy-run doctor [--json] [--out FILE] [--offline] [--smoke]
       agy-run demo [--model M] [--no-tab] [--keep]
       agy-run install [--ps1] [--dry-run]
       agy-run --version`);
    return;
  }
  if (cmd === 'doctor') return (await import('./doctor.mjs')).doctor(rest);
  if (cmd === 'install') return (await import('./install.mjs')).install(rest);
  if (cmd === 'wait') return (await import('./wait.mjs')).wait(rest);
  if (cmd === 'demo') return (await import('./demo.mjs')).demo(rest);
  const r = await (await import('./run.mjs')).run(cmd === 'run' ? rest : argv);
  process.exit(r.exit);
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
