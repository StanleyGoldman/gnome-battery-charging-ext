#!/usr/bin/env python3
"""PROTOTYPE for issue #11: a tiny mock of the UPower charge-limit API.

Owns org.freedesktop.UPower on the SESSION bus (never the system bus), exports
batteries under /org/freedesktop/UPower/devices/, and reads commands from stdin.
Type `help` for the commands. Initial batteries come from the arguments,
e.g. `mock-upower.py BAT0:enabled BAT1:unsupported` (default: BAT0).
"""
import sys
import warnings

from gi.repository import Gio, GLib

warnings.filterwarnings("ignore", category=DeprecationWarning)  # register_object

NAME = 'org.freedesktop.UPower'
PATH = '/org/freedesktop/UPower'
DEVICE_PREFIX = PATH + '/devices/battery_'

UPOWER_XML = '''
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices"><arg type="ao" direction="out"/></method>
    <signal name="DeviceAdded"><arg type="o"/></signal>
    <signal name="DeviceRemoved"><arg type="o"/></signal>
  </interface>
</node>'''

DEVICE_XML = '''
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="NativePath" type="s" access="read"/>
    <property name="Type" type="u" access="read"/>
    <property name="PowerSupply" type="b" access="read"/>
    <property name="ChargeThresholdSupported" type="b" access="read"/>
    <property name="ChargeThresholdEnabled" type="b" access="read"/>
    <method name="EnableChargeThreshold"><arg type="b" direction="in"/></method>
  </interface>
</node>'''

HELP = '''commands (NAME is e.g. BAT0):
  add NAME [unsupported] [peripheral] [enabled]
                                        add a battery (supported, laptop, limit off by default)
  remove NAME                           remove a battery
  enable NAME | disable NAME            change the limit from "outside" (like GNOME Settings)
  support NAME on|off                   flip ChargeThresholdSupported
  fail NAME [MESSAGE]                   make EnableChargeThreshold fail on NAME
                                        (default: "Operation is not allowed.")
  ok NAME                               stop failing
  delay SECONDS                         delay every EnableChargeThreshold reply
  state                                 print all batteries
  quit                                  stop the mock (like UPower going away)'''

upower_iface = Gio.DBusNodeInfo.new_for_xml(UPOWER_XML).interfaces[0]
device_iface = Gio.DBusNodeInfo.new_for_xml(DEVICE_XML).interfaces[0]

conn = None
batteries = {}  # name -> dict
delay = 0.0
loop = GLib.MainLoop()


def path_of(name):
    return DEVICE_PREFIX + name


def print_state():
    if not batteries:
        print('  (no batteries)')
    for name, b in batteries.items():
        print(f"  {name}: power-supply={b['power_supply']} supported={b['supported']} "
              f"enabled={b['enabled']} fail={b['fail']!r}")
    print(f'  delay={delay}s', flush=True)


def emit_changed(name, **props):
    variants = {k: GLib.Variant('b', v) for k, v in props.items()}
    conn.emit_signal(None, path_of(name), 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                     GLib.Variant('(sa{sv}as)', ('org.freedesktop.UPower.Device', variants, [])))


def set_enabled(name, enabled):
    b = batteries[name]
    if b['enabled'] != enabled:
        b['enabled'] = enabled
        emit_changed(name, ChargeThresholdEnabled=enabled)


def device_get_property(_conn, _sender, path, _iface, prop):
    b = batteries[path[len(DEVICE_PREFIX):]]
    return {
        'NativePath': GLib.Variant('s', b['name']),
        'Type': GLib.Variant('u', 2),
        'PowerSupply': GLib.Variant('b', b['power_supply']),
        'ChargeThresholdSupported': GLib.Variant('b', b['supported']),
        'ChargeThresholdEnabled': GLib.Variant('b', b['enabled']),
    }[prop]


