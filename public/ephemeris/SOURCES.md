# ORBIT: historical trajectories and coverage

The mission view uses geometric state vectors from JPL Horizons or the NASA/JPL NAIF SPICE archive. It does not construct transfer orbits from the positions of planets, and it does not claim to solve spacecraft dynamics. Forces, gravity assists and manoeuvres are already reflected in the source trajectory. Source quality and coverage differ by mission.

## Shared coordinates and time

- All samples use the **solar-system barycentre**, **ecliptic J2000 / ICRF orientation**, **TDB seconds past J2000**, kilometres and kilometres per second. No light-time or stellar-aberration correction is applied. These are simultaneous positions, not the delayed view through a telescope.
- A single TDB instant drives the spacecraft and every displayed natural body. Seeking, pausing and changing playback speed preserve that shared instant.
- The UTC clock is displayed to the minute. The geometry uses continuous TDB. UTC display interpolation through the leap seconds in these windows is approximate to within one second. SPICE's pre-1972 UTC convention is approximate; early snapshots should not be used for precision timing.
- Planet centres are used, including Pluto's centre rather than the Pluto–Charon barycentre. Mercury's barycentre is its centre because it has no natural satellites.
- Generic natural-body states come from DE440s and Horizons. Where a mission SPK contains matching target, planet and Sun ephemerides, those take precedence. Individual JSON files preserve the actual target IDs, query output headers, kernel hashes and validation results.

## What is visualised

Distances and equatorial body radii share a uniform scale in mission view. Coordinates are rebased near the spacecraft before sending them to the renderer. Body shapes, atmospheres and surface textures remain illustrative; these are not historical weather, spacecraft camera images or terrain reconstructions. Planetary poles use the IAU model at the start of each imported window. Surface longitudes and spacecraft attitude are not reconstructed.

The camera and playback rate are editorial. The probe silhouette is enlarged. The path is **relative to the named body**: each historical probe position has that body's position at the same historical instant subtracted, and the resulting line is placed around the body's current position. It is not a heliocentric path superimposed on a stationary planet. Other planets continue to use the shared clock.

The separate **Solar atlas** retains its illustrated, undated layout. Uninvolved moons without data in a long replay are hidden. Asteroid and Kuiper-belt particles are hidden in mission view: they are not individually tracked objects.

## Flights between chapters

The camera follows a continuous arc away from the current point of interest and into the next recorded scene, with calendar advance overlapping the travel. Moving planetary-system anchors guide the camera; there is no stationary wide-shot intermission. This connecting flight is editorial camera motion, not a claim that either spacecraft flew between those chapters. The outgoing view remains visible while the next record loads. During the final approach, the incoming probe can already move within its recorded window; camera and bodies hand off at that same historical epoch. Encounter seeking also advances the shared clock continuously.

At imported encounter anchors, camera close-ups explicitly **hold the historical clock** before returning to the pursuit pose and resuming the data. These holds are not physical spacecraft loitering, orbit insertions, or extended ephemeris coverage. World close-ups and the enlarged Pioneer 10 portrait at the belt crossing are editorial views. Unavailable spacecraft trajectories remain withheld, including during these close-ups.

The wide time-lapse samples a separate [DE440s export](timelapse.json) covering 1957–2022, with simultaneous geometric states in the same SSB / ECLIPJ2000 / TDB frame. Mercury, Venus and Earth use planet centres; Mars through Pluto use **planetary-system barycentres** in this distant view. Moons, the comet and spacecraft are omitted during the calendar advance. Small offsets between the overview model and each mission's matched planet-centre solution are reconciled while the camera is fully pulled back; the close views keep their original matched states. Compact markers exaggerate visibility, not orbital distances. Short arcs show actual historical planetary states before the displayed date; they are not probe transfer paths.

`scripts/import-timelapse.py` generates this export from the same cached official DE440s and leap-second kernels. It preserves the source hash and target IDs and checks independent quarter, half and three-quarter interval samples against SPICE to a 100 km interpolation tolerance suitable for the wide view. The UTC date during the years-long transition is interpolated between chapter anchors; it is a calendar display, not precision UTC-to-TDB conversion. Encounter geometry and clocks retain their tighter original validation.

## Record quality

