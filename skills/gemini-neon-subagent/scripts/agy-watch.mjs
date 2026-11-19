// Pretty-prints `agy --output-format stream-json` events live in a terminal.
// Usage: agy -p "..." --output-format stream-json | node agy-watch.mjs
import readline from 'node:readline';

const c = { dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', reset: '\x1b[0m' };
const out = (s) => process.stdout.write(s);
let inText = false;
const endText = () => { if (inText) { out('\n'); inText = false; } };
const ICON = { user_input: '📝', agent_response: '💬', error_message: '⚠️ ', tool_call: '🔧', planner_response: '🧠' };
const IGNORE_KEYS = new Set(['conversation_id', 'step_index', 'state', 'step_type', 'text_delta', 'duration_seconds', 'usage']);

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let ev;
  try { ev = JSON.parse(line); } catch { endText(); out(`${c.dim}${line}${c.reset}\n`); return; }

  if (ev.event === 'init') {
    out(`${c.bold}${c.cyan}▶ Gemini ${ev.init.model}${c.reset} ${c.dim}in ${ev.init.cwd} · mode ${ev.init.permission_mode} · conv ${ev.conversation_id}${c.reset}\n\n`);
    return;
  }

  if (ev.event === 'step_update') {
    const s = ev.step_update;
    if (s.step_type === 'agent_response' && s.text_delta !== undefined) {
      if (!inText) { out(`${c.green}💬 `); inText = true; }
      out(`${s.text_delta}`);
      if (s.state === 'DONE') { out(c.reset); endText(); }
      return;
    }
    if (s.state !== 'DONE' && s.step_type !== 'error_message') return; // print each step once, when it finishes
    if (s.step_type === 'user_input') return;
    endText();
    const extra = Object.entries(s).filter(([k]) => !IGNORE_KEYS.has(k))
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
    const color = s.step_type === 'error_message' ? c.yellow : c.magenta;
    const label = s.step_type === 'error_message' ? 'error / retry (often a Google rate limit)' : s.step_type;
    const dur = s.duration_seconds ? ` ${c.dim}(${s.duration_seconds.toFixed(1)}s)${c.reset}` : '';
    out(`${color}${ICON[s.step_type] || '•'} step ${s.step_index}: ${label}${c.reset}${dur}${extra ? ` ${c.dim}${extra.slice(0, 400)}${c.reset}` : ''}\n`);
    return;
  }

  if (ev.event === 'result') {
    endText();
    const r = ev.result;
    const ok = r.status === 'SUCCESS';
    out(`\n${ok ? c.green : c.red}${c.bold}■ ${r.status}${c.reset} ${c.dim}${r.duration_seconds ? `${Number(r.duration_seconds).toFixed(1)}s` : ''} · conv ${r.conversation_id}${c.reset}\n`);
    if (r.error) out(`${c.red}${JSON.stringify(r.error)}${c.reset}\n`);
    return;
  }

  endText();
  out(`${c.dim}${line.slice(0, 300)}${c.reset}\n`);
});
rl.on('close', () => endText());
