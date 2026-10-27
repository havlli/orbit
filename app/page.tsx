'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  CHAPTER_HANDOFF_SECONDS,
  DISCOVERY_DWELL_SECONDS,
} from './mission-journeys';
import { missionRecords } from './ephemeris';
import SceneStory from './scene-story';
import ReadingChapter from './reading-chapter';
import TransferCaption from './transfer-caption';
import ExplorationTabs from './exploration-tabs';
import DeferredAtlasControls from './deferred-atlas-controls';
import ExpeditionWelcome, {
  type EntryMode,
  type ScenePreparation,
} from './expedition-welcome';
import type { ReadingArea } from './path-presentation';
import {
  closingCue,
  transferCue,
  type StoryBinding,
} from './scene-story-motion';
import {
  ArrowUpRight,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  Maximize,
  Minimize,
  Orbit,
  Map,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Navigation,
  LocateFixed,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import SolarScene, {
  type FlightRequest,
  type FlightTelemetry,
  type SolarController,
} from './solar-scene';
import {
  bodies,
  bodyById,
  milestones,
  type BodyId,
  type Destination,
} from './solar-data';

const initial: FlightTelemetry = {
  phase: 'travel',
  progress: 0,
  ready: false,
  destination: 'earth',
  missionIndex: 0,
  missionPhase: 'departure',
  distance: 300,
};
export default function Home() {
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [entryChoice, setEntryChoice] = useState<EntryMode | null>(null);
  const [preparation, setPreparation] = useState<ScenePreparation>({
    status: 'loading',
    progress: 0,
  });
  const [request, setRequest] = useState<FlightRequest>({
    destination: 'earth',
    serial: 0,
    missionIndex: 0,
  });
  const [mode, setMode] = useState<'story' | 'atlas'>('story');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [motion, setMotion] = useState(true);
  const [paths, setPaths] = useState(true);
  const [labels, setLabels] = useState(false);
  const [clean, setClean] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [feature, setFeature] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [atlasNotesOpen, setAtlasNotesOpen] = useState(false);
  const [atlasNotesMaterialized, setAtlasNotesMaterialized] = useState<
    string | null
  >(null);
  const [telemetry, setTelemetry] = useState(initial);
  const [dwell, setDwell] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const readingMode = preparation.status === 'fallback';
  const onPreparation = useCallback((value: ScenePreparation) => {
    setPreparation(value);
    if (value.status === 'fallback') {
      setPlaying(false);
      setHeld(true);
      setClean(false);
      setBriefingOpen(false);
    }
  }, []);
  const controller = useRef<SolarController | null>(null);
  const storyBinding = useRef<StoryBinding | null>(null);
  const transferReading = useRef<ReadingArea | null>(null);
  const onTransferReading = useCallback((area: ReadingArea | null) => {
    transferReading.current = area;
  }, []);
  const onStoryBinding = useCallback((binding: StoryBinding | null) => {
    storyBinding.current = binding;
  }, []);
  const timeline = useRef<HTMLDivElement>(null);
  const atlasHeading = useRef<HTMLHeadingElement>(null);
  const atlasFeatureAction = useRef<HTMLButtonElement>(null);
  const pendingAtlasFocus = useRef<'heading' | 'feature' | null>(null);
  const latest = useRef({ step, playing, mode, request, telemetry });
  // oxlint-disable-next-line react/react-compiler -- Keep the latest playback snapshot available to imperative callbacks.
  latest.current = { step, playing, mode, request, telemetry };
  const serial = useRef(0);
  const dwellRef = useRef(0);
  const onTelemetry = useCallback((value: FlightTelemetry) => {
    setTelemetry(value);
  }, []);
  const issueFlight = useCallback(
    (
      destination: Destination,
      view?: string,
      missionIndex?: number,
      continuation = false,
    ) => {
      setFeature(!!view);
      setBriefingOpen(false);
      setAtlasNotesOpen(false);
      setRequest({
        destination,
        feature: view,
        missionIndex,
        continuation,
        serial: ++serial.current,
      });
      setHeld(false);
      dwellRef.current = 0;
      setDwell(0);
    },
    [],
  );
  const chooseEntry = useCallback(
    (choice: EntryMode) => {
      setEntryChoice(choice);
      setPlaying(choice === 'story' && !reduced && !readingMode);
      setHeld(choice === 'story' && reduced);
      if (choice === 'atlas') {
        setMode('atlas');
        setStep(-1);
        setTelemetry({
          ...initial,
          destination: 'overview',
          missionIndex: undefined,
        });
      }
    },
    [reduced, readingMode],
  );
  useEffect(() => {
    if (!welcomeOpen || entryChoice !== 'atlas') return;
    // Cover the prepared Earth portrait before composing the atlas overview.
    const transfer = window.setTimeout(
      () => {
        setRequest({
          destination: 'overview',
          entrance: true,
          serial: ++serial.current,
        });
      },
      reduced ? 0 : 360,
    );
    return () => clearTimeout(transfer);
  }, [welcomeOpen, entryChoice, reduced]);
  const entryReady =
    preparation.status === 'fallback' ||
    (preparation.status === 'ready' &&
      telemetry.ready &&
      (entryChoice === 'atlas'
        ? telemetry.destination === 'overview'
        : telemetry.missionIndex === 0));
  const welcomeLeaving = welcomeOpen && entryChoice !== null && entryReady;
  useEffect(() => {
    if (!welcomeLeaving) return;
    const reveal = window.setTimeout(
      () => {
        setWelcomeOpen(false);
      },
      reduced ? 0 : 1200,
    );
    return () => clearTimeout(reveal);
  }, [welcomeLeaving, reduced]);
  useEffect(() => {
    if (!welcomeOpen)
      document
        .querySelector<HTMLElement>('.solar-experience')
        ?.focus({ preventScroll: true });
  }, [welcomeOpen]);
  const goStep = useCallback(
    (index: number, auto = true, continuation = false) => {
      const next = Math.max(0, Math.min(milestones.length - 1, index));
      const m = milestones[next];
      const autoplay = auto && !reduced && !readingMode;
      setMode('story');
      setStep(next);
      setPlaying(autoplay);
      issueFlight(m.body, m.view, next, continuation);
      setHeld(!autoplay);
    },
    [issueFlight, reduced, readingMode],
  );
  const selectBody = useCallback(
    (id: BodyId) => {
      setPlaying(false);
      setMode('atlas');
      issueFlight(id);
    },
    [issueFlight],
  );
  const overview = useCallback(() => {
    setPlaying(false);
    setMode('atlas');
    issueFlight('overview');
  }, [issueFlight]);
  const interact = useCallback(() => {
    setPlaying(false);
    if (latest.current.request.missionIndex !== undefined) {
      setHeld(true);
      return;
    }
    setHeld(false);
    setMode('atlas');
    setRequest((current) => ({ ...current, missionIndex: undefined }));
  }, []);
  const play = useCallback(() => {
    if (readingMode) return;
    if (latest.current.playing) {
      setPlaying(false);
      setHeld(true);
      return;
    }
    if (
      latest.current.step < 0 ||
      latest.current.mode === 'atlas' ||
      (latest.current.step === milestones.length - 1 &&
        dwellRef.current >= DISCOVERY_DWELL_SECONDS)
    ) {
      goStep(0, true);
    } else {
      setPlaying(true);
      setHeld(false);
    }
  }, [goStep, readingMode]);
  const atlasDestinations = useCallback(
    (strip: HTMLDivElement | null) => {
      if (!strip || mode !== 'atlas' || request.destination === 'overview')
        return;
      const selected = bodyById[request.destination];
      const card = strip.querySelector<HTMLElement>(
        `[data-destination="${selected.parent ?? selected.id}"]`,
      );
      if (!card) return;
      const reveal = () => {
        const bounds = strip.getBoundingClientRect();
        const item = card.getBoundingClientRect();
        if (item.left >= bounds.left && item.right <= bounds.right) return;
        strip.scrollTo({
          left:
            strip.scrollLeft +
            item.left -
            bounds.left -
            (strip.clientWidth - item.width) / 2,
          behavior: reduced ? 'instant' : 'smooth',
        });
      };
      const observer = new ResizeObserver(reveal);
      observer.observe(strip);
      return () => observer.disconnect();
    },
    [mode, request.destination, reduced],
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const compact = matchMedia('(max-width: 760px)');
    const update = () => {
      setReduced(media.matches);
      setMotion(!media.matches);
      if (media.matches) {
        setPlaying(false);
        setHeld(true);
      }
    };
    update();
    media.addEventListener('change', update);
    const updateViewport = (event?: MediaQueryListEvent) => {
      if (event?.matches) {
        const current = latest.current;
        if (
          current.mode === 'atlas' &&
          current.request.destination !== 'overview'
        )
          setAtlasNotesMaterialized(
            `${current.mode}-${current.request.serial}`,
          );
      }
      setCompactViewport(compact.matches);
    };
    updateViewport();
    compact.addEventListener('change', updateViewport);
    const fs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fs);
    return () => {
      media.removeEventListener('change', update);
      compact.removeEventListener('change', updateViewport);
      document.removeEventListener('fullscreenchange', fs);
    };
  }, []);
  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(),
        delta = Math.min((now - last) / 1000, 0.25);
      last = now;
      const l = latest.current;
      if (
        !l.playing ||
        !l.telemetry.ready ||
        l.telemetry.phase !== 'orbit' ||
        !l.telemetry.chapterComplete ||
        l.telemetry.missionIndex !== l.step ||
        document.hidden
      )
        return;
      dwellRef.current += delta * speed;
      const hold =
        l.step === milestones.length - 1
          ? DISCOVERY_DWELL_SECONDS
          : CHAPTER_HANDOFF_SECONDS;
      setDwell(Math.min(dwellRef.current / hold, 1));
      if (dwellRef.current >= hold) {
        if (l.step < milestones.length - 1) goStep(l.step + 1, true, true);
        else {
          setPlaying(false);
          setHeld(false);
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [speed, goStep]);
  useEffect(() => {
    const strip = timeline.current;
    const stop = strip?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (step >= 0 && strip && stop)
      strip.scrollTo({
        left:
          strip.scrollLeft +
          stop.getBoundingClientRect().left -
          strip.getBoundingClientRect().left -
          (strip.clientWidth - stop.offsetWidth) / 2,
        behavior: reduced ? 'instant' : 'smooth',
      });
  }, [step, mode, reduced]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (welcomeOpen) return;
      if (e.key === 'Escape') {
        setClean(false);
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(
          'button,a[href],input,textarea,select,[contenteditable],[role=slider],[role=dialog]',
        )
      )
        return;
      if (latest.current.mode !== 'story') return;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
      }
      if (e.target instanceof HTMLCanvasElement) return;
      if (e.key === 'ArrowRight') goStep(Math.max(0, latest.current.step + 1));
      if (e.key === 'ArrowLeft') goStep(Math.max(0, latest.current.step - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [play, goStep, welcomeOpen]);
  const body =
    request.destination === 'overview' ? null : bodyById[request.destination];
  const milestone = mode === 'story' && step >= 0 ? milestones[step] : null;
  const journey = milestone?.journey;
  const record = milestone ? missionRecords[step] : null;
  const hasTrajectory = !!record && record.quality !== 'unavailable';
  const activeMission = !readingMode && telemetry.missionIndex === step;
  const transferring =
    !readingMode && !!telemetry.chapterTransfer && !!telemetry.transition;
  const closing =
    activeMission && playing && !transferring && step < milestones.length - 1
      ? (telemetry.closingProgress ?? 0)
      : 0;
  const preparingHandoff =
    !readingMode &&
    !!request.continuation &&
    (!activeMission || !telemetry.ready);
  const bridgeVisible = transferring || closing > 0 || preparingHandoff;
  const bridgeMission = closing > 0 ? milestones[step + 1] : milestone;
  const arrivalBody =
    milestone?.body === 'belt'
      ? bodyById.belt
      : activeMission && journey && telemetry.focus
        ? bodyById[telemetry.focus]
        : body;
  const transitionLabel =
    telemetry.transition === 'departing'
      ? 'Leaving the encounter'
      : telemetry.transition === 'arriving'
        ? `Approaching ${arrivalBody?.name ?? 'the next encounter'}`
        : milestone
          ? telemetry.transitionClock
            ? 'Advancing through time'
            : 'Settling into the historical view'
          : 'Opening the illustrated atlas';
  const handoff = transferCue(
    telemetry.transitionProgress ?? 0,
    reduced || !playing,
    request.continuation,
  );
  const closingText = closingCue(closing);
  const bridgePresence =
    closing > 0
      ? closingText.bridge
      : preparingHandoff
        ? 1
        : bridgeVisible
          ? handoff.presence
          : 0;
  const missionProgress = activeMission ? telemetry.progress : 0;
  const discoveryBeat = activeMission ? telemetry.discovery : undefined;
  const finalDiscoveryReached =
    step === milestones.length - 1 &&
    activeMission &&
    !transferring &&
    missionProgress >= (telemetry.events?.at(-1)?.progress ?? 1);
  const observing = !!discoveryBeat;
  const discovered =
    !!journey &&
    activeMission &&
    !transferring &&
    (discoveryBeat?.primary || telemetry.missionPhase === 'discovery');
  const flightDate = readingMode
    ? (milestone?.year ?? '')
    : activeMission && telemetry.utc
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          ...(record?.datePrecision === 'day'
            ? {}
            : { hour: '2-digit' as const, minute: '2-digit' as const }),
          hourCycle: 'h23',
          timeZone: 'UTC',
        }).format(new Date(telemetry.utc)) + ' UTC'
      : record
        ? 'Loading historical positions…'
        : '';
  const focusName = telemetry.focus ? bodyById[telemetry.focus].name : '';
  const trajectorySource = record?.kernel
    ? `https://naif.jpl.nasa.gov/pub/naif/${record.kernel.slice(0, record.kernel.lastIndexOf('/') + 1)}`
    : 'https://ssd.jpl.nasa.gov/horizons/manual.html#spacecraft';
  const seekMission = (progress: number) => {
    controller.current?.seekMission(progress);
    dwellRef.current = 0;
    setDwell(0);
  };
  const showDiscovery = () => {
    // Approach the encounter from just before its timestamp, so playback
    // performs the reveal and return instead of marking that shot as visited.
    seekMission(Math.max(0, (telemetry.events?.at(-1)?.progress ?? 1) - 1e-6));
    setBriefingOpen(false);
    setPlaying(true);
    setHeld(false);
  };
  const title =
    feature && body && !milestone
      ? body.feature
      : journey
        ? discovered || !hasTrajectory
          ? journey.discoveryTitle
          : milestone!.title
        : (body?.name ??
          (mode === 'atlas'
            ? 'Choose your\nnext world.'
            : 'Follow the explorers.'));
  const description =
    feature && body && !milestone
      ? body.featureText
      : journey
        ? discovered
          ? journey.discoveryText
          : hasTrajectory
            ? milestone!.text
            : journey.discoveryText
        : (body?.description ??
          (mode === 'atlas'
            ? 'Explore the planets, their moons and the smaller worlds between them. Choose a destination, or start with Earth.'
            : 'Follow the spacecraft that changed our view of the solar system, from the first satellite to encounters with distant worlds.'));
  const related = body
    ? bodies.filter(
        (b) =>
          b.parent === body.id ||
          b.id === body.parent ||
          b.region === body.id ||
          b.id === body.region,
      )
    : [];
  const source = journey?.source ?? body?.source;
  const atlasNotesIdentity = `${mode}-${request.serial}`;
  const atlasNotesVisible = readingMode || !compactViewport || atlasNotesOpen;
  const renderAtlasNotes =
    atlasNotesVisible || atlasNotesMaterialized === atlasNotesIdentity;
  useEffect(() => {
    const target = pendingAtlasFocus.current;
    if (!target || transferring || clean) return;
    pendingAtlasFocus.current = null;
    if (mode !== 'atlas' || document.activeElement !== document.body) return;
    (target === 'feature' ? atlasFeatureAction : atlasHeading).current?.focus({
      preventScroll: true,
    });
  }, [mode, request.destination, feature, transferring, clean]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };
  const header = useMemo(
    () => (
      <header className="masthead ui-chrome" inert={clean}>
        <button
          className="brand"
          onClick={overview}
          aria-label="Return to the solar-system overview"
        >
          <Orbit size={27} strokeWidth={1.2} />
          <span>
            orbit<span className="brand-dot">.</span>
          </span>
        </button>
        <ExplorationTabs
          value={mode}
          onValueChange={(value) => {
            setAtlasNotesOpen(false);
            if (value === 'story') {
              goStep(Math.max(0, step));
            } else {
              setMode('atlas');
              setPlaying(false);
              setHeld(false);
              if (request.missionIndex !== undefined)
                issueFlight(request.destination);
            }
          }}
        />
        <Dialog>
          <DialogTrigger className="source-trigger">
            About & sources <ArrowUpRight size={15} />
          </DialogTrigger>
          <DialogContent
            className="source-dialog"
            initialFocus={() => document.getElementById('about-title')}
          >
            <div className="source-dialog-body">
              <DialogTitle id="about-title" tabIndex={-1}>
                About this expedition
              </DialogTitle>
              <DialogDescription>
                ORBIT follows selected milestones in humanity’s exploration of
                the solar system, from Sputnik in 1957 to Parker Solar Probe’s
                first crossing into the corona in 2021.
              </DialogDescription>
              <p>
                Encounters appear in date order. When trajectory data is
                available, a chapter replays its recorded flight window. The
                clock may move back to an earlier departure when a new chapter
                begins.
              </p>
              <p>
                Spacecraft and worlds share the same historical time and
                distance scale. Camera views and playback speed are chosen for
                the presentation. Spacecraft are enlarged so you can see them,
                and their orientation is illustrative. Flight paths follow the
                motion relative to the body named onscreen.
              </p>
              <p>
                Some routes come from later reconstructions or older navigation
                records. Each chapter explains its coverage and only plays
                supported intervals. Where a validated route is unavailable, a
                dated world view takes its place. Bodies without covered
                positions are hidden. Older records retain their original
                uncertainties.
              </p>
              <p>
                The Solar atlas is illustrated and undated, with sizes and
                spacing arranged for exploration. Its star background uses fixed
                J2000 directions and brightness adjusted for visibility. Stellar
                motion and apparent-sky corrections are not simulated. Surface
                maps do not reproduce historical weather, and poles stay fixed
                within each chapter.
              </p>
              <p>
                Drag or zoom to pause and inspect the historical scene. Play
                resumes following the probe. Space plays or pauses the story.
                Use the timeline to jump between encounters, and Solar atlas to
                visit any destination.
              </p>
              <div className="source-links">
                <a href="/sky/SOURCES.md" target="_blank" rel="noreferrer">
                  Celestial sky · Yale & NASA/Goddard SVS{' '}
                  <ArrowUpRight size={16} />
                </a>
                <a
                  href="/ephemeris/SOURCES.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Trajectory sources & coverage <ArrowUpRight size={16} />
                </a>
                {journey && (
                  <a
                    href={journey.routeSource ?? journey.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Current flight chronology <ArrowUpRight size={16} />
                  </a>
                )}
                <a
                  href="https://science.nasa.gov/deep-space-exploration/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Mission chronology · NASA <ArrowUpRight size={16} />
                </a>
                <a
                  href="https://www.solarsystemscope.com/textures/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Planet textures · Solar System Scope / INOVE{' '}
                  <ArrowUpRight size={16} />
                </a>
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 4.0 · textures mapped and relit{' '}
                  <ArrowUpRight size={16} />
                </a>
                <a
                  href="https://science.nasa.gov/resource/pluto-global-color-map/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Pluto mosaic · NASA/JHUAPL/SwRI <ArrowUpRight size={16} />
                </a>
                <a href="/models/README.md" target="_blank" rel="noreferrer">
                  Spacecraft models · NASA <ArrowUpRight size={16} />
                </a>
                <a href="/SOLAR-ASSETS.md" target="_blank" rel="noreferrer">
                  Image credits and coverage notes <ArrowUpRight size={16} />
                </a>
              </div>
              <p className="source-footnote">
                Visualization textures include color enhancement. Titan’s haze
                and the comet are schematic. Black regions in moon and
                dwarf-planet maps are imagery gaps. Unmapped moons use plain
                ellipsoids.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </header>
    ),
    [mode, step, request, journey, clean, overview, goStep, issueFlight],
  );
  const navigation = useMemo(
    () => (
      <section
        className="journey-console ui-chrome"
        inert={clean}
        aria-label={
          mode === 'story' ? 'Mission timeline' : 'Solar-system destinations'
        }
      >
        <div className="console-heading">
          <div>
            <p className="eyebrow">
              {mode === 'story' ? 'THE HUMAN JOURNEY' : 'CHOOSE A DESTINATION'}
            </p>
            <p>
              {mode === 'story'
                ? 'Choose a chapter or play the expedition.'
                : 'Planets, moons and small bodies.'}
            </p>
          </div>
          {mode === 'story' ? (
            <div className="playback">
              <button
                aria-label="Previous encounter"
                onClick={() => goStep(Math.max(0, step - 1))}
                disabled={step <= 0}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className={`play-button ${playing ? 'playing' : ''}`}
                onClick={play}
                disabled={!telemetry.ready}
                hidden={readingMode}
              >
                {playing ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
                {playing
                  ? 'Pause journey'
                  : step < 0
                    ? 'Play the journey'
                    : step === milestones.length - 1 && dwell >= 1
                      ? 'Replay journey'
                      : 'Continue journey'}
              </button>
              <button
                aria-label="Next encounter"
                onClick={() =>
                  goStep(Math.min(milestones.length - 1, step + 1))
                }
                disabled={step === milestones.length - 1}
              >
                <ChevronRight size={18} />
              </button>
              <button
                className="speed-button"
                hidden={readingMode}
                onClick={() =>
                  setSpeed((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))
                }
                aria-label={`Playback speed ${speed} times. Change speed.`}
              >
                {speed}×
              </button>
            </div>
          ) : (
            <button className="atlas-overview" onClick={overview}>
              <Navigation size={16} /> View the whole system
            </button>
          )}
        </div>
        {mode === 'story' && (
          <>
            <Slider
              className="journey-slider"
              aria-label="Mission chronology"
              min={0}
              max={milestones.length - 1}
              step={1}
              value={[Math.max(0, step)]}
              onValueChange={(value) =>
                goStep(Array.isArray(value) ? value[0] : value)
              }
              aria-valuetext={`${milestones[Math.max(0, step)].year}: ${milestones[Math.max(0, step)].mission}`}
            />
            <div className="timeline-window" ref={timeline}>
              {milestones.map((m, i) => (
                <button
                  data-step={i}
                  key={`${m.year}-${m.mission}-${m.body}`}
                  className={`timeline-stop ${step === i ? 'active' : ''} ${i < step ? 'past' : ''}`}
                  onClick={() => goStep(i)}
                  aria-label={`${m.year} · ${m.mission} · ${bodyById[m.body].name}`}
                  aria-current={step === i ? 'step' : undefined}
                >
                  <span className="timeline-point" />
                  <span className="timeline-year">
                    {m.year}
                    <span className="timeline-destination">
                      {m.body === 'belt'
                        ? 'Belt'
                        : bodyById[m.body].name.replace(/^The /, '')}
                    </span>
                  </span>
                  <span className="timeline-mission">{m.mission}</span>
                  <span className="timeline-body">{bodyById[m.body].name}</span>
                  {step === i && (
                    <span
                      className="dwell-bar"
                      style={{ transform: `scaleX(${dwell})` }}
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="timeline-foot">
              <span>
                1957 <span>→</span> 2021
              </span>
              <span>
                SELECT AN ENCOUNTER OR PRESS PLAY · EVENT SPACING IS NOT LINEAR
              </span>
            </div>
          </>
        )}
        <DeferredAtlasControls active={mode === 'atlas'}>
          {mode === 'atlas' && (
            <div className="atlas-strip" ref={atlasDestinations}>
              {bodies
                .filter((b) => !b.parent)
                .map((b) => {
                  const moonCount = bodies.filter(
                    (moon) => moon.parent === b.id,
                  ).length;
                  const moonLabel = `${moonCount} ${moonCount === 1 ? 'moon' : 'moons'}`;
                  const current = (body?.parent ?? body?.id) === b.id;
                  return (
                    <button
                      key={b.id}
                      data-destination={b.id}
                      className={current ? 'active' : ''}
                      onClick={() => selectBody(b.id)}
                      aria-current={current ? 'location' : undefined}
                      aria-label={
                        moonCount
                          ? `${b.name}, ${moonLabel} in this atlas`
                          : undefined
                      }
                    >
                      <span
                        className="atlas-dot"
                        style={{ background: b.color }}
                      />
                      <span>{b.name}</span>
                      <small>
                        {moonCount
                          ? `${moonLabel.toUpperCase()} SHOWN`
                          : b.id === 'sun'
                            ? 'STAR'
                            : b.au + ' AU'}
                      </small>
                    </button>
                  );
                })}
            </div>
          )}
        </DeferredAtlasControls>
      </section>
    ),
    [
      mode,
      step,
      playing,
      telemetry.ready,
      speed,
      dwell,
      body,
      clean,
      goStep,
      play,
      overview,
      selectBody,
      readingMode,
      atlasDestinations,
    ],
  );
  const footer = useMemo(
    () => (
      <footer className="bottom-bar ui-chrome" inert={clean}>
        <span>
          {readingMode ? (
            'READING MODE'
          ) : compactViewport ? (
            <>
              DRAG TO LOOK <b>·</b> PINCH TO ZOOM
            </>
          ) : (
            <>
              DRAG TO ORBIT <b>·</b> SCROLL TO ZOOM
            </>
          )}
        </span>
        {!readingMode && (
          <div>
            <label>
              <Switch checked={paths} onCheckedChange={setPaths} size="sm" />{' '}
              {mode === 'atlas' ? 'Orbit paths' : 'Flight path'}
            </label>
            <DeferredAtlasControls active={mode === 'atlas'}>
              {mode === 'atlas' && (
                <>
                  <label>
                    <Switch
                      checked={labels}
                      onCheckedChange={setLabels}
                      size="sm"
                    />{' '}
                    Atlas labels
                  </label>
                  <button
                    className="motion-toggle"
                    onClick={() => setMotion(!motion)}
                    aria-pressed={motion}
                    aria-label="Auto orbit"
                  >
                    {motion ? <Pause size={13} /> : <Play size={13} />} Auto
                    orbit
                  </button>
                </>
              )}
            </DeferredAtlasControls>
          </div>
        )}
        <span className="scale-note">
          {readingMode
            ? mode === 'story'
              ? 'CHOOSE A CHAPTER TO READ'
              : 'CHOOSE A WORLD TO READ'
            : milestone
              ? 'HISTORICAL POSITIONS · COMPRESSED TIME'
              : 'ILLUSTRATED ATLAS · UNDATED POSITIONS'}
        </span>
      </footer>
    ),
    [
      paths,
      labels,
      motion,
      milestone,
      clean,
      mode,
      readingMode,
      compactViewport,
    ],
  );
  return (
    <main
      tabIndex={-1}
      aria-label="ORBIT solar system expedition"
      className={`solar-experience ${milestone ? 'mission-view' : body ? 'atlas-view' : 'intro-view'} ${transferring ? 'transfer-view' : ''} ${observing ? 'observing-view' : ''} ${clean ? 'clean-view' : ''} ${readingMode ? 'reading-mode' : ''}`}
    >
      <SolarScene
        request={request}
        motion={motion}
        flightPaused={welcomeOpen || held}
        speed={speed}
        paths={paths}
        interfaceVisible={!welcomeOpen && !clean}
        introActive={welcomeOpen}
        introLeaving={welcomeLeaving}
        labels={labels && !clean && mode === 'atlas'}
        controller={controller}
        onTelemetry={onTelemetry}
        onPreparation={onPreparation}
        onSelect={selectBody}
        onInteract={interact}
        storyBinding={storyBinding}
        transferReading={transferReading}
      />
      <div
        className={`experience-content ${welcomeOpen ? (welcomeLeaving ? 'experience-opening' : 'experience-waiting') : ''}`}
        inert={welcomeOpen}
      >
        <div className="edge-shade" aria-hidden="true" />
        {header}
        <div className="mission-line ui-chrome">
          <span>
            <i /> AN EXPEDITION THROUGH THE SOLAR SYSTEM
          </span>
          <span>
            {journey
              ? flightDate
              : body
                ? `${body.kind} · illustrated atlas`
                : mode === 'atlas'
                  ? 'Illustrated · undated'
                  : '1957 to 2021'}
          </span>
        </div>
        <section
          inert={transferring || clean || (readingMode && !!journey)}
          className={`narrative ui-chrome ${discovered ? 'discovery-revealed' : ''} ${briefingOpen ? 'briefing-open' : ''} ${atlasNotesOpen ? 'atlas-notes-open' : ''}`}
          key={`${mode}-${request.destination}-${step}-${feature}`}
        >
          {!journey && (
            <>
              <p className="eyebrow">
                {body ? (
                  <>
                    <span>{body.name.toUpperCase()}</span>
                    {feature ? 'A CLOSER LOOK' : 'FIELD NOTES'}
                  </>
                ) : mode === 'atlas' ? (
                  <>
                    <span>SOLAR ATLAS</span>ILLUSTRATED · UNDATED
                  </>
                ) : (
                  <>
                    <span>1957 to 2021</span>A HISTORY OF FIRST ENCOUNTERS
                  </>
                )}
              </p>
              <div aria-live="polite" aria-atomic="true">
                <h1 ref={atlasHeading} tabIndex={-1}>
                  {title.split('\n').map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </h1>
                <p className="narrative-description">{description}</p>
              </div>
            </>
          )}
          {journey && (
            <button
              className="briefing-toggle"
              aria-expanded={briefingOpen}
              aria-controls="mission-briefing"
              onClick={() => {
                if (!briefingOpen) {
                  setPlaying(false);
                  setHeld(true);
                }
                setBriefingOpen((open) => !open);
              }}
            >
              {briefingOpen ? 'Close flight details' : 'Flight details'}
              <span aria-hidden="true">{briefingOpen ? '−' : '+'}</span>
            </button>
          )}
          {journey ? (
            <div className="mission-details" id="mission-briefing">
              <p className="mobile-briefing-description">{description}</p>
              {activeMission && telemetry.rangeKm !== undefined && (
                <p className="briefing-measurements">
                  {Math.round(telemetry.rangeKm).toLocaleString()} km from{' '}
                  {focusName}’s centre
                  <br />
                  {telemetry.relativeSpeedKmS?.toFixed(2)} km/s relative speed
                </p>
              )}
              <p className="route-label">
                <Navigation size={14} />
                {hasTrajectory
                  ? record?.events?.map((event) => event.label).join(' → ') ||
                    (step === 5
                      ? 'The asteroid-belt crossing'
                      : 'Recorded flight window')
                  : 'Dated planetary view'}
              </p>
              {hasTrajectory && (
                <>
                  <div className="mission-stages" aria-label="Flight progress">
                    {['Approach', 'Following', 'Encounter', 'Discovery'].map(
                      (label, index) => (
                        <span
                          key={label}
                          className={
                            index <=
                            (discovered
                              ? 3
                              : missionProgress < 0.16
                                ? 0
                                : missionProgress < 0.76
                                  ? 1
                                  : 2)
                              ? 'reached'
                              : ''
                          }
                        >
                          {label}
                        </span>
                      ),
                    )}
                  </div>
                  {briefingOpen && !transferring && !clean && (
                    <Slider
                      className="segment-slider"
                      disabled={transferring}
                      aria-label="Current mission progress"
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round(missionProgress * 100)]}
                      onValueChange={(value) =>
                        seekMission(
                          (Array.isArray(value) ? value[0] : value) / 100,
                        )
                      }
                      aria-valuetext={`${Math.round(missionProgress * 100)} percent, ${flightDate}`}
                    />
                  )}
                  <div
                    className="encounter-stops"
                    aria-label="Recorded encounters"
                  >
                    {activeMission &&
                      telemetry.events?.map((event) => (
                        <button
                          key={event.label}
                          onClick={() => seekMission(event.progress)}
                        >
                          {event.label} <ArrowRight size={12} />
                        </button>
                      ))}
                  </div>
                </>
              )}
              <div className="mission-actions">
                <button
                  hidden={readingMode}
                  onClick={() =>
                    telemetry.ephemerisError
                      ? controller.current?.reset()
                      : !hasTrajectory
                        ? goStep(
                            Math.min(step + 1, milestones.length - 1),
                            true,
                          )
                        : discovered
                          ? goStep(step, true)
                          : showDiscovery()
                  }
                >
                  {discovered ? (
                    <RotateCcw size={14} />
                  ) : (
                    <ArrowRight size={14} />
                  )}
                  {telemetry.ephemerisError
                    ? 'Retry chapter'
                    : !hasTrajectory
                      ? 'Continue the journey'
                      : discovered
                        ? 'Replay flight'
                        : 'Skip to discovery'}
                </button>
                {discovered && (
                  <a href={journey.source} target="_blank" rel="noreferrer">
                    Mission record <ArrowUpRight size={13} />
                  </a>
                )}
              </div>
              <p className="reconstruction-note">
                {record?.quality === 'reconstructed'
                  ? 'Tracking reconstruction'
                  : record?.quality === 'archival'
                    ? 'Archival navigation solution'
                    : 'No validated spacecraft route'}
                {hasTrajectory && ' · craft enlarged'}
              </p>
              {hasTrajectory && activeMission && telemetry.focus && (
                <p className="path-frame">
                  Path relative to {focusName} · distances to scale
                </p>
              )}
              <details className="trajectory-coverage">
                <summary>Trajectory & coverage</summary>
                <p>{record?.note}</p>
                {hasTrajectory && (
                  <p>
                    Replay: {record?.start?.replace('T', ' ')} to{' '}
                    {record?.end?.replace('T', ' ')} UTC.
                  </p>
                )}
                <a href={trajectorySource} target="_blank" rel="noreferrer">
                  JPL source <ArrowUpRight size={12} />
                </a>
                <a
                  href="/ephemeris/SOURCES.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  All coverage notes <ArrowUpRight size={12} />
                </a>
              </details>
              {telemetry.ephemerisError && (
                <p role="alert" className="trajectory-error">
                  {telemetry.ephemerisError}
                </p>
              )}
            </div>
          ) : !body ? (
            <div className="intro-actions">
              <button
                className="primary-action"
                onClick={(event) => {
                  if (
                    event.detail === 0 &&
                    document.activeElement === event.currentTarget
                  ) {
                    if (mode === 'atlas') pendingAtlasFocus.current = 'heading';
                    else
                      event.currentTarget
                        .closest<HTMLElement>('.solar-experience')
                        ?.focus({ preventScroll: true });
                  }
                  if (mode === 'atlas') selectBody('earth');
                  else goStep(0, true);
                }}
                disabled={!telemetry.ready && !readingMode}
              >
                {mode === 'atlas' ? (
                  <>
                    <LocateFixed size={15} />{' '}
                    {readingMode ? 'Read about Earth' : 'Explore Earth'}{' '}
                  </>
                ) : (
                  <>
                    <Play size={15} fill="currentColor" />{' '}
                    {readingMode
                      ? 'Read the human journey'
                      : 'Play the human journey'}{' '}
                  </>
                )}
                <ArrowRight size={17} />
              </button>
              <button
                className="text-action"
                onClick={(event) => {
                  if (
                    event.detail === 0 &&
                    document.activeElement === event.currentTarget
                  )
                    event.currentTarget
                      .closest<HTMLElement>('.solar-experience')
                      ?.focus({ preventScroll: true });
                  if (mode === 'atlas') goStep(0, true);
                  else setMode('atlas');
                }}
              >
                {mode === 'atlas'
                  ? 'Begin the human journey'
                  : 'Explore on your own'}{' '}
                <ArrowUpRight size={16} />
              </button>
            </div>
          ) : (
            <div className="point-links">
              <div className="atlas-note-actions">
                <button
                  ref={atlasFeatureAction}
                  hidden={readingMode}
                  onClick={(event) => {
                    if (
                      event.detail === 0 &&
                      document.activeElement === event.currentTarget
                    )
                      pendingAtlasFocus.current = 'feature';
                    setPlaying(false);
                    setMode('atlas');
                    issueFlight(
                      body.id,
                      feature ? undefined : body.featureView,
                    );
                  }}
                  className={feature ? 'selected' : ''}
                  aria-pressed={feature}
                >
                  <LocateFixed size={15} />
                  {feature ? 'Return to orbit' : body.feature}
                  <ArrowUpRight size={14} />
                </button>
                <button
                  className="atlas-notes-toggle"
                  hidden={readingMode}
                  aria-label={
                    atlasNotesOpen ? 'Close field notes' : 'Read field notes'
                  }
                  aria-expanded={atlasNotesOpen}
                  aria-controls="atlas-field-notes"
                  onClick={() => {
                    setAtlasNotesMaterialized(atlasNotesIdentity);
                    setAtlasNotesOpen((open) => !open);
                  }}
                >
                  Field notes
                  <span aria-hidden="true">{atlasNotesOpen ? '−' : '+'}</span>
                </button>
              </div>
              <div
                className="atlas-field-details"
                id="atlas-field-notes"
                inert={!readingMode && compactViewport && !atlasNotesOpen}
              >
                {renderAtlasNotes && (
                  <>
                    <p className="atlas-note-description">{description}</p>
                    <dl className="atlas-facts">
                      <div>
                        <dt>MEAN DISTANCE FROM THE SUN</dt>
                        <dd>{body.au} AU</dd>
                      </div>
                      <div>
                        <dt>
                          {body.id === 'sun' ? 'DIAMETER' : 'SIZE / EXTENT'}
                        </dt>
                        <dd>{body.diameter}</dd>
                      </div>
                      <div>
                        <dt>
                          {body.id === 'sun'
                            ? 'AGE'
                            : 'ORBITAL PERIOD / REGION'}
                        </dt>
                        <dd>{body.period}</dd>
                      </div>
                    </dl>
                    {related.length > 0 && (
                      <div
                        className={`system-links ${related.length > 4 ? 'many-worlds' : related.length === 1 ? 'single-world' : ''}`}
                        aria-label="Related worlds"
                      >
                        <p>
                          {body.parent
                            ? 'PARENT WORLD'
                            : body.region
                              ? 'REGION'
                              : body.id === 'belt'
                                ? 'WORLDS IN THE BELT'
                                : 'MOONS IN THIS ATLAS'}
                        </p>
                        <div>
                          {related.map((b) => (
                            <button
                              key={b.id}
                              onClick={(event) => {
                                if (
                                  event.detail === 0 &&
                                  document.activeElement === event.currentTarget
                                )
                                  pendingAtlasFocus.current = 'heading';
                                selectBody(b.id);
                              }}
                            >
                              <span style={{ background: b.color }} />
                              {b.name}
                              <ArrowUpRight size={12} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {body.mapNote && <p className="map-note">{body.mapNote}</p>}
                    {source && (
                      <a
                        className="field-source"
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Facts and sources <ArrowUpRight size={13} />
                      </a>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
        {readingMode && journey && milestone && (
          <ReadingChapter
            chapter={`${String(step + 1).padStart(2, '0')} / ${milestones.length}`}
            mission={milestone.mission}
            year={milestone.year}
            title={milestone.title}
            description={milestone.text}
            discoveryTitle={journey.discoveryTitle}
            discoveryText={journey.discoveryText}
            coverage={record?.note}
            source={journey.source}
          />
        )}
        {!readingMode && journey && milestone && (
          <SceneStory
            onBinding={onStoryBinding}
            chapter={`${String(step + 1).padStart(2, '0')} / ${milestones.length}`}
            mission={milestone.mission}
            title={
              discoveryBeat && !discoveryBeat.primary
                ? discoveryBeat.label
                : finalDiscoveryReached
                  ? journey.discoveryTitle
                  : hasTrajectory && !discoveryBeat && playing
                    ? milestone.title
                    : title
            }
            description={
              discoveryBeat && !discoveryBeat.primary
                ? `${milestone.mission} passes ${bodyById[discoveryBeat.body].name}. This recorded encounter is one stage of its onward journey.`
                : description
            }
            subject={
              discoveryBeat?.subject === 'probe'
                ? milestone.mission
                : discoveryBeat
                  ? bodyById[discoveryBeat.body].name
                  : focusName || body?.name || 'the solar system'
            }
            date={flightDate}
            coverage={
              !hasTrajectory
                ? `${step === 13 ? 'Illustrative nucleus' : 'Dated world view'} · no spacecraft route`
                : undefined
            }
            progress={missionProgress}
            beat={discoveryBeat}
            reading={!playing || reduced}
            presence={transferring ? handoff.incoming : closingText.outgoing}
            hidden={
              (transferring && handoff.incoming === 0) ||
              !activeMission ||
              !telemetry.ready ||
              briefingOpen ||
              clean
            }
          />
        )}
        {(journey || transferring) && (
          <TransferCaption
            onReading={onTransferReading}
            presence={bridgePresence}
            drift={reduced || closing > 0 ? 0 : handoff.drift}
            arrival={closing > 0 || preparingHandoff ? 1 : handoff.arrival}
            hidden={bridgePresence === 0 || briefingOpen || clean}
          >
            <p className="eyebrow">
              {closing > 0 || preparingHandoff
                ? 'THE JOURNEY CONTINUES'
                : telemetry.transition === 'timelapse' &&
                    telemetry.transitionClock
                  ? 'HISTORICAL TIME-LAPSE'
                  : 'CAMERA IN FLIGHT'}
            </p>
            <p className="transfer-year">
              {telemetry.utc
                ? new Date(telemetry.utc).getUTCFullYear()
                : mode === 'story'
                  ? (milestone?.year ?? 'PREPARING')
                  : 'ATLAS'}
            </p>
            <p>{closing > 0 ? 'Leaving the encounter' : transitionLabel}</p>
            <div className="transfer-progress" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${telemetry.transitionProgress ?? 0})`,
                }}
              />
            </div>
            <p className="transfer-destination">
              <span>{mode === 'atlas' ? 'Destination' : 'Next encounter'}</span>
              <strong>
                {bridgeMission?.mission ?? body?.name ?? 'Solar system'}
              </strong>
            </p>
            {telemetry.transition === 'timelapse' && (
              <p className="transfer-context-key">
                {telemetry.transitionClock
                  ? 'Dated planets · schematic belt guide'
                  : 'Undated layout · schematic belt guide'}
              </p>
            )}
          </TransferCaption>
        )}
        {milestone?.body === 'belt' && activeMission && !transferring && (
          <p className="belt-region-note ui-chrome">
            ASTEROID BELT REGION · APPROX. 2.2–3.2 AU{' '}
            <span>Guide marks are schematic.</span>
            <span>Ceres & Vesta use dated positions.</span>
          </p>
        )}
        {milestone && activeMission && telemetry.rangeKm !== undefined && (
          <aside
            className="ephemeris-telemetry ui-chrome"
            aria-label="Historical flight measurements"
          >
            <p className="eyebrow">RELATIVE TO {focusName.toUpperCase()}</p>
            <p>
              <strong>{Math.round(telemetry.rangeKm).toLocaleString()}</strong>{' '}
              km from centre
            </p>
            <p>{telemetry.relativeSpeedKmS?.toFixed(2)} km/s</p>
          </aside>
        )}
        {!milestone && (
          <aside
            className="observatory ui-chrome"
            key={body?.id ?? 'overview'}
            inert={clean || transferring}
          >
            <p className="eyebrow">
              {milestone
                ? 'THE YEAR OF ENCOUNTER'
                : body
                  ? 'MEAN DISTANCE FROM THE SUN'
                  : 'OUR SOLAR NEIGHBORHOOD'}
            </p>
            <div className="observatory-value">
              {body ? body.au : '8'}
              <span>{milestone ? '' : body ? 'AU' : 'planets'}</span>
            </div>
            <p className="observatory-caption">
              {milestone
                ? body?.name
                : body
                  ? '1 AU ≈ Earth–Sun distance'
                  : 'Explore the planets and their moons.'}
            </p>
            {body && (
              <dl>
                <div>
                  <dt>{body.id === 'sun' ? 'DIAMETER' : 'SIZE / EXTENT'}</dt>
                  <dd>{body.diameter}</dd>
                </div>
                <div>
                  <dt>
                    {body.id === 'sun' ? 'AGE' : 'ORBITAL PERIOD / REGION'}
                  </dt>
                  <dd>{body.period}</dd>
                </div>
              </dl>
            )}
            <button className="overview-button" onClick={overview}>
              <Map size={15} /> System overview <ArrowUpRight size={14} />
            </button>
          </aside>
        )}
        <output className="flight-status ui-chrome" aria-live="off">
          <span
            className={
              telemetry.phase === 'travel' ? 'flight-dot moving' : 'flight-dot'
            }
          />
          {readingMode
            ? `Reading mode · ${milestone?.year ?? body?.name ?? 'Solar atlas'}`
            : transferring
              ? `${held ? 'Flight paused' : transitionLabel}${journey ? ` · ${flightDate}` : ''}`
              : journey && telemetry.ready
                ? `${held ? 'Paused' : discoveryBeat ? (discoveryBeat.kind === 'tableau' ? 'Orbital camera · historical clock held' : discoveryBeat.stage === 'return' ? 'Returning to probe pursuit' : 'Encounter close-up · historical clock held') : !hasTrajectory ? 'Historical snapshot' : discovered ? 'Encounter reached' : activeMission ? (telemetry.missionPhase ?? 'departure') : 'Loading trajectory'} · ${flightDate}`
                : !telemetry.ready
                  ? journey
                    ? 'Loading historical positions'
                    : 'Preparing the atlas'
                  : telemetry.phase === 'travel'
                    ? `${held ? 'Flight paused' : 'In transit'} · ${body?.name ?? 'Solar system'}`
                    : body
                      ? `In orbit · ${body.name}`
                      : 'Orbital overview'}
          {telemetry.phase === 'travel' && (
            <div className="flight-track">
              <span
                style={{
                  transform: `scaleX(${telemetry.transitionProgress ?? telemetry.progress})`,
                }}
              />
            </div>
          )}
        </output>
        {!readingMode && (
          <fieldset className="camera-tools" aria-label="Camera and display">
            <button
              onClick={() => controller.current?.zoom(1)}
              aria-label="Zoom in"
              data-label="Zoom in"
              disabled={!telemetry.ready}
            >
              <Plus size={18} />
            </button>
            <button
              onClick={() => controller.current?.zoom(-1)}
              aria-label="Zoom out"
              data-label="Zoom out"
              disabled={!telemetry.ready}
            >
              <Minus size={18} />
            </button>
            <span />
            <button
              onClick={() => {
                if (milestone) goStep(step, true);
                else controller.current?.reset();
              }}
              aria-label={milestone ? 'Replay encounter' : 'Reset camera'}
              data-label={milestone ? 'Replay encounter' : 'Reset camera'}
              disabled={!telemetry.ready}
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => setClean(!clean)}
              aria-label={clean ? 'Show interface' : 'Hide interface'}
              data-label={clean ? 'Show interface' : 'Hide interface'}
            >
              {clean ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <button
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              data-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
          </fieldset>
        )}
        {navigation}
        {footer}
      </div>
      {welcomeOpen && (
        <ExpeditionWelcome
          preparation={preparation}
          openingReady={entryReady}
          choice={entryChoice}
          leaving={welcomeLeaving}
          onChoose={chooseEntry}
        />
      )}
      {clean && (
        <button className="restore-ui" onClick={() => setClean(false)}>
          <Eye size={16} /> Show interface
        </button>
      )}
    </main>
  );
}