def device_method(_conn, _sender, path, _iface, method, params, invocation):
    name = path[len(DEVICE_PREFIX):]
    enabled = params.unpack()[0]
    print(f'\n<- EnableChargeThreshold({enabled}) on {name}', flush=True)

    def reply():
        b = batteries.get(name)
        if b is None:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownObject', 'battery is gone')
        elif b['fail']:
            invocation.return_dbus_error('org.freedesktop.UPower.GeneralError', b['fail'])
        elif not b['supported']:
            invocation.return_dbus_error('org.freedesktop.UPower.GeneralError',
                                         'setting battery charge thresholds is unsupported')
        else:
            set_enabled(name, enabled)
            invocation.return_value(None)
        print('-> replied', flush=True)
        print_state()
        return GLib.SOURCE_REMOVE

    if delay > 0:
        GLib.timeout_add(int(delay * 1000), reply)
    else:
        reply()


def upower_method(_conn, _sender, _path, _iface, method, _params, invocation):
    invocation.return_value(GLib.Variant('(ao)', ([path_of(n) for n in batteries],)))


def add(name, *flags):
    if name in batteries:
        print(f'{name} already exists')
        return
    b = {'name': name, 'power_supply': 'peripheral' not in flags,
         'supported': 'unsupported' not in flags, 'enabled': 'enabled' in flags, 'fail': None}
    b['reg_id'] = conn.register_object(path_of(name), device_iface,
                                       device_method, device_get_property, None)
    batteries[name] = b
    conn.emit_signal(None, PATH, NAME, 'DeviceAdded', GLib.Variant('(o)', (path_of(name),)))


def remove(name):
    b = batteries.pop(name)
    conn.unregister_object(b['reg_id'])
    conn.emit_signal(None, PATH, NAME, 'DeviceRemoved', GLib.Variant('(o)', (path_of(name),)))


def command(line):
    global delay
    words = line.split()
    if not words:
        return
    cmd, args = words[0], words[1:]
    try:
        if cmd == 'help':
            print(HELP)
        elif cmd == 'add':
            add(*args)
        elif cmd == 'remove':
            remove(args[0])
        elif cmd in ('enable', 'disable'):
            set_enabled(args[0], cmd == 'enable')
        elif cmd == 'support':
            batteries[args[0]]['supported'] = args[1] == 'on'
            emit_changed(args[0], ChargeThresholdSupported=args[1] == 'on')
        elif cmd == 'fail':
            batteries[args[0]]['fail'] = ' '.join(args[1:]) or 'Operation is not allowed.'
        elif cmd == 'ok':
            batteries[args[0]]['fail'] = None
        elif cmd == 'delay':
            delay = float(args[0])
        elif cmd == 'state':
            pass
        elif cmd == 'quit':
            loop.quit()
            return
        else:
            print(f'unknown command {cmd!r}; type help')
            return
    except (KeyError, IndexError, ValueError) as e:
        print(f'bad command: {e!r}; type help')
        return
    print_state()


def on_stdin(channel, _condition):
    line = channel.readline()
    if not line:
        loop.quit()
        return GLib.SOURCE_REMOVE
    command(line)
    print('mock-upower> ', end='', flush=True)
    return GLib.SOURCE_CONTINUE


def on_bus(connection, _name):
    global conn
    conn = connection
    conn.register_object(PATH, upower_iface, upower_method, None, None)
    for spec in sys.argv[1:] or ['BAT0']:
        add(*spec.split(':'))


def on_name_acquired(_conn, name):
    print(f'mock UPower owns {name} on the session bus. Type help.')
    print_state()
    print('mock-upower> ', end='', flush=True)


def on_name_lost(_conn, name):
    print(f'could not own {name} on the session bus', file=sys.stderr)
    loop.quit()


Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
                 on_bus, on_name_acquired, on_name_lost)
GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT,
                  GLib.IOCondition.IN | GLib.IOCondition.HUP, on_stdin)
loop.run()
