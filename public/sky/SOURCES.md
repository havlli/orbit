# Fixed celestial sky

Two independent layers preserve small star images during narrow camera views.
Both use fixed J2000 directions, transformed into the scene's ECLIPJ2000 frame
with [JPL's adopted obliquity](https://ssd.jpl.nasa.gov/astro_par.html),
84381.448 arcseconds. Stellar proper motion, parallax, variability and historical
apparent-sky corrections are not simulated. Exposure and magnitude compression
are editorial; the image is not calibrated photometry.

## Bright stars

`bright-stars.json`: 9,096 stars from **The Bright Star Catalogue, 5th Revised
Edition (Preliminary Version)**, Dorrit Hoffleit and Wayne H. Warren Jr. (1991),
Yale University Observatory / NSSDC. Retrieved through **CDS VizieR, V/50**.

- [Catalog and attribution](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50)
- [Column definitions](https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/V/50?format=html&tex=true)
- [Original fixed-width catalog](https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz)

Retained columns: HR identifier, J2000 right ascension and declination in degrees,
visual magnitude, B−V color index (null when absent). Fourteen entries without
stellar positions are omitted. The renderer uses small antialiased points and a
restrained approximate B−V tint. This catalog does not supply the much fainter
individual stars of the Milky Way background.

## Milky Way

`milkyway/`: tiled imagery derived from the 16384 × 8192 **Milky Way
background** layer of [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/).
The source explicitly omits the bright Hipparcos and Tycho stars, avoiding the
large blurry star disks of the former all-in-one panorama. This is a visualization
assembled from catalog data, including Gaia DR2; consult the source for catalog
coverage and repaired data gaps.

Credit: **NASA/Goddard Space Flight Center Scientific Visualization Studio;
Gaia DR2: ESA/Gaia/DPAC**. Visualization: Ernie Wright (USRA).
[NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

[Original 16384 × 8192 linear EXR](https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_16k.exr).
The 88 detail tiles use a 1024 × 1024 core
and four pixels of surrounding source imagery on each edge (1032 × 1032 total).
The four equatorial rows retain native source pixel spacing. Longitude samples
are averaged in linear light by two above 45° absolute declination and by four
above 67.5°, while latitude retains native resolution. These wider polar tiles
reduce plate-carrée oversampling and keep the visible sky inside the texture
budget even when the camera looks towards a celestial pole. Rows contain
4, 8, 16, 16, 16, 16, 8 and 4 tiles respectively.
Longitude gutters wrap across the panorama seam; latitude gutters clamp at the
poles. Linear RGB receives a fixed 16× exposure normalization to retain the
previous 4k layer's brightness, is clipped to the display range, transformed to sRGB, and
encoded as JPEG at quality 94. There is no generated detail, sharpening or
auto-levels. This is higher-resolution catalog-rendered structure, not newly
observed imagery or a photographic exposure.

`base.jpg` is a 2048 × 1024 continuous fallback, averaged in linear light from
the same 16k source. The renderer requests detail around the camera's current
orientation, fades it in, and retains at most 24 detail maps on desktop or 16
at phone widths. Two requests may be pending; at most one result becomes
resident per frame. Including mipmaps and the base image, the maximum resident
RGBA sky textures use approximately 141 MiB / 97 MiB respectively, versus
683 MiB for a complete 16k RGBA map with mipmaps. These figures exclude decoded
images, geometry and the rest of the scene. Failed or unselected tiles retain
the base view. The renderer adjusts sky exposure independently of the planets.

To reproduce with downloaded source files:

```sh
node scripts/tile-sky.mjs work/milkyway_2020_16k.exr public/sky/milkyway work/sky-conversion
```

For faster offline decoding, the equivalent native path applies that same gain
in floating point (two two-stop exposure filters), then writes a linear RGB16
intermediate. The importer recognizes this already-normalized PPM input:

```sh
ffmpeg -threads 4 -filter_threads 4 -i work/milkyway_2020_16k.exr -vf 'format=gbrpf32le,exposure=2,exposure=2' -frames:v 1 -pix_fmt rgb48be work/milkyway-normalized.ppm
node scripts/tile-sky.mjs work/milkyway-normalized.ppm public/sky/milkyway work/sky-conversion
```

The importer flips the bottom-up buffer returned by Three.js EXRLoader back to
image scanline order before encoding. Its EXR decoding uses half floats and a
transfer-function lookup. The native path quantizes normalized linear channels
to 16 bits before sRGB encoding. The large EXR is an offline input and is not shipped
to the browser. The former 4k JPEG and 2012 baked-star JPEG are retired.

## Live presentation treatment

The renderer applies a luminance-based contrast curve to separate the Milky
Way's broader structure from darker regions. A gentle highlight shoulder
restrains the dense background's brightness while retaining middle tones,
keeping that distant texture behind the separate sharp catalog stars. This
is display grading rather than added sky detail or spatial filtering.
Both the fallback and detail
tiles use the same continuous base image to determine this grade, avoiding
per-tile exposure changes during loading. Source color ratios and celestial
directions are retained. The encoded images themselves are unchanged.

The stellar display curve gives faint catalog stars less weight while keeping
the brightest stars distinct. The 48 catalog entries brighter than visual magnitude 2
receive a very small optical shoulder around their sharp cores, in one extra
draw call. This is an illustrative point-spread treatment, not resolved stellar
surfaces, measured apparent diameters or an atmospheric twinkle simulation.

Foreground illumination controls a smooth sky exposure cue. The meter uses
projected body coverage and the Sun/body/camera angle in the same rebased
coordinate system as the scene. Sky exposure settles as a bright world enters
the view and recovers more slowly on departure; brighter stellar cores remain
more visible than the faint field. This is an editorial photographic treatment,
not calibrated sensor exposure or an observation of historical sky brightness.
No fictitious nearby stars, translation parallax or drifting nebula layers are
introduced. The sky remains fixed at infinity relative to camera translation.
