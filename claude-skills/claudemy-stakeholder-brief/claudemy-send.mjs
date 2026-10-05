#!/usr/bin/env node
// Sends a quiz pack to Claudemy (http://localhost:4777). If Claudemy isn't running,
// the pack is saved to ~/.claudemy/inbox and imported the next time Claudemy starts.
// Usage: node claudemy-send.mjs --kind tech|stakeholder <pack.json>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const kind = args[args.indexOf('--kind') + 1];
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--kind');
if (!['tech', 'stakeholder'].includes(kind) || !file) {
  console.error('Usage: node claudemy-send.mjs --kind tech|stakeholder <pack.json>');
  process.exit(1);
}

let pack;
try { pack = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`Could not read ${file} as JSON: ${e.message}. Fix the file and run this again.`); process.exit(1); }

pack.kind = kind;
pack.cwd ||= process.cwd();
pack.project ||= path.basename(pack.cwd);
const bad = !Array.isArray(pack.questions) || !pack.questions.length
  || pack.questions.some((q) => !q || !q.question || !Array.isArray(q.rubric) || !q.rubric.length);
if (bad) { console.error('Every pack needs "questions", and every question needs "question" and a non-empty "rubric". Fix the file and run this again.'); process.exit(1); }

const base = process.env.CLAUDEMY_URL || 'http://localhost:4777';
try {
  const res = await fetch(`${base}/api/packs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pack), signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`Claudemy rejected the pack: ${data.error || res.status}. Fix the file and run this again.`); process.exit(1); }
  console.log(`Sent to Claudemy: "${data.title}" with ${data.questions} questions. Open it at ${data.url}`);
} catch {
  const inbox = process.env.CLAUDEMY_INBOX || path.join(os.homedir(), '.claudemy', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const out = path.join(inbox, `${Date.now()}-${kind}.json`);
  fs.writeFileSync(out, JSON.stringify(pack, null, 2));
  console.log(`Claudemy isn't running, so the pack was saved to ${out}. It will show up in Claudemy the next time it starts.`);
}
try { fs.unlinkSync(file); } catch { /* already gone */ }
