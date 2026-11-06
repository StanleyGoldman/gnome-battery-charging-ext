UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
ICONS := $(wildcard src/icons/*.svg)
POT := po/$(UUID).pot
SOURCES := $(wildcard src/*.js src/metadata.json) $(ICONS)
EXTRA_SOURCES := $(filter-out src/extension.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)
INSTALL_DIR := $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/gnome-shell/extensions/$(UUID)
SH_FILES := $(wildcard scripts/*.sh tests/*/*.sh)
PY_FILES := $(wildcard scripts/*.py tests/*/*.py)
NODE_BIN := node_modules/.bin

.PHONY: test test-integration screenshots pack pot install uninstall check-deps \
	lint lint-js lint-sh lint-py format typos

## Run the unit tests.
test:
	gjs -m tests/unit/run.js $(UNIT_TESTS)

## Pack the extension, then run the headless integration tests (GNOME Shell 50).
test-integration: $(ZIP)
	tests/integration/run.sh $(ZIP) dist/integration

## Pack the extension, then retake the README screenshots in docs/screenshots (GNOME Shell 50).
screenshots: $(ZIP)
	scripts/screenshots.sh $(ZIP) docs/screenshots

## Build the installable zip in dist/.
pack: $(ZIP)

$(ZIP): $(SOURCES) $(wildcard po/*.po po/*.pot)
	mkdir -p dist
	gnome-extensions pack src --force --out-dir=dist --podir=../po --extra-source=icons \
		$(foreach f,$(EXTRA_SOURCES),--extra-source=$(notdir $(f)))

## Regenerate po/<uuid>.pot from the _() strings only. Resetting the keywords (-k) drops
## xgettext's default dgettext, which would extract the strings borrowed from GNOME.
pot:
	mkdir -p po
	xgettext --from-code=UTF-8 --language=JavaScript -k --keyword=_ --keyword=C_:1c,2 \
		--keyword=ngettext:1,2 --add-comments=Translators --sort-by-file \
		--package-name=$(UUID) --msgid-bugs-address=https://github.com/StanleyGoldman/gnome-battery-charging-ext/issues \
		--output=$(POT) $(wildcard src/*.js)

## Install the zip for the current user.
install: $(ZIP)
	gnome-extensions install --force $(ZIP)

## Uninstall the extension for the current user. gnome-extensions asks the running shell,
## which doesn't know an extension installed since the last login (Wayland can't reload),
## so fall back to deleting its directory.
uninstall:
	gnome-extensions uninstall $(UUID) 2>/dev/null || rm -rf "$(INSTALL_DIR)"

## Run every linter and the spell check; fails on any finding. `make -k lint` reports them all.
lint: lint-js lint-sh lint-py typos

## ESLint and Prettier on the JavaScript.
lint-js: node_modules
	$(NODE_BIN)/eslint --max-warnings 0 .
	$(NODE_BIN)/prettier --check '**/*.js'

## shellcheck and shfmt on the shell scripts.
lint-sh:
	shellcheck $(SH_FILES)
	shfmt --diff $(SH_FILES)

## ruff on the Python.
lint-py:
	ruff check $(PY_FILES)
	ruff format --check $(PY_FILES)

## Rewrite the JavaScript, shell and Python files in place to their formatters' style.
format: node_modules
	$(NODE_BIN)/prettier --write '**/*.js'
	shfmt --write $(SH_FILES)
	ruff format $(PY_FILES)

## Spell-check the repo (project words live in _typos.toml).
typos:
	typos

# The pinned Node dev tools (ESLint, Prettier), from package-lock.json.
node_modules: package.json package-lock.json
	npm ci
	@touch $@

## List missing tools and the apt line that installs them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
