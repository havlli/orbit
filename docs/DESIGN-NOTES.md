# Design notes

Background on how ORBIT works and what it deliberately does not do. The README
has the short version.

## Principles

- ORBIT is a static site: no production API routes, databases or server runtime. Hosting is Cloudflare static assets, configured in `wrangler.static.jsonc`.
- Astronomy claims are checked against primary sources. Image attribution and coverage limits stay accurate.
- Schematic or missing data is never presented as observed detail.
- Mission playback uses sourced ephemerides at one shared historical time and one uniform distance scale. Camera movement and playback rate are editorial; spacecraft are enlarged, and surface maps and craft attitude are illustrative.
- Archival uncertainty is shown. Missing or predicted routes are withheld.
- The atlas is undated and says so.
- Rendering and camera changes are checked in a real browser at desktop and phone sizes: departures, transit, arrival, pause, seek and reduced motion. Visual checks that were not done are not reported as done.
- Credentials and scratch files stay out of the repository. Scratch output goes in `work/`, which is ignored.

## Source map

- `app/solar-data.ts`: planetary information, source links, and dated mission milestones.
- `app/small-bodies.ts`: eighteen additional moons, Ceres and Vesta, sourced axes, and surface coverage notes.
- `app/spacecraft.ts`: NASA model loading, scene lighting adjustments, schematic fallback geometry, and clone cleanup.
- `app/belt-region.ts`: persistent Sun-relative belt region in historical and atlas layouts, without synthetic dated asteroid states.
- `app/belt-material.ts`: individual nearby-rock clearance without hiding entire atlas fields.
- `app/path-visibility.ts` and `app/path-presentation.ts`: guide fades around travel and readable caption space.
- `app/expedition-welcome.tsx`: prepared scene entry into the journey or atlas.
- `app/body-markers.ts`: subtle markers for covered natural bodies smaller than a screen pixel.
- `app/mission-journeys.ts`: sourced flight segments, departure/encounter dates, and discovery copy.
- `app/mission-flight.ts`: enlarged spacecraft silhouettes, body-relative ephemeris paths, floating-origin camera, pause/seek, and cleanup.
- `app/mission-cinematography.ts`: encounter pacing, exact-epoch discovery holds, close-up camera arcs, and return to pursuit.
- `app/scene-story.tsx`: scene-integrated chapter, encounter and discovery captions.
- `app/scene-story-motion.ts`: playback-clock text cues, projected silhouette leaders and damped caption placement.
- `app/ephemeris.ts`: validated bundled data loading, Hermite state sampling, and the shared TDB clock.
- `app/expedition-flight.ts`: continuous chapter pullback, DE440s time-lapse, and logarithmic approach; separate from spacecraft motion.
- `scripts/import-mission-context.py`: additive moon and small-body imports; existing spacecraft tracks and clocks remain untouched.
- `scripts/import-timelapse.py`: offline export of natural-body positions between mission windows.
- `scripts/ephemeris-missions.json`: explicit mission identity, quality, window and event definitions.
- `scripts/import-ephemerides.py`: cached, sequential JPL/NAIF importer and independent interpolation checks.
- `public/ephemeris/`: bundled state vectors, provenance, validation results and coverage notes.
- `app/solar-scene.tsx`: shared Three.js scene, textured bodies, camera flights, orbital interaction, and GPU resource lifecycle.
- `app/page.tsx`: chronological playback, atlas navigation, and accessible controls.
- `app/globals.css`: theme, responsive layout, and interface motion.
- `public/textures/solar/`: attributed planetary maps.
- `public/SOLAR-ASSETS.md`: source credits, licenses, and imagery limitations.

## Presentation model

Mission playback uses sourced spacecraft and natural-body states at one shared historical instant. Positions use SSB-centred ecliptic J2000 geometry and continuous TDB. The user-facing clock is UTC to the minute. All displayed planets move on that clock; no static destination is used to manufacture a gravity-assist curve. Cubic Hermite interpolation preserves both position and velocity. No extrapolation or additional force simulation is performed. Small explicitly recorded source-model seams are preserved as gaps; the clock skips them and no trail line or interpolated velocity bridges them.

Mission distances and physical radii use a uniform scale. Positions are rebased near the spacecraft before GPU conversion. Camera choreography and time compression remain editorial; spacecraft silhouettes are enlarged. Trails are in the named body's translating frame, subtracting that body's position at each historical sample. Surface maps, longitudes, atmosphere detail and craft attitude remain illustrative; axial poles are fixed at the imported window's start. The separate illustrated atlas retains an explicitly undated layout.

Quality is per chapter: tracking reconstruction, archival navigation solution, or no validated route. Missing and predicted spacecraft records are withheld. The corresponding dated natural-body scene and discovery remain accessible. Continuous encounter windows are favoured over misleading complete-looking routes. See [trajectory sources and limitations](../public/ephemeris/SOURCES.md) and the [machine-readable catalogue](../scripts/ephemeris-missions.json) for exact coverage.

