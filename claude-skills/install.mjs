#!/usr/bin/env node
// Installs the two Claudemy skills into Claude Code and registers their Stop hooks.
//   node install.mjs              install or update
//   node install.mjs --uninstall  remove skills and hooks
// Skills go to ~/.claude/skills/<name>, hooks into ~/.claude/settings.json (a backup is made first).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const skillsDir = path.join(claudeHome, 'skills');
const settingsFile = path.join(claudeHome, 'settings.json');
const uninstall = process.argv.includes('--uninstall');
const SKILLS = ['claudemy-tech-quiz', 'claudemy-stakeholder-brief'];
const fwd = (p) => p.split(path.sep).join('/');

// settings.json: read, back up, remove old Claudemy hooks
let settings = {};
if (fs.existsSync(settingsFile)) {
  const raw = fs.readFileSync(settingsFile, 'utf8');
  try { settings = raw.trim() ? JSON.parse(raw) : {}; }
  catch { console.error(`Could not parse ${settingsFile}. Fix the JSON in that file first, then run this again.`); process.exit(1); }
  const backup = `${settingsFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(settingsFile, backup);
  console.log(`Backed up settings to ${backup}`);
}
settings.hooks ||= {};
settings.hooks.Stop = (settings.hooks.Stop || [])
  .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !/claudemy-|leerpad-/.test(String(h.command || ''))) }))
  .filter((group) => group.hooks.length);

// Clean up skills from the old name (Leerpad), if present.
for (const old of ['leerpad-tech-quiz', 'leerpad-stakeholder-brief']) {
  const dir = path.join(skillsDir, old);
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log(`Removed old skill ${old}`); }
}

for (const name of SKILLS) {
  const dest = path.join(skillsDir, name);
  if (uninstall) {
    fs.rmSync(dest, { recursive: true, force: true });
    console.log(`Removed skill ${name}`);
    continue;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(here, name))) {
    let content = fs.readFileSync(path.join(here, name, f), 'utf8');
    if (f === 'SKILL.md') content = content.replaceAll('{{SKILL_DIR}}', fwd(dest));
    fs.writeFileSync(path.join(dest, f), content);
  }
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: `node "${fwd(dest)}/hook.mjs"`, timeout: 15 }] });
  console.log(`Installed skill ${name} with its Stop hook in ${dest}`);
}
if (!settings.hooks.Stop.length) delete settings.hooks.Stop;
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(claudeHome, { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
console.log(uninstall
  ? 'Done. Restart Claude Code to unload the hooks.'
  : 'Done. Restart Claude Code (or open /hooks once) so it picks up the new hooks. Type /skills to check the skills are listed.');
