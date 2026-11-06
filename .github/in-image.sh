#!/usr/bin/env bash
# Runs one command in the CI image, with the checkout mounted at /work, the way
# every step of .github/workflows/ci.yml runs its make target.
#
# Usage: .github/in-image.sh <command> [<arg>...]
#   e.g. .github/in-image.sh make test
#
# Run it from the repository root. The image must already exist as
# `battery-charging-ci:latest`: the workflow builds it, and `make ci-image`
# does by hand.
#
# Only the checkout is mounted, so in a git worktree, whose .git points outside
# it, git commands in the image fail (e.g. `make coverage BASE=<commit>`).
#
# The command runs as the caller's user, so what it writes to the checkout
# (dist/, node_modules/) stays the caller's. That user has no home in the
# image, so HOME is a scratch directory there.
#
# The variables in `passed` below reach the container when set here.
#
# Exit status: the command's.
set -euo pipefail

passed=(CI GITHUB_ACTIONS CI_SKIP_INTEGRATION)

args=(--rm -v "$PWD:/work" -w /work --user "$(id -u):$(id -g)" -e HOME=/tmp)
for name in "${passed[@]}"; do
    args+=(-e "$name")
done
exec docker run "${args[@]}" battery-charging-ci:latest "$@"
