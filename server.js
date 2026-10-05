// Claudemy: a local learning hub that tutors you through your own Claude Code CLI.
// No API key and no npm packages. Run with: node server.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');

const PORT = Number(process.env.PORT || 4777);
const HOST = '127.0.0.1'; // local only, never exposed to the network
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';
const TUTOR_LANG = process.env.TUTOR_LANG || 'English';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 240000);
const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 900000);
// Where Claude Code keeps one folder of session transcripts per project.
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(CLAUDE_HOME, 'projects');
const ACTIVE_MINUTES = Number(process.env.ACTIVE_MINUTES || 15);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
// The tutor runs in an empty folder so it has nothing to read or change.
const SANDBOX = path.join(DATA_DIR, 'tutor-sandbox');
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'projects');
const GAME_FILE = path.join(DATA_DIR, 'game', 'world.json');
// Quiz packs that the Claude Code skills could not deliver live (Claudemy was not running) wait here.
const INBOX_DIR = process.env.CLAUDEMY_INBOX || path.join(os.homedir(), '.claudemy', 'inbox');

// Spaced repetition: box 0..4, days until the next review per box.
const INTERVAL_DAYS = [0, 1, 4, 10, 25];
const LEVEL_NAMES = ['New', 'Junior', 'Medior', 'Senior', 'Expert'];
const LEVEL_GUIDE = [
  'just starting: needs concrete examples and the basic mechanism',
  'can follow an explanation: test whether they can explain it in their own words',
  'can do it: test whether they can predict outcomes and trace the flow',
  'can debug and choose: test diagnosis without AI and trade-offs between designs',
  'can teach it: test failure modes, edge cases and explaining it to a customer',
];
const QUESTION_TYPES = {
  explain: 'Explain back: ask them to explain the concept or a specific situation in their own words, as if to a colleague.',
  predict: 'Predict: describe a concrete command, request or situation and ask what will happen and why.',
  trace: 'Trace the flow: ask them to walk step by step through what happens from start to end.',
  debug: 'Debug: describe a symptom and ask how they would find the cause without AI, and what each check would tell them.',
  design: 'Choose a design: give two realistic alternatives and ask which they would pick here and why the other is worse.',
  teach: 'Teach it: ask them to explain it to a non-technical customer, and name one way it can fail.',
};
const TYPES_BY_BOX = [
  ['explain', 'predict'],
  ['explain', 'predict', 'trace'],
  ['trace', 'predict', 'debug'],
  ['debug', 'design'],
  ['design', 'teach', 'debug'],
];
const TYPE_LABELS = {
  explain: 'Explain it back', predict: 'Predict the outcome', trace: 'Trace the flow',
  debug: 'Debug without AI', design: 'Choose a design', teach: 'Teach it',
};

// Game layer: XP, ranks, streaks, badges, certificates.
const RANKS = [
  { name: 'Rookie', xp: 0 }, { name: 'Operator', xp: 100 }, { name: 'Engineer', xp: 300 },
  { name: 'Architect', xp: 700 }, { name: 'Grandmaster', xp: 1500 }, { name: 'AI Master Brain', xp: 3000 },
];
const BADGES = [
  { id: 'first', name: 'First blood', desc: 'Finish your first lesson', test: (p) => p.stats.lessons >= 1 },
  { id: 'flawless', name: 'Flawless', desc: 'Score 100% on the first try', test: (p) => p.stats.perfects >= 1 },
  { id: 'comeback', name: 'Comeback', desc: 'Pass a question on your second try', test: (p) => p.stats.comebacks >= 1 },
  { id: 'streak3', name: 'On fire', desc: 'Keep a 3-day streak', test: (p) => p.streak >= 3 },
  { id: 'streak7', name: 'Unstoppable', desc: 'Keep a 7-day streak', test: (p) => p.streak >= 7 },
  { id: 'streak30', name: 'Machine', desc: 'Keep a 30-day streak', test: (p) => p.streak >= 30 },
  { id: 'curious', name: 'Curious mind', desc: 'Send 20 messages to the tutor', test: (p) => p.stats.chatMessages >= 20 },
  { id: 'grinder', name: 'Grinder', desc: 'Finish 25 lessons', test: (p) => p.stats.lessons >= 25 },
  { id: 'quizmaster', name: 'Quiz master', desc: 'Finish 5 quiz packs from your Claude Code sessions', test: (p) => p.stats.packsDone >= 5 },
  { id: 'boardroom', name: 'Boardroom ready', desc: 'Score 80% or more on a stakeholder drill', test: (p) => p.stats.boardroom >= 1 },
  { id: 'certified', name: 'Certified', desc: 'Reach Expert on a concept', test: (p) => p.certificates.length >= 1 },
  { id: 'polymath', name: 'Polymath', desc: 'Reach Expert on 5 concepts', test: (p) => p.certificates.length >= 5 },
];

function localDay(date = new Date()) { return date.toLocaleDateString('sv-SE'); } // YYYY-MM-DD in local time
function newProfile() {
  return { name: '', xp: 0, xpToday: 0, xpDay: '', dailyGoal: 50, streak: 0, lastActiveDay: '', badges: [], certificates: [],
    stats: { lessons: 0, perfects: 0, comebacks: 0, chatMessages: 0, packsDone: 0, boardroom: 0 },
    playSeconds: 0, correctToward: 0, correctTotal: 0,
    settings: { minutesPerReward: 1, correctNeeded: 10, freePlay: false, writeLearnings: true } };
}
function rankOf(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1];
  return { name: RANKS[i].name, index: i, floor: RANKS[i].xp, next: next ? next.name : null, nextXp: next ? next.xp : null };
}
function effectiveStreak(p) {
  const today = localDay(), yesterday = localDay(new Date(Date.now() - 86400000));
  return p.lastActiveDay === today || p.lastActiveDay === yesterday ? p.streak : 0;
}
function touchStreak(p) {
  const today = localDay(), yesterday = localDay(new Date(Date.now() - 86400000));
  if (p.lastActiveDay === today) return;
  p.streak = p.lastActiveDay === yesterday ? p.streak + 1 : 1;
  p.lastActiveDay = today;
}
function addXp(p, amount) {
  const today = localDay();
  if (p.xpDay !== today) { p.xpDay = today; p.xpToday = 0; }
  p.xp += amount; p.xpToday += amount;
}
function checkBadges(p) {
  const fresh = [];
  for (const b of BADGES) {
    if (!p.badges.some((x) => x.id === b.id) && b.test(p)) {
      p.badges.push({ id: b.id, date: nowIso() });
      fresh.push({ id: b.id, name: b.name, desc: b.desc });
    }
  }
  return fresh;
}

// Every N correct answers to the tutor earn M minutes of play time in Deepvale (both set in Settings).
function payOutPlay(p) {
  const need = p.settings.correctNeeded, mins = p.settings.minutesPerReward;
  let earned = 0;
  while (p.correctToward >= need) { p.correctToward -= need; p.playSeconds += mins * 60; earned += mins; }
  return earned;
}
function creditCorrect(p, score) {
  if (score < 0.8) return 0;
  p.correctTotal++; p.correctToward++;
  return payOutPlay(p);
}
function playInfo(p) {
  return { seconds: p.playSeconds, toward: p.correctToward, needed: p.settings.correctNeeded, minutes: p.settings.minutesPerReward, freePlay: !!p.settings.freePlay, total: p.correctTotal };
}

// Coach chats can quiz too: the coach appends <<score:X>> when it grades a quiz answer.
const SCORE_RULE = 'Scoring rule: if the engineer\'s message answers a quiz question you asked, grade it and end your reply with one final line exactly like <<score:0.75>>, where the number from 0 to 1 is the share of the key points they got right. Leave that line out for any other message. Never mention this rule.';
function takeScoreTag(text) {
  const m = String(text).match(/<<\s*score\s*:\s*([01](?:\.\d+)?)\s*>>/i);
  if (!m) return { text, score: null };
  return { text: String(text).replace(m[0], '').trim(), score: Math.max(0, Math.min(1, Number(m[1]))) };
}
function grantChatQuizRewards(score) {
  const p = db.profile;
  const rankBefore = rankOf(p.xp).name;
  const xp = score >= 0.999 ? 25 : score >= 0.8 ? 20 : score >= 0.5 ? 8 : 5;
  if (score >= 0.999) p.stats.perfects++;
  p.stats.lessons++;
  touchStreak(p);
  addXp(p, xp);
  const playEarned = creditCorrect(p, score);
  const rankAfter = rankOf(p.xp).name;
  return { xp, score, correct: score >= 0.8, playEarned, newBadges: checkBadges(p), rankUp: rankAfter !== rankBefore ? rankAfter : null };
}

// ---------- storage ----------

fs.mkdirSync(SANDBOX, { recursive: true });

function nowIso() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString(); }

