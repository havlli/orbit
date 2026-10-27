#!/usr/bin/env python3
"""Build offline mission ephemerides from official JPL data (never from fitted artwork).
Requires Python with numpy and spiceypy; runtime app needs neither.
Install in a temporary venv. Network requests are sequential and cached under ignored work/.
Run from repo root: python scripts/import-ephemerides.py [mission-id ...]
"""

import hashlib, json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path
import numpy as np
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "work/ephemeris"
KERNELS = CACHE / "kernels"
OUT = ROOT / "public/ephemeris"
for p in (CACHE, KERNELS, OUT):
    p.mkdir(parents=True, exist_ok=True)
BASE = "https://naif.jpl.nasa.gov/pub/naif/"
BODIES = {
    "sun": 10,
    "mercury": 199,
    "venus": 299,
    "earth": 399,
    "moon": 301,
    "mars": 499,
    "jupiter": 599,
    "europa": 502,
    "saturn": 699,
    "titan": 606,
    "uranus": 799,
    "neptune": 899,
    "pluto": 999,
}
# Equatorial radii, km; rendering uses one uniform km scale. Comet shape is illustrative.
RADII = {
    "sun": 695700,
    "mercury": 2439.7,
    "venus": 6051.8,
    "earth": 6378.137,
    "moon": 1737.4,
    "mars": 3396.19,
    "jupiter": 71492,
    "europa": 1560.8,
    "saturn": 60268,
    "titan": 2574.73,
    "uranus": 25559,
    "neptune": 24764,
    "pluto": 1188.3,
    "comet": 2,
}


def kernel(path):
    p = KERNELS / Path(path).name
    if not p.exists():
        print("Download", path, flush=True)
        with urllib.request.urlopen(BASE + path, timeout=180) as r:
            p.write_bytes(r.read())
    return p


def horizons(target, epochs):
    """Geometric SSB positions and velocities, ecliptic J2000, TDB, km and km/s."""
    rows = []
    sources = []
    for offset in range(0, len(epochs), 75):
        ts = epochs[offset : offset + 75]
        params = dict(
            format="json",
            COMMAND=f"'{target}'",
            OBJ_DATA="'NO'",
            MAKE_EPHEM="'YES'",
            EPHEM_TYPE="'VECTORS'",
            CENTER="'500@0'",
            REF_PLANE="'ECLIPTIC'",
            REF_SYSTEM="'ICRF'",
            VEC_CORR="'NONE'",
            OUT_UNITS="'KM-S'",
            VEC_TABLE="'2'",
            CSV_FORMAT="'YES'",
            TIME_TYPE="'TDB'",
            TLIST_TYPE="'JD'",
            TLIST="'" + " ".join(f"{2451545+t/86400:.9f}" for t in ts) + "'",
        )
        query = urllib.parse.urlencode(params)
        p = CACHE / (hashlib.sha256(query.encode()).hexdigest() + ".json")
        if p.exists():
            d = json.loads(p.read_text())
        else:
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(
                        "https://ssd.jpl.nasa.gov/api/horizons.api?" + query,
                        timeout=100,
                    ) as r:
                        d = json.load(r)
                    if "$$SOE" not in d.get("result", ""):
                        raise ValueError(str(d)[:1000])
                    p.write_text(json.dumps(d))
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2)
        result = d["result"]
        header = result.split("$$SOE")[0]
        sources.append(header)
        lines = result.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
        if len(lines) != len(ts):
            raise ValueError("Unexpected epoch count")
        for t, line in zip(ts, lines):
            cols = line.split(",")
            rows.append([t] + [float(v) for v in cols[2:8]])
    return np.array(rows), sources[0]


def hermite(a, b, t):
    h = b[0] - a[0]
    u = (t - a[0]) / h
    return (
        (2 * u**3 - 3 * u * u + 1) * a[1:4]
        + (u**3 - 2 * u * u + u) * h * a[4:7]
        + (-2 * u**3 + 3 * u * u) * b[1:4]
        + (u**3 - u * u) * h * b[4:7]
    )


