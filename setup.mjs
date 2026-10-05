#!/usr/bin/env node
// One-time setup: checks your environment and installs the two Claude Code skills with their hooks.
// Usage: node setup.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (m) => console.log(`  ok   ${m}`);
const warn = (m) => console.log(`  !!   ${m}`);
let problems = 0;

console.log('\nClaudemy setup\n');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) ok(`Node.js ${process.versions.node}`);
else { warn(`Node.js ${process.versions.node} is too old. Install Node.js 18 or newer from https://nodejs.org`); problems++; }

const bin = process.env.CLAUDE_BIN || 'claude';
const v = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (v.status === 0) ok(`Claude Code ${v.stdout.trim()}`);
else { warn('Claude Code was not found. Install it (https://code.claude.com/docs/en/overview), log in once by running `claude`, then run this setup again. If it is installed somewhere unusual, set CLAUDE_BIN to its full path.'); problems++; }

const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const projectsDir = path.join(claudeHome, 'projects');
let count = 0;
try { count = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length; } catch {}
if (count) ok(`Found ${count} Claude Code project ${count === 1 ? 'folder' : 'folders'} in ${projectsDir}`);
else warn(`No Claude Code projects yet in ${projectsDir}. Open a terminal in one of your project folders, run \`claude\` and send one message; that creates the folder Claudemy reads.`);

console.log('\nInstalling the Claude Code skills and hooks\n');
const r = spawnSync(process.execPath, [path.join(here, 'claude-skills', 'install.mjs')], { stdio: 'inherit' });
if (r.status !== 0) { warn('Installing the skills failed (see above).'); problems++; }

console.log(`
${problems ? 'Setup finished with problems; fix the items marked !! and run it again.' : 'All set.'}

Next:
  1. Restart Claude Code so it loads the new skills and hooks (check with /skills and /hooks).
  2. Start Claudemy:   npm start      (or: node server.js)
  3. Open http://localhost:4777 on your second screen and pick the project you're working on.
`);
