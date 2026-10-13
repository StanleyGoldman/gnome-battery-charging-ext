UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
ICONS := $(wildcard src/icons/*.svg)
POT := po/$(UUID).pot
SOURCES := $(wildcard src/*.js src/metadata.json) $(ICONS)
EXTRA_SOURCES := $(filter-out src/extension.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)
INSTALL_DIR := $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/gnome-shell/extensions/$(UUID)

.PHONY: test test-integration pack pot install uninstall check-deps

## Run the unit tests.
test:
	gjs -m tests/unit/run.js $(UNIT_TESTS)

## Pack the extension, then run the headless integration tests (GNOME Shell 50).
test-integration: $(ZIP)
	tests/integration/run.sh $(ZIP) dist/integration

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

## List missing tools and the apt line that installs them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