def fit_track(target, start, end, native=False, tolerance=5, max_seam=0):
    cache = {}
    seams = {}

    def fetch(times):
        missing = sorted(set(round(float(t), 6) for t in times) - cache.keys())
        if not missing:
            return
        if native:
            rows = [
                [t, *spice.spkezr(str(target), t, "ECLIPJ2000", "NONE", "0")[0]]
                for t in missing
            ]
        else:
            rows, _ = horizons(target, missing)
        for row in rows:
            cache[round(float(row[0]), 6)] = np.array(row)

    if start == end:
        fetch([start])
        return [cache[round(start, 6)].tolist()], 0, []
    # Start coarse; refine from independent interior samples. Never bridge a source gap.
    times = list(
        np.linspace(start, end, max(2, math.ceil((end - start) / 86400 / 5) + 1))
    )
    times = [round(float(t), 6) for t in times]
    fetch(times)
    for _ in range(26):
        probes = [
            round(a + (b - a) * f, 6)
            for a, b in zip(times, times[1:])
            for f in (0.25, 0.5, 0.75)
        ]
        fetch(probes)
        add = []
        maxerror = 0
        for a, b in zip(times, times[1:]):
            if (a, b) in seams:
                continue
            errors = [
                np.linalg.norm(
                    hermite(cache[a], cache[b], round(a + (b - a) * f, 6))
                    - cache[round(a + (b - a) * f, 6)][1:4]
                )
                for f in (0.25, 0.5, 0.75)
            ]
            if max(errors) > tolerance:
                if b - a < 0.25:
                    jump = float(
                        np.linalg.norm(
                            cache[b][1:4]
                            - cache[a][1:4]
                            - (cache[b][4:7] + cache[a][4:7]) * (b - a) / 2
                        )
                    )
                    if max_seam and jump <= max_seam:
                        seams[(a, b)] = {
                            "start": a,
                            "end": b,
                            "jumpKm": jump,
                            "note": "Boundary between source orbit solutions; no interpolation or path segment crosses it.",
                        }
                        continue
                    raise ValueError(
                        f"Unresolved discontinuity: {utc(a)} to {utc(b)}, {max(errors):.3f} km error"
                    )
                add.append(round((a + b) / 2, 6))
            maxerror = max(maxerror, max(errors))
        if not add:
            break
        times = sorted(times + add)
    else:
        raise ValueError("Interpolation did not converge")
    return (
        [
            [round(float(v), 6 if j < 4 else 10) for j, v in enumerate(cache[t])]
            for t in times
        ],
        float(maxerror),
        list(seams.values()),
    )


def sample(rows, t):
    a = np.array(rows)
    i = max(0, min(len(a) - 2, int(np.searchsorted(a[:, 0], t) - 1)))
    if len(a) == 1:
        return a[0, 1:4]
    return hermite(a[i], a[i + 1], t)


def utc(et):
    return spice.et2utc(et, "ISOC", 3) + "Z"


