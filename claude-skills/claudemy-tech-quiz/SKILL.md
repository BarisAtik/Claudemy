---
name: claudemy-tech-quiz
description: Turns the technical work done in this Claude Code session (resources created, code written, scripts made, commands run, configuration changed) into a quiz pack and sends it to the user's Claudemy learning hub, where a tutor quizzes them and helps when they get stuck. Use when a Claudemy Stop hook asks for it, or when the user asks to be quizzed on what you just did, such as "quiz me on this", "make a tech quiz" or "test me on what you built".
---

# Claudemy tech quiz

The user wants to own the work you do for them: understand it well enough to redo it, explain it and debug it without AI. You don't quiz them here. You write the questions and context, and Claudemy (a local web app) does the quizzing and the helping.

## 0. Check what the engineer already knows

If `.claude/claudemy/learnings.md` exists in the project folder, read it first. It is written by Claudemy from earlier checkpoints and coach chats. Use it: revisit topics under **Still shaky** when this session's work touches them (from a new angle, not the same question), don't re-ask what's under **Understood** unless it changed, and if this session worked on something under **Design points raised**, ask about it.

## 1. Collect what actually happened

Look back over this conversation since the last tech quiz was sent (the last `claudemy-send.mjs --kind tech` call), or since the start if there was none. List the concrete technical work:

- Resources created or changed (Azure, Power Platform, Copilot Studio, SharePoint, databases) and their key settings.
- Code, topics, flows or scripts written or edited: which files, and what the important parts do.
- Commands run: what each important one did, and what its key flags or parameters mean.
- Decisions: what you chose, why, and which alternative you rejected.
- How to check that it works, and what you saw when you checked.

Only use what really happened in this session. Never invent steps, results or settings.

## 2. Pick what is worth knowing

Choose the 4 to 8 items with the most lasting value. Prefer: why something is configured a certain way, what a command does, how the pieces connect, how it fails and how you'd notice, and security or data choices. Skip trivia like exact names or numbers, unless the value itself was a decision.

## 3. Write the questions

Mix these types (the `type` field):

- `explain`: explain in your own words what X does and why it's there.
- `predict`: what happens if you run this, or change this setting?
- `trace`: walk through what happens from trigger to result.
- `debug`: it fails with symptom Y; what do you check first, and what would each check tell you?
- `design`: we chose A over B; why, and when would B be better?
- `command`: what does this command do, and what does flag Z change?

For each question:

- When it is about code or a command, put the relevant snippet in the question as a fenced code block (at most about 20 lines).
- `rubric`: 2 to 4 key points a good answer must contain. These are what the tutor grades on.
- `hint`: one nudge that helps without giving the answer away.
- `misconception`: the most likely wrong idea.
- `why_it_matters`: one or two sentences on why this is worth knowing in real work.
- `source`: the file path, resource name or command the question is about.
- `difficulty`: `junior`, `medior` or `senior`. Aim for a mix.

## 4. Write the context

Markdown, at most about 600 words: what the user asked for, what was built or changed (files, resources), the important commands and what they did, the key decisions with the rejected alternatives, and how it was verified. The user can open it during the quiz and the tutor uses it to grade, so be accurate and concrete.

## 5. Never include secrets

Replace keys, tokens, passwords, connection strings, client secrets, SAS URLs and personal data with `<redacted>`, in the questions and in the context.

## 6. Send it

Write the pack with the Write tool to `.claudemy-pack.json` in the current working directory, then run:

```
node "{{SKILL_DIR}}/claudemy-send.mjs" --kind tech .claudemy-pack.json
```

The script delivers the pack to Claudemy (or to its inbox if Claudemy isn't running) and deletes the file. If it reports an error, fix the JSON and run it again.

## 7. Finish

End with one short line, for example: "Tech quiz 'Leave request flow' (6 questions) is waiting in Claudemy." Don't ask the questions in this chat and don't repeat them.

## Pack format

Write the pack in the language the user writes in this conversation, and set `language` to match.

```json
{
  "title": "Short title of the work, 3 to 6 words",
  "language": "English",
  "cwd": "absolute path of the project folder",
  "project": "project name",
  "context": "markdown, see step 4",
  "questions": [
    {
      "type": "command",
      "question": "What does this command produce, and why did we use `--managed`?\n\n```powershell\npac solution export --name HRAgent --path ./out --managed\n```",
      "rubric": ["exports the HRAgent solution as a zip file", "managed means it is locked for editing in the target environment", "managed is meant for test and production, unmanaged for development"],
      "hint": "Think about what the customer may change in production.",
      "misconception": "That managed and unmanaged only differ in file size.",
      "why_it_matters": "Importing an unmanaged solution in production lets people edit it there, and the next release overwrites their changes.",
      "source": "pac solution export",
      "difficulty": "medior"
    }
  ]
}
```
