// agy-run install: put `agy-run` and `agy-wait` on PATH from the copy of the scripts this
// file lives in (the plugin's bundled copy). No network, nothing downloaded.
//
// Writes:
//   <share>/*.mjs        a fallback copy of these scripts (~/.local/share/agy-run, or
//                        %LOCALAPPDATA%\agy-run on Windows)
//   ~/.local/bin/agy-run, agy-wait          POSIX sh launchers (also used by Git Bash)
//   ~/.local/bin/agy-run.cmd, agy-wait.cmd  Windows launchers (cmd and PowerShell)
//   ~/.local/bin/*.ps1                      only with --ps1 (PowerShell's execution policy
//                                           often blocks .ps1 files; .cmd always works)
// Every launcher runs launch.mjs, which picks the newest installed copy (plugin first),
// so the commands update whenever the plugin updates. Run it again any time; it is idempotent.
//
// Usage: agy-run install [--ps1] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, IS_WIN, SCRIPTS_DIR, shareDir, binDir } from './common.mjs';

export async function install(argv) {
  const dry = argv.includes('--dry-run');
  const ps1 = argv.includes('--ps1');
  const share = shareDir(), bin = binDir();
  const did = [];
  const write = (f, content, mode) => {
    did.push(f);
    if (dry) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    if (mode) fs.chmodSync(f, mode);
  };

  // 1. fallback copy of the scripts
  for (const f of fs.readdirSync(SCRIPTS_DIR).filter((x) => x.endsWith('.mjs'))) {
    write(path.join(share, f), fs.readFileSync(path.join(SCRIPTS_DIR, f)));
  }
  if (!dry) for (const stale of ['agy-watch.mjs']) { try { fs.unlinkSync(path.join(share, stale)); } catch {} }

  // 2. launchers
  const launch = path.join(share, 'launch.mjs');
  const shPath = IS_WIN ? launch.replace(/\\/g, '/') : launch; // Git Bash's node accepts C:/...
  for (const name of ['agy-run', 'agy-wait']) {
    write(path.join(bin, name), `#!/bin/sh\n# ${name} launcher, written by agy-run install v${VERSION}\nexec node "${shPath}" ${name} "$@"\n`, 0o755);
    if (IS_WIN) {
      write(path.join(bin, `${name}.cmd`), `@echo off\r\nrem ${name} launcher, written by agy-run install v${VERSION}\r\nnode "${launch}" ${name} %*\r\n`);
      if (ps1) write(path.join(bin, `${name}.ps1`), `# ${name} launcher, written by agy-run install v${VERSION}\r\n& node "${launch}" ${name} @args\r\nexit $LASTEXITCODE\r\n`);
    }
  }

  console.log(`${dry ? 'Would install' : 'Installed'} agy-run v${VERSION} from ${SCRIPTS_DIR}`);
  for (const f of did) console.log(`  ${f}`);
  const onPath = (process.env.PATH || '').split(path.delimiter).some((d) => d && path.resolve(d) === path.resolve(bin));
  if (!onPath) {
    console.log(`\n${bin} is not on your PATH. Add it once:`);
    if (IS_WIN) console.log(`  PowerShell: [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';${bin}', 'User')\n  then reopen the terminal (and restart the Claude app so its Terminal panel sees it).`);
    else console.log(`  fish: fish_add_path ${bin}\n  bash/zsh: echo 'export PATH="${bin}:$PATH"' >> ~/.bashrc   (or ~/.zshrc)\n  then reopen the terminal.`);
  }
  console.log('\nThe launchers always run the newest installed plugin copy, so they update with the plugin. Check everything with: agy-run doctor');
}
