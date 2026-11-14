#!/usr/bin/env python3
"""Build the bundled catalogs, constellation figures, patio horizon, and Messier seed.

Outputs (all committed under public/data so the PWA works offline):

  constellations.json   88 IAU constellations, stick figures, and boundaries
  catalog.json          110 Messier objects + a bright/extended OpenNGC subset
  horizon.json          Foothill patio horizon, if the .hrz file is available
  messier-seed.json     captured Messier ids from the spreadsheet

Re-run after dropping a fresh spreadsheet or horizon file into data/source/:

  python3 scripts/prepare_data.py

The spreadsheet reader uses 1-based even columns (Excel B, D, F, …). Cells are
stripped of whitespace and trailing tabs, then scanned for Messier names.
If that reading does not yield 72 objects and the other column parity does,
the script keeps the parity that matches the known count and says which one.
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
SOURCE = ROOT / "data" / "source"
OUT = ROOT / "public" / "data"

MESS_RE = re.compile(r"M\s*0*(\d{1,3})", re.IGNORECASE)

SKIP_TYPES = {"NonEx", "Dup", "*", "**", "Nova"}

TYPE_LABELS = {
    "*": "Star",
    "**": "Double star",
    "*Ass": "Association",
    "OCl": "Open cluster",
    "GCl": "Globular cluster",
    "Cl+N": "Cluster with nebulosity",
    "G": "Galaxy",
    "GPair": "Galaxy pair",
    "GTrpl": "Galaxy triplet",
    "GGroup": "Galaxy group",
    "PN": "Planetary nebula",
    "HII": "H II region",
    "DrkN": "Dark nebula",
    "EmN": "Emission nebula",
    "Neb": "Nebula",
    "RfN": "Reflection nebula",
    "SNR": "Supernova remnant",
    "Other": "Other",
    "Dup": "Duplicate",
}

CONST_ALIAS = {"Se1": "Ser", "Se2": "Ser"}

DOWNLOADS = {
    "NGC.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
    "addendum.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv",
    "constellations.json": "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json",
    "constellations.lines.json": "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json",
    "constellations.bounds.json": "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.bounds.json",
}


def ensure_cache() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in DOWNLOADS.items():
        dest = CACHE / name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        print(f"downloading {name}")
        urllib.request.urlretrieve(url, dest)


def num(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def hms_to_hours(text: str) -> float:
    parts = text.strip().split(":")
    sign = -1 if parts[0].startswith("-") else 1
    hours = abs(float(parts[0]))
    minutes = float(parts[1]) if len(parts) > 1 else 0
    seconds = float(parts[2]) if len(parts) > 2 else 0
    return sign * (hours + minutes / 60 + seconds / 3600)


def dms_to_deg(text: str) -> float:
    """OpenNGC declination is ±DD:MM:SS, not hours."""
    parts = text.strip().split(":")
    sign = -1 if parts[0].startswith("-") else 1
    deg = abs(float(parts[0]))
    minutes = float(parts[1]) if len(parts) > 1 else 0
    seconds = float(parts[2]) if len(parts) > 2 else 0
    return sign * (deg + minutes / 60 + seconds / 3600)


def lon_to_hours(lon_deg: float) -> float:
    ra = lon_deg % 360
    return ra / 15


def spherical_mean(points: list[tuple[float, float]]) -> tuple[float, float]:
    x = y = z = 0.0
    for ra_h, dec in points:
        ra = math.radians(ra_h * 15)
        d = math.radians(dec)
        x += math.cos(d) * math.cos(ra)
        y += math.cos(d) * math.sin(ra)
        z += math.sin(d)
    hyp = math.sqrt(x * x + y * y + z * z) or 1
    dec = math.degrees(math.asin(max(-1, min(1, z / hyp))))
    ra = math.degrees(math.atan2(y, x)) / 15
    if ra < 0:
        ra += 24
    return ra, dec


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle, delimiter=";"))


def best_mag(row: dict[str, str]) -> float | None:
    visual = num(row.get("V-Mag"))
    blue = num(row.get("B-Mag"))
    if visual is not None:
        return visual
    return blue


def common_name(row: dict[str, str]) -> str:
    raw = (row.get("Common names") or "").strip()
    if not raw:
        return ""
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    if not parts:
        return ""
    # Prefer a short English-looking name when several are listed.
    ascii_parts = [part for part in parts if all(ord(ch) < 128 for ch in part)]
    pool = ascii_parts or parts
    return min(pool, key=len)


def messier_id(value: str) -> str | None:
    match = MESS_RE.search(value or "")
    if not match:
        return None
    number = int(match.group(1))
    if 1 <= number <= 110:
        return f"M{number}"
    return None


def messier_id_from_row(row: dict[str, str]) -> str | None:
    """OpenNGC stores the Messier number in column M as digits only ('042').

    The M102 row is a duplicate pointer at M101 and is skipped; M102 is added
    separately from NGC 5866.
    """
    name = (row.get("Name") or "").strip().upper().replace(" ", "")
    if name in {"M102", "M0102"}:
        return None
    field = (row.get("M") or "").strip()
    if re.fullmatch(r"\d{1,3}", field):
        number = int(field)
        if 1 <= number <= 110:
            return f"M{number}"
        return None
    return messier_id(field) or messier_id(name)


def catalog_id_from_name(name: str) -> str:
    text = name.strip()
    if text.upper().startswith("NGC"):
        digits = re.sub(r"\D", "", text)
        return f"NGC{int(digits)}" if digits else text
    if text.upper().startswith("IC"):
        digits = re.sub(r"\D", "", text)
        return f"IC{int(digits)}" if digits else text
    mid = messier_id(text)
    if mid:
        return mid
    return re.sub(r"\s+", "", text)


def display_alias(name: str) -> str:
    text = name.strip()
    upper = text.upper()
    if upper.startswith("NGC"):
        digits = re.sub(r"\D", "", text)
        return f"NGC {int(digits)}" if digits else text
    if upper.startswith("IC"):
        digits = re.sub(r"\D", "", text)
        return f"IC {int(digits)}" if digits else text
    return text


def object_record(row: dict[str, str], object_id: str, alias: str, name: str) -> dict:
    mag = best_mag(row)
    major = num(row.get("MajAx"))
    minor = num(row.get("MinAx"))
    con = (row.get("Const") or "").strip()
    con = CONST_ALIAS.get(con, con)
    record = {
        "id": object_id,
        "name": name,
        "alias": alias,
        "type": (row.get("Type") or "").strip(),
        "typeLabel": TYPE_LABELS.get((row.get("Type") or "").strip(), (row.get("Type") or "").strip() or "Object"),
        "mag": None if mag is None else round(mag, 2),
        "major": None if major is None else round(major, 2),
        "minor": None if minor is None else round(minor, 2),
        "ra": round(hms_to_hours(row["RA"]), 5),
        "dec": round(dms_to_deg(row["Dec"]), 5),
        "con": con,
    }
    return record


def keep_ngc(row: dict[str, str]) -> bool:
    kind = (row.get("Type") or "").strip()
    if kind in SKIP_TYPES:
        return False
    mag = best_mag(row)
    major = num(row.get("MajAx"))
    if mag is not None and mag <= 13:
        return True
    if mag is None and major is not None and major >= 2:
        return True
    return False


def build_catalog() -> dict:
    ngc = load_csv(CACHE / "NGC.csv")
    addendum = load_csv(CACHE / "addendum.csv")
    by_id: dict[str, dict] = {}

    spindle = next(row for row in ngc if row["Name"].strip() == "NGC5866")

    for row in ngc + addendum:
        name = (row.get("Name") or "").strip()
        mid = messier_id_from_row(row)
        if not mid:
            continue
        alias = "" if name.upper().startswith("M") else display_alias(name)
        if alias.upper().replace(" ", "") == mid:
            alias = ""
        title = common_name(row) or TYPE_LABELS.get((row.get("Type") or "").strip(), mid)
        by_id[mid] = object_record(row, mid, alias, title)

    # OpenNGC marks M102 as a duplicate of M101. Vardan's notes, and the usual
    # imaging identification, treat M102 as the Spindle Galaxy, NGC 5866.
    by_id["M102"] = object_record(spindle, "M102", "NGC 5866", "Spindle Galaxy")

    missing = [f"M{n}" for n in range(1, 111) if f"M{n}" not in by_id]
    if missing:
        raise SystemExit(f"Messier catalog is missing {missing}")

    messier_aliases = set()
    for item in by_id.values():
        alias = (item.get("alias") or "").upper().replace(" ", "")
        if alias:
            messier_aliases.add(alias)

    for row in ngc:
        if (row.get("M") or "").strip():
            continue
        if not keep_ngc(row):
            continue
        object_id = catalog_id_from_name(row["Name"])
        if object_id in by_id or object_id.upper() in messier_aliases:
            continue
        title = common_name(row)
        alias = display_alias(row["Name"])
        by_id[object_id] = object_record(row, object_id, alias, title or alias)

    objects = sorted(by_id.values(), key=lambda item: (item["id"][0] != "M", natural_key(item["id"])))
    messier_count = sum(1 for item in objects if re.fullmatch(r"M\d+", item["id"]))
    return {
        "generatedFrom": "OpenNGC (CC-BY-SA-4.0) by Mattia Verga",
        "filter": (
            "All 110 Messier objects. Other NGC/IC objects with V magnitude "
            "(or B if V is blank) of 13.0 or brighter, plus objects that have "
            "no magnitude but a major axis of at least 2 arcminutes. "
            "Stars, double stars, duplicates, and nonexistent entries are omitted. "
            "M102 is stored as NGC 5866, the Spindle Galaxy."
        ),
        "messierCount": messier_count,
        "count": len(objects),
        "objects": objects,
    }


def natural_key(value: str) -> tuple:
    parts = re.split(r"(\d+)", value)
    return tuple(int(part) if part.isdigit() else part for part in parts)


def ring_points(ring: list) -> list[tuple[float, float]]:
    points = []
    for lon, lat in ring:
        points.append((round(lon_to_hours(lon), 5), round(lat, 5)))
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    return points


def line_polylines(coords: list) -> list[list[list[float]]]:
    polylines = []
    for line in coords:
        poly = [[round(lon_to_hours(lon), 5), round(lat, 5)] for lon, lat in line]
        if len(poly) >= 2:
            polylines.append(poly)
    return polylines


def build_constellations() -> dict:
    names = json.loads((CACHE / "constellations.json").read_text())
    lines = json.loads((CACHE / "constellations.lines.json").read_text())
    bounds = json.loads((CACHE / "constellations.bounds.json").read_text())

    meta: dict[str, dict] = {}
    for feature in names["features"]:
        props = feature["properties"]
        label = props.get("name") or props.get("en") or feature["id"]
        # Serpens is stored as two figures, Caput and Cauda, under one IAU name.
        if feature["id"] == "Ser":
            label = "Serpens"
        meta[feature["id"]] = {
            "name": label,
            "genitive": props.get("gen") or "",
        }

    grouped_lines: dict[str, list] = defaultdict(list)
    for feature in lines["features"]:
        grouped_lines[feature["id"]].extend(line_polylines(feature["geometry"]["coordinates"]))

    grouped_bounds: dict[str, list] = defaultdict(list)
    for feature in bounds["features"]:
        rings = feature["geometry"]["coordinates"]
        exterior = rings[0]
        grouped_bounds[feature["id"]].append(ring_points(exterior))

    ids = sorted(set(meta) | set(grouped_lines) | set(grouped_bounds))
    constellations = []
    for cid in ids:
        figure = [pt for poly in grouped_lines.get(cid, []) for pt in poly]
        if not figure:
            figure = [pt for ring in grouped_bounds.get(cid, []) for pt in ring]
        ra, dec = spherical_mean(figure) if figure else (0.0, 0.0)
        info = meta.get(cid, {"name": cid, "genitive": ""})
        constellations.append(
            {
                "id": cid,
                "name": info["name"],
                "genitive": info["genitive"],
                "ra": round(ra, 5),
                "dec": round(dec, 4),
                "lines": grouped_lines.get(cid, []),
                "bounds": grouped_bounds.get(cid, []),
            }
        )
    constellations.sort(key=lambda item: item["name"])
    if len(constellations) != 88:
        raise SystemExit(f"expected 88 constellations, got {len(constellations)}: {[c['id'] for c in constellations]}")
    return {
        "source": (
            "Stick figures and names from d3-celestial by Olaf Frohn (BSD-3-Clause), "
            "drawn from the IAU constellation figures. Boundaries from Catalogue of "
            "Constellation Boundary Data, Davenhall & Leggett 1989, VizieR VI/49, "
            "as packaged by d3-celestial. Coordinates are J2000."
        ),
        "count": len(constellations),
        "constellations": constellations,
    }


def cell_text(value) -> str:
    if value is None:
        return ""
    return str(value).replace("\t", " ").strip()


def captured_from_rows(rows: list[list[str]], one_based_even: bool) -> list[str]:
    found: set[str] = set()
    for row in rows:
        for index, cell in enumerate(row):
            column_number = index + 1
            even = column_number % 2 == 0 if one_based_even else index % 2 == 0
            if not even:
                continue
            mid = messier_id(cell_text(cell))
            if mid:
                found.add(mid)
    return sorted(found, key=lambda item: int(item[1:]))


def find_file(names: list[str]) -> Path | None:
    candidates = []
    for name in names:
        candidates.extend(
            [
                Path("/workspace/uploads") / name,
                SOURCE / name,
                ROOT / "uploads" / name,
                Path("/tmp") / name,
            ]
        )
    for path in candidates:
        if path.exists() and path.stat().st_size > 0:
            return path
    return None


def read_xlsx_rows(path: Path) -> list[list[str]]:
    import openpyxl

    book = openpyxl.load_workbook(path, data_only=True, read_only=True)
    rows: list[list[str]] = []
    try:
        for sheet in book.worksheets:
            for row in sheet.iter_rows(values_only=True):
                rows.append([cell_text(cell) for cell in row])
    finally:
        book.close()
    return rows


def build_seed() -> dict | None:
    path = find_file(
        [
            "Messier_objects_122c.xlsx",
            "Messier_objects.xlsx",
            "Messier_objects_122c.csv",
            "Messier_objects.csv",
        ]
    )
    if path is None:
        print("WARNING: Messier spreadsheet not found. Seed file left unchanged if it exists.")
        return None
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as handle:
            rows = [[cell_text(cell) for cell in row] for row in csv.reader(handle)]
    else:
        rows = read_xlsx_rows(path)
    even_columns = captured_from_rows(rows, True)
    even_indexes = captured_from_rows(rows, False)
    if len(even_columns) == 72 and len(even_indexes) != 72:
        chosen, parity = even_columns, "1-based even columns (B, D, F, …)"
    elif len(even_indexes) == 72 and len(even_columns) != 72:
        chosen, parity = even_indexes, "0-based even indexes (A, C, E, …)"
    elif even_columns == even_indexes:
        chosen, parity = even_columns, "1-based even columns (both parities agreed)"
    elif len(even_columns) >= len(even_indexes):
        chosen, parity = even_columns, "1-based even columns (B, D, F, …)"
        print(
            f"WARNING: 1-based even columns captured {len(even_columns)}; "
            f"0-based even indexes captured {len(even_indexes)}. Using 1-based."
        )
    else:
        chosen, parity = even_indexes, "0-based even indexes (A, C, E, …)"
        print(
            f"WARNING: 0-based even indexes captured {len(even_indexes)}; "
            f"1-based even columns captured {len(even_columns)}. Using 0-based."
        )
    print(f"seed from {path}: {len(chosen)} captured via {parity}")
    return {
        "sourceFile": path.name,
        "columnRule": parity,
        "note": "Cells were stripped of whitespace and trailing tabs before matching M1–M110.",
        "count": len(chosen),
        "captured": chosen,
    }


def parse_horizon_text(text: str) -> list[dict[str, float]]:
    points = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith(";") or line.startswith("//"):
            continue
        line = line.replace(",", " ")
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            az = float(parts[0])
            alt = float(parts[1])
        except ValueError:
            continue
        if abs(az) > 3600 or abs(alt) > 90:
            continue
        az = az % 360
        points.append({"az": round(az, 4), "alt": round(alt, 4)})
    # Drop a leading count row that some horizon files use (azimuth 0..n with a tiny altitude).
    points.sort(key=lambda item: item["az"])
    dedup = []
    for point in points:
        if dedup and abs(dedup[-1]["az"] - point["az"]) < 1e-6:
            dedup[-1] = point
        else:
            dedup.append(point)
    return dedup


def build_horizon() -> dict | None:
    path = find_file(
        [
            "Foothill_horizon_52ea.hrz",
            "Foothill_horizon.hrz",
            "Foothill_horizon.txt",
        ]
    )
    if path is None:
        print("WARNING: patio horizon file not found. horizon.json left unchanged if it exists.")
        return None
    points = parse_horizon_text(path.read_text(encoding="utf-8", errors="replace"))
    if len(points) < 4:
        raise SystemExit(f"{path} did not look like azimuth/altitude pairs ({len(points)} points)")
    print(f"horizon from {path}: {len(points)} points, alt {min(p['alt'] for p in points):.1f}–{max(p['alt'] for p in points):.1f}°")
    return {
        "name": "Foothill patio",
        "sourceFile": path.name,
        "marginDeg": 2,
        "poorAzimuth": [20, 60],
        "poorLabel": "poor: streetlights/tree gap",
        "points": points,
    }


def main() -> None:
    ensure_cache()
    OUT.mkdir(parents=True, exist_ok=True)
    SOURCE.mkdir(parents=True, exist_ok=True)

    constellations = build_constellations()
    (OUT / "constellations.json").write_text(json.dumps(constellations, separators=(",", ":")))
    print(f"constellations: {constellations['count']}")

    catalog = build_catalog()
    (OUT / "catalog.json").write_text(json.dumps(catalog, separators=(",", ":")))
    print(f"catalog: {catalog['count']} objects, {catalog['messierCount']} Messier")

    seed = build_seed()
    if seed is not None:
        (OUT / "messier-seed.json").write_text(json.dumps(seed, indent=2) + "\n")
    elif not (OUT / "messier-seed.json").exists():
        print("ERROR: no seed could be written", file=sys.stderr)

    horizon = build_horizon()
    if horizon is not None:
        (OUT / "horizon.json").write_text(json.dumps(horizon))
        # Keep a copy of the original next to the source drop folder.
        src = find_file(["Foothill_horizon_52ea.hrz", "Foothill_horizon.hrz", "Foothill_horizon.txt"])
        if src and src.parent != SOURCE:
            (SOURCE / "Foothill_horizon.hrz").write_text(src.read_text(encoding="utf-8", errors="replace"))
    elif not (OUT / "horizon.json").exists():
        print("ERROR: no horizon could be written", file=sys.stderr)


if __name__ == "__main__":
    main()
