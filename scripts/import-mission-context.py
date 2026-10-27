#!/usr/bin/env python3
"""Add covered natural-body tracks without regenerating any spacecraft orbit.
Uses the same independently checked Hermite sampler and source kernels as the
mission importer. Large moons are loaded only for relevant planetary chapters.
"""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('ephemeris_import', Path(__file__).with_name('import-ephemerides.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
spice = base.spice

SYSTEMS = {
    'mars': {'phobos': 401, 'deimos': 402},
    'jupiter': {'io': 501, 'ganymede': 503, 'callisto': 504},
    'saturn': {'mimas': 601, 'enceladus': 602, 'tethys': 603, 'dione': 604, 'rhea': 605, 'iapetus': 608},
    'uranus': {'ariel': 701, 'umbriel': 702, 'titania': 703, 'oberon': 704, 'miranda': 705},
    'neptune': {'triton': 801},
    'pluto': {'charon': 901},
    'belt': {'ceres': '1;', 'vesta': '4;'},
}
CHAPTERS = {'mariner4': 'mars', 'pioneer10': 'jupiter', 'pioneer11': 'saturn', 'cassini': 'saturn', 'huygens': 'saturn', 'uranus': 'uranus', 'neptune': 'neptune', 'horizons': 'pluto', 'belt': 'belt'}
missions = {m['id']: m for m in json.loads((base.ROOT / 'scripts/ephemeris-missions.json').read_text())}
for chapter, system in CHAPTERS.items():
    bundle_path = base.OUT / (chapter + '.json')
    bundle = json.loads(bundle_path.read_text())
    bundle.setdefault('seams', {})
    bundle.setdefault('poles', {})
    bundle.setdefault('provenance', {})
    spice.kclear()
    paths = [base.kernel('generic_kernels/lsk/naif0012.tls'), base.kernel('generic_kernels/spk/planets/de440s.bsp'), base.kernel('generic_kernels/pck/pck00011.tpc')]
    m = missions[chapter]
    if m.get('kernel'): paths.append(base.kernel(m['kernel']))
    for path in m.get('matchingKernels', []): paths.append(base.kernel(path))
    for path in paths: spice.furnsh(str(path))
    for name, target in SYSTEMS[system].items():
        if name in bundle['tracks']: continue
        start, end = bundle['start'], bundle['end']
        try:
            spice.spkezr(str(target), start, 'ECLIPJ2000', 'NONE', '0')
            spice.spkezr(str(target), end, 'ECLIPJ2000', 'NONE', '0')
            native = True
        except spice.utils.exceptions.SpiceyError:
            native = False
        print(chapter, name, 'SPICE' if native else 'Horizons', flush=True)
        rows, error, seams = base.fit_track(target, start, end, native, tolerance=5)
        bundle['tracks'][name] = rows
        bundle['seams'][name] = seams
        bundle['validation']['maxPositionErrorKm'][name] = error
        # PCK radii are physical ellipsoid axes, in km. Keep the enclosing radius
        # for camera clearance; the renderer retains the ellipsoid proportions.
        radii_id = 2000001 if name == 'ceres' else 2000004 if name == 'vesta' else target
        axes = spice.bodvrd(str(radii_id), 'RADII', 3)[1]
        bundle['radiiKm'][name] = float(max(axes))
        try: bundle['poles'][name] = spice.pxform('IAU_' + name.upper(), 'ECLIPJ2000', start)[:, 2].tolist()
        except spice.utils.exceptions.SpiceyError: pass
        source = {'target': target, 'provider': 'SPICE' if native else 'Horizons'}
        if native: source['kernels'] = [p.name for p in paths if p.suffix == '.bsp']
        else: source['header'] = base.horizons(target, [start])[1].strip()
        bundle['provenance'][name] = source
        # Save each completed body so an interrupted network import is resumable.
        bundle_path.write_text(json.dumps(bundle, separators=(',', ':')) + '\n')
        print('Saved', name, len(rows), 'samples; error', round(error, 4), 'km', flush=True)
