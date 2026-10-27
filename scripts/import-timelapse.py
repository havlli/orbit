#!/usr/bin/env python3
"""Export the natural-body overview used BETWEEN recorded mission windows.

Run after import-ephemerides.py, with the same temporary numpy/spiceypy venv.
Uses cached official DE440s / LSK kernels; no spacecraft paths are generated.
"""

import hashlib
import json
from pathlib import Path

import numpy as np
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
KERNELS = ROOT / "work/ephemeris/kernels"
for name in ("naif0012.tls", "de440s.bsp"):
    spice.furnsh(str(KERNELS / name))

START = spice.str2et("1957-01-01T00:00:00")
END = spice.str2et("2022-01-01T00:00:00")
TARGETS = {
    "sun": 10,
    "mercury": 199,
    "venus": 299,
    "earth": 399,
    "mars": 4,
    "jupiter": 5,
    "saturn": 6,
    "uranus": 7,
    "neptune": 8,
    "pluto": 9,
}
tracks, errors = {}, {}
for name, target in TARGETS.items():
    cache = {}

    def state(t):
        if t not in cache:
            cache[t] = np.array(
                spice.spkezr(str(target), t, "ECLIPJ2000", "NONE", "0")[0]
            )
        return cache[t]

    def fit(a, b):
        left, right = state(a), state(b)
        h = b - a
        error = 0
        for u in (0.25, 0.5, 0.75):
            interpolated = (
                (2 * u**3 - 3 * u**2 + 1) * left[:3]
                + (u**3 - 2 * u**2 + u) * h * left[3:]
                + (-2 * u**3 + 3 * u**2) * right[:3]
                + (u**3 - u**2) * h * right[3:]
            )
            error = max(
                error, float(np.linalg.norm(interpolated - state(a + u * h)[:3]))
            )
        if error > 100:
            mid = (a + b) / 2
            return fit(a, mid)[:-1] + fit(mid, b)
        errors[name] = max(errors.get(name, 0), error)
        return [a, b]

    # No interval longer than 32 days, even for the outer planets.
    coarse = np.linspace(START, END, int(np.ceil((END - START) / 86400 / 32)) + 1)
    epochs = []
    for a, b in zip(coarse, coarse[1:]):
        epochs.extend(fit(float(a), float(b))[:-1])
    epochs.append(END)
    tracks[name] = [
        [
            round(t, 6),
            *[round(float(v), 3 if i < 3 else 9) for i, v in enumerate(state(t))],
        ]
        for t in epochs
    ]
    print(name, len(epochs), "samples; checked error", round(errors[name], 3), "km")

data = {
    "version": 1,
    "frame": "ECLIPJ2000",
    "center": "SOLAR SYSTEM BARYCENTER",
    "timeScale": "TDB",
    "units": "km, km/s",
    "start": START,
    "end": END,
    "tracks": tracks,
    "provenance": {
        "provider": "NASA/JPL DE440s via NAIF SPICE",
        "source": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
        "sha256": hashlib.sha256((KERNELS / "de440s.bsp").read_bytes()).hexdigest(),
        "targets": TARGETS,
        "note": "Wide time-lapse only: Mars through Pluto use planetary-system barycentres. Moons and spacecraft are omitted. Encounter views use their own matched planet-centre ephemerides.",
    },
    "validation": {"sampledToleranceKm": 100, "maxPositionErrorKm": errors},
}
output = ROOT / "public/ephemeris/timelapse.json"
output.write_text(json.dumps(data, separators=(",", ":")) + "\n")
print(output.name, output.stat().st_size, "bytes")
