# ORBIT solar-system texture candidates

Verified 2026-09-08. All files downloaded and visually inspected. Originals retained unchanged.

Total image payload: **8,027,368 bytes (8.03 MB)**. Core 11 maps: 6,231,451 bytes. This is below the approximately 12 MB budget.

| Body | File | Dimensions | Bytes |
|---|---|---:|---:|
| Sun | `sun-2k.jpg` | 2048 × 1024 | 822,427 |
| Mercury | `mercury-2k.jpg` | 2048 × 1024 | 872,555 |
| Venus atmosphere | `venus-atmosphere-2k.jpg` | 2048 × 1024 | 229,696 |
| Earth day | `earth-day-2k.jpg` | 2048 × 1024 | 463,087 |
| Earth night | `earth-night-2k.jpg` | 2048 × 1024 | 255,287 |
| Earth clouds | `earth-clouds-2k.jpg` | 2048 × 1024 | 965,676 |
| Moon | `moon-2k.jpg` | 2048 × 1024 | 1,053,869 |
| Mars | `mars-2k.jpg` | 2048 × 1024 | 750,547 |
| Jupiter | `jupiter-2k.jpg` | 2048 × 1024 | 498,976 |
| Uranus | `uranus-2k.jpg` | 2048 × 1024 | 77,751 |
| Neptune | `neptune-2k.jpg` | 2048 × 1024 | 241,580 |
| Titan (optional infrared surface) | `titan-infrared-PIA22770.jpg` | 5760 × 2880 | 772,070 |
| Pluto (optional partial coverage) | `pluto-global-color-nasa.jpg` | 5926 × 2963 | 952,315 |
| Europa | `europa-global-usgs-1k.jpg` | 1024 × 512 | 71,532 |

## Core map attribution