**Tracking reconstruction**: a post-flight orbit solution fitted to tracking observations. This is the best available model used here, not an assertion of perfect truth.

**Archival navigation solution**: a historical JPL solution with documented precision or provenance limitations. Old dynamical models can differ from modern planetary positions by kilometres. Interpolation accuracy does not remove that uncertainty.

**No validated route**: a dated natural-body scene is shown, and the spacecraft flight is withheld. A prediction, another spacecraft or a launch stage is never silently substituted.

## Imported mission windows

The machine-readable [catalogue](index.json) gives the exact imported UTC window, event anchors and source notes. Each mission JSON contains its own state vectors and provenance.

- **Sputnik 1, Luna 3 and Mariner 4:** no validated spacecraft state-vector record was imported. Dated natural-body scenes only.
- **Mariner 2:** the Venus encounter portion of JPL's `m2_620827_621231_ja_v1` reconstruction. This was fitted to printed Doppler tracking data with DE405. Solar pressure was modelled; outgassing was not. The loosely constrained pre-correction departure is excluded.
- **Apollo 11:** no validated Eagle descent trajectory was imported. Horizons' `-399110` is Apollo 11's discarded S-IVB rocket stage, not the command or lunar module; it is explicitly excluded.
- **Pioneer 10 and 11:** Horizons' archived JPL navigation solutions. Their regeneration circumstances are not fully known. Continuous validated intervals only; check the catalogue for the included windows.
- **Mariner 10:** [M10_archive_1.bsp](https://naif.jpl.nasa.gov/pub/naif/M10/kernels/spk/M10_archive_1.bsp), NAIF ID `-76`, with the bundled DE125 Mercury solution. NAIF describes probable reprocessing of tracking data but could not establish all details. The imported 18:00–23:00 UTC Mercury encounter on 29 March 1974 avoids a detected archive discontinuity near 17:36:59 UTC. It does not include the earlier Venus assist.
- **Voyager 2 at Uranus:** [vgr2.ura182.bsp](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/vgr2.ura182.bsp), paired with URA182 and DE442. This is the trajectory used in the radiometric and optical data analysis.
- **Voyager 2 at Neptune:** [vgr2_nep097.bsp](https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/vgr2_nep097.bsp), paired with NEP097 and DE440. The older pre-August-1989 Horizons Voyager trajectory is a patched-conic mission design; it is not used as a tracking reconstruction.
- **Cassini:** [200128RU_SCPSE_04182_04251.bsp](https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/spk/200128RU_SCPSE_04182_04251.bsp), the definitive uniform reconstruction with matching SAT427 and locally corrected DE437 planet positions. The imported window begins at 18:00 UTC on 30 June 2004 and includes the Saturn orbit-insertion burn. [NASA arrival account](https://science.nasa.gov/learn/basics-of-space-flight/soi/).
- **Huygens:** Horizons explicitly describes its descent record as a prediction, not the actual descent. It is excluded. Titan is shown on the landing date.
- **Philae:** the lander's descent and rebounds are not imported. The comet uses the Rosetta mission's archived `1000012` ephemeris. No invented landing path is shown. [ESA reconstruction](https://www.esa.int/ESA_Multimedia/Images/2015/04/Reconstructing_Philae_s_trajectory).
- **New Horizons:** the PDS archive’s bundled `nh_recon_pluto_od122_v01.bsp`, including the matching OD122 DE433 and PLU047 solutions. The archive explicitly requires spacecraft and Pluto-system states to be used as a set; a newer generic Pluto solution must not be silently substituted. The post-flight [PDS mission overview](https://pdssbn.astro.umd.edu/holdings/pds4-nh_documents-v4.2/mission/documents/nh_mission_overview.pdf) places closest approach at 11:48:28.771 UTC, 13,674 km from Pluto’s modelled centre; this is the timing and range checked here. The earlier Jupiter cruise is outside the imported window. [PDS record](https://naif.jpl.nasa.gov/pub/naif/pds/data/nh-j_p_ss-spice-6-v1.0/nhsp_1000/data/spk/nh_recon_pluto_od122_v01.lbl). [NASA mission record](https://science.nasa.gov/mission/new-horizons/).
- **Parker Solar Probe:** the post-launch tracking fit covering the February 2021 Venus assist and April 2021 solar passage. [NASA Venus encounter account](https://science.nasa.gov/blogs/parker-solar-probe/2021/02/19/parker-solar-probe-primed-for-fourth-venus-flyby/). The 09:33–14:42 UT sub-Alfvénic interval on 28 April follows the published measurement interval in [Huang et al., 2023, footnote 13](https://ntrs.nasa.gov/api/citations/20230004343/downloads/Huang_2023_ApJS_265_47.pdf). This is an observed plasma boundary, not the solar surface or a spherical shell added to the scene.

## Sampling and checks

The offline importer preserves position and velocity and adaptively subdivides intervals until cubic Hermite interpolation agrees with independently queried quarter, midpoint and three-quarter states. The limits are 1 km for reconstructed spacecraft, 10 km for archival spacecraft and 5 km for natural bodies. These are sampled interpolation checks, **not orbit uncertainties or a mathematical maximum-error guarantee**. An unresolved discontinuity rejects the interval rather than smoothing it into a fictional manoeuvre. The Parker record explicitly permits source-model jumps up to 5 km: these are preserved as marked sub-second gaps in the data, clock and path, and excluded from interpolation. No artificial burn or velocity is fitted across them. Their exact bounds and measured offsets are exported as `seams`; they are not physical jumps made by the spacecraft. Sample requests outside bundled coverage fail instead of extrapolating.

Regression checks compare centre distances at close approach against independently published mission figures, check that relative velocity changes across gravity assists, check synchronized natural-body motion, exercise forward/reverse seeking and pause, and check camera clearance and framing numerically. They do not constitute visual browser QA.

## Primary technical references

- [JPL Horizons manual — spacecraft and accuracy limitations](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [JPL Horizons API specification](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [NAIF SPK required reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
- [DE440s planetary ephemeris](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp)
- [NAIF leap-second kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls)
- [IAU planetary constants / poles](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)
- [NASA Voyager planetary encounters](https://science.nasa.gov/mission/voyager/planetary-voyage/)
- [NASA Mariner 10 encounter](https://science.nasa.gov/mission/mariner-10/)

The original imagery credits remain in [SOLAR-ASSETS.md](../SOLAR-ASSETS.md).

## Additional moon systems and belt context · 10 September 2026

`import-mission-context.py` adds natural-body tracks without changing existing spacecraft samples, event times, clocks or source windows. Mars gains Phobos/Deimos; Jupiter gains Io/Ganymede/Callisto; Saturn gains Mimas/Enceladus/Tethys/Dione/Rhea/Iapetus; Uranus gains its five major moons; Neptune gains Triton; Pluto gains Charon. Ceres and Vesta are available in the Pioneer 10 belt chapter.

Tracks use the mission's matching SPICE kernels when covered and geometric Horizons vectors otherwise, at the same barycentric ECLIPJ2000/TDB times as the spacecraft. Each added track records its provider/target, sample coverage and independent interpolation residual in the bundle; maximum tested position residual is below 5 km. These are interpolation checks, not claims about the absolute accuracy of an old reconstructed orbit. Single-instant chapters retain single-instant natural-body states. Missing coverage remains hidden.

Physical ellipsoid axes use NAIF `pck00011.tpc`. Atlas orbital periods are rounded [JPL satellite mean-element periods](https://ssd.jpl.nasa.gov/sats/elem/); those table elements do not drive playback. Surface mosaics and longitude are illustrative and not synchronized observations.


The Pioneer 10 belt chapter includes a sparse, stippled **region annotation** at approximately 2.2–3.2 AU from the Sun ([NASA Dawn FAQ](https://science.nasa.gov/mission/dawn/faq/)). Its fixed map pattern and faint underlying wash mark geographic extent; the stipples are not asteroid positions, measured density or individual orbits. The guide has no physical opacity or wall, and NASA describes the belt as mostly empty space. Marks feather below the screen's resolving scale instead of becoming a continuous surface. The same annotation follows the Sun and blends into the separate atlas scale without introducing historical motion. Ceres/Vesta markers use their imported dated positions. Other covered natural bodies receive subtle enlarged markers when their physical disks are sub-pixel. The atlas particle belts are illustrative and hidden in historical playback.
