UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
ICONS := $(wildcard src/icons/*.svg)
POT := po/$(UUID).pot
SCHEMAS := $(wildcard src/schemas/*.gschema.xml)
SOURCES := $(wildcard src/*.js src/metadata.json) $(ICONS) $(SCHEMAS)
# gnome-extensions pack adds extension.js, prefs.js and schemas/ by itself.
EXTRA_SOURCES := $(filter-out src/extension.js src/prefs.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)
INSTALL_DIR := $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/gnome-shell/extensions/$(UUID)
SH_FILES := $(wildcard scripts/*.sh tests/*/*.sh .github/*.sh)
PY_FILES := $(wildcard scripts/*.py tests/*/*.py)
NODE_BIN := node_modules/.bin
CI_IMAGE := battery-charging-ci:latest
COVERAGE_DIR := dist/coverage

.PHONY: test coverage test-integration screenshots pack pot install uninstall check-deps \
	lint lint-js lint-sh lint-py lint-actions format typos ci ci-image ci-docker

## Run the unit tests and the schema's strict dry-run compile.
test:
	gjs -m tests/unit/run.js $(UNIT_TESTS)
	glib-compile-schemas --strict --dry-run src/schemas

## Run the unit tests with coverage of src/: writes $(COVERAGE_DIR)/coverage.lcov, an HTML
## report in $(COVERAGE_DIR)/html and the Markdown summary.md. BASE=<commit> adds the share
## of the lines changed since that commit the tests ran. Never fails on a percentage.
# gjs matches --coverage-prefix against module URIs, so a bare path matches nothing. It
# copies each covered source under the output directory, where genhtml reads it. The
# report is of lines only: genhtml rejects the function records, since gjs gives
# different anonymous functions the same name.
coverage:
	rm -rf $(COVERAGE_DIR)
	mkdir -p $(COVERAGE_DIR)
	gjs --coverage-prefix=file://$(CURDIR)/src --coverage-output=$(COVERAGE_DIR) \
		-m tests/unit/run.js $(UNIT_TESTS)
	genhtml --quiet --rc function_coverage=0 --output-directory $(COVERAGE_DIR)/html $(COVERAGE_DIR)/coverage.lcov
	$(if $(BASE),git diff --no-color --no-ext-diff -U0 --src-prefix=a/ --dst-prefix=b/ \
		$(BASE) -- src > $(COVERAGE_DIR)/changes.diff)
	gjs -m scripts/print-coverage-summary.js $(COVERAGE_DIR)/coverage.lcov \
		$(if $(BASE),--diff $(COVERAGE_DIR)/changes.diff) $(wildcard src/*.js) \
		> $(COVERAGE_DIR)/summary.md
	cat $(COVERAGE_DIR)/summary.md

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
lint: lint-js lint-sh lint-py lint-actions typos

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

## actionlint on the GitHub Actions workflows (and shellcheck on their scripts).
lint-actions:
	actionlint

## Rewrite the JavaScript, shell and Python files in place to their formatters' style.
format: node_modules
	$(NODE_BIN)/prettier --write '**/*.js'
	shfmt --write $(SH_FILES)
	ruff format $(PY_FILES)

## Spell-check the repo (project words live in _typos.toml).
typos:
	typos

## Run every check CI runs, in order.
# .github/workflows/ci.yml runs these same targets, each as a step of its own;
# change the list here and the workflow's steps together. The workflow runs typos
# first, and test-integration in a job of its own. `ci` runs the unit tests
# through `coverage`, which also fails on a failing test.
ci: lint-js lint-sh lint-py lint-actions typos coverage pack test-integration

## Build the CI image (.github/Dockerfile) as $(CI_IMAGE).
ci-image:
	docker build -t $(CI_IMAGE) -f .github/Dockerfile .github

## Build the CI image, then run `make ci` in it, as CI does.
ci-docker: ci-image
	.github/in-image.sh make ci

# The pinned Node dev tools (ESLint, Prettier), from package-lock.json.
node_modules: package.json package-lock.json
	npm ci
	@touch $@

## List missing tools and the commands (an apt line and others) that install them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
