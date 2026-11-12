#!/usr/bin/env python3
"""Draws icons/icon{16,32,48,128}.png: a gray covered-ad tile with "AD" on it.

No third-party imaging library needed - a tiny PNG encoder is enough.
Run from the extension folder:  python3 tools/make_icons.py
"""

import os
import struct
import zlib

BG = (163, 163, 163)
INK = (20, 20, 20)

GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
}

SIZES = (16, 32, 48, 128)
SS = 8  # supersampling factor


def render(n):
    size = n * SS
    px = [[BG for _ in range(size)] for _ in range(size)]

    # Rounded corners, transparent outside the radius.
    radius = size * 0.20
    for y in range(size):
        for x in range(size):
            cx = min(max(x, radius), size - radius)
            cy = min(max(y, radius), size - radius)
            if (x - cx) ** 2 + (y - cy) ** 2 > radius * radius:
                px[y][x] = None

    cols, rows = 11, 7
    scale = max(1, int(min(size * 0.62 / cols, size * 0.40 / rows)))
    tw, th = cols * scale, rows * scale
    x0 = (size - tw) // 2
    y0 = (size - th) // 2

    for ci, ch in enumerate("AD"):
        for ry, bits in enumerate(GLYPHS[ch]):
            for cx, bit in enumerate(bits):
                if bit != "1":
                    continue
                gx = ci * 6 * scale + cx * scale
                gy = ry * scale
                for dy in range(scale):
                    for dx in range(scale):
                        px[y0 + gy + dy][x0 + gx + dx] = INK

    out = []
    for y in range(n):
        row = []
        for x in range(n):
            r = g = b = 0
            covered = 0
            for dy in range(SS):
                for dx in range(SS):
                    c = px[y * SS + dy][x * SS + dx]
                    if c is None:
                        continue
                    r += c[0]
                    g += c[1]
                    b += c[2]
                    covered += 1
            if covered == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append(
                    (r // covered, g // covered, b // covered, int(round(255 * covered / (SS * SS))))
                )
        out.append(row)
    return out


def write_png(path, rows):
    n = len(rows)
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *p) for p in row) for row in rows
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(blob)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(here, "icons")
    os.makedirs(out_dir, exist_ok=True)
    for n in SIZES:
        path = os.path.join(out_dir, "icon%d.png" % n)
        write_png(path, render(n))
        print("wrote", path)


if __name__ == "__main__":
    main()
