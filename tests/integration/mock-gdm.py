#!/usr/bin/env python3
"""A stand-in for GDM's version property, on a private system bus.

The shell builds its screen shield only when LoginManager.canLock() finds
org.gnome.DisplayManager on the system bus with a Version of 3.5.91 or later.
A container has no GDM, so without this Main.screenShield is null and the lock
test can't lock. run.sh starts it only on the empty private system bus it
creates where there's no real one, and passes that bus's address.

  mock-gdm.py ADDRESS
"""

import sys
import warnings

from gi.repository import Gio, GLib

warnings.filterwarnings('ignore', category=DeprecationWarning)  # register_object

NAME = 'org.gnome.DisplayManager'
PATH = '/org/gnome/DisplayManager/Manager'
XML = """
<node>
  <interface name="org.gnome.DisplayManager.Manager">
    <property name="Version" type="s" access="read"/>
  </interface>
</node>"""


def get_property(*_args):
    return GLib.Variant('s', '50.0')


conn = Gio.DBusConnection.new_for_address_sync(
    sys.argv[1],
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    None,
    None,
)
conn.register_object(PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], None, get_property, None)
Gio.bus_own_name_on_connection(conn, NAME, Gio.BusNameOwnerFlags.NONE, None, None)
GLib.MainLoop().run()