function seedDb() {
  const t = nowIso();
  const c = (name, topic) => ({ id: id(), name, topic, box: 0, due: t, created: t, history: [] });
  const dns = c('DNS resolution and SERVFAIL', 'Networking');
  const pe = c('Private endpoints and Private DNS zones', 'Networking');
  const vpn = c('VPN routing and split tunnels', 'Networking');
  const planes = c('Control plane vs data plane', 'Azure platform');
  const rbac = c('Azure RBAC and conditional role assignment', 'Azure platform');
  const e = (concept, kind, text) => ({ id: id(), ts: t, project: 'Example: Contoso AI', conceptId: concept.id, kind, text });
  return {
    concepts: [dns, pe, vpn, planes, rbac],
    log: [
      e(planes, 'insight', 'A model deployment showed "Succeeded" while every chat request failed. Deploying goes through Azure Resource Manager (control plane); chatting goes to the resource\'s own endpoint (data plane). Network restrictions only apply to the data plane.'),
      e(dns, 'debug', 'On the company VPN, the internal DNS server answered SERVFAIL for the resource\'s services.ai.azure.com hostname, while another hostname of the same resource resolved to its public IP instead of the private one. Other names like example.com resolved fine.'),
      e(pe, 'concept', 'The AI resource has one private endpoint with three private IPs, one per hostname (cognitiveservices, openai, services.ai). Public DNS points each name to a privatelink.* name; only clients whose DNS knows the Private DNS zone get the private IP, everyone else follows the chain to the public IP.'),
      e(pe, 'insight', 'The Private DNS zones exist with correct A records in a central hub subscription. They only answer via Azure\'s resolver (168.63.129.16), which is reachable from linked VNets only, so on-premises DNS needs conditional forwarders to a resolver in the hub.'),
      e(vpn, 'debug', 'Get-NetRoute on the VPN adapter showed only allowlisted /32 routes. The public IP of the resource was on the list, but the private endpoint IPs were not, so traffic to them left via the home Wi-Fi default route 0.0.0.0/0 and timed out.'),
      e(rbac, 'decision', 'Access comes through a project group with Contributor and a Foundry owner role on the resource group. That role includes the data actions needed to call models, and can assign roles, but a condition limits that to a few roles such as Foundry User, so there is no escalation to Owner.'),
    ],
    chats: {},
    profile: newProfile(),
  };
}

let db;
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = seedDb();
    saveDb();
  }
  db.concepts ||= []; db.log ||= []; db.chats ||= {}; db.projectChats ||= {}; db.packs ||= []; db.packChats ||= {}; db.learnings ||= {};
  db.profile = Object.assign(newProfile(), db.profile || {});
  db.profile.stats = Object.assign(newProfile().stats, db.profile.stats || {});
  db.profile.settings = Object.assign(newProfile().settings, db.profile.settings || {});
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
loadDb();

function findConcept(conceptId) { return db.concepts.find((c) => c.id === conceptId); }
function findOrCreateConcept(name, topic) {
  const clean = String(name || '').trim().slice(0, 120);
  if (!clean) return null;
  let concept = db.concepts.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (!concept) {
    concept = { id: id(), name: clean, topic: String(topic || 'General').trim().slice(0, 60) || 'General', box: 0, due: nowIso(), created: nowIso(), history: [] };
    db.concepts.push(concept);
  }
  return concept;
}
function entriesFor(conceptId, limit = 12) {
  return db.log.filter((e) => e.conceptId === conceptId).slice(-limit);
}
function formatEntries(entries) {
  if (!entries.length) return '(no log entries yet: use well-established general knowledge of the concept)';
  return entries.map((e, i) => `[${i + 1}] (${e.kind}, project: ${e.project || 'n/a'}, ${e.ts.slice(0, 10)}) ${e.text}`).join('\n');
}

// ---------- Claude CLI bridge ----------

function spawnClaude(args) {
  const isWin = process.platform === 'win32';
  if (isWin) {
    // claude is installed as claude.cmd on Windows, which needs a shell.
    // All args are fixed flags or validated ids, so joining is safe.
    const quote = (a) => (/[\s&|<>^()]/.test(a) ? `"${a}"` : a);
    return spawn([CLAUDE_BIN, ...args].map(quote).join(' '), { cwd: SANDBOX, shell: true, windowsHide: true });
  }
  return spawn(CLAUDE_BIN, args, { cwd: SANDBOX });
}

function runProcess(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnClaude(args); } catch (err) { return reject(err); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude CLI took too long to answer.')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start "${CLAUDE_BIN}": ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error((err || `Claude CLI exited with code ${code}`).trim().slice(0, 500)));
      resolve(out);
    });
    if (input != null) child.stdin.end(input, 'utf8'); else child.stdin.end();
  });
}

function parseClaudeOutput(stdout) {
  const trimmed = stdout.trim();
  let data;
  try { data = JSON.parse(trimmed); } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && !data; i--) { try { data = JSON.parse(lines[i]); } catch { /* keep looking */ } }
  }
  if (Array.isArray(data)) data = [...data].reverse().find((m) => m && m.type === 'result') || data[data.length - 1];
  if (!data || typeof data.result !== 'string') throw new Error('Unexpected output from Claude CLI: ' + trimmed.slice(0, 300));
  if (data.is_error) throw new Error(data.result || 'Claude CLI returned an error.');
  return { text: data.result, sessionId: data.session_id };
}

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i;

async function askClaude(prompt, { resume, readDir, timeoutMs } = {}) {
  const args = ['-p', '--output-format', 'json'];
  if (CLAUDE_MODEL && /^[\w.\-:]+$/.test(CLAUDE_MODEL)) args.push('--model', CLAUDE_MODEL);
  if (resume && SESSION_ID_RE.test(resume)) args.push('--resume', resume);
  if (readDir) {
    // Give read-only access to a project folder. The session itself stays in the sandbox,
    // so tutor chats never show up as activity in your real project.
    if (/["%!]/.test(readDir) || !fs.existsSync(readDir)) throw new Error('Project folder not found: ' + readDir);
    args.push('--add-dir', readDir, '--allowedTools', 'Read,Glob,Grep', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch');
  }
  const out = await runProcess(args, prompt, timeoutMs || CLAUDE_TIMEOUT_MS);
  return parseClaudeOutput(out);
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Claude did not return JSON.');
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------- prompts ----------

// Optional: tell the tutor who you are and what you build, for example
// CLAUDEMY_ABOUT="I build Copilot Studio agents and Azure integrations for small businesses."
const CLAUDEMY_ABOUT = (process.env.CLAUDEMY_ABOUT || '').trim();
const TUTOR_CONTEXT = `You are the tutor inside Claudemy, a personal learning hub for a software engineer who builds with Claude Code.${CLAUDEMY_ABOUT ? ` About the engineer: ${CLAUDEMY_ABOUT}` : ''} The goal is real understanding: the engineer must be able to explain, design and debug their work without AI.`;

function lessonPrompt(concept, type) {
  return `${TUTOR_CONTEXT}

Task: write ONE question that tests real understanding of the concept below.

Concept: ${concept.name}
Topic: ${concept.topic}
Learner level: ${LEVEL_NAMES[concept.box]} (${LEVEL_GUIDE[concept.box]})
Question type: ${QUESTION_TYPES[type]}

Source material from the learner's own work log. Ground the question in it when present. Do not invent facts that are not in it and are not well-established general knowledge:
${formatEntries(entriesFor(concept.id))}

Rules:
- One question, answerable in 2 to 6 sentences in the learner's own words.
- Test understanding (why, what happens if, how would you check), not trivia or memorised numbers.
- Write the question in ${TUTOR_LANG}.
- Do not use any tools. Do not read or write files.

Reply with ONLY a JSON object and no other text:
{"question": "...", "rubric": ["2 to 4 key points a good answer must contain"], "misconception": "the most likely wrong idea", "source": "which log entry number, or general knowledge"}`;
}

function gradePrompt(pending, answer) {
  const final = pending.attempts >= 1;
  return `${TUTOR_CONTEXT}

Task: grade the learner's answer. Grade on the key points, not on wording, spelling or length.

Concept: ${pending.conceptName}
Question: ${pending.question}
Key points:
${pending.rubric.map((r) => `- ${r}`).join('\n')}
Likely misconception: ${pending.misconception || 'n/a'}

Learner's answer (attempt ${pending.attempts + 1} of 2):
"""
${answer}
"""

Rules:
- score is the share of key points the answer clearly covers, from 0.0 to 1.0. A point only counts if the learner shows they understand it, not when they just name a term.
- If the answer contains the misconception, say so plainly.
- feedback: 2 to 4 sentences in ${TUTOR_LANG}, direct and friendly.
- ${final
    ? 'This is the final attempt: in model_answer, give a short, clear correct answer.'
    : 'If the score is below 0.8, do NOT reveal the answer: give hints in "missed" that point to what is missing so they can try again, and leave model_answer empty. If the score is 0.8 or higher, give a short model_answer.'}
- Do not use any tools.

Reply with ONLY a JSON object and no other text:
{"score": 0.0, "hit": ["key points covered"], "missed": ["what is missing, phrased as hints"], "feedback": "...", "model_answer": "..."}`;
}

function chatOpeningPrompt(concept, message, transcriptTail) {
  return `${TUTOR_CONTEXT}

The learner opened a conversation about "${concept.name}" (topic: ${concept.topic}). Their level on it: ${LEVEL_NAMES[concept.box]} (${LEVEL_GUIDE[concept.box]}).

How you teach:
- Socratic first: before explaining, ask what they already think or expect, and build on that.
- One new idea per message. Keep messages short (under about 150 words) unless they ask for depth.
- Give a concrete example or analogy before the abstract term.
- After explaining something, check understanding with one short question that asks them to predict or explain back. Never just ask "does that make sense?".
- Ground yourself in the work log below. When you go beyond it, say so. When you are not sure about a fact (Azure changes fast), say so.
- Reply in ${TUTOR_LANG}. Do not use tools, read or write files, or run commands.
- When they ask for a quiz, ask one question at a time and wait for the answer before grading it.
- ${SCORE_RULE}

Work log for this concept:
${formatEntries(entriesFor(concept.id))}
${transcriptTail ? `\nEarlier conversation (for context):\n${transcriptTail}\n` : ''}
The learner's message:
${message}`;
}

// ---------- learning logic ----------

const pendingQuestions = new Map();

function pickType(concept) {
  const options = TYPES_BY_BOX[concept.box] || TYPES_BY_BOX[0];
  const last = concept.history.length ? concept.history[concept.history.length - 1].type : null;
  const fresh = options.filter((t) => t !== last);
  const pool = fresh.length ? fresh : options;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyResult(concept, score, attempts, type) {
  const before = concept.box;
  if (score >= 0.8 && attempts === 1) {
    concept.box = Math.min(4, concept.box + 1);
    concept.due = addDays(INTERVAL_DAYS[concept.box] || 1);
  } else if (score >= 0.8) {
    concept.due = addDays(1); // passed on the retry: same level, see it again tomorrow
  } else if (score >= 0.5) {
    concept.due = addDays(1);
  } else {
    concept.box = Math.max(0, concept.box - 1);
    concept.due = nowIso();
  }
  concept.history.push({ ts: nowIso(), type, score: Math.round(score * 100) / 100, attempts });
  return { levelBefore: LEVEL_NAMES[before], levelAfter: LEVEL_NAMES[concept.box], boxBefore: before, box: concept.box, due: concept.due };
}

function grantLessonRewards(concept, score, attempts, progress) {
  const p = db.profile;
  const rankBefore = rankOf(p.xp).name;
  let xp;
  if (score >= 0.8 && attempts === 1) {
    xp = 30;
    if (score >= 0.999) { xp += 10; p.stats.perfects++; }
  } else if (score >= 0.8) { xp = 15; p.stats.comebacks++; }
  else if (score >= 0.5) xp = 8;
  else xp = 5;
  const leveledUp = progress.box > progress.boxBefore;
  if (leveledUp) xp += 20;
  let certificate = null;
  if (leveledUp && progress.box === 4 && !p.certificates.some((c) => c.conceptId === concept.id)) {
    certificate = { id: id(), conceptId: concept.id, conceptName: concept.name, topic: concept.topic, date: nowIso() };
    p.certificates.push(certificate);
    xp += 100;
  }
  p.stats.lessons++;
  touchStreak(p);
  addXp(p, xp);
  const playEarned = creditCorrect(p, score);
  const rankAfter = rankOf(p.xp).name;
  return { xp, leveledUp, certificate, playEarned, newBadges: checkBadges(p), rankUp: rankAfter !== rankBefore ? rankAfter : null, streak: p.streak };
}

function publicState() {
  return {
    levels: LEVEL_NAMES,
    concepts: db.concepts.map((c) => ({
      id: c.id, name: c.name, topic: c.topic, box: c.box, level: LEVEL_NAMES[c.box],
      due: c.due, isDue: new Date(c.due) <= new Date(), lessons: c.history.length,
      lastScore: c.history.length ? c.history[c.history.length - 1].score : null,
      logCount: db.log.filter((e) => e.conceptId === c.id).length,
    })),
    openPacks: db.packs.filter((p) => !p.completedAt).length,
    log: [...db.log].reverse().slice(0, 200).map((e) => ({ ...e, conceptName: findConcept(e.conceptId)?.name || '' })),
    chats: Object.fromEntries(Object.entries(db.chats).map(([k, v]) => [k, v.messages])),
    profile: (() => {
      const p = db.profile;
      return {
        name: p.name, xp: p.xp, xpToday: p.xpDay === localDay() ? p.xpToday : 0, dailyGoal: p.dailyGoal,
        streak: effectiveStreak(p), rank: rankOf(p.xp), ranks: RANKS, stats: p.stats,
        badges: BADGES.map((b) => ({ id: b.id, name: b.name, desc: b.desc, unlocked: p.badges.find((x) => x.id === b.id)?.date || null })),
        certificates: p.certificates,
        play: playInfo(p), settings: p.settings,
      };
    })(),
  };
}


// ---------- Claude Code projects ----------

function readHead(file, bytes = 65536) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8');
  } catch { return ''; }
}
function readTail(file, size, bytes = 12 * 1024 * 1024) {
  if (size <= bytes) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, size - bytes);
    fs.closeSync(fd);
    const text = buf.slice(0, n).toString('utf8');
    return text.slice(text.indexOf('\n') + 1); // drop the partial first line
  } catch { return ''; }
}
function parseLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or non-JSON line */ }
  }
  return out;
}
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const toPosix = (p) => p.split(path.sep).join('/');

