// Target of the agy-run / agy-wait launchers. Runs the newest installed copy of the
// scripts (an installed plugin version first, then this fallback copy), so the commands
// stay current when the plugin updates. Usage: node launch.mjs agy-run|agy-wait [args...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERSION, SCRIPTS_DIR, installedCopies, cmpVersion, normPath } from './common.mjs';

const [, , name, ...args] = process.argv;
let dir;
if (process.env.AGY_RUN_HOME) dir = normPath(process.env.AGY_RUN_HOME);
else {
  const all = [...installedCopies(), { dir: SCRIPTS_DIR, version: VERSION }];
  dir = all.filter((x) => fs.existsSync(path.join(x.dir, 'cli.mjs')))
    .sort((a, b) => cmpVersion(b.version, a.version))[0]?.dir || SCRIPTS_DIR;
}
const { main } = await import(pathToFileURL(path.join(dir, 'cli.mjs')).href);
await main(name === 'agy-wait' ? ['wait', ...args] : args);
