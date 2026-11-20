// Compatibility entry for pre-v4 launchers, which run <newest plugin copy>/agy-wait.mjs.
import { main } from './cli.mjs';
await main(['wait', ...process.argv.slice(2)]);