function sessionFiles(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  return files.map((f) => {
    try { const st = fs.statSync(path.join(dir, f)); return { f, mtime: st.mtimeMs, size: st.size }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

function scanProjects() {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    const files = sessionFiles(dir);
    if (!files.length) continue;
    let cwd = null;
    for (const s of files.slice(0, 4)) {
      for (const line of parseLines(readHead(path.join(dir, s.f)))) {
        if (line && typeof line.cwd === 'string') { cwd = line.cwd; break; }
      }
      if (cwd) break;
    }
    if (!cwd || samePath(cwd, SANDBOX) || d.name.toLowerCase().includes('tutor-sandbox')) continue;
    const last = files[0].mtime;
    out.push({
      id: d.name, name: path.basename(cwd) || d.name, cwd, sessions: files.length,
      lastActive: new Date(last).toISOString(), active: Date.now() - last < ACTIVE_MINUTES * 60000,
      exists: fs.existsSync(cwd), hasOverview: fs.existsSync(overviewFile(d.name)),
    });
  }
  return out.sort((a, b) => (b.active - a.active) || (new Date(b.lastActive) - new Date(a.lastActive)));
}

function findProject(projectId) {
  if (!/^[\w.\-]+$/.test(projectId)) return null;
  return scanProjects().find((p) => p.id === projectId) || null;
}

function sessionDigest(project, max = 6) {
  const dir = path.join(PROJECTS_DIR, project.id);
  return sessionFiles(dir).slice(0, max).map(({ f, mtime, size }) => {
    const prompts = [], touched = new Set();
    let start = null, lastText = '';
    for (const l of parseLines(readTail(path.join(dir, f), size))) {
      if (!l || l.isSidechain) continue;
      if (l.timestamp && !start) start = l.timestamp;
      const msg = l.message;
      if (l.type === 'user' && msg && !l.isMeta) {
        let t = '';
        if (typeof msg.content === 'string') t = msg.content;
        else if (Array.isArray(msg.content) && !msg.content.some((c) => c && c.type === 'tool_result')) {
          t = msg.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
        }
        t = (t || '').trim();
        if (t && !t.startsWith('<') && !t.startsWith('Caveat:')) prompts.push(t.slice(0, 600));
      }
      if (l.type === 'assistant' && msg && Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (!c) continue;
          const fp = c.input && (c.input.file_path || c.input.notebook_path);
          if (c.type === 'tool_use' && ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name) && fp) {
            const rel = path.relative(project.cwd, fp);
            touched.add(rel.startsWith('..') ? fp : toPosix(rel));
          }
          if (c.type === 'text' && c.text) lastText = c.text;
        }
      }
    }
    return { id: f.replace(/\.jsonl$/, ''), start, end: new Date(mtime).toISOString(), prompts: prompts.slice(0, 10), filesTouched: [...touched].slice(0, 40), lastAssistant: lastText.slice(0, 1500) };
  });
}
function digestText(sessions) {
  if (!sessions.length) return '(no sessions found)';
  return sessions.map((s, i) => `Session ${i + 1} (${(s.start || s.end).slice(0, 10)}):
  Asked: ${s.prompts.slice(0, 4).map((p) => p.replace(/\s+/g, ' ').slice(0, 220)).join(' | ') || '(nothing readable)'}
  Files changed: ${s.filesTouched.join(', ') || 'none'}
  Claude's last summary: ${s.lastAssistant.replace(/\s+/g, ' ').slice(0, 400) || 'n/a'}`).join('\n');
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'bin', 'obj', '.venv', 'venv', 'env', '__pycache__', '.next', '.nuxt', '.vs', '.idea', 'coverage', 'target', '.pytest_cache', '.mypy_cache', '.terraform', '.cache', '.turbo', '.parcel-cache', '.gradle', '.svelte-kit']);
const SKIP_FILES = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|\.DS_Store|Thumbs\.db)$|^\.env(\..*)?$|\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf|zip|gz|7z|rar|exe|dll|so|dylib|bin|woff2?|ttf|otf|eot|mp[34]|mov|avi|wav|db|sqlite|pyc|class|jar|pbix|xlsx?|docx?|pptx?|pfx|pem|key|crt|cer|p12)$/i;

function walkProject(root, limit = 500) {
  const files = [];
  (function walk(dir, depth) {
    if (files.length >= limit || depth > 10) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile() || SKIP_FILES.test(e.name)) continue;
      try { if (fs.statSync(full).size > 1024 * 1024) continue; } catch { continue; }
      files.push(toPosix(path.relative(root, full)));
    }
  })(root, 0);
  return files;
}

function overviewFile(projectId) { return path.join(KNOWLEDGE_DIR, projectId, 'overview.json'); }
function loadOverview(projectId) { try { return JSON.parse(fs.readFileSync(overviewFile(projectId), 'utf8')); } catch { return null; } }
function saveOverview(projectId, overview) {
  fs.mkdirSync(path.dirname(overviewFile(projectId)), { recursive: true });
  fs.writeFileSync(overviewFile(projectId), JSON.stringify(overview, null, 2));
}

const READ_RULES = 'You may read files in the project folder with Read, Glob and Grep. Never open .env files, secrets, keys, certificates or credentials. Never modify anything.';

