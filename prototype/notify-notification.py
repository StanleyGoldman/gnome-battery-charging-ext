#!/usr/bin/env python3
"""PROTOTYPE, throw away. Not part of the extension.

Question (issue #55, "How does Notify behave?"): what should the Full-battery action's
Notify notification say and offer, and what do dismiss and snooze do?

Posts real notifications on your GNOME desktop through org.freedesktop.Notifications, with
the timings shrunk to seconds, and drives a stand-in for the Notify state machine. The
battery is simulated: type commands in this terminal to unplug, refill or switch modes.

Run:  python3 prototype/notify-notification.py [--variant a|b|c] [--wait S] [--interval S]
      [--body dismiss|later|switch]

Variants (Q1 on #55):
  a  Buttons "Preserve Battery Health" + "Remind Me Later". ✕ stops reminders until the
     next full charge; Remind Me Later waits one interval.
  b  Button "Preserve Battery Health" only. ✕ stops reminders until the next full charge.
  c  Button "Preserve Battery Health" only. ✕ waits one interval (dismiss is the snooze).

Fidelity gap: the real extension uses its own MessageTray.Source in-process; this goes
through GNOME Shell's FDO notification daemon, which renders the same banner and list
entry but names the source after app_name.
"""

import argparse
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

TITLE = "Battery Fully Charged"
BODY = "Switch to Preserve Battery Health to slow battery wear."
ICON = "battery-full-charged-symbolic"
APP = "Battery Charging"

CLOSE_REASONS = {1: "expired", 2: "dismissed", 3: "closed by app", 4: "undefined"}

p = argparse.ArgumentParser()
p.add_argument("--variant", choices="abc", default="a")
p.add_argument("--wait", type=int, default=5, help="seconds Full before first notify")
p.add_argument("--interval", type=int, default=20, help="re-notify interval, 0 = once")
p.add_argument("--body", choices=["dismiss", "later", "switch"], default="dismiss",
               help="what clicking the notification body does")
args = p.parse_args()

bus = Gio.bus_get_sync(Gio.BusType.SESSION)
proxy = Gio.DBusProxy.new_sync(bus, 0, None, "org.freedesktop.Notifications",
                               "/org/freedesktop/Notifications",
                               "org.freedesktop.Notifications")

state = {
    "full": True,            # simulated battery: all supporting batteries Full
    "mode": "Maximize Charge",
    "phase": "waiting",      # waiting | notified | snoozed | silenced | idle
    "notif_id": 0,
    "shown": 0,              # banners shown this full charge
    "timer": 0,
    "closing_ourselves": False,
}
loop = GLib.MainLoop()


def log(event):
    s = state
    print(f"\n[{event}]\n  battery={'Full' if s['full'] else 'not Full'} mode={s['mode']}"
          f" phase={s['phase']} notif_id={s['notif_id'] or '-'} banners_this_charge={s['shown']}"
          f"\n  variant={args.variant} wait={args.wait}s interval={args.interval}s"
          f" body-click={args.body}")
    print("> ", end="", flush=True)


def cancel_timer():
    if state["timer"]:
        GLib.source_remove(state["timer"])
        state["timer"] = 0


def start_timer(seconds, fn):
    cancel_timer()

    def fire():
        state["timer"] = 0
        fn()
        return GLib.SOURCE_REMOVE
    state["timer"] = GLib.timeout_add_seconds(seconds, fire)


def actions():
    acts = ["default", "", "preserve", "Preserve Battery Health"]
    if args.variant == "a" and args.interval > 0:
        acts += ["later", "Remind Me Later"]
    return acts


def notify():
    # replaces_id re-shows the banner (same as acknowledged = false in-process).
    nid = proxy.call_sync(
        "Notify",
        GLib.Variant("(susssasa{sv}i)", (APP, state["notif_id"], ICON, TITLE, BODY,
                                        actions(),
                                        {"urgency": GLib.Variant("y", 1),
                                         "desktop-entry": GLib.Variant("s", "gnome-power-panel")},
                                        0)),
        0, -1, None).unpack()[0]
    state["notif_id"] = nid
    state["shown"] += 1
    state["phase"] = "notified"
    if args.interval > 0:
        start_timer(args.interval, lambda: (notify(), log("interval passed, banner re-shown")))
    log("notification posted" if state["shown"] == 1 else "reminder posted")