def run(m):
    spice.kclear()
    paths = [
        kernel("generic_kernels/lsk/naif0012.tls"),
        kernel("generic_kernels/spk/planets/de440s.bsp"),
        kernel("generic_kernels/pck/pck00011.tpc"),
    ]
    if m.get("kernel"):
        paths.append(kernel(m["kernel"]))
    for extra in m.get("matchingKernels", []):
        paths.append(kernel(extra))
    for path in paths:
        spice.furnsh(str(path))
    start = spice.str2et(m.get("start", m.get("date")).replace("T", " ") + " UTC")
    end = spice.str2et(m.get("end", m.get("date")).replace("T", " ") + " UTC")
    tracks = {}
    errors = {}
    provenance = {}
    seams = {}
    ids = dict(BODIES)
    if end - start > 10 * 86400:
        # Moons not involved in these long legs are omitted, never placed schematically.
        ids.pop("europa")
        ids.pop("titan")
    if m["id"] == "philae":
        ids["comet"] = 1000012
    if m.get("target"):
        ids = {"craft": m["target"], **ids}
    # Match the archival encounter solution's planet, Sun and Earth before generic ephemerides.
    if m["id"] == "mariner10":
        ids["mercury"] = 1
    for name, target in ids.items():
        try:
            spice.spkezr(str(target), start, "ECLIPJ2000", "NONE", "0")
            spice.spkezr(str(target), end, "ECLIPJ2000", "NONE", "0")
            native = True
        except spice.utils.exceptions.SpiceyError:
            native = False
        print(m["id"], name, "SPICE" if native else "Horizons", flush=True)
        tracks[name], errors[name], seams[name] = fit_track(
            target,
            start,
            end,
            native,
            (10 if m["quality"] == "archival" else 1) if name == "craft" else 5,
            m.get("maxModelSeamKm", 0) if name == "craft" else 0,
        )
        if native:
            provenance[name] = {
                "target": target,
                "provider": "SPICE",
                "kernels": [p.name for p in paths if p.suffix == ".bsp"],
            }
        else:
            _, header = horizons(target, [start])
            provenance[name] = {
                "target": target,
                "provider": "Horizons",
                "header": header.strip(),
            }
    events = []
    for event in m.get("events", []):
        t = spice.str2et(event["date"].replace("T", " ") + " UTC")
        if event.get("closest"):
            # Minimise actual sampled craft-to-body range, not distance to a static planet.
            lo = max(start, t - 21600)
            hi = min(end, t + 21600)

            def distance(t):
                return float(
                    np.linalg.norm(
                        sample(tracks["craft"], t) - sample(tracks[event["body"]], t)
                    )
                )

            for _ in range(65):
                a = lo + (hi - lo) / 3
                b = hi - (hi - lo) / 3
                if distance(a) < distance(b):
                    hi = b
                else:
                    lo = a
            t = (lo + hi) / 2
        events.append(
            {
                **event,
                "et": t,
                "utc": utc(t),
                "rangeKm": round(
                    float(
                        np.linalg.norm(
                            sample(tracks["craft"], t)
                            - sample(tracks[event["body"]], t)
                        )
                    ),
                    3,
                ),
            }
        )
    # Editorial time compression only: slow down across each encounter, preserving a shared clock.
    if len(events) > 1:
        clock = [
            (0, start),
            (0.10, max(start, events[0]["et"] - 21600)),
            (0.24, events[0]["et"]),
            (0.38, min(end, events[0]["et"] + 21600)),
            (0.64, max(start, events[-1]["et"] - 21600)),
            (0.85, events[-1]["et"]),
            (1, end),
        ]
    elif events:
        event = events[0]["et"]
        clock = [
            (0, start),
            (0.25, event - min(21600, (event - start) * 0.7)),
            (0.65, event),
            (0.9, event + min(21600, (end - event) * 0.7)),
            (1, end),
        ]
    else:
        clock = [(0, start), (1, end)]
    for e in events:
        for (p, a), (q, b) in zip(clock, clock[1:]):
            if a <= e["et"] <= b:
                e["progress"] = p + (q - p) * (e["et"] - a) / (b - a) if b > a else p
                break
    poles = {}
    for name, target in BODIES.items():
        try:
            poles[name] = spice.pxform("IAU_" + name.upper(), "ECLIPJ2000", start)[
                :, 2
            ].tolist()
        except spice.utils.exceptions.SpiceyError:
            pass
    bundle = {
        "seams": seams,
        "poles": poles,
        "version": 1,
        "id": m["id"],
        "frame": "ECLIPJ2000",
        "center": "SOLAR SYSTEM BARYCENTER",
        "timeScale": "TDB",
        "units": "km, km/s",
        "start": start,
        "end": end,
        "radiiKm": RADII,
        "clock": [{"progress": p, "et": t, "utc": utc(t)} for p, t in clock],
        "tracks": tracks,
        "events": events,
        "provenance": provenance,
        "validation": {
            "method": "Cubic Hermite checked at independent quarter, midpoint and three-quarter samples of every retained interval. Interpolation error is not source-orbit uncertainty.",
            "maxPositionErrorKm": errors,
        },
        "kernels": [
            {"file": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in paths
        ],
    }
    (OUT / (m["id"] + ".json")).write_text(
        json.dumps(bundle, separators=(",", ":")) + "\n"
    )
    return {
        **m,
        "start": utc(start),
        "end": utc(end),
        "events": events,
        "url": "/ephemeris/" + m["id"] + ".json",
        "clock": bundle["clock"],
    }



if __name__ == "__main__":
    missions = json.loads((ROOT / "scripts/ephemeris-missions.json").read_text())
    selected = set(sys.argv[1:])
    index_path = OUT / "index.json"
    existing = (
        {m["id"]: m for m in json.loads(index_path.read_text())}
        if index_path.exists()
        else {}
    )
    failures = []
    for m in missions:
        if selected and m["id"] not in selected:
            continue
        if not selected and m["id"] in existing and (OUT / (m["id"] + ".json")).exists():
            continue
        try:
            existing[m["id"]] = run(m)
        except Exception as error:
            failures.append(m["id"])
            print("FAILED", m["id"], str(error), flush=True)
            (CACHE / (m["id"] + "-import-error.txt")).write_text(str(error))
            continue
        index_path.write_text(
            json.dumps(
                [existing[m["id"]] for m in missions if m["id"] in existing], indent=2
            )
            + "\n"
        )
        print("Saved", m["id"], flush=True)

    if failures:
        raise SystemExit(1)
