## Agent skills

### Issue tracker

Issues live in GitHub Issues on StanleyGoldman/gnome-battery-charging-ext (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Testing in GNOME Shell

Before running a headless or nested GNOME Shell, or `gnome-shell-test-tool`, read `docs/agents/gnome-shell-testing.md`.

## Working preferences

### Grilling

- Ask one question per round; two or three only when tightly coupled. This overrides the grilling skill's whole-frontier rounds.
- Number questions `Q<n>/<total>` within the round, e.g. `Q1/2`, `Q2/2`.

### Subagents

- Ask before starting research subagents, even when a skill (e.g. `wayfinder` charting) says to start them automatically.

### Prototypes

- Push every prototype to its own branch and open a **draft** PR for it, titled `PROTOTYPE: <what it prototypes>`.
- The PR description states what the prototype set out to answer, plus a running Q&A about what it showed.
- When the prototype session ends, close the PR unmerged and leave a pointer to it on the prototype's issue.

### Writing for agents

- Load the `writing-for-agents` skill before writing anything an agent reads: `CLAUDE.md`, `docs/agents/*`, skills, prompts.

### Self-improvement

- When you hit friction (a tool gotcha, a wrong assumption, a repeated workaround), record the lesson in the doc where the next agent will look, written with the `writing-for-agents` skill.
- Write scripts or skills whenever they help you get a task done; write skills with the `writing-for-agents` skill.

### Pull requests

- Open pull requests and leave merging to a human; never merge one yourself.
- Stage by explicit path (`git add <paths>`) and check `git status` before committing: untracked output from another branch (e.g. `prototype/smoke-out/`, ignored only on the prototype branch) survives `git switch`.
- Whenever you push to a pull request, update its title and description to cover everything it now contains.