The timeline orders chapters by discovery date. Individual replays may begin earlier. The welcome holds the opening scene while it prepares; choosing the human journey starts playback unless reduced motion is requested. At each imported encounter, a 14-playback-second camera interlude holds the exact historical epoch: move closer, observe, return to the pursuit pose, then resume the recorded flight. The editorial clock uses a monotone cubic easing through the source clock anchors and settles to zero speed at encounter holds. Probe pursuit maintains an inertial viewing direction through single-body flybys; discovery turns are limited so ring systems do not whirl between approach and return. The primary encounter shows the discovery narrative; other encounters use their own event labels. Chapters without a validated route use a 16-second orbital camera passage at one recorded epoch. The opening Earth and Moon views move continuously across the limb instead of zooming in, stopping, and backing out. No spacecraft route is inferred for these chapters. The belt crossing moves closer to Pioneer 10 itself, rather than inventing a discrete belt object. The next chapter begins as soon as the recorded replay finishes; its introduction starts during the outgoing shot. Only the final chapter retains a 2.5-playback-second closing hold. Pausing freezes time and camera choreography; seeking explicitly cancels the current interlude. Body labels remain hidden in mission view. Dragging or zooming pauses the historical clock for inspection, and resuming eases back to pursuit. The atlas remains explicitly undated.

The next chapter’s ephemerides and spacecraft model are prepared during playback. Chapter changes retain the outgoing view while any remaining data loads, then follow a continuous 14-second flight. The camera pulls into a Sun-centred view as calendar time accelerates, continues a gentle arc while the planets move, then closes on the next encounter as time settles. The close departure and arrival use fixed endpoint epochs; the distant view absorbs the date change without attaching the camera to a rapidly orbiting planet. Logarithmic distance changes and a modest lens widening connect the shots without a decorative camera roll. Recorded probe playback begins during the last part of the approach, with an exact moving-pose handoff. Calendar travel samples continuous DE440s states, using system barycentres for Mars through Pluto; small source-model differences are reconciled at distance. Current-epoch point markers and a persistent shaded main-belt region preserve context at uniform distance scale. Markers do not enlarge physical planetary meshes. Orbit guides fade out before camera travel and return faintly after arrival; historical transfers do not show orbital arcs. Probe routes remain hidden outside recorded windows. Pause freezes the transfer; reduced motion bypasses it. Seeking and returns from manual inspection take 1.4 seconds. Captions clear space for the moving scene and the discovery close-ups; mobile composition places the subject above the controls.

Switching to or from the illustrated atlas uses the same pullback and approach, with a short layout-and-scale morph at distance. This is identified as a change of view, not historical orbital motion. The historical scene is exact at handoff; the atlas remains undated.

## Behaviour to preserve

- Mission bodies and spacecraft share a sourced historical clock and one uniform distance scale. Camera choreography, time compression and spacecraft enlargement are editorial. Coverage gaps and withheld routes stay visible.
- The illustrated atlas is undated. Its asteroid and Kuiper fields persist across destinations when in view, and oversized rocks feather out individually. Historical playback uses a belt band and covered body states, never invented dated asteroid particles.
- Faint orbit paths fade out before departure, stay hidden in transit and return gradually after arrival. Interrupted fades stay continuous, and toggling paths works while paused.
- The welcome prepares the real scene behind the introduction and offers direct journey and atlas choices. It holds the historical opening until entry, and supports reduced motion.
- Each encounter follows the probe, reveals the discovery with a close-up, returns to pursuit and continues. The encounter epoch is held during discovery.
- Performance work should not trade away sharpness, surface and ring detail, full-quality assets or antialiasing to hide stutter. Measure frame cadence separately from screenshots or video, and note that cadence is not FPS.

## Updating ephemerides

Use a temporary Python environment with `numpy` and `spiceypy` (CSPICE N0067 or newer). The browser needs neither. Run `python scripts/import-ephemerides.py` from the repository root to generate missing bundles, or pass mission IDs to regenerate selected bundles. Source downloads and responses are cached under ignored `work/ephemeris/`; large original kernels are not committed. Commit the compact JSON exports and their provenance. The importer uses sequential requests to the official Horizons API. Review failed-window reports and never loosen validation to hide a source discontinuity.

After caching the generic kernels, run `python scripts/import-timelapse.py` to regenerate the separate 1957–2022 overview export without network requests. Its 100 km sampled interpolation tolerance applies only to the distant natural-body time-lapse. See the source notes for the planet-centre / system-barycentre distinction.

## Tests

Numerical tests cover source identities and intervals, a known analytic interpolation case, out-of-coverage rejection, every body's shared clock, pause and reverse seeking, close-approach ranges, gravity-assist velocity deflection, camera clearance and portrait/landscape framing. The importer independently checks interior states against JPL/SPICE. Interpolation thresholds do not remove source-orbit uncertainty.

Chapter-flight tests also check moving arrival poses, continuous camera movement during time advance, forward/reverse time, interrupted transfers, pause/reduced motion, and atlas handoffs. Discovery tests cover elapsed-time conservation across holds, frame-rate independence, every chapter's camera clearance and close-up framing, a fixed ephemeris epoch throughout each interlude, and completion only after returning to flight.

Numerical checks and successful compilation are not visual QA. Verify motion and controls in a real browser at desktop and mobile viewports, including reduced motion.

`tests/frame-cadence.test.mjs` covers the analysis code in `scripts/qa/analyze-cadence.mjs`, which post-processes frame-delivery traces captured in a browser with `scripts/qa/cadence-probe.js`.
