---
name: claudemy-stakeholder-brief
description: Writes an honest status brief of the project (where it stands, what works well and how we know, why it is designed this way, risks, next steps) plus the questions a customer, consultant, IT admin or architect would ask, and sends them to the user's Claudemy learning hub as a stakeholder drill, where a tutor plays those people and coaches the answers. Use when a Claudemy Stop hook asks for it (at commits, pushes, deploys or after a lot of work), or when the user asks to prepare for a customer or consultant meeting, such as "prep me for the customer", "make a stakeholder drill" or "can I explain where we stand?".
---

# Claudemy stakeholder brief

The user must be able to answer, in detail and without AI, when a consultant or the customer asks where things stand, what works, why it was built this way and what's still open. You prepare the material; Claudemy (a local web app) runs the drill: its tutor asks the questions in the voice of each stakeholder, grades the answers and coaches.

## 0. Check what the engineer already knows

If `.claude/claudemy/learnings.md` exists in the project folder, read it first. It is written by Claudemy from earlier checkpoints and coach chats. Use it: use **Design points raised** in the brief (open or resolved, and how), and when a stakeholder question touches a topic under **Still shaky**, include it so the engineer practises explaining exactly that.

## 1. Build an honest status picture

Use this conversation and the project itself. You may run read-only commands such as `git log --oneline -20`, `git status` and `git diff --stat`, and read the README, plans or TODO files. Work out:

- **Where we stand**: what's done, what's in progress, what hasn't started. Be specific about scope.
- **What works well, and how we know**: tests run, outputs seen, demos done. If something has not been verified, say so.
- **Why it is designed this way**: the key decisions, the reasons, and the alternatives that were rejected and why.
- **Risks and known issues**: what could break, what is fragile, what depends on the customer (access, data, licences, decisions).
- **Next steps**: what's next, rough effort if it was discussed, and what's needed from the customer.
- **Open questions** for the customer or the team.

Never overstate progress. "Not tested yet" and "depends on the customer's IT" are good, honest answers, and the rubric should reward them.

## 2. Write the brief (the context)

Markdown, at most about 700 words, using the six headings above. This is what the user studies before and during the drill, and what the tutor grades against, so keep it factual and concrete (names of components, files and resources, no vague claims).

## 3. Write 5 to 8 stakeholder questions

Spread them over these personas (the `persona` field), each with their own concerns:

- **The customer** (business owner, not technical): value, timeline, what it costs them in effort, whether it's safe, what they'll see.
- **The consultant** (your project lead): status against scope, risks, what to tell the customer, what's blocking.
- **The customer's IT admin**: data, access, security, licences, where things run, who can change what.
- **The architect** (technical reviewer): why this design, which alternatives, how it scales, how it fails.

Use these `type` values: `status`, `value`, `design-why`, `alternatives`, `risk`, `data-security`, `next-steps`, `demo`.

For each question:

- Phrase it the way that person would actually say it in a meeting.
- `rubric`: 2 to 4 points a strong answer contains. Include honesty points where relevant, such as "admits that X is not tested yet".
- `hint`, `misconception` (for example: answering a customer with jargon, or promising a date nobody agreed), `why_it_matters`, `source` (the part of the brief or the file it's about) and `difficulty`.

## 4. Never include secrets

Replace keys, tokens, passwords, connection strings, client secrets and personal data with `<redacted>`.

## 5. Send it

Write the pack with the Write tool to `.claudemy-pack.json` in the current working directory, then run:

```
node "{{SKILL_DIR}}/claudemy-send.mjs" --kind stakeholder .claudemy-pack.json
```

The script delivers it to Claudemy (or its inbox if Claudemy isn't running) and deletes the file. If it reports an error, fix the JSON and run it again.

## 6. Finish

End with one short line, for example: "Stakeholder drill 'Status after the SharePoint connection' (6 questions) is waiting in Claudemy." Don't run the drill in this chat.

## Pack format

Write the pack in the language the user writes in this conversation, and set `language` to match.

```json
{
  "title": "Status after <milestone>, 3 to 7 words",
  "language": "English",
  "cwd": "absolute path of the project folder",
  "project": "project name",
  "context": "markdown brief, see step 2",
  "questions": [
    {
      "persona": "The customer",
      "type": "status",
      "question": "So can my team start using it on Monday?",
      "rubric": ["is clear about what works today and what doesn't", "names what is still needed from the customer before go-live", "doesn't promise a date that wasn't agreed"],
      "hint": "Separate what's built from what's verified, and from what depends on them.",
      "misconception": "Saying yes because the code is written, while it hasn't been tested with their data.",
      "why_it_matters": "Overpromising in week one costs more trust than a clear 'not yet, because'.",
      "source": "Brief: Where we stand",
      "difficulty": "medior"
    }
  ]
}
```