function analyzePrompt(project, files, sessions) {
  const many = files.length > 150;
  return `${TUTOR_CONTEXT}

Task: build a learning overview of a software project, so the engineer understands what was built, how and why, and can debug it without AI.

Project folder: ${project.cwd}
${READ_RULES}

Files in the project (relative paths):
${files.join('\n')}

Recent Claude Code sessions in this project (what the engineer asked for and which files changed):
${digestText(sessions)}

Read what you need: start with README and config or manifest files, then entry points, then the files changed recently.
Then reply with ONLY a JSON object and no other text:
{"summary": "2 to 3 sentences: what this project is and does, the way you'd tell a customer", "stack": ["main technologies"], "architecture": "one paragraph: the main parts and how a request or data flows through them", "files": {"relative/path": "1 to 2 sentences: what this file does and why it exists"}, "techniques": [{"name": "technique or concept", "what": "one sentence", "where": ["relative/paths"], "why": "why it is used here, and what the alternative would have been"}], "risks": ["where it is most likely to break, and what you would check first"]}

Explain ${many ? 'the 150 most important files in the list' : 'every file in the list'}. Give 4 to 10 techniques and 2 to 5 risks. Use the exact relative paths from the list. Write in ${TUTOR_LANG}.`;
}

function explainFilePrompt(project, relPath, overview) {
  return `${TUTOR_CONTEXT}

Project folder: ${project.cwd}
${READ_RULES}
${overview ? `Project summary: ${overview.summary}\n` : ''}
Read the file "${relPath}" in the project folder and explain it for the engineer who owns this project.

Reply with ONLY a JSON object and no other text:
{"explanation": "1 to 3 sentences in ${TUTOR_LANG}: what this file does, why it exists, and how it connects to the rest"}`;
}

function projectChatPrompt(project, overview, sessions, message, transcriptTail) {
  return `${TUTOR_CONTEXT}

You are the engineer's coach for one specific project. They are vibe coding it with Claude Code on another screen right now, and use you to keep up with what is being built. Your goal is to remove their cognitive debt on it: they must be able to explain to a customer what was built, how and why, say why the alternatives are worse, and debug it without AI. Also make them a master of the techniques used in it.

Project: ${project.name}
Folder: ${project.cwd}
${READ_RULES} Read the actual code before you explain it, and point to concrete files (and functions or line ranges) when you do.

${overview ? `Overview:
${overview.summary}
Architecture: ${overview.architecture}
Techniques: ${(overview.techniques || []).map((t) => t.name).join(', ')}
` : 'No overview has been generated yet; explore the folder yourself.'}
Recent Claude Code sessions:
${digestText(sessions)}

How you teach:
- Socratic first: before explaining, ask what they already think or expect, and build on that.
- One idea per message, short (under about 180 words) unless they ask for depth.
- Concrete before abstract: show the actual code path, then name the concept.
- After explaining, check understanding with one question that asks them to predict, trace or explain back. Never just ask "does that make sense?".
- When they ask for a quiz, ask one question at a time and wait for the answer before grading it.
- When you are not sure about a fact (platforms and APIs change fast), say so.
- Reply in ${TUTOR_LANG}.
- ${SCORE_RULE}
${transcriptTail ? `\nEarlier conversation (for context):\n${transcriptTail}\n` : ''}
The engineer's message:
${message}`;
}

function projectOrThrow(projectId) {
  const project = findProject(projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
  return project;
}


// ---------- quiz packs from Claude Code skills ----------

const PACK_KINDS = { tech: 'Tech quiz', stakeholder: 'Stakeholder drill' };
const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

function normalizePack(raw) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('A quiz pack must be a JSON object.'), { status: 400 });
  const kind = PACK_KINDS[raw.kind] ? raw.kind : null;
  if (!kind) throw Object.assign(new Error('kind must be "tech" or "stakeholder".'), { status: 400 });
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 15).map((q, i) => ({
    id: `q${i + 1}`,
    question: str(q.question, 3000),
    type: str(q.type, 40) || (kind === 'tech' ? 'explain' : 'status'),
    persona: str(q.persona, 80),
    rubric: (Array.isArray(q.rubric) ? q.rubric : []).map((r) => str(r, 400)).filter(Boolean).slice(0, 5),
    hint: str(q.hint, 600),
    misconception: str(q.misconception, 400),
    why: str(q.why_it_matters || q.why, 600),
    source: str(q.source, 300),
    difficulty: str(q.difficulty, 20),
  })).filter((q) => q.question && q.rubric.length);
  if (!questions.length) throw Object.assign(new Error('A quiz pack needs at least one question with a rubric.'), { status: 400 });
  const cwd = str(raw.cwd, 500);
  const project = cwd ? scanProjects().find((p) => samePath(p.cwd, cwd)) : null;
  return {
    id: id(), kind, title: str(raw.title, 140) || PACK_KINDS[kind], language: str(raw.language, 30) || TUTOR_LANG,
    cwd, projectId: project ? project.id : null, projectName: str(raw.project, 80) || (project ? project.name : (cwd ? path.basename(cwd) : '')),
    sessionId: str(raw.session_id || raw.sessionId, 80), context: str(raw.context, 12000),
    createdAt: nowIso(), questions, progress: {}, completedAt: null,
  };
}

const LEGACY_INBOX_DIR = path.join(os.homedir(), '.leerpad', 'inbox'); // from when this project was called Leerpad
function importInbox() {
  let files = [];
  for (const dir of [INBOX_DIR, LEGACY_INBOX_DIR]) {
    try { files.push(...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f))); } catch {}
  }
  if (!files.length) return 0;
  let n = 0;
  for (const full of files) {
    const f = path.basename(full);
    try {
      db.packs.push(normalizePack(JSON.parse(fs.readFileSync(full, 'utf8'))));
      fs.unlinkSync(full); n++;
    } catch (e) {
      try { fs.renameSync(full, full + '.rejected'); } catch {}
      console.log(`Skipped inbox file ${f}: ${e.message}`);
    }
  }
  if (n) { saveDb(); console.log(`Imported ${n} quiz pack(s) from ${INBOX_DIR}`); }
  return n;
}

function packSummary(p) {
  const answered = Object.values(p.progress).filter((x) => x.done);
  return {
    id: p.id, kind: p.kind, kindLabel: PACK_KINDS[p.kind], title: p.title, projectName: p.projectName, projectId: p.projectId,
    createdAt: p.createdAt, total: p.questions.length, answered: answered.length,
    avg: answered.length ? answered.reduce((a, x) => a + x.score, 0) / answered.length : null, completedAt: p.completedAt,
  };
}
function packPublic(p) {
  return {
    ...packSummary(p), context: p.context, language: p.language,
    questions: p.questions.map((q) => ({ id: q.id, question: q.question, type: q.type, persona: q.persona, why: q.why, source: q.source, difficulty: q.difficulty })),
    progress: p.progress, chat: (db.packChats[p.id] || {}).messages || [],
  };
}
function findPack(packId) {
  const p = db.packs.find((x) => x.id === packId);
  if (!p) throw Object.assign(new Error('Quiz pack not found.'), { status: 404 });
  return p;
}

function packGradePrompt(pack, q, answer, attempt) {
  const final = attempt >= 2;
  const lens = pack.kind === 'stakeholder'
    ? `This is a stakeholder drill. The question comes from: ${q.persona || 'the customer'}. Judge whether the answer would satisfy that person: correct about the facts in the context, honest about status and risks, concrete, and pitched at their level (no unexplained jargon for a customer or manager).`
    : 'This is a technical quiz about work done with Claude Code. Judge real understanding of what was built and why, not memorised wording.';
  return `${TUTOR_CONTEXT}

Task: grade the engineer's answer.
${lens}

What happened in the session (context written by the Claude that did the work):
"""
${pack.context || '(no context given)'}
"""

Question: ${q.question}
${q.source ? `Refers to: ${q.source}\n` : ''}Key points a good answer covers:
${q.rubric.map((r) => `- ${r}`).join('\n')}
Likely misconception: ${q.misconception || 'n/a'}

The engineer's answer (attempt ${attempt} of 2):
"""
${answer}
"""

Rules:
- score is the share of key points the answer clearly covers, from 0.0 to 1.0. A point only counts when the engineer shows understanding, not when they drop a term.
- If the answer contains the misconception, say so plainly.
- feedback: 2 to 4 sentences in ${pack.language}, direct and friendly.
- ${final
    ? 'This is the final attempt. In model_answer give a short, strong answer. In explanation, teach it: 2 to 4 sentences on why the answer is what it is, tied to what actually happened in the session.'
    : 'If the score is below 0.8, do NOT reveal the answer: put hints in "missed" that point to what is missing, and leave model_answer and explanation empty. If the score is 0.8 or higher, give a short model_answer.'}
- Do not use tools.

- takeaway: one sentence stating the key insight of this question as a fact the engineer should remember (not about their answer).
- design_point: if this question exposes a concrete gap, risk or open item in the project itself (not in the engineer's knowledge), state it in one or two sentences as an actionable item. Otherwise an empty string.

Reply with ONLY a JSON object and no other text:
{"score": 0.0, "hit": ["key points covered"], "missed": ["what is missing, phrased as hints"], "feedback": "...", "model_answer": "...", "explanation": "...", "takeaway": "...", "design_point": ""}`;
}

