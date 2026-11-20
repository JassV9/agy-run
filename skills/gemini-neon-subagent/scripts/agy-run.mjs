// Compatibility entry for pre-v4 launchers, which run <newest plugin copy>/agy-run.mjs.
import { main } from './cli.mjs';
await main(process.argv.slice(2));
