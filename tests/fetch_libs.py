#!/usr/bin/env python3
"""Resolve missing Chromium shared libraries by downloading .deb files into a
local prefix (no root needed) and extracting them there."""
import gzip
import os
import re
import subprocess
import sys
import urllib.request

BASE = "http://archive.ubuntu.com/ubuntu"
DISTS = ["noble/main/binary-amd64", "noble/universe/binary-amd64"]
DEST = "/tmp/alibs"
ROOT = os.path.join(DEST, "root")
DEBS = os.path.join(DEST, "debs")

SEEDS = [
    "libnss3", "libnspr4", "libasound2t64", "libatk1.0-0t64", "libatk-bridge2.0-0t64",
    "libatspi2.0-0t64", "libcairo2", "libcups2t64", "libpango-1.0-0", "libxcomposite1",
    "libxdamage1", "libxfixes3", "libxrandr2", "libxkbcommon0",
]


INDEX_CACHE = os.path.join(DEST, "index.json")


def load_index():
    if os.path.exists(INDEX_CACHE):
        import json

        with open(INDEX_CACHE) as fh:
            data = json.load(fh)
        print("index cache loaded", len(data))
        return data
    index = {}
    for dist in DISTS:
        url = "%s/dists/%s/Packages.gz" % (BASE, dist)
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                raw = resp.read()
        except Exception as exc:  # noqa: BLE001
            print("index fetch failed", url, exc)
            continue
        text = gzip.decompress(raw).decode("utf-8", "replace")
        for block in text.split("\n\n"):
            fields = {}
            for line in block.splitlines():
                if line.startswith(" ") or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                fields[key.strip()] = value.strip()
            name = fields.get("Package")
            if name and name not in index:
                index[name] = fields
        print("indexed", dist, len(index))
    import json

    with open(INDEX_CACHE, "w") as fh:
        json.dump(index, fh)
    return index


def deps_of(fields):
    raw = (fields.get("Pre-Depends", "") + "," + fields.get("Depends", "")).strip(",")
    out = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        first = chunk.split("|")[0].strip()
        name = re.split(r"[\s(]", first)[0]
        if name:
            out.append(name)
    return out


def main():
    os.makedirs(DEBS, exist_ok=True)
    os.makedirs(ROOT, exist_ok=True)
    index = load_index()
    seen = set()
    queue = [(name, 0) for name in SEEDS]
    downloaded = 0
    while queue:
        name, depth = queue.pop(0)
        if name in seen:
            continue
        seen.add(name)
        fields = index.get(name)
        if not fields:
            continue
        if depth < 3:
            queue.extend((dep, depth + 1) for dep in deps_of(fields))
        filename = fields.get("Filename")
        if not filename:
            continue
        deb_path = os.path.join(DEBS, os.path.basename(filename))
        if not os.path.exists(deb_path):
            url = "%s/%s" % (BASE, filename)
            try:
                with urllib.request.urlopen(url, timeout=60) as resp, open(deb_path, "wb") as fh:
                    fh.write(resp.read())
                downloaded += 1
                print("got", name)
            except Exception as exc:  # noqa: BLE001
                print("download failed", name, exc)
                continue
        subprocess.run(["dpkg-deb", "-x", deb_path, ROOT], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("packages:", len(seen), "downloaded:", downloaded)

    libdirs = []
    for base, _dirs, files in os.walk(ROOT):
        if any(f.endswith(".so") or ".so." in f for f in files):
            libdirs.append(base)
    print("LD_LIBRARY_PATH=" + ":".join(sorted(set(libdirs))))


if __name__ == "__main__":
    sys.exit(main())
