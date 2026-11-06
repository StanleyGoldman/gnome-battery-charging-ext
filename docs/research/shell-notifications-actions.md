# How GNOME Shell 50 notifications with action buttons work for an extension

Research for issue #52 (part of map #49). Researched 2026-11-06.

**Sources** (all primary):

- gnome-shell source at tag `50.1` from `gitlab.gnome.org/GNOME/gnome-shell` (the version on the dev
  machine, `gnome-shell --version` → 50.1): `js/ui/messageTray.js`, `js/ui/main.js`,
  `js/ui/messageList.js`, `js/ui/notificationDaemon.js`, `js/ui/dateMenu.js`, `js/ui/calendar.js`,
  `js/ui/status/doNotDisturb.js`, `js/ui/sessionMode.js`, `js/ui/unlockDialog.js`,
  `js/ui/extensionSystem.js`. Line references below are to `50.1`, e.g.
  <https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/messageTray.js#L574>.
  `messageTray.js` at `48.0` was diffed against `50.1` for API changes.
- gnome-settings-daemon `50.1`: `plugins/power/gsd-power-manager.c`
  (<https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/blob/50.1/plugins/power/gsd-power-manager.c>).
- gjs.guide: [Notifications](https://gjs.guide/extensions/topics/notifications.html), port guides for
  [48](https://gjs.guide/extensions/upgrading/gnome-shell-48.html),
  [49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html),
  [50](https://gjs.guide/extensions/upgrading/gnome-shell-50.html).

Claims marked **(inference)** are reasoned from the code, not observed or stated by a source. No test
notifications were posted to the live session.

## 1. The API on 50: `Source`, `Notification`, actions, urgency, resident, transient

All in `js/ui/messageTray.js` @ 50.1.

### Source

- `MessageTray.Source` (L501–621) extends `MessageList.Source` (properties `title`, `icon`,
  `icon-name`). Constructor param `policy` defaults to `NotificationGenericPolicy` (L524–525), which
  follows `org.gnome.desktop.notifications` (`show-banners`, `show-in-lock-screen`; L209–237).
- A source must be registered with `Main.messageTray.add(source)` (L854–868). Only then does the tray
  listen to its `notification-request-banner` signal (L873–876).
- **A source destroys itself when its last notification goes** (`_onNotificationDestroy`, L569–570).
  So an extension that keeps a source must null its reference on the source's `destroy` signal and
  build a new one next time. gjs.guide's `getNotificationSource()` example shows this pattern, and
  so does `getSystemSource()` (L1316–1330).
- At most 10 notifications per source; adding an 11th destroys the oldest with `EXPIRED` (L24,
  L577–580).

### Notification

`new MessageTray.Notification({source, title, body, gicon | iconName, urgency, resident, isTransient,
privacyScope, sound, ...})`. GObject properties L624–693; `source` is construct-only.

- **`addAction(label, callback)`** (L425–441) wraps the callback: after it runs, a non-resident
  notification destroys itself (`this.destroy()`, default reason `DISMISSED`). A resident one stays.
  `removeAction()` (new in 48, per the 48 port guide) and `clearActions()` (L443–460) also exist.
  At most **3 buttons** are rendered (`MAX_NOTIFICATION_BUTTONS = 3`, `messageList.js` L20, L749).
- **Body click** calls `activate()` (L469–486): emits `activated`, then destroys a non-resident
  notification (reason `DISMISSED`). The banner and the message-list entry both route clicks here
  (`messageList.js` L731–733).
- **`resident`** (default false): survives activation and action clicks (L433, L482). It is not
  destroyed by `Source.destroyNonResidentNotifications()` (L615–620).
- **`isTransient`** (default false): when its banner hides, the tray destroys it with `EXPIRED`
  (L1276–1277). It never lingers in the message list. A non-transient notification stays in the
  message list after its banner hides.
- **`urgency`** (`Urgency` L59–64; default `NORMAL`):
  - `LOW`: never gets a banner (L926–927); goes straight to the message list.
  - `NORMAL` / `HIGH`: banner unless the policy forbids it. They differ only in queue sort order
    (L946–947).
  - `CRITICAL`: banner even with banners off (L929); jumps a full queue (L944); shows over fullscreen
    and Busy presence (L1080); auto-expands, so action buttons show without hovering (L1166–1168);
    never times out (L1206, L1089). It sits at the top of the message list (`messageList.js`
    L1085–1089, L1816–1823) and is styled `critical` on the lock screen (`unlockDialog.js` L190–199).
- **`privacyScope`**: `SYSTEM` lets the lock screen show the notification's content even when the
  policy doesn't (`unlockDialog.js` L185–186). gsd's battery notifications set it to system.
- Non-critical banners show for `NOTIFICATION_TIMEOUT = 4000` ms (L19, L1207). The timer is extended
  while the pointer moves towards or hovers the banner (L1223–1244), and cut to 2 s once the user
  becomes active after an idle pop-up (L1112–1116). A non-critical banner shows actions only once
  expanded (hover or the `focus-active-notification` keybinding; L1096–1101, L1288–1293).

### API stability 48 → 50

Fact: the only `messageTray.js` changes from 48.0 to 50.1 are a `console.assert` plus a `_destroyed`
guard against double destruction in `activate()`, and `idle_add` → `idle_add_once`. The 49 and 50
port guides list no notification API changes. 48 introduced per-app grouping, `removeAction()`, and
raised `MAX_NOTIFICATIONS_PER_SOURCE` from 3 to 10. 49 moved Do Not Disturb from `calendar.js`
(`DoNotDisturbSwitch`, removed) to the Quick Settings `DoNotDisturbToggle` (`status/doNotDisturb.js`).

### What the extension does today

`src/extension.js` L108: `model.connect('failed', (_m, title, body) => Main.notify(title, body))`.
`Main.notify` (`main.js` L639–648) posts a **transient** notification on the shared **"System"**
source (`getSystemSource()`, icon `cog-wheel-symbolic`) with no actions and `NORMAL` urgency. It
shows a 4 s banner and is then destroyed (`EXPIRED`), so it never stays in the message list, and
under DND it is never seen at all. That's fine for a failure notice but unsuitable for Notify:
Notify needs its own `Source` and `Notification` so it can add actions, stay in the list, and
listen to signals.

## 2. Re-notifying: same object vs destroy + new

There are three ways to "post again". From the source:

| Method | Banner again? | Message list | Code |
|---|---|---|---|
| `source.addNotification(sameObject)` | **No.** It is a no-op if the object is already in the source. | Unchanged | L574–575 |
| Change properties (`title`, `body`, `gicon`, …) on the same object | **No new banner.** If its banner is on screen at that moment, the banner updates in place (bound properties, `messageList.js` L704–718). `datetime` refreshes on the next idle (L358–374). | Updates in place; **doesn't move** the source group to the top | — |
| Same object, set `notification.acknowledged = false` | **Yes.** `notify::acknowledged` → `false` re-emits `notification-request-banner` (L583–589). If the banner is still showing, it re-shows and its timer restarts (L932–937). Otherwise it is queued like a new one (L938–950). | Same entry; marked unseen (`unseenCount`, L542–544), so the date-menu dot returns. Group **not** moved to the top (only `notification-added` moves it, `messageList.js` L1825–1828) (inference from those lines) | L583–589 |
| `old.destroy(REPLACED)` then `addNotification(new)` | **Yes**, a fresh banner (L592–593). | Old entry animates out, new one in. The group moves to the top (`messageList.js` L1825–1828). If the old one was the source's only notification, **the source destroys itself** (L569–570), so build the new source first or add the new notification before destroying the old one. | L560–595 |

GNOME Shell itself uses both re-post patterns:

- **FDO `Notify` with `replaces_id`** (`notificationDaemon.js` L205–212, L213, L364–367) reuses
  the same object: it sets the new title/body, sets `acknowledged: false`, clears and re-adds
  actions, then calls `addNotification`, which is a no-op for an existing object. Users see a fresh
  banner.
- **GTK/portal notifications** (`GtkNotificationDaemonAppSource.addNotification`, L544–558) destroy
  the old one with `REPLACED` and add a new object.

`acknowledged` becomes `true` when a banner is shown (L1161), and for every notification of a group
when that group is mapped in the open message list (`messageList.js` L1194–1200). Banners are never
shown for acknowledged notifications (L922–924), and acknowledged ones are dropped from the banner
queue (L1064–1072).

**(Inference)** Setting `acknowledged = false` on a notification whose flag is already `false` (for
example, one that never got a banner because DND was on) may not emit `notify` and so may not
re-request a banner. Re-requesting is pointless then anyway, because the banner is still pending or
suppressed. Destroy + new avoids that edge case.

**Silent tray update without a banner:** change `title`/`body` on the same object and leave
`acknowledged` alone. Or post with `Urgency.LOW`, which never banners.

**Sound** plays only when a banner is shown (`playSound()` is called from
`_updateShowingNotification`, L1162), and only if the policy's `enableSound` is true and a `sound`
is set. Notifications have no sound by default.

## 3. Signals: dismiss vs click vs action vs expiry

`Notification` signals (L687–692): `activated`, `destroy(reason)`, `action-added`, `action-removed`.
Reasons (L48–53): `EXPIRED=1`, `DISMISSED=2`, `SOURCE_CLOSED=3`, `REPLACED=4`.

| User / system event | What fires | Reason |
|---|---|---|
| Close (×) button on banner or list entry, Delete/BackSpace key, the list's **Clear** button | `destroy` | `DISMISSED` (`messageList.js` L726–729, L676–682; `calendar.js` L827–835 → `MessageView.clear()` → `message.close()`, L1648–1668) |
| Click body | `activated`, then `destroy` (non-resident) | `DISMISSED` (L469–488) |
| Click action button | action callback, then `destroy` (non-resident) | `DISMISSED` (L425–437) |
| Banner times out, or Esc on the banner | nothing; it stays in the list. A **transient** one is destroyed. | `EXPIRED` (transient only, L1273–1277; Esc → `_expireNotification`, L825–837) |
| 11th notification on the source | oldest destroyed | `EXPIRED` (L577–580) |
| `source.destroy(reason)` | each notification destroyed with that reason. **With no argument, `reason` is `undefined`, so `Notification.destroy`'s default makes it `DISMISSED`** (L597–603, L488). | as passed |
| `notification.destroy()` with no argument | — | `DISMISSED` (default, L488) |

Consequences:

- **`DISMISSED` covers close, body click and action click.** To tell them apart, set a flag in the
  `activated` handler and in each action callback (they run before `destroy`, L426–436, L472–485), and
  read it in the `destroy` handler.
- **Expiry of a non-transient notification fires nothing**: the banner slides away and the
  notification stays in the list with `acknowledged = true`. There is no "banner hidden" signal on
  the notification (inference: none exists in L687–692). `EXPIRED` only reaches transient
  notifications or per-source overflow.
- **The extension's own teardown looks like a user dismissal** unless it passes an explicit reason,
  e.g. `source.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED)` in `disable()`, or
  disconnects its handlers first.

## 4. Do Not Disturb, the lock screen and fullscreen

**Do Not Disturb (fact).** The Quick Settings toggle binds inverted to
`org.gnome.desktop.notifications show-banners` (`status/doNotDisturb.js` L15–20). With the generic
policy, `showBanners` reads that key (L230–232), and the tray skips the banner for any non-`CRITICAL`
notification (L929–930). The notification still goes to the message list. The date-menu unseen dot
is hidden while DND is on (`dateMenu.js` L795–798). No sound plays, because sound only plays with a
banner. `CRITICAL` notifications ignore DND.

**Fullscreen and Busy presence (fact).** While the primary monitor is fullscreen, or GNOME Session
presence is `BUSY`, the next banner is held unless it is `forFeedback` or `CRITICAL` (L1079–1082).
It stays queued and is shown when that ends (`in-fullscreen-changed` → `_updateState`, L770–771). A
Busy transition also cuts the current banner's timer to 0 (L1008–1012). The queue holds at most 3
(`MAX_NOTIFICATIONS_IN_QUEUE`, L943–949), and only `CRITICAL` gets past a full queue. A dropped
notification still sits in the message list. The DND toggle is **not** Busy presence: it only flips
`show-banners`.

**Lock screen (fact).**

- The `unlock-dialog` session mode doesn't set `hasNotifications`, so it inherits `false` from
  `restrictive` (`sessionMode.js` L36, L67–79). The tray shows no banners and closes any banner that
  is up (L1074–1078, L1091). The lock screen instead lists sources in `NotificationsBox`
  (`unlockDialog.js`), only if `policy.showInLockScreen` (L238, L325–328). For the generic policy that
  is the global `show-in-lock-screen` key (L234–236). Content is shown when
  `detailsInLockScreen || narrowestPrivacyScope === SYSTEM` (L185–186).
- **The extension is disabled while the screen is locked.** `src/metadata.json` has no
  `session-modes`, so it defaults to `['user']` (`extensionSystem.js` L393). The extension system only
  keeps extensions whose modes include the current mode or its parent (L168–181), and re-evaluates on
  every session-mode change (L782–786). So locking calls `disable()` and unlocking calls `enable()`.
  If `disable()` tears down the notification source, which the review guidelines expect, the Notify
  notification **disappears from the message list on every lock**, and its timers reset on unlock
  (inference from the above; the existing code already cleans up everything in `disable()`).

## 5. Precedent: gnome-settings-daemon's battery notifications (50.1)

- **There is no "fully charged" notification.** `gsd-power-manager.c` only notifies for UPS
  discharging, low, critical and action levels (`engine_device_warning_changed_cb`, L1033–1077). When
  the warning level returns to `NONE`, which the comment describes as "fully charged or charging", it
  only **closes** the low-battery notification (L1062–1071). GNOME has no wording to borrow for a
  full-battery prompt, and no precedent for action buttons on power notifications: gsd adds none.
- **Low battery** (L785–860): `NORMAL` urgency, `transient` hint, 30 s timeout
  (`GSD_POWER_MANAGER_NOTIFY_TIMEOUT_LONG`, L70), icon `battery-low-symbolic`, app name "Power",
  `desktop-entry` `gnome-power-panel`, privacy scope system (`create_notification`, L359–384).
- **Critical / action** (L862–1031): `CRITICAL` urgency, never expires (`NOTIFY_EXPIRES_NEVER`), not
  transient, plus a looping alert sound.
- **Re-notify pattern: close + create new.** Every notification first calls
  `notify_close_if_showing(&manager->notification_low)` and then creates a new one (L835–848,
  L912–923, L1008–1015). It notifies **once per warning-level transition** (debounced by
  `engine_device_debounce_warn`, L1047). It never repeats on a timer.

## Short answer / implications

- **Build:** Notify needs its own `MessageTray.Source` (registered with `Main.messageTray.add`, reset on
  its `destroy` signal) and a non-transient `MessageTray.Notification` with up to 3 `addAction`
  buttons. `Main.notify` can't do it: it is transient, uses the System source, and has no actions.
  The API is unchanged 48→50.
- **Re-notify:** to get a **banner** again, either set `acknowledged = false` on the same object (what
  the FDO daemon does for `replaces_id`), or `destroy(REPLACED)` and post a new one (what the GTK
  daemon and gsd do). Destroy + new also moves the entry to the top of the list and avoids the
  `acknowledged`-already-false edge case. Changing title or body alone updates the list entry
  **silently**. Calling `addNotification` again on the same object does nothing.
- **Signals:** body click → `activated` then `destroy(DISMISSED)`. Action click → callback then
  `destroy(DISMISSED)`. Close, Clear all and Delete → `destroy(DISMISSED)`. Telling them apart needs
  flags set in `activated` and the action callbacks. A banner timing out fires **nothing** for a
  non-transient notification. `source.destroy()` without a reason also reports `DISMISSED`, so
  `disable()` must pass `SOURCE_CLOSED` or disconnect first.
- **Suppression:** DND, fullscreen and the lock screen all suppress non-critical banners. DND drops
  the banner entirely (the notification is still in the list). Fullscreen queues it until fullscreen
  ends. The lock screen shows no banners, and the extension itself is **disabled while locked**, so
  its notification and timers are torn down on lock and must be re-derived on unlock. `CRITICAL`
  bypasses DND and fullscreen and never times out, which is too aggressive for a "you may switch to
  Preserve Battery Health" prompt.
- **Precedent:** gsd posts no full-battery notification and puts no buttons on power notifications.
  It closes and re-creates, uses `NORMAL` + transient for warnings, `CRITICAL` only for
  near-shutdown, and notifies once per level change rather than on an interval.
