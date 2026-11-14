#!/usr/bin/env python3
"""Draw the Patio Sky home-screen icons: a red polar chart on black."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, paint) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(paint(x, y, size))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def icon(padding: float):
    def paint(x: int, y: int, size: int) -> tuple[int, int, int, int]:
        cx = cy = (size - 1) / 2
        scale = size * (0.5 - padding)
        dx = (x - cx) / scale
        dy = (y - cy) / scale
        radius = math.hypot(dx, dy)
        # North-up polar disk. dy is negative toward the top of the image.
        red = 0
        if radius <= 1:
            red = 18
            ring = min(abs(radius - 1), abs(radius - 0.66), abs(radius - 0.33))
            if ring < 0.015:
                red = 90
            # A small Orion-like figure in the southeast of the disk.
            stars = [(0.15, 0.35), (0.28, 0.18), (0.22, -0.02), (0.08, -0.16), (0.34, -0.22)]
            for sx, sy in stars:
                if math.hypot(dx - sx, dy - sy) < 0.045:
                    red = 230
            for a, b in zip(stars, stars[1:]):
                if segment(dx, dy, a, b) < 0.02:
                    red = 190
            if abs(dx) < 0.012 or abs(dy) < 0.012:
                red = max(red, 70)
        elif abs(radius - 1) < 0.03 and padding > 0:
            red = 40
        return (red, int(red * 0.22), int(red * 0.22), 255)

    return paint


def segment(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    length = vx * vx + vy * vy or 1
    t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / length))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", 192, icon(0.04))
    write_png(OUT / "icon-512.png", 512, icon(0.04))
    write_png(OUT / "icon-maskable.png", 512, icon(0.18))
    print("icons written")


if __name__ == "__main__":
    main()
