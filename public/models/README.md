# Spacecraft visualization models

These unmodified glTF assets are NASA visualization models by **NASA Visualization Technology Applications and Development (VTAD)**. They are enlarged in ORBIT to remain visible. Their orientation and deployed configuration are illustrative, not reconstructed spacecraft attitude or engineering CAD.

- [Voyager](https://science.nasa.gov/resource/voyager-3d-model/)
- [Cassini](https://science.nasa.gov/resource/cassini-3d-model/)
- [New Horizons](https://science.nasa.gov/resource/new-horizons-3d-model/)
- [Parker Solar Probe](https://science.nasa.gov/resource/parker-solar-probe-3d-model/)

Exact download URLs, sizes, and SHA-256 hashes are retained in `sources.json`. Reuse follows [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); NASA endorsement is not implied. These are not covered by the Solar System Scope texture license.

The renderer normalizes size and presents an illustrative attitude. Metalness
is capped at 0.8; minimum roughness is 0.36 for metallic surfaces and 0.5 for
other surfaces. Source colors, normal maps, texture alpha and rougher materials
are retained. Each flight owns one clone per source material and geometry,
while the imported textures remain shared.

A Sun-directed light casts self-shadows within a 1024 × 1024 map fitted around
the enlarged active spacecraft. Bounds and shadow bias follow the same uniform
scale and rebased coordinates as the model. A stationary model/Sun pair reuses
the shadow map; hidden spacecraft do not refresh it. Blended transparent layers
receive shadows but do not cast opaque carrier-triangle silhouettes. Masked
cutouts retain their source alpha test. This is shading of the illustrative
model and attitude, not reconstructed historical spacecraft illumination.
These runtime adjustments do not modify the distributed source GLB files.