function packHelpPrompt(pack, q, message, tail) {
  return `${TUTOR_CONTEXT}

You are helping the engineer with a ${PACK_KINDS[pack.kind].toLowerCase()} built from their own Claude Code session${pack.projectName ? ` on project "${pack.projectName}"` : ''}.
${pack.kind === 'stakeholder' ? 'Goal: they must be able to tell a consultant or the customer, in detail and honestly, where things stand, what works well, why it was designed this way and what is still open.' : 'Goal: they must understand the technical work Claude did (resources, code, scripts, commands) well enough to redo, explain and debug it without AI.'}
${pack.cwd && fs.existsSync(pack.cwd) ? `${READ_RULES} The project folder is ${pack.cwd}.` : 'Do not use tools.'}

Context of the session:
"""
${pack.context || '(no context given)'}
"""
${q ? `\nThe question they are working on: ${q.question}\nWhat a good answer covers (use this to guide them; don't dump it at once): ${q.rubric.join('; ')}\n` : ''}
How you help:
- Start from what they think. Ask one guiding question, or give one hint, before you explain.
- If they're stuck after that, or they ask you to just explain, explain it clearly and concretely, then check understanding with one question.
- Short messages (under about 160 words). Reply in ${pack.language}.
${tail ? `\nEarlier conversation:\n${tail}\n` : ''}
The engineer's message:
${message}`;
}

function grantPackRewards(pack, score, attempts) {
  const p = db.profile;
  const rankBefore = rankOf(p.xp).name;
  let xp;
  if (score >= 0.8 && attempts === 1) { xp = 30; if (score >= 0.999) { xp += 10; p.stats.perfects++; } }
  else if (score >= 0.8) { xp = 15; p.stats.comebacks++; }
  else if (score >= 0.5) xp = 8;
  else xp = 5;
  p.stats.lessons++;
  let packDone = false, avg = null;
  const done = Object.values(pack.progress).filter((x) => x.done);
  if (!pack.completedAt && done.length === pack.questions.length) {
    pack.completedAt = nowIso(); packDone = true; xp += 25; p.stats.packsDone++;
    avg = done.reduce((a, x) => a + x.score, 0) / done.length;
    if (pack.kind === 'stakeholder' && avg >= 0.8) p.stats.boardroom++;
  }
  touchStreak(p);
  addXp(p, xp);
  const playEarned = creditCorrect(p, score);
  const rankAfter = rankOf(p.xp).name;
  return { xp, packDone, avg, playEarned, newBadges: checkBadges(p), rankUp: rankAfter !== rankBefore ? rankAfter : null, streak: p.streak };
}


// ---------- live session feed ----------

function readFrom(file, offset, maxBytes = 3 * 1024 * 1024) {
  let size;
  try { size = fs.statSync(file).size; } catch { return { text: '', next: offset, truncated: false }; }
  if (offset > size) offset = 0; // file was replaced
  let start = offset, truncated = false;
  if (offset === 0 && size > maxBytes) { start = size - maxBytes; truncated = true; }
  if (start >= size) return { text: '', next: size, truncated };
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  let from = 0;
  if (truncated) from = buf.indexOf(0x0a) + 1; // skip the partial first line
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < from) return { text: '', next: start + from, truncated };
  return { text: buf.slice(from, lastNl + 1).toString('utf8'), next: start + lastNl + 1, truncated };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n');
  return '';
}
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '\n…' : s; };

function parseEvents(lines, cwd) {
  const rel = (fp) => { if (!fp) return ''; const r = path.relative(cwd, fp); return r.startsWith('..') ? fp : toPosix(r); };
  const out = [];
  for (const l of lines) {
    if (!l || l.isSidechain || !l.message) continue;
    const ts = l.timestamp || null, uuid = l.uuid || null;
    const content = l.message.content;
    if (l.type === 'user') {
      if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) {
        for (const c of content) if (c && c.type === 'tool_result') out.push({ kind: 'result', id: c.tool_use_id, output: clip(textOf(c.content), 4000), isError: !!c.is_error, ts });
        continue;
      }
      if (l.isMeta) continue;
      const t = textOf(content).trim();
      if (t && !t.startsWith('<') && !t.startsWith('Caveat:')) out.push({ kind: 'prompt', uuid: uuid || `p${out.length}`, text: clip(t, 4000), ts });
      continue;
    }
    if (l.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const c of content) {
      if (!c) continue;
      if (c.type === 'text' && c.text && c.text.trim()) { out.push({ kind: 'say', text: clip(c.text.trim(), 3000), ts }); continue; }
      if (c.type !== 'tool_use') continue;
      const i = c.input || {};
      const base = { id: c.id, ts };
      switch (c.name) {
        case 'Edit': out.push({ ...base, kind: 'edit', file: rel(i.file_path), before: clip(i.old_string, 1500), after: clip(i.new_string, 1500) }); break;
        case 'MultiEdit': out.push({ ...base, kind: 'edit', file: rel(i.file_path), before: clip((i.edits || []).map((e) => e.old_string).join('\n…\n'), 1500), after: clip((i.edits || []).map((e) => e.new_string).join('\n…\n'), 1500), count: (i.edits || []).length }); break;
        case 'Write': out.push({ ...base, kind: 'write', file: rel(i.file_path), preview: clip(i.content, 1500), lines: String(i.content || '').split('\n').length }); break;
        case 'NotebookEdit': out.push({ ...base, kind: 'edit', file: rel(i.notebook_path), before: '', after: clip(i.new_source, 1500) }); break;
        case 'Bash': case 'PowerShell': out.push({ ...base, kind: 'cmd', command: clip(i.command, 2000), description: String(i.description || '') }); break;
        case 'Read': out.push({ ...base, kind: 'read', target: rel(i.file_path) }); break;
        case 'Glob': case 'Grep': out.push({ ...base, kind: 'read', target: `${c.name.toLowerCase()} ${i.pattern || ''}`.trim() }); break;
        case 'TodoWrite': out.push({ ...base, kind: 'plan', todos: (i.todos || []).map((t) => ({ text: String(t.content || t.activeForm || ''), status: String(t.status || '') })) }); break;
        case 'Task': case 'Agent': out.push({ ...base, kind: 'agent', text: String(i.description || i.prompt || '').slice(0, 300) }); break;
        case 'WebFetch': case 'WebSearch': out.push({ ...base, kind: 'read', target: String(i.url || i.query || c.name) }); break;
        default: out.push({ ...base, kind: 'tool', name: c.name, summary: clip(JSON.stringify(i), 300) });
      }
    }
  }
  return out;
}

function sessionList(project, max = 15) {
  const dir = path.join(PROJECTS_DIR, project.id);
  return sessionFiles(dir).slice(0, max).map(({ f, mtime }) => {
    let first = '';
    for (const l of parseLines(readHead(path.join(dir, f), 131072))) {
      if (l && l.type === 'user' && l.message && !l.isMeta && typeof l.message.content === 'string' && !l.message.content.startsWith('<')) { first = l.message.content.slice(0, 140); break; }
    }
    return { id: f.replace(/\.jsonl$/, ''), updated: new Date(mtime).toISOString(), first };
  });
}
function sessionFile(project, sessionId) {
  if (!/^[\w-]+$/.test(sessionId || '')) throw Object.assign(new Error('Invalid session.'), { status: 400 });
  const file = path.join(PROJECTS_DIR, project.id, sessionId + '.jsonl');
  if (!fs.existsSync(file)) throw Object.assign(new Error('Session not found.'), { status: 404 });
  return file;
}

function turnsFile(projectId) { return path.join(KNOWLEDGE_DIR, projectId, 'turns.json'); }
function loadTurns(projectId) { try { return JSON.parse(fs.readFileSync(turnsFile(projectId), 'utf8')); } catch { return {}; } }
function saveTurnExplanation(projectId, sessionId, turnId, expl) {
  const all = loadTurns(projectId);
  (all[sessionId] ||= {})[turnId] = expl;
  fs.mkdirSync(path.dirname(turnsFile(projectId)), { recursive: true });
  fs.writeFileSync(turnsFile(projectId), JSON.stringify(all, null, 2));
}

function turnDigest(events, turnId) {
  const start = events.findIndex((e) => e.kind === 'prompt' && e.uuid === turnId);
  if (start === -1) return null;
  let end = events.findIndex((e, i) => i > start && e.kind === 'prompt');
  if (end === -1) end = events.length;
  const results = Object.fromEntries(events.filter((e) => e.kind === 'result').map((e) => [e.id, e]));
  const parts = [`The engineer asked: ${events[start].text}`];
  for (const e of events.slice(start + 1, end)) {
    if (e.kind === 'say') parts.push(`Claude said: ${clip(e.text, 600)}`);
    if (e.kind === 'edit') parts.push(`Claude edited ${e.file}:\n--- before\n${clip(e.before, 700)}\n+++ after\n${clip(e.after, 700)}`);
    if (e.kind === 'write') parts.push(`Claude wrote ${e.file} (${e.lines} lines):\n${clip(e.preview, 800)}`);
    if (e.kind === 'cmd') { const r = results[e.id]; parts.push(`Claude ran: ${e.command}${e.description ? ` (${e.description})` : ''}${r ? `\nOutput${r.isError ? ' (error)' : ''}: ${clip(r.output, 500)}` : ''}`); }
    if (e.kind === 'plan') parts.push(`Claude's plan: ${e.todos.map((t) => `[${t.status}] ${t.text}`).join('; ')}`);
    if (e.kind === 'agent') parts.push(`Claude started a subagent: ${e.text}`);
    if (e.kind === 'tool') parts.push(`Claude used ${e.name}: ${e.summary}`);
  }
  const reads = events.slice(start + 1, end).filter((e) => e.kind === 'read').map((e) => e.target);
  if (reads.length) parts.push(`Claude looked at: ${[...new Set(reads)].slice(0, 15).join(', ')}`);
  return clip(parts.join('\n\n'), 14000);
}

function explainTurnPrompt(project, digest) {
  return `${TUTOR_CONTEXT}

The engineer is vibe coding with Claude Code on one screen and follows along on a second screen. Explain what Claude did in the turn below, so they understand it functionally and technically, and could explain or redo it without AI.

Project: ${project.name}
Folder: ${project.cwd}
${READ_RULES} Read code only when the turn is unclear without it.

The turn:
"""
${digest}
"""

Reply with ONLY a JSON object and no other text:
{"functional": "1 to 3 sentences: what changed for the user or the business, in plain words", "technical": "2 to 5 sentences: how it was done, naming the files, functions, resources and commands involved", "why": "1 to 3 sentences: why this approach, and the main alternative", "check": "1 to 2 sentences: how to verify it works, or what to watch out for", "terms": [{"term": "a technical term from this turn", "meaning": "one short sentence"}]}

Give at most 4 terms, only ones a junior engineer might not know. Be concrete and don't just repeat the log. Write in ${TUTOR_LANG}.`;
}


