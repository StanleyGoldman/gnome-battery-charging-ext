UUID := battery-charging@stanleygoldman.github.io
ZIP := dist/$(UUID).shell-extension.zip
SOURCES := $(wildcard src/*.js src/metadata.json)
EXTRA_SOURCES := $(filter-out src/extension.js,$(wildcard src/*.js))
UNIT_TESTS := $(wildcard tests/unit/*.test.js)

.PHONY: test pack install check-deps

## Run the unit tests.
test:
	gjs -m tests/unit/run.js $(UNIT_TESTS)

## Build the installable zip in dist/.
pack: $(ZIP)

$(ZIP): $(SOURCES)
	mkdir -p dist
	gnome-extensions pack src --force --out-dir=dist \
		$(foreach f,$(EXTRA_SOURCES),--extra-source=$(notdir $(f)))

## Install the zip for the current user.
install: $(ZIP)
	gnome-extensions install --force $(ZIP)

## List missing tools and the apt line that installs them. Never runs sudo.
check-deps:
	@./scripts/check-deps.sh
