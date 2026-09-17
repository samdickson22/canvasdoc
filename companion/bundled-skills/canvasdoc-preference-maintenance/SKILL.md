---
name: canvasdoc-preference-maintenance
description: Create or revise workspace skills when user corrections, examples, or recurring coursework reveal durable writing, coding, class, or assignment-type preferences.
---

# Maintain learned skills

Keep guidance that will change future work. An explicit recurring preference can be saved immediately; a one-time edit or the absence of criticism does not establish a permanent preference. Use observed examples without inventing the user's identity, opinions, or experiences. Ask about scope only when the distinction matters and cannot be inferred.

Inspect `.agents/skills/` and read matching skills before writing. Update an existing skill when it already owns the subject. Use the narrowest useful scope:

- Shared writing or code preferences apply across courses. Create coding guidance only when relevant and supported by the user's work.
- A class skill identifies its Canvas origin and course ID, with a readable course name. Keep class-specific exceptions there.
- An assignment-type skill covers a repeated format or procedure, such as discussion replies or lab reports; specify which courses it applies to if it is not general.
- A request applying only to this assignment stays with its conversation or working files rather than becoming a reusable skill.

Write a lowercase, hyphenated folder name with a `SKILL.md` containing YAML `name` and `description`. Make the description say when to read it, including course identity when applicable. Use a concise body with current guidance, a small example if helpful, and a short source reference to the relevant user correction, conversation, or file. Store longer examples in linked files only when needed. Do not copy entire conversations, private course materials, secrets, or temporary task status into skills.

New corrections replace superseded rules in the same scope. Merge equivalent rules and remove stale advice. Preserve unrelated user edits and references; do not rewrite a whole skill merely to add one fact. Explicit requests to forget a preference remove it from learned guidance and any copied examples that would reintroduce it. Current user instructions and the actual assignment requirements take precedence over learned defaults. Verify changing course requirements from Canvas rather than treating a skill as the source of truth.

Keep the shipped `canvasdoc-*` skills and `unslop` intact. Put personalization in separately named skills. Do not create a parallel memory log or automatically copy these updates into Codex memory files.

After an update, re-read the file: confirm the scope, remove duplicate or conflicting guidance, and check that any references exist. Briefly tell the user what was learned and where it applies. On the next relevant task, use the revised guidance and check the output for the behavior it was meant to improve; a saved file alone does not prove improvement.
