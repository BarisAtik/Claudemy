# Claudemy skills for Claude Code

Two skills that turn your Claude Code sessions into checkpoints on your second screen. Claude Code writes the questions and the context; Claudemy's own Claude asks them next to the live session feed, grades your answers and helps when you're stuck.

| Skill | What it makes | When its hook fires |
|---|---|---|
| `claudemy-tech-quiz` | A **tech checkpoint** on what Claude built, wrote and ran: resources, code, scripts, commands, config | After 6 file changes or commands since the last tech quiz |
| `claudemy-stakeholder-brief` | A **stakeholder checkpoint**: an honest status brief plus the questions a customer, consultant, IT admin or architect would ask | At milestones (git commit or push, PR, `pac solution` export/import, Azure or azd deploy, terraform apply, publish), or after 30 actions |

You can also trigger them yourself in any session: "quiz me on what you just did" or "prep me for the customer meeting".

## Install

Requires Node.js 18 or newer (the same Node you use for Claudemy).

```powershell
cd claudemy\claude-skills
node install.mjs
```

This copies both skills to `%USERPROFILE%\.claude\skills\` and adds their Stop hooks to `%USERPROFILE%\.claude\settings.json`. It makes a backup of `settings.json` first and keeps any hooks you already had. Run it again after an update; it replaces its own entries instead of adding duplicates.

Then restart Claude Code. Check with `/skills` (both should be listed) and `/hooks` (two Stop hooks with `claudemy` in the path).

The first time a skill sends a pack, Claude Code asks permission to run `node ...claudemy-send.mjs`. Choose "don't ask again" for that command.

To remove everything: `node install.mjs --uninstall`.

## How it fits together

1. You work in Claude Code as usual.
2. When Claude is about to stop, each hook reads the session transcript and counts the work since its last pack. Below the threshold it does nothing. Above it, it tells Claude to run the skill first.
3. The skill writes the questions, a rubric per question, hints and the session context to `.claudemy-pack.json`, and runs `claudemy-send.mjs`.
4. The send script posts the pack to Claudemy and deletes the file. If Claudemy isn't running, the pack waits in `%USERPROFILE%\.claudemy\inbox` and is imported when Claudemy starts.
5. In Claudemy, the checkpoint pops up (with a notification) in the project's live feed, at the moment it was made, and under **Checkpoints** in the panel on the right. The coach asks the questions there while the feed stays visible, gives a hint after a miss, explains after the second try, and "Stuck?" opens help at any moment. Stakeholder checkpoints put each question in the voice of the person asking.

## Learning notes

Both skills first read `.claude/claudemy/learnings.md` in the project if it exists. Claudemy writes that file from your checkpoint answers and saved coach notes. Tech checkpoints then revisit topics you were shaky on and ask about open design points; stakeholder checkpoints use the design points in the brief.

After updating Claudemy, run `node install.mjs` again so the installed skills pick up this step.

## Tuning

Set these as Windows environment variables (they apply to new Claude Code sessions):

| Variable | Default | Effect |
|---|---|---|
| `CLAUDEMY_HOOKS` | on | Set to `off` to pause both hooks; the skills still work on request |
| `CLAUDEMY_TECH_THRESHOLD` | 6 | File changes plus commands before a tech quiz |
| `CLAUDEMY_BRIEF_THRESHOLD` | 30 | Actions before a stakeholder drill when no milestone happened |
| `CLAUDEMY_URL` | http://localhost:4777 | Where Claudemy runs |

## Good to know

- The hooks only read the transcript. They never send anything anywhere; the skill does that, through Claude, after the hook asks.
- Packs never leave your machine: they go to Claudemy on localhost or to the local inbox folder. The skills are told to replace secrets with `<redacted>`, but read a pack's context once in a while to check.
- Each pack costs one extra Claude turn in your session. If that's too often, raise the thresholds.
