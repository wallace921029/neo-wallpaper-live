#!/usr/bin/env python3
"""Query properties from an mpv IPC socket: mpvq.py SOCKET prop [prop...]"""
import json
import socket
import sys

sock, props = sys.argv[1], sys.argv[2:]
out = {}
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(2)
    s.connect(sock)
    f = s.makefile("rw")
    for i, p in enumerate(props):
        f.write(json.dumps({"command": ["get_property", p], "request_id": i}) + "\n")
    f.flush()
    got = 0
    while got < len(props):
        line = f.readline()
        if not line:
            break
        m = json.loads(line)
        if "request_id" in m:
            out[props[m["request_id"]]] = m.get("data", m.get("error"))
            got += 1
except Exception as e:  # noqa: BLE001
    out["_error"] = str(e)
print(json.dumps(out))
