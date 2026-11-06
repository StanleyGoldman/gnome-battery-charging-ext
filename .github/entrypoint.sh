#!/usr/bin/env bash
# The CI image's entrypoint: gives the caller's uid and gid a passwd and group
# entry, then runs the command. in-image.sh runs the container as the caller's
# user, whose uid the image may not know (the GitHub runner's is 1001; the image has only
# 1000, `ubuntu`). dbus-daemon, which the integration tests start, refuses to
# run for an unknown uid. The Dockerfile makes /etc/passwd and /etc/group
# writable for this.
set -euo pipefail

if ! getent passwd "$(id -u)" >/dev/null; then
    echo "ci:x:$(id -u):$(id -g):CI:${HOME:-/tmp}:/bin/bash" >>/etc/passwd
fi
if ! getent group "$(id -g)" >/dev/null; then
    echo "ci:x:$(id -g):" >>/etc/group
fi
exec "$@"