// ---------- learnings: notes for Claude Code ----------
// Per project, Claudemy keeps what the engineer understands, where they're shaky, and design points
// that came up, and writes it to <project>/.claude/claudemy/learnings.md for Claude Code to read.

const LEARN_REL = '.claude/claudemy/learnings.md';
const IMPORT_LINE = '@.claude/claudemy/learnings.md';
const LEGACY_IMPORT_LINE = '@.claude/leerpad/learnings.md'; // from when this project was called Leerpad

function learningKey(projectId, cwd) { return projectId || (cwd ? 'cwd:' + cwd.toLowerCase() : null); }
function projectForKey(key) {
  if (!key) return null;
  if (key.startsWith('cwd:')) { const cwd = key.slice(4); return { id: null, name: path.basename(cwd), cwd, exists: fs.existsSync(cwd) }; }
  return findProject(key);
}
const oneLine = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function renderLearnings(project, entries) {
  const checks = entries.filter((e) => e.type === 'checkpoint');
  const notes = entries.filter((e) => e.type === 'note');
  // latest result per question decides shaky vs understood
  const latest = new Map();
  for (const e of checks) latest.set(e.question, e);
  const shaky = [...latest.values()].filter((e) => e.score < 0.8);
  const solid = [...latest.values()].filter((e) => e.score >= 0.8);
  const design = checks.filter((e) => e.designPoint);
  const date = (iso) => iso.slice(0, 10);
  const lines = [
    `# Claudemy learnings: ${project.name}`,
    '',
    `_Written by Claudemy from checkpoints and coach chats. Last updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Don't edit by hand; Claudemy rewrites this file._`,
    '',
    '## For Claude Code',
    '',
    '- **Still shaky**: the engineer got these wrong or only partly right. When your work touches these topics, explain the reasoning explicitly and briefly check their understanding instead of assuming it.',
    '- **Understood**: no need to re-explain these from scratch.',
    '- **Design points raised**: concrete issues or gaps in this project that surfaced during quizzes. Treat them as open items: check whether the code already handles them, and mention it when it doesn\'t.',
    '- **Notes from the coach**: insights the engineer chose to keep.',
    '',
    '## Still shaky',
    '',
    ...(shaky.length ? shaky.map((e) => `- **${oneLine(e.takeaway || e.question, 200)}** (${date(e.ts)}, ${Math.round(e.score * 100)}%, ${e.packTitle}). ${e.misconception ? `Misconception: ${oneLine(e.misconception, 250)}. ` : ''}Correct understanding: ${oneLine(e.modelAnswer || e.explanation, 500)}`) : ['_Nothing yet._']),
    '',
    '## Understood',
    '',
    ...(solid.length ? solid.map((e) => `- ${oneLine(e.takeaway || e.question, 300)} (${date(e.ts)}, ${Math.round(e.score * 100)}%)`) : ['_Nothing yet._']),
    '',
    '## Design points raised',
    '',
    ...(design.length ? design.map((e) => `- ${oneLine(e.designPoint, 500)} (${date(e.ts)}, from "${oneLine(e.packTitle, 80)}"${e.source ? `, ${oneLine(e.source, 80)}` : ''})`) : ['_Nothing yet._']),
    '',
    '## Notes from the coach',
    '',
    ...(notes.length ? notes.map((e) => `### ${date(e.ts)}${e.context ? `: ${oneLine(e.context, 120)}` : ''}\n\n${String(e.text).trim().slice(0, 2500)}\n`) : ['_Nothing yet._']),
    '',
    '## Checkpoint log',
    '',
    ...(checks.length ? [...checks].reverse().slice(0, 60).map((e) => [
      `### ${date(e.ts)}: ${e.packKind === 'stakeholder' ? 'Stakeholder' : 'Tech'} checkpoint "${oneLine(e.packTitle, 100)}"`,
      '',
      `**Question**${e.persona ? ` (asked by ${e.persona})` : ''}: ${String(e.question).trim()}`,
      '',
      ...e.answers.map((a, i) => `**Engineer's answer${e.answers.length > 1 ? `, try ${i + 1}` : ''}**: ${String(a).trim()}`),
      '',
      `**Result**: ${Math.round(e.score * 100)}% after ${e.answers.length} ${e.answers.length === 1 ? 'try' : 'tries'}.${e.hit.length ? ` Got: ${e.hit.map((h) => oneLine(h, 160)).join('; ')}.` : ''}${e.missed.length ? ` Missed: ${e.missed.map((h) => oneLine(h, 200)).join('; ')}.` : ''}`,
      '',
      e.modelAnswer ? `**Model answer**: ${String(e.modelAnswer).trim()}` : '',
      e.explanation ? `**Why**: ${String(e.explanation).trim()}` : '',
      e.why ? `**Why it matters**: ${String(e.why).trim()}` : '',
    ].map((x) => x.trim()).filter(Boolean).join('\n\n') + '\n') : ['_No checkpoints yet._']),
    '',
  ];
  return lines.join('\n');
}

function writeLearnings(key) {
  const project = projectForKey(key);
  if (!project) return null;
  const entries = db.learnings[key] || [];
  const md = renderLearnings(project, entries);
  const result = { projectFile: null, error: null };
  if (project.id) {
    fs.mkdirSync(path.join(KNOWLEDGE_DIR, project.id), { recursive: true });
    fs.writeFileSync(path.join(KNOWLEDGE_DIR, project.id, 'learnings.md'), md);
  }
  if (project.exists && db.profile.settings.writeLearnings !== false) {
    try {
      const dir = path.join(project.cwd, '.claude', 'claudemy');
      fs.mkdirSync(dir, { recursive: true });
      const gi = path.join(dir, '.gitignore');
      if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# Personal learning notes from Claudemy; keep them out of the repo.\n*\n');
      fs.writeFileSync(path.join(dir, 'learnings.md'), md);
      result.projectFile = path.join(dir, 'learnings.md');
    } catch (e) { result.error = e.message; }
  }
  return result;
}

function addLearning(key, entry) {
  if (!key) return null;
  (db.learnings[key] ||= []).push({ id: id(), ts: nowIso(), ...entry });
  if (db.learnings[key].length > 300) db.learnings[key] = db.learnings[key].slice(-300);
  saveDb();
  return writeLearnings(key);
}

function claudeMdStatus(project) {
  if (!project || !project.exists) return { linked: false, file: null };
  const file = path.join(project.cwd, 'CLAUDE.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (text.includes(LEGACY_IMPORT_LINE) && !text.includes(IMPORT_LINE)) {
    try { fs.writeFileSync(file, text.split(LEGACY_IMPORT_LINE).join(IMPORT_LINE)); text = text.split(LEGACY_IMPORT_LINE).join(IMPORT_LINE); } catch {}
  }
  return { linked: text.includes(IMPORT_LINE), file, exists: !!text };
}

