#!/usr/bin/env node
// Claude Code Stop hook for the claudemy-tech-quiz skill.
// After enough technical actions (file changes and commands) since the last tech quiz,
// it asks Claude to run the skill before stopping. Set CLAUDEMY_HOOKS=off to disable,
// CLAUDEMY_TECH_THRESHOLD to change how many actions it takes (default 6).
import fs from 'node:fs';

const THRESHOLD = Number(process.env.CLAUDEMY_TECH_THRESHOLD || 6);
const ACTION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
if (process.env.CLAUDEMY_HOOKS === 'off' || input.stop_hook_active) process.exit(0);
const tp = input.transcript_path;
if (!tp || !fs.existsSync(tp)) process.exit(0);

function readTail(file, bytes = 8 * 1024 * 1024) {
  const size = fs.statSync(file).size;
  if (size <= bytes) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(bytes);
  fs.readSync(fd, buf, 0, bytes, size - bytes); fs.closeSync(fd);
  const t = buf.toString('utf8'); return t.slice(t.indexOf('\n') + 1);
}
const uses = [];
for (const line of readTail(tp).split(/\r?\n/)) {
  if (!line.trim()) continue;
  let l; try { l = JSON.parse(line); } catch { continue; }
  if (l.type !== 'assistant' || l.isSidechain || !Array.isArray(l.message?.content)) continue;
  for (const c of l.message.content) if (c && c.type === 'tool_use') uses.push({ name: c.name, cmd: String(c.input?.command || '') });
}
let last = -1;
uses.forEach((u, i) => { if (u.cmd.includes('claudemy-send') && /--kind\s+tech\b/.test(u.cmd)) last = i; });
const since = uses.slice(last + 1).filter((u) => ACTION_TOOLS.has(u.name) && !u.cmd.includes('claudemy-send'));
if (since.length < THRESHOLD) process.exit(0);

const commands = since.filter((u) => COMMAND_TOOLS.has(u.name)).length;
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `Claudemy: ${since.length} technical actions since the last quiz (${since.length - commands} file changes, ${commands} commands). Use the claudemy-tech-quiz skill now to turn that work into a quiz pack and send it to Claudemy. Don't quiz the user in this chat; finish with one short line.`,
}));