All 11 core maps come from [Solar System Scope](https://www.solarsystemscope.com/textures/) and are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The source explicitly identifies equirectangular projection and allows commercial reuse with attribution. Creator: Solar System Scope / INOVE.

Suggested credit: “Solar-system textures by Solar System Scope / INOVE, licensed under CC BY 4.0.” Link the creator and license. Indicate alterations if you modify the maps.

These visualization maps use NASA-based data, adjusted colors, and fictional fill for some gaps in observations. Do not label them raw scientific data or complete current observations. Sun is an illustrative colorful map, Venus is the atmosphere, and Neptune uses saturated blue coloration.

Earth cloud JPEG has no alpha channel: use its grayscale brightness as a transparency mask for a white cloud shell. Night lights should be blended on the night hemisphere rather than shown across the fully lit globe.

## Optional NASA candidates

Titan: [Titan Mosaic: The Surface Under the Haze, PIA22770](https://science.nasa.gov/resource/titan-mosaic-the-surface-under-the-haze/). Credit **NASA/JPL-Caltech/Univ. Arizona**. This is grayscale surface brightness at 938 nm infrared, not a natural-color view through Titan's haze. It is a clean, unlabeled 2:1 global map.

Pluto: [Pluto Global Color Map](https://science.nasa.gov/resource/pluto-global-color-map/). Credit **NASA/JHUAPL/SwRI**. This New Horizons map has varied resolution and an unmapped southern area rendered black. Preserve that distinction if used. It is a candidate, not a fully covered texture.

The NASA candidates use [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) and, where applicable, [JPL image policy](https://www.jpl.nasa.gov/jpl-image-use-policy/), not CC BY 4.0. NASA allows factual informational web use with source acknowledgement and without implying endorsement. The source captions show the credits listed above without a separate copyright restriction.

## Europa follow-up

[Europa Voyager–Galileo SSI Global Mosaic 500m](https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m), USGS Astrogeology Science Center. The downloaded 1024 × 512 JPEG is the source's unlabeled browse product of its global Simple Cylindrical (equirectangular) map. It is ready for sphere UV mapping. Credit: **USGS Astrogeology Science Center; NASA/JPL Galileo and Voyager imagery**. The source metadata states **Access Constraints: None; Use Constraints: None**. This asset is not covered by the Solar System Scope CC BY license.

Visual inspection confirms recognizable fracture patterns, variable source resolution and visible mosaic seams. A narrow black strip near the south pole is a source coverage gap, not natural terrain. It is a useful lightweight map; full scientific GeoTIFF is linked in the JSON manifest but was not downloaded.

The targeted Titan atmosphere candidate, [NASA Saturn–Titan 3D texture](https://science.nasa.gov/3d-resources/saturn-titan/), explicitly calls itself fictional. It was not downloaded as natural-color evidence. Keep the simplified atmospheric haze treatment or use the separately labelled infrared surface map.

Saturn and its rings are credited in [ATTRIBUTION.md](ATTRIBUTION.md).

## Exact sources and local paths

[surface-detail-sources.json](textures/solar/surface-detail-sources.json) and [moon-sources.json](textures/solar/moon-sources.json) record dimensions, verified byte sizes, exact source pages, direct image URLs, credits, usage notes, and inspection status for the assets they cover.

## Spacecraft and mission flight presentation

Voyager, Cassini, New Horizons and Parker use NASA visualization models, loaded per mission; see [model credits and exact source URLs](models/README.md). Other spacecraft use procedural Three.js schematic silhouettes. All are enlarged independently of planets and distances and are not engineering CAD. Spacecraft attitude and surface orientation are illustrative. Trajectory geometry, natural-body positions and the shared historical clock now come from sourced ephemerides; see [trajectory sources and coverage](ephemeris/SOURCES.md). Missing spacecraft paths are withheld. The separate illustrated Solar atlas retains its undated layout.

Mission dates and discoveries are linked to NASA and ESA records. The discovery panel summarizes the encounter, not the historical moment of signal reception, analysis or announcement. Images are not time-specific observations of the replayed instant. Existing terrain coverage limitations still apply.

## Additional moons and small worlds · 10 September 2026

Eight unchanged official USGS browse maps add 991,761 bytes. [Exact sources, credits, projection and processing metadata](textures/solar/moon-sources.json) accompany each file. These are mosaics from multiple acquisitions, not imagery taken at the playback clock. Surface longitude and spin remain illustrative. Black source gaps are missing coverage, not measured dark terrain. No generated surface detail or local gap filling is used.

| World | Credit | Presentation / coverage |
|---|---|---|
| Io | NASA/JPL/USGS | False color; spatial resolution varies |
| Ganymede, Callisto | NASA/JPL/USGS | Monochrome; polar gaps and mosaic joins |
| Enceladus | NASA/JPL/Space Science Institute; USGS | Monochrome Cassini mosaic; source lighting retained |
| Triton | NASA/JPL-Caltech/LPI; Paul Schenk; USGS | Enhanced color; large northern gap; producer repaired former grid lines |
| Charon | NASA/JHUAPL/SwRI/LPI; New Horizons Team; USGS | Monochrome; large southern gap; uneven detail |
| Ceres | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA | Dawn clear-filter mosaic; polar gaps and source shadows |
| Vesta | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA; Dawn Team | Monochrome; producer repaired a longitude-wrap seam with neighboring pixels |

Additional moons without an installed map use plain ellipsoids with JPL/PCK axis proportions, explicitly labeled as untextured. No borrowed lunar terrain is substituted.
# Cinematic detail and celestial background — 2026-09-11

The following assets supplement the original 2k maps. All are local; no runtime
request goes to the source sites.

| File under `textures/` | Dimensions | Bytes | Source |
| --- | --- | ---: | --- |
| `solar/jupiter-4k.jpg` | 4096 × 2048 | 3,080,980 | [Solar System Scope original](https://www.solarsystemscope.com/textures/download/8k_jupiter.jpg) |
| `solar/saturn-4k.jpg` | 4096 × 2048 | 1,098,204 | [Solar System Scope original](https://www.solarsystemscope.com/textures/download/8k_saturn.jpg) |
| `solar/mars-4k.jpg` | 4096 × 2048 | 2,705,696 | [Solar System Scope original](https://www.solarsystemscope.com/textures/download/8k_mars.jpg), resized from 8192 × 4096 and encoded as JPEG quality 88 with macOS `sips` |

The Jupiter and Saturn download names say “8k”, but the supplied files are
4096 × 2048; they are retained unchanged and named for their actual dimensions.
These maps remain color-enhanced visualization textures, **not historical
weather or calibrated surface observations**. Credit: Solar System Scope /
INOVE, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Mars is only
resampled; no terrain was generated. Higher resolution maps are loaded on
demand, retaining the original 2k fallbacks. The current cache normally keeps
three detail maps so Earth's two layers can coexist with the next destination.
Resolved planets still in the shot take priority over that soft limit; prefetch
cannot evict their detail during a departure.

The fixed sky now separates catalog star points from NASA’s 2020 Milky Way
background. See [sky sources, credits, transformations and limitations](sky/SOURCES.md).

## Earth and Moon close-up detail · 12 September 2026

Three 4096 × 2048 maps add 7,236,816 bytes, loaded only when needed:

| File under `textures/solar/` | Bytes | Original |
| --- | ---: | --- |
| `earth-day-4k.jpg` | 1,181,479 | [8192 × 4096 Earth day map](https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg) |
| `earth-clouds-4k.jpg` | 2,774,908 | [8192 × 4096 Earth clouds](https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg) |
| `moon-4k.jpg` | 3,280,429 | [8192 × 4096 lunar map](https://www.solarsystemscope.com/textures/download/8k_moon.jpg) |

Credit: Solar System Scope / INOVE, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Resampled with Pillow LANCZOS and encoded at JPEG quality 88. The cloud map's
identical RGB channels become a grayscale opacity mask, sampled as non-color
data. Color maps retain their sRGB profile and 4:4:4 chroma. Orientation matches
the existing maps; there is no local terrain generation, gap filling or sharpening.
These remain undated, processed visualization composites with the publisher's
coverage, seasonal and color limitations. Cloud brightness is an illustrative
opacity convention, not calibrated atmospheric data. Full processing, hashes,
source dimensions and visual inspection are in [the asset manifest](textures/solar/surface-detail-sources.json).

## Ring rendering · 12 September 2026

The existing 2048 × 125 ring artwork supplies Saturn's radial bands and gaps.
No additional ring structure or texture pixels were generated in this pass.
The material distinguishes the lit face from the transmitted-light view of
the unlit face, following the qualitative behavior described by
[NASA's ring comparison](https://science.nasa.gov/photojournal/saturns-rings/).
Its view-dependent opacity is an editorial interpretation of the artwork's
alpha channel, not a calibrated optical-depth model. Planet occultation uses
the same flattened geometry as the rendered Saturn; derivative filtering
stabilizes the shadow boundary. Uranus retains its explicitly simplified ring
material.

## Uranus ring profile · 3 October 2026

Uranus uses a procedural schematic profile rather than an image map. The narrow
bands follow the published centre radii of rings 5, 4, Alpha, Beta, Eta, Gamma,
Delta, Lambda and Epsilon in the
[Planetary Data System ring table](https://pds-rings.seti.org/uranus/uranus_tables.html),
normalized by the 25,559 km equatorial radius in the
[ring fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/uranringfact.html).
Kilometre values are used directly; rounded radius-ratio columns are not the
source of the profile.

Representative widths within the published ranges are enlarged sixfold, with
derivative filtering and a minimum screen width to keep narrow bands stable in
motion. Colour and relative opacity are editorial. The most prominent outer
band represents Epsilon; the fainter bands and clear gaps follow the qualitative
appearance described in
[the Voyager ring observation](https://science.nasa.gov/photojournal/uranus-rings/).
This is not an observed texture, calibrated optical-depth model, or reconstruction
of a dated image. Ring eccentricities, clumps and fine variations are not
represented.

The existing circular mesh, 1.65–2.05 planet-radius extent and axial orientation
are preserved. Ring 6 and the closer Zeta ring are outside its inner edge; the
distant Nu and Mu rings are outside its outer edge and remain omitted. The
[current ring overview](https://science.nasa.gov/uranus/facts/#rings) describes
the complete system. Saturn continues to use its existing credited artwork.
