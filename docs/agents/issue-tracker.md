# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Block an issue on another**: use GitHub's **native issue dependencies** for every blocking edge in this repo. `gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). `issue_dependencies_summary.blocked_by` counts open blockers only, the live gate; an issue is unblocked when every blocker is closed. Last resort, only when the dependencies API is unavailable: a `Blocked by: #<n>, #<n>` line at the top of the blocked issue's body.
- **Parent split work**: when work splits into several issues (e.g. build slices), create one parent issue for the whole and attach every piece as a **sub-issue**: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (the child's database id, as for blockers). Pieces that wait on each other also get blocker edges (above). Close the parent by hand once every sub-issue is closed.
- **Batch `gh` scripts**: run multi-step scripts under bash explicitly, `bash -euo pipefail <<'EOF' ... EOF`. The login shell is zsh, whose 1-indexed arrays and different `set -e` once shifted titles onto the wrong issue bodies. After creating linked issues, read back each one's title, its parent (`gh api repos/<owner>/<repo>/issues/<parent>/sub_issues --jq '.[].number'`) and its blockers (`gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by`). Remove a wrong edge with `gh api --method DELETE repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by/<blocker-db-id>`.
- **Resolve with a PR**: the PR description carries a closing keyword for each issue it resolves, one per line (`Closes #<n>`). GitHub links the PR to each issue and closes it on merge.
- **Follow-ups from a PR**: work a PR leaves for later issues goes in three places, each linking back to the PR:
  - a `## Follow-ups` section in the PR description;
  - a comment on each open issue it affects, opening `Follow-ups from <short PR name> (#<pr>):`, so the issue's implementer finds it without reading old PRs;
  - a new issue for a follow-up no open issue holds. **Ask the user before creating it.** Its first line links the PR. Attach it to the parent as a sub-issue, and add a blocker edge to each issue that waits on it, as in **Parent split work**.

  Finish with a PR comment listing where each follow-up went.
- **Close by hand**: `gh issue close <number> --comment "..."`, for an issue resolved without a PR (e.g. by an answering comment).

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Edit the map body**: run `gh` from inside the repo, or pass `-R StanleyGoldman/gnome-battery-charging-ext`. Outside a clone `gh issue view` fails, the shell redirect still creates an empty file, and `gh issue edit --body-file` then wipes the map. Edit the saved body with Python rather than sed. Before `gh issue edit 2 --body-file map.md`, confirm the file is non-empty and still has the map's headings (e.g. `## Decisions so far`). To recover a wiped body, read the issue's edit history; each node's `diff` is a full past body, newest first: `gh api graphql -f query='{repository(owner:"StanleyGoldman",name:"gnome-battery-charging-ext"){issue(number:2){userContentEdits(first:3){nodes{editedAt diff}}}}}'`.
- **Child ticket**: an issue linked to the map as a sub-issue, as in **Parent split work** under Conventions. Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: the native issue dependencies under Conventions; a child's `blocked_by` edges are its gate.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`; close it by hand with `gh issue close <n>` when no PR resolves it (a PR's `Closes #<n>` closes it on merge); then append a context pointer (gist + link) to the map's Decisions-so-far.
