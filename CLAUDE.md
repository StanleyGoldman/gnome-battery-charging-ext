## Agent skills

- **Issues:** before creating, reading, labelling or closing an issue, read `docs/agents/issue-tracker.md`.
- **Triage labels:** before applying a triage label, read `docs/agents/triage-labels.md`.
- **Domain docs:** before exploring the code or naming a domain concept, read `docs/agents/domain.md`.

## Working preferences

### Grilling

- Ask one question per round; two or three only when tightly coupled. This overrides the grilling skill's whole-frontier rounds.
- Number questions `Q<n>/<total>` within the round, e.g. `Q1/2`, `Q2/2`.

### Subagents

- Ask before starting research subagents, even when a skill (e.g. `wayfinder` charting) says to start them automatically.

### Pull requests

- Open pull requests and leave merging to a human; never merge one yourself.
- Whenever you push to a pull request, update its title and description to cover everything it now contains.
