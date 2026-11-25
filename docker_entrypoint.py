"""Prepare the catalog bind mount for the configured service account."""

import os
from pathlib import Path
import sys

if os.getuid() == 0:
    uid = int(os.environ.get("PUID", "1000"))
    gid = int(os.environ.get("PGID", "1000"))
    data = Path(os.environ["TRAILER_ROOM_DATA"])
    data.mkdir(parents=True, exist_ok=True)
    owner = data.stat()
    if (owner.st_uid, owner.st_gid) != (uid, gid):
        os.chown(data, uid, gid)
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)

os.execvp(sys.argv[1], sys.argv[1:])
