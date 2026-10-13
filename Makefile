UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
ICONS := $(wildcard src/icons/*.svg)
SOURCES := $(wildcard src/*.js src/metadata.json) $(ICONS)
EXTRA_SOURCES := $(filter-out src/extension.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)

.PHONY: test test-integration pack install check-deps

## Run the unit tests.
test:
	gjs -m tests/unit/run.js $(UNIT_TESTS)

## Pack the extension, then run the headless integration tests (GNOME Shell 50).
test-integration: $(ZIP)
	tests/integration/run.sh $(ZIP) dist/integration

## Build the installable zip in dist/.
pack: $(ZIP)

$(ZIP): $(SOURCES)
	mkdir -p dist
	gnome-extensions pack src --force --out-dir=dist --extra-source=icons \
		$(foreach f,$(EXTRA_SOURCES),--extra-source=$(notdir $(f)))

## Install the zip for the current user.
install: $(ZIP)
	gnome-extensions install --force $(ZIP)

## List missing tools and the apt line that installs them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
