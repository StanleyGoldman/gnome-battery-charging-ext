UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
ICONS := $(wildcard src/icons/*.svg)
POT := po/$(UUID).pot
SOURCES := $(wildcard src/*.js src/metadata.json) $(ICONS)
EXTRA_SOURCES := $(filter-out src/extension.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)

.PHONY: test test-integration pack pot install check-deps

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

## List missing tools and the apt line that installs them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
