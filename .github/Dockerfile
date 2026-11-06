# CI's tools, baked in once instead of reinstalled by every step. The workflow
# (.github/workflows/ci.yml) builds it on its runner, with its layers in the
# GitHub Actions cache; there is no registry. `make ci-image` builds it by hand.
# Steps run in it through .github/in-image.sh.
#
# Ubuntu 26.04 ships GNOME Shell 50, the release the extension and its
# integration tests target, as the development machine does. Move this line,
# and the runners (`runs-on`) in the workflow, when the target release moves.
FROM ubuntu:26.04

# What the make targets need. scripts/check-deps.sh lists the same tools for a
# development machine; change both together.
# - gjs: make test. gnome-shell: gnome-extensions (make pack) and
#   gnome-shell-test-tool (make test-integration). gettext: make pack, make pot.
# - python3-gi, dbus: the mock UPower and its private session bus.
# - language-pack-gnome-de: the integration tests check German strings
#   borrowed from GNOME Settings.
# - nodejs, npm: ESLint and Prettier (make lint-js). shellcheck, shfmt: make
#   lint-sh; actionlint also runs shellcheck on the workflow's scripts.
# - lcov: the unit-test coverage report.
RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      ca-certificates curl dbus gettext gjs gnome-shell git language-pack-gnome-de \
      lcov make nodejs npm python3-gi shellcheck shfmt && \
    rm -rf /var/lib/apt/lists/*

# tests/integration/run.sh runs the shell under LANG=en_US.UTF-8, since
# LANGUAGE only switches languages under a generated non-C locale. The German
# language pack generates only the de_* locales.
RUN locale-gen en_US.UTF-8

# The tools apt doesn't carry, or carries at another version, as pinned
# prebuilt binaries: an image rebuild never changes them behind our back. Bump
# a version here to move it.
ARG TYPOS_VERSION=1.51.1
ARG RUFF_VERSION=0.17.4
ARG ACTIONLINT_VERSION=1.7.12
RUN cd /usr/local/bin && \
    curl -fsSL "https://github.com/crate-ci/typos/releases/download/v${TYPOS_VERSION}/typos-v${TYPOS_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
      tar -xz ./typos && \
    curl -fsSL "https://github.com/astral-sh/ruff/releases/download/${RUFF_VERSION}/ruff-x86_64-unknown-linux-musl.tar.gz" | \
      tar -xz --strip-components=1 ruff-x86_64-unknown-linux-musl/ruff && \
    curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" | \
      tar -xz actionlint && \
    typos --version && ruff --version && actionlint --version && \
    gjs --version && gnome-shell --version && node --version