// ---------- HTTP ----------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, max = 200000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > max) { reject(new Error('Request too large.')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON body.')); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const routes = {
  'GET /api/projects/:id/learnings': async (body, params) => {
    const project = projectOrThrow(params.id);
    const entries = db.learnings[project.id] || [];
    let md = '';
    try { md = fs.readFileSync(path.join(KNOWLEDGE_DIR, project.id, 'learnings.md'), 'utf8'); } catch { md = renderLearnings(project, entries); }
    return { md, count: entries.length, projectFile: project.exists ? path.join(project.cwd, ...LEARN_REL.split('/')) : null, writeToProject: db.profile.settings.writeLearnings !== false, claudeMd: claudeMdStatus(project) };
  },

  'POST /api/projects/:id/link-claude-md': async (body, params) => {
    const project = projectOrThrow(params.id);
    if (!project.exists) throw Object.assign(new Error('The project folder is not on this machine.'), { status: 400 });
    writeLearnings(project.id);
    const st = claudeMdStatus(project);
    if (!st.linked) {
      const block = `\n\n## Learning notes\n\nWhat the engineer understands, where they're still shaky, and design points from their Claudemy checkpoints (a personal, gitignored file):\n\n${IMPORT_LINE}\n`;
      fs.appendFileSync(st.file, (st.exists ? '' : `# ${project.name}\n`) + block);
    }
    return { claudeMd: claudeMdStatus(project) };
  },

  'POST /api/projects/:id/notes': async (body, params) => {
    const project = projectOrThrow(params.id);
    const text = str(body.text, 4000);
    if (!text) throw Object.assign(new Error('Nothing to save.'), { status: 400 });
    const r = addLearning(project.id, { type: 'note', text, context: str(body.context, 300) });
    return { ok: true, ...r };
  },

  'POST /api/packs/:id/notes': async (body, params) => {
    const pack = findPack(params.id);
    const text = str(body.text, 4000);
    if (!text) throw Object.assign(new Error('Nothing to save.'), { status: 400 });
    const r = addLearning(learningKey(pack.projectId, pack.cwd), { type: 'note', text, context: str(body.context, 300) || pack.title });
    return { ok: true, ...r };
  },
  'GET /api/game': async () => {
    const p = db.profile;
    let save = null;
    try { save = JSON.parse(fs.readFileSync(GAME_FILE, 'utf8')); } catch {}
    return { ...playInfo(p), save };
  },

  'POST /api/game/spend': async (body) => {
    const p = db.profile;
    if (!p.settings.freePlay) {
      const s = Math.max(0, Math.min(15, Number(body.seconds) || 0));
      p.playSeconds = Math.max(0, Math.round((p.playSeconds - s) * 10) / 10);
      saveDb();
    }
    return playInfo(p);
  },

  'POST /api/game/save': async (body) => {
    if (!body || body.version !== 1 || typeof body.seed !== 'number') throw Object.assign(new Error('Invalid save.'), { status: 400 });
    fs.mkdirSync(path.dirname(GAME_FILE), { recursive: true });
    const tmp = GAME_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, GAME_FILE);
    return { ok: true };
  },

  'POST /api/settings': async (body) => {
    const p = db.profile, st = p.settings;
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));
    if (body.minutesPerReward != null && !Number.isNaN(Number(body.minutesPerReward))) st.minutesPerReward = int(body.minutesPerReward, 1, 30);
    if (body.correctNeeded != null && !Number.isNaN(Number(body.correctNeeded))) st.correctNeeded = int(body.correctNeeded, 1, 50);
    if (body.freePlay != null) st.freePlay = !!body.freePlay;
    if (body.writeLearnings != null) st.writeLearnings = !!body.writeLearnings;
    const earned = payOutPlay(p); // lowering the requirement can complete a reward right away
    saveDb();
    return { state: publicState(), earned };
  },

  'POST /api/game/new': async () => {
    try { fs.unlinkSync(GAME_FILE); } catch {}
    return { ok: true };
  },
  'GET /api/projects/:id/live': async (body, params, query) => {
    const project = projectOrThrow(params.id);
    const sessions = sessionList(project);
    if (!sessions.length) return { session: null, latest: null, sessions, events: [], offset: 0 };
    const sessionId = query.get('session') || sessions[0].id;
    const file = sessionFile(project, sessionId);
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    const { text, next, truncated } = readFrom(file, offset);
    const mtime = fs.statSync(file).mtimeMs;
    return {
      session: sessionId, latest: sessions[0].id, sessions, offset: next, truncated,
      idleSeconds: Math.round((Date.now() - mtime) / 1000),
      events: parseEvents(parseLines(text), project.cwd),
      explained: offset === 0 ? (loadTurns(project.id)[sessionId] || {}) : undefined,
    };
  },

  'POST /api/projects/:id/explain-turn': async (body, params) => {
    const project = projectOrThrow(params.id);
    const file = sessionFile(project, String(body.session || ''));
    const events = parseEvents(parseLines(readTail(file, fs.statSync(file).size)), project.cwd);
    const digest = turnDigest(events, String(body.turn || ''));
    if (!digest) throw Object.assign(new Error('That turn is not in this session.'), { status: 404 });
    const { text } = await askClaude(explainTurnPrompt(project, digest), { readDir: project.exists ? project.cwd : undefined });
    const o = extractJson(text);
    const expl = {
      functional: String(o.functional || ''), technical: String(o.technical || ''), why: String(o.why || ''), check: String(o.check || ''),
      terms: (o.terms || []).slice(0, 4).map((t) => ({ term: String(t.term || ''), meaning: String(t.meaning || '') })).filter((t) => t.term),
      at: nowIso(),
    };
    saveTurnExplanation(project.id, String(body.session), String(body.turn), expl);
    return expl;
  },
  'GET /api/packs': async () => { importInbox(); return { packs: [...db.packs].reverse().map(packSummary), inbox: INBOX_DIR }; },

  'POST /api/packs': async (body) => {
    const pack = normalizePack(body);
    db.packs.push(pack);
    saveDb();
    return { ok: true, id: pack.id, title: pack.title, questions: pack.questions.length, url: `http://localhost:${PORT}/#pack/${pack.id}` };
  },

  'GET /api/packs/:id': async (body, params) => packPublic(findPack(params.id)),

  'POST /api/packs/:id/answer': async (body, params) => {
    const pack = findPack(params.id);
    const q = pack.questions.find((x) => x.id === body.questionId);
    if (!q) throw Object.assign(new Error('Unknown question.'), { status: 404 });
    const answer = str(body.answer, 6000);
    if (answer.length < 3) throw Object.assign(new Error('Write an answer first.'), { status: 400 });
    const prog = pack.progress[q.id] ||= { attempts: 0, done: false, score: 0 };
    if (prog.done) throw Object.assign(new Error('You already finished this question. Reset the pack to play it again.'), { status: 400 });
    const { text } = await askClaude(packGradePrompt(pack, q, answer, prog.attempts + 1));
    prog.attempts += 1;
    (prog.answers ||= []).push(answer);
    const g = extractJson(text);
    const score = Math.max(0, Math.min(1, Number(g.score) || 0));
    const done = score >= 0.8 || prog.attempts >= 2;
    let rewards = null, learning = null;
    if (done) {
      prog.done = true; prog.score = score; rewards = grantPackRewards(pack, score, prog.attempts);
      learning = addLearning(learningKey(pack.projectId, pack.cwd), {
        type: 'checkpoint', packId: pack.id, packTitle: pack.title, packKind: pack.kind, question: q.question, persona: q.persona, source: q.source,
        answers: prog.answers.slice(-2), score, hit: (g.hit || []).map(String), missed: (g.missed || []).map(String),
        modelAnswer: String(g.model_answer || ''), explanation: String(g.explanation || ''), why: q.why, misconception: q.misconception,
        takeaway: String(g.takeaway || ''), designPoint: String(g.design_point || ''),
      });
      prog.answers = [];
    }
    saveDb();
    return {
      learning,
      score, done, attempts: prog.attempts,
      hit: (g.hit || []).map(String), missed: (g.missed || []).map(String),
      hint: !done && q.hint ? q.hint : '',
      feedback: String(g.feedback || ''), modelAnswer: done ? String(g.model_answer || '') : '', explanation: done ? String(g.explanation || '') : '',
      why: done ? q.why : '', rewards, profile: publicState().profile, summary: packSummary(pack),
    };
  },

  'POST /api/packs/:id/help': async (body, params) => {
    const pack = findPack(params.id);
    const q = pack.questions.find((x) => x.id === body.questionId) || null;
    const message = str(body.message, 6000);
    if (!message) throw Object.assign(new Error('Type a message first.'), { status: 400 });
    const chat = db.packChats[pack.id] ||= { sessionId: null, messages: [] };
    const readDir = pack.cwd && fs.existsSync(pack.cwd) ? pack.cwd : undefined;
    const fresh = (tail) => askClaude(packHelpPrompt(pack, q, message, tail), { readDir });
    let reply;
    if (chat.sessionId) {
      const withQuestion = q && chat.lastQuestion !== q.id ? `(I'm now on this question: ${q.question})\n\n${message}` : message;
      try { reply = await askClaude(withQuestion, { resume: chat.sessionId, readDir }); }
      catch { reply = await fresh(chat.messages.slice(-8).map((m) => `${m.role === 'user' ? 'Engineer' : 'Tutor'}: ${m.text}`).join('\n')); }
    } else reply = await fresh();
    if (reply.sessionId) chat.sessionId = reply.sessionId;
    chat.lastQuestion = q ? q.id : chat.lastQuestion;
    chat.messages.push({ role: 'user', text: message, ts: nowIso(), q: q ? q.id : null }, { role: 'tutor', text: reply.text, ts: nowIso() });
    db.profile.stats.chatMessages++;
    addXp(db.profile, 2);
    const newBadges = checkBadges(db.profile);
    saveDb();
    return { messages: chat.messages, newBadges, profile: publicState().profile };
  },

  'POST /api/packs/:id/reset': async (body, params) => {
    const pack = findPack(params.id);
    pack.progress = {}; pack.completedAt = null; delete db.packChats[pack.id];
    saveDb();
    return packPublic(pack);
  },

  'POST /api/packs/:id/delete': async (body, params) => {
    findPack(params.id);
    db.packs = db.packs.filter((x) => x.id !== params.id); delete db.packChats[params.id];
    saveDb();
    return { ok: true };
  },

  'GET /api/projects': async () => ({ projects: scanProjects(), activeMinutes: ACTIVE_MINUTES, projectsDir: PROJECTS_DIR, found: fs.existsSync(PROJECTS_DIR) }),

  'GET /api/projects/:id': async (body, params) => {
    const project = projectOrThrow(params.id);
    return {
      project,
      overview: loadOverview(project.id),
      files: project.exists ? walkProject(project.cwd) : [],
      sessions: sessionDigest(project),
      chat: (db.projectChats[project.id] || {}).messages || [],
    };
  },

  'POST /api/projects/:id/analyze': async (body, params) => {
    const project = projectOrThrow(params.id);
    if (!project.exists) throw Object.assign(new Error('The project folder no longer exists on this machine.'), { status: 400 });
    const files = walkProject(project.cwd);
    const sessions = sessionDigest(project);
    const { text } = await askClaude(analyzePrompt(project, files, sessions), { readDir: project.cwd, timeoutMs: ANALYZE_TIMEOUT_MS });
    const o = extractJson(text);
    const overview = {
      generatedAt: nowIso(), summary: String(o.summary || ''), stack: (o.stack || []).map(String),
      architecture: String(o.architecture || ''), files: Object.fromEntries(Object.entries(o.files || {}).map(([k, v]) => [k, String(v)])),
      techniques: (o.techniques || []).map((t) => ({ name: String(t.name || ''), what: String(t.what || ''), where: (t.where || []).map(String), why: String(t.why || '') })).filter((t) => t.name),
      risks: (o.risks || []).map(String),
    };
    saveOverview(project.id, overview);
    return { overview };
  },

  'POST /api/projects/:id/explain-file': async (body, params) => {
    const project = projectOrThrow(params.id);
    const rel = String(body.path || '');
    if (!walkProject(project.cwd).includes(rel)) throw Object.assign(new Error('That file is not part of this project.'), { status: 400 });
    const overview = loadOverview(project.id) || { generatedAt: null, summary: '', stack: [], architecture: '', files: {}, techniques: [], risks: [] };
    const { text } = await askClaude(explainFilePrompt(project, rel, overview.summary ? overview : null), { readDir: project.cwd });
    const explanation = String(extractJson(text).explanation || '').trim();
    overview.files[rel] = explanation;
    saveOverview(project.id, overview);
    return { path: rel, explanation };
  },

  'POST /api/projects/:id/chat': async (body, params) => {
    const project = projectOrThrow(params.id);
    const message = String(body.message || '').trim().slice(0, 6000);
    if (!message) throw Object.assign(new Error('Type a message first.'), { status: 400 });
    const chat = db.projectChats[project.id] ||= { sessionId: null, messages: [] };
    const readDir = project.exists ? project.cwd : undefined;
    const fresh = (tail) => askClaude(projectChatPrompt(project, loadOverview(project.id), sessionDigest(project, 4), message, tail), { readDir });
    let reply;
    if (chat.sessionId) {
      try { reply = await askClaude(`${message}\n\n(${SCORE_RULE})`, { resume: chat.sessionId, readDir }); }
      catch { reply = await fresh(chat.messages.slice(-8).map((m) => `${m.role === 'user' ? 'Engineer' : 'Tutor'}: ${m.text}`).join('\n')); }
    } else {
      reply = await fresh();
    }
    if (reply.sessionId) chat.sessionId = reply.sessionId;
    const { text: replyText, score } = takeScoreTag(reply.text);
    chat.messages.push({ role: 'user', text: message, ts: nowIso() }, { role: 'tutor', text: replyText, ts: nowIso(), score });
    db.profile.stats.chatMessages++;
    addXp(db.profile, 2);
    const rewards = score !== null ? grantChatQuizRewards(score) : null;
    const newBadges = [...(rewards ? rewards.newBadges : []), ...checkBadges(db.profile)];
    saveDb();
    return { messages: chat.messages, rewards, newBadges, profile: publicState().profile };
  },

  'POST /api/projects/:id/chat/reset': async (body, params) => {
    delete db.projectChats[params.id];
    saveDb();
    return { ok: true };
  },

  'POST /api/projects/:id/technique': async (body, params) => {
    const project = projectOrThrow(params.id);
    const overview = loadOverview(project.id);
    const t = overview && overview.techniques.find((x) => x.name === body.name);
    if (!t) throw Object.assign(new Error('Unknown technique.'), { status: 404 });
    const concept = findOrCreateConcept(t.name, project.name);
    db.log.push({ id: id(), ts: nowIso(), project: project.name, conceptId: concept.id, kind: 'concept',
      text: `${t.what} Used in ${t.where.join(', ') || 'this project'}. Why here: ${t.why}` });
    saveDb();
    return { conceptId: concept.id, state: publicState() };
  },
  'GET /api/state': async () => publicState(),

  'GET /api/health': async () => {
    try {
      const out = await runProcess(['--version'], null, 20000);
      return { ok: true, version: out.trim().split(/\r?\n/)[0], language: TUTOR_LANG, model: CLAUDE_MODEL || 'default' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  'POST /api/concepts': async (body) => {
    const concept = findOrCreateConcept(body.name, body.topic);
    if (!concept) throw Object.assign(new Error('Give the concept a name.'), { status: 400 });
    saveDb();
    return { id: concept.id, state: publicState() };
  },

  'POST /api/log': async (body) => {
    const text = String(body.text || '').trim();
    if (!text) throw Object.assign(new Error('A log entry needs text.'), { status: 400 });
    const concept = body.conceptId ? findConcept(body.conceptId) : findOrCreateConcept(body.concept, body.topic);
    if (!concept) throw Object.assign(new Error('Name the concept this entry is about.'), { status: 400 });
    const kinds = ['decision', 'concept', 'debug', 'insight'];
    const entry = {
      id: id(), ts: nowIso(), project: String(body.project || '').trim().slice(0, 80),
      conceptId: concept.id, kind: kinds.includes(body.kind) ? body.kind : 'insight', text: text.slice(0, 4000),
    };
    db.log.push(entry);
    saveDb();
    return { ok: true, entryId: entry.id, conceptId: concept.id };
  },

  'POST /api/lesson': async (body) => {
    const concept = findConcept(body.conceptId);
    if (!concept) throw Object.assign(new Error('Unknown concept.'), { status: 404 });
    const type = pickType(concept);
    const { text } = await askClaude(lessonPrompt(concept, type));
    const q = extractJson(text);
    if (!q.question || !Array.isArray(q.rubric) || !q.rubric.length) throw new Error('Claude returned an incomplete question. Try again.');
    const questionId = id();
    pendingQuestions.set(questionId, {
      conceptId: concept.id, conceptName: concept.name, type, question: String(q.question),
      rubric: q.rubric.map(String).slice(0, 5), misconception: String(q.misconception || ''), attempts: 0,
    });
    return { questionId, type, typeLabel: TYPE_LABELS[type], question: String(q.question), source: String(q.source || '') };
  },

  'POST /api/answer': async (body) => {
    const pending = pendingQuestions.get(body.questionId);
    if (!pending) throw Object.assign(new Error('This question has expired. Start a new lesson.'), { status: 404 });
    const answer = String(body.answer || '').trim();
    if (answer.length < 3) throw Object.assign(new Error('Write an answer first.'), { status: 400 });
    const { text } = await askClaude(gradePrompt(pending, answer));
    const g = extractJson(text);
    const score = Math.max(0, Math.min(1, Number(g.score) || 0));
    pending.attempts += 1;
    const done = score >= 0.8 || pending.attempts >= 2;
    let progress = null, rewards = null;
    if (done) {
      const concept = findConcept(pending.conceptId);
      if (concept) {
        progress = applyResult(concept, score, pending.attempts, pending.type);
        rewards = grantLessonRewards(concept, score, pending.attempts, progress);
        saveDb();
      }
      pendingQuestions.delete(body.questionId);
    }
    return {
      score, done, canRetry: !done,
      hit: (g.hit || []).map(String), missed: (g.missed || []).map(String),
      feedback: String(g.feedback || ''), modelAnswer: done ? String(g.model_answer || '') : '',
      progress, rewards, state: done ? publicState() : null,
    };
  },

  'POST /api/chat': async (body) => {
    const concept = findConcept(body.conceptId);
    if (!concept) throw Object.assign(new Error('Unknown concept.'), { status: 404 });
    const message = String(body.message || '').trim().slice(0, 6000);
    if (!message) throw Object.assign(new Error('Type a message first.'), { status: 400 });
    const chat = db.chats[concept.id] ||= { sessionId: null, messages: [] };

    let reply;
    if (chat.sessionId) {
      try {
        reply = await askClaude(`${message}\n\n(${SCORE_RULE})`, { resume: chat.sessionId });
      } catch {
        // The session may be gone (for example after clearing Claude Code history): start a fresh one with context.
        const tail = chat.messages.slice(-8).map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.text}`).join('\n');
        reply = await askClaude(chatOpeningPrompt(concept, message, tail));
      }
    } else {
      reply = await askClaude(chatOpeningPrompt(concept, message));
    }
    if (reply.sessionId) chat.sessionId = reply.sessionId;
    const { text: replyText, score } = takeScoreTag(reply.text);
    chat.messages.push({ role: 'user', text: message, ts: nowIso() }, { role: 'tutor', text: replyText, ts: nowIso(), score });
    db.profile.stats.chatMessages++;
    addXp(db.profile, 2);
    const rewards = score !== null ? grantChatQuizRewards(score) : null;
    const newBadges = [...(rewards ? rewards.newBadges : []), ...checkBadges(db.profile)];
    saveDb();
    return { reply: replyText, messages: chat.messages, rewards, newBadges, profile: publicState().profile };
  },

  'POST /api/profile': async (body) => {
    if (body.name != null) db.profile.name = String(body.name).trim().slice(0, 80);
    const goal = Number(body.dailyGoal);
    if ([20, 50, 100, 200].includes(goal)) db.profile.dailyGoal = goal;
    saveDb();
    return publicState();
  },

  'POST /api/chat/reset': async (body) => {
    delete db.chats[body.conceptId];
    saveDb();
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, 'http://x');
  const pathname = reqUrl.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res);
  let handler = routes[`${req.method} ${pathname}`];
  const params = {};
  const m = !handler && pathname.match(/^\/api\/(projects|packs)\/([^/]+)(\/.*)?$/);
  if (m) { params.id = decodeURIComponent(m[2]); handler = routes[`${req.method} /api/${m[1]}/:id${m[3] || ''}`]; }
  if (!handler) return send(res, 404, { error: 'Unknown endpoint.' });
  try {
    const body = req.method === 'POST' ? await readBody(req, pathname === '/api/game/save' ? 20 * 1024 * 1024 : 200000) : {};
    send(res, 200, await handler(body, params, reqUrl.searchParams));
  } catch (e) {
    send(res, e.status || 500, { error: e.message || 'Something went wrong.' });
  }
});

importInbox();
setInterval(importInbox, 20000);

server.listen(PORT, HOST, () => {
  console.log(`Claudemy is running at http://localhost:${PORT}`);
  console.log(`Reading Claude Code projects from: ${PROJECTS_DIR}`);
  console.log(`Quiz inbox: ${INBOX_DIR}`);
  if (CLAUDEMY_ABOUT) console.log(`About you: ${CLAUDEMY_ABOUT}`);
  console.log(`Tutor uses: ${CLAUDE_BIN}${CLAUDE_MODEL ? ` (model ${CLAUDE_MODEL})` : ''}, language: ${TUTOR_LANG}`);
});
