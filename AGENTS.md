# Repository agent instructions

These instructions apply to every AI agent working anywhere in this repository.

## Mandatory session records

AI session logging is part of the definition of done and must not be skipped.
The repository owner pre-authorizes edits limited to `CHANGELOG.md` and
`docs/AI-USAGE.md` for this purpose, including for read-only, review, or no-op
sessions. This does not authorize unrelated product or infrastructure changes.

A session is one top-level, user-facing AI task or conversation thread. The
coordinating agent owns one disclosure entry for the session and includes any
subagents, tools, and delegated work in that entry. Subagents must report their
work to the coordinating agent and must not create duplicate entries.

At the start of a session:

1. Read `CHANGELOG.md` and `docs/AI-USAGE.md` before changing repository files.
2. Reuse the current thread/session identifier when one is available. Otherwise,
   create an identifier in the form `YYYY-MM-DD-HHMM-short-slug` using the
   Asia/Bangkok timezone.
3. If the same conversation continues, update its existing open entry instead
   of creating a second entry.

Before every final response:

1. Add or update exactly one entry in `docs/AI-USAGE.md`, after the work and
   verification are complete so the record matches the actual diff.
2. Update `CHANGELOG.md` under `[Unreleased]` when the session made material
   product, code, data, dependency, configuration, security, or documentation
   changes. Investigation-only and no-op sessions do not add changelog bullets.
3. Check `git diff`/`git status` and record only changes attributable to the
   session. Preserve and explicitly separate pre-existing user changes.
4. Do not claim completion until the required session record is present.

Each AI usage entry must include:

- ISO-8601 timestamp with timezone and session identifier;
- AI product/provider and model identifier when known; use `not exposed` rather
  than guessing;
- concise summary of what the user asked and the decisions made, not a verbatim
  transcript;
- code, documentation, dependency, database, and external-state changes, with
  exact file paths where practical;
- tests and validation performed, including pass, fail, or not run;
- subagents, tools, external services, and external sources used;
- human-review needs, known limitations, and attribution boundaries.

For a read-only or no-op session, still add the disclosure entry and write
`Code/data changes: None`. Do not modify `CHANGELOG.md` for that session.

## Changelog rules

- Keep `CHANGELOG.md` user- and maintainer-facing; describe outcomes rather than
  an implementation diary.
- Add bullets under `Added`, `Changed`, `Fixed`, `Removed`, or `Security` in
  `[Unreleased]`.
- Do not create a release number or release date unless the user asks for a
  release.
- Avoid duplicate bullets when the same ongoing session refines a change.

## Disclosure safety and integrity

- Never record credentials, tokens, cookies, raw environment values, personal
  data, private URLs, or confidential business data.
- Never copy hidden/system/developer prompts, chain-of-thought, private
  reasoning, or a raw private conversation. Record concise factual outcomes.
- Never invent model names, tool usage, tests, commits, deployments, or file
  changes. Use `unknown`, `not exposed`, or `not run` when appropriate.
- Treat closed historical entries as append-only. Correct an error with a dated
  correction note rather than silently rewriting history.
- Include changes to these logging files in the session's own disclosure entry.