def withdraw(why):
    cancel_timer()
    if state["notif_id"]:
        state["closing_ourselves"] = True
        proxy.call_sync("CloseNotification", GLib.Variant("(u)", (state["notif_id"],)),
                        0, -1, None)
        state["notif_id"] = 0


def snooze():
    state["phase"] = "snoozed"
    start_timer(args.interval, notify)


def silence():
    cancel_timer()
    state["phase"] = "silenced"


def become_full():
    state["full"] = True
    state["shown"] = 0
    state["phase"] = "waiting"
    start_timer(args.wait, notify)


def switch_to_preserve(source):
    state["mode"] = "Preserve Battery Health"
    state["full"] = False   # charge limit on → no battery is Full
    withdraw("switched")
    state["phase"] = "idle"
    log(f"switched to Preserve Battery Health ({source}); notification withdrawn")


pending_action = {"key": None}


def on_signal(_proxy, _sender, signal, params):
    nid = params.unpack()[0]
    if nid != state["notif_id"]:
        return
    if signal == "ActionInvoked":
        pending_action["key"] = params.unpack()[1]
        return
    if signal != "NotificationClosed":
        return
    reason = params.unpack()[1]
    state["notif_id"] = 0
    if state["closing_ourselves"]:
        state["closing_ourselves"] = False
        return
    key = pending_action["key"]
    pending_action["key"] = None
    if key == "default":
        key = {"dismiss": None, "later": "later", "switch": "preserve"}[args.body]
        print(f"\n(body clicked → treated as {key or 'dismiss'})", end="")
    if key == "preserve":
        switch_to_preserve("notification button")
    elif key == "later":
        snooze()
        log(f"Remind Me Later: next reminder in {args.interval}s")
    elif reason == 2:
        if args.variant == "c" and args.interval > 0:
            snooze()
            log(f"dismissed (✕): snoozed, next reminder in {args.interval}s")
        else:
            silence()
            log("dismissed (✕): no more reminders until the next full charge")
    else:
        log(f"closed: {CLOSE_REASONS.get(reason, reason)}")


proxy.connect("g-signal", on_signal)

HELP = """commands:
  u  unplug (battery stops being Full; notification withdrawn)
  f  battery Full again (replug / reach 100 %): fresh wait, then notify
  p  switch to Preserve Battery Health elsewhere (Quick Settings / GNOME Settings)
  m  switch to Maximize Charge elsewhere (battery still at 100 % → Full again)
  s  show state
  q  quit (closes the notification)"""


def on_stdin(_fd, _cond):
    line = sys.stdin.readline()
    if not line:
        loop.quit()
        return False
    c = line.strip()
    if c == "u":
        state["full"] = False
        withdraw("unplugged")
        state["phase"] = "idle"
        log("unplugged: not Full, timer cancelled, notification withdrawn")
    elif c == "f":
        state["mode"] = "Maximize Charge"
        become_full()
        log(f"battery Full: notifying in {args.wait}s")
    elif c == "p":
        switch_to_preserve("elsewhere")
    elif c == "m":
        state["mode"] = "Maximize Charge"
        become_full()
        log(f"switched to Maximize Charge at 100 %: Full again, notifying in {args.wait}s")
    elif c == "s":
        log("state")
    elif c == "q":
        withdraw("quit")
        loop.quit()
        return False
    else:
        print(HELP)
        print("> ", end="", flush=True)
    return True


GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT,
                  GLib.IOCondition.IN | GLib.IOCondition.HUP, on_stdin)

print(__doc__.split("Run:")[0].strip())
print()
print(HELP)
become_full()
log(f"start: battery Full, notifying in {args.wait}s")
try:
    loop.run()
except KeyboardInterrupt:
    withdraw("quit")
