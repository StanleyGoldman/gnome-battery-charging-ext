## Agent skills

### Issue tracker

Issues live in GitHub Issues on StanleyGoldman/gnome-battery-charging-ext (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working preferences

### Grilling

- Ask **one** question per round, or two or three only when they are tightly coupled (answering one changes the others). Don't dump the whole frontier at once.
- Number questions as `Q<n>/<total>`, where `<total>` is the number of questions in that round (e.g. `Q1/2`, `Q2/2`).

### Subagents

- Ask before starting research subagents, even when a skill (e.g. `wayfinder` charting) says to fire them automatically.

### Pull requests

- Never merge pull requests. Open them and leave merging to a human.
