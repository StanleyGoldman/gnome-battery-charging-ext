// The Full-battery action (docs/spec.md §5): once the battery has stayed Full for the
// wait, Notify offers the switch to Preserve Battery Health in a notification (posted,
// re-shown and withdrawn by the shell on this object's signals; the shell reports the
// user's answer through dismissed(), remindLater() and preserve()), and Switch
// automatically makes it.
// No GNOME Shell imports, so it runs under plain `gjs -m` for the unit tests.
//
// It takes the BatteryChargingModel, the strings from createStrings(), a clock:
//   now()                          wall-clock milliseconds
//   startTimer(delayMs, callback)  a one-shot timer; returns an id
//   cancelTimer(id)                only for a timer that hasn't fired
// and the settings as plain values: {action: 'off' | 'notify' | 'switch', fullWait,
// renotifyInterval}, the timings in minutes.

import GObject from 'gi://GObject';

export const FullBatteryAction = GObject.registerClass(
    {
        Signals: {
            // The automatic switch succeeded; the finished notice title.
            'switched': {param_types: [GObject.TYPE_STRING]},
            // Notify: post the notification, or show it again. Its title, its body, and
            // whether it has a Remind Me Later button.
            'notification-posted': {
                param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_BOOLEAN],
            },
            // Notify: destroy the notification; its cycle is over.
            'notification-withdrawn': {},
        },
    },
    // eslint-disable-next-line no-shadow -- registerClass names the GType after the class, so the names match.
    class FullBatteryAction extends GObject.Object {
        constructor(model, strings, clock, settings, {minuteMs = 60000} = {}) {
            super();
            this._model = model;
            this._strings = strings;
            this._clock = clock;
            this._settings = settings;
            this._minuteMs = minuteMs;
            this._fullSince = null; // wall time "all Full" began, while the wait runs
            // Nothing more happens until "all Full" breaks (docs/spec.md §5, One full charge).
            this._actedOrOverridden = false;
            this._lastNotified = null; // wall time of the Notify notification's last post
            this._shown = false; // the Notify notification is out
            this._buttonSwitch = null; // its Preserve Battery Health button's switch, in flight
            this._timer = null;
            this._switching = false; // true while this action starts a switch
            this._inFlight = null; // this action's switch, while it awaits its replies
            this._superseded = false; // a click took over this action's switch, and is in flight
            this._modelIds = [
                model.connect('full-changed', () => this._evaluate()),
                model.connect('changed', () => this._onModelChanged()),
                model.connect('switch-started', (_m, preserve) => this._onSwitchStarted(preserve)),
            ];
            this._evaluate();
        }

        _evaluate() {
            this._cancelTimer();
            if (!this._model.allFull || this._settings.action === 'off') {
                this._fullSince = null;
                this._endNotify();
                this._actedOrOverridden = false;
                return;
            }
            this._fullSince ??= this._clock.now();
            if (this._actedOrOverridden || this._due === null) return;
            const remaining = this._due - this._clock.now();
            // The timer's clock stops during suspend, but the wait runs on wall-clock time:
            // look again at least once a minute, so a wait that passed while suspended
            // fires within a minute of resume.
            this._timer = this._clock.startTimer(Math.max(0, Math.min(remaining, this._minuteMs)), () => {
                this._timer = null;
                if (this._clock.now() >= this._due) this._fire();
                else this._evaluate();
            });
        }

        // The settings changed: the same plain values as the constructor's.
        update(settings) {
            const before = this._settings.action;
            const after = settings.action;
            // Between Notify and Switch automatically: a new action for the same full charge.
            if (before !== after && before !== 'off' && after !== 'off') this._actedOrOverridden = false;
            if (after !== 'notify') this._endNotify();
            this._settings = settings;
            this._evaluate();
        }

        // When the action fires next, or null for never: the end of the wait, or, once Notify
        // has posted, the next reminder.
        get _due() {
            const {fullWait, renotifyInterval} = this._settings;
            if (this._buttonSwitch) return null;
            if (this._lastNotified === null) return this._fullSince + fullWait * this._minuteMs;
            return renotifyInterval > 0 ? this._lastNotified + renotifyInterval * this._minuteMs : null;
        }

        // A user's switch. It supersedes this action's switch in flight, which then sets no
        // flag. Choosing Maximize Charge while already Full overrides the action.
        _onSwitchStarted(preserve) {
            if (this._switching) return;
            if (this._inFlight) {
                this._inFlight = null;
                this._actedOrOverridden = false;
                this._superseded = true;
            }
            if (this._settings.action === 'off') return;
            if (!preserve && this._model.allFull) {
                this._actedOrOverridden = true;
                this._cancelTimer();
            }
        }

        // Once the click that superseded this action's switch has settled, its effect decides
        // what follows: a refused Preserve Battery Health leaves the battery Full and the
        // action live.
        _onModelChanged() {
            if (!this._superseded || this._model.switching) return;
            this._superseded = false;
            this._evaluate();
        }

        async _fire() {
            if (this._settings.action === 'notify') {
                this._post();
                return;
            }
            this._actedOrOverridden = true;
            const attempt = {};
            this._inFlight = attempt;
            this._switching = true;
            const switched = this._model.switchTo(true);
            this._switching = false;
            const outcome = await switched;
            // A click superseded it and took over the flag, or the action was destroyed.
            if (this._inFlight !== attempt) return;
            this._inFlight = null;
            if (outcome === 'switched') this.emit('switched', this._strings.switchedTitle());
        }

        _post() {
            this._lastNotified = this._clock.now();
            this._shown = true;
            const strings = this._strings;
            this.emit(
                'notification-posted',
                strings.fullyChargedTitle(),
                strings.fullyChargedBody(),
                this._settings.renotifyInterval > 0
            );
            this._evaluate();
        }

        // The shell reports what the user did with the Notify notification, which is gone.

        // ✕, Clear all, Delete or a body click: nothing more for this full charge.
        dismissed() {
            if (!this._shown) return;
            this._shown = false;
            this._actedOrOverridden = true;
            this._cancelTimer();
        }

        // Remind Me Later: the next reminder comes one interval from now.
        remindLater() {
            if (!this._shown) return;
            this._shown = false;
            this._lastNotified = this._clock.now();
            this._evaluate();
        }

        // The Preserve Battery Health button: a user's switch. On success "all Full" breaks
        // and the cycle ends. Otherwise (refused, or superseded by a click whose own effect
        // then decides) the cycle carries on as after Remind Me Later, or ends with the
        // interval at 0.
        async preserve() {
            if (!this._shown) return;
            this._shown = false;
            this._cancelTimer();
            const attempt = {};
            this._buttonSwitch = attempt;
            const outcome = await this._model.switchTo(true);
            // The cycle ended meanwhile, or the action was destroyed.
            if (this._buttonSwitch !== attempt) return;
            this._buttonSwitch = null;
            if (outcome === 'switched') return;
            if (this._settings.renotifyInterval === 0) this._actedOrOverridden = true;
            this._lastNotified = this._clock.now();
            this._evaluate();
        }

        // Ends the Notify cycle, withdrawing its notification if it is out.
        _endNotify() {
            this._lastNotified = null;
            this._buttonSwitch = null;
            if (!this._shown) return;
            this._shown = false;
            this.emit('notification-withdrawn');
        }

        _cancelTimer() {
            if (this._timer !== null) this._clock.cancelTimer(this._timer);
            this._timer = null;
        }

        destroy() {
            this._inFlight = null;
            this._cancelTimer();
            this._endNotify();
            this._modelIds.forEach(id => this._model.disconnect(id));
            this._modelIds = [];
        }
    }
);
