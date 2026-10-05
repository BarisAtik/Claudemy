#!/usr/bin/env node
// Claude Code Stop hook for the claudemy-stakeholder-brief skill.
// At milestones (commit, push, deploy, publish) or after a lot of work since the last drill,
// it asks Claude to run the skill before stopping. Set CLAUDEMY_HOOKS=off to disable,
// CLAUDEMY_BRIEF_THRESHOLD to change the "a lot of work" fallback (default 30 actions).
import fs from 'node:fs';

const THRESHOLD = Number(process.env.CLAUDEMY_BRIEF_THRESHOLD || 30);
const MIN_WORK = 3; // never right after the previous drill
const ACTION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);
const MILESTONES = [
  [/\bgit\s+(-\S+\s+)*commit\b/i, 'a git commit'],
  [/\bgit\s+(-\S+\s+)*push\b/i, 'a git push'],
  [/\bgh\s+(pr\s+create|release\s+create)\b/i, 'a pull request or release'],
  [/\bpac\s+(solution\s+(export|import|publish)|copilot\s+publish)\b/i, 'a Power Platform solution move'],
  [/\baz\s+(deployment|webapp\s+deploy|functionapp\s+deployment)\b/i, 'an Azure deployment'],
  [/\bazd\s+(up|deploy|provision)\b/i, 'an azd deployment'],
  [/\bfunc\s+azure\s+functionapp\s+publish\b/i, 'a Function App publish'],
  [/\bterraform\s+apply\b/i, 'a terraform apply'],
  [/\b(npm|pnpm|yarn)\s+publish\b/i, 'a package publish'],
  [/\bdocker\s+push\b/i, 'a docker push'],
  [/\bkubectl\s+apply\b/i, 'a kubectl apply'],
];

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
uses.forEach((u, i) => { if (u.cmd.includes('claudemy-send') && /--kind\s+stakeholder\b/.test(u.cmd)) last = i; });
const since = uses.slice(last + 1).filter((u) => ACTION_TOOLS.has(u.name) && !u.cmd.includes('claudemy-send'));
if (since.length < MIN_WORK) process.exit(0);

let milestone = null;
for (const u of since) for (const [re, label] of MILESTONES) if (!milestone && re.test(u.cmd)) milestone = label;
if (!milestone && since.length < THRESHOLD) process.exit(0);

const why = milestone ? `milestone reached (${milestone})` : `${since.length} actions since the last stakeholder drill`;
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `Claudemy: ${why}. Use the claudemy-stakeholder-brief skill now: write an honest status brief and stakeholder questions, and send them to Claudemy. Don't quiz the user in this chat; finish with one short line.`,
}));
