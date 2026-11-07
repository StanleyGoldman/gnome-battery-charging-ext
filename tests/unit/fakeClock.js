// A fake of the clock FullBatteryAction takes (see src/fullBattery.js), advanced by hand.
// Wall time (now()) and timer time move together on advance(); jump() moves wall time
// alone, as a suspend does: GLib's timers run on the monotonic clock, which stops then.

export class FakeClock {
    constructor(start = Date.UTC(2026, 10, 6, 12)) {
        this.wall = start;
        this._monotonic = 0;
        this._timers = new Map(); // id -> {due, callback}
        this._nextId = 1;
    }

    now() {
        return this.wall;
    }

    startTimer(delayMs, callback) {
        const id = this._nextId++;
        this._timers.set(id, {due: this._monotonic + delayMs, callback});
        return id;
    }

    cancelTimer(id) {
        if (!this._timers.delete(id)) throw new Error(`timer ${id} was not pending`);
    }

    get pendingTimers() {
        return this._timers.size;
    }

    // Moves both clocks forward, firing each timer as its time comes, in order.
    advance(ms) {
        const end = this._monotonic + ms;
        for (;;) {
            const next = [...this._timers.entries()]
                .filter(([, t]) => t.due <= end)
                .sort(([, a], [, b]) => a.due - b.due)[0];
            if (!next) break;
            const [id, timer] = next;
            this.wall += timer.due - this._monotonic;
            this._monotonic = timer.due;
            this._timers.delete(id);
            timer.callback();
        }
        this.wall += end - this._monotonic;
        this._monotonic = end;
    }

    jump(ms) {
        this.wall += ms;
    }
}
