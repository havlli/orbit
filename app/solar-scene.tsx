'use client';

import { createBodyMarkers } from './body-markers';
import { contextBodies } from './orbital-context';
import { createSceneRendering, scenePixelRatio } from './scene-rendering';
import { createCelestialSky } from './celestial-sky';
import { SkyExposure, type SkyLightBody } from './sky-exposure';
import { SpacecraftLighting } from './spacecraft-lighting';
import { createSpacecraftPreparation } from './spacecraft-preparation';
import { loadSceneTexture } from './scene-texture';
import { type ReadingArea } from './path-presentation';
import { PathVisibility } from './path-visibility';
import { PointerGesture } from './pointer-gesture';
import type { ScenePreparation } from './expedition-welcome';
import {
  WelcomeCamera,
  welcomePortrait,
  welcomeFraming,
} from './welcome-camera';
import {
  fitAtlasPortrait,
  fitAtlasFeature,
  fitAtlasRegion,
  atlasRegionFraming,
  atlasPortraitFraming,
  atlasLabelFits,
  atlasRingViewDirection,
  atlasArrivalLookProgress,
  AtlasFramingTransition,
  AtlasAutoOrbit,
  type AtlasOrbitViewport,
  isCompactLandscape,
} from './atlas-camera';
import { PlanetDetail, cloudDetailSurface } from './planet-detail';
import { SharedBodySpheres } from './body-spheres';
import { ringFragment } from './planet-rings';
import { createCometMaterial } from './comet-material';
import {
  bodyVertex,
  bodyFragment,
  atmosphereFragment,
  surfaceProfile,
} from './planet-shading';
import { createBeltRegion } from './belt-region';
import { softenNearbyBeltRocks } from './belt-material';
import { createBeltRockGeometry, beltRockAppearance } from './belt-rocks';
import { StoryProjector, type StoryBinding } from './scene-story-motion';
import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  bodies,
  bodyById,
  milestones,
  type BodyId,
  type Destination,
} from './solar-data';
import { MissionFlight, type MissionPhase } from './mission-flight';
import {
  loadSpacecraftModel,
  preloadSpacecraftModel,
  disposeSpacecraft,
} from './spacecraft';
import type { DiscoveryBeat } from './mission-cinematography';
import {
  ExpeditionFlight,
  easeFlight,
  loadTimelapse,
  viewMotion,
  type ExpeditionView,
  type TransitionPhase,
} from './expedition-flight';
import {
  loadEphemeris,
  KM_PER_UNIT,
  type EphemerisBundle,
  type Encounter,
} from './ephemeris';

export interface FlightRequest {
  destination: Destination;
  feature?: string;
  serial: number;
  missionIndex?: number;
  continuation?: boolean;
  entrance?: boolean;
}
export interface FlightTelemetry {
  phase: 'travel' | 'orbit';
  progress: number;
  ready: boolean;
  destination: Destination;
  distance: number;
  missionPhase?: MissionPhase;
  missionIndex?: number;
  utc?: string;
  focus?: BodyId;
  rangeKm?: number;
  relativeSpeedKmS?: number;
  events?: Encounter[];
  ephemerisError?: string;
  transition?: TransitionPhase;
  transitionProgress?: number;
  transitionClock?: boolean;
  chapterTransfer?: boolean;
  discovery?: DiscoveryBeat;
  chapterComplete?: boolean;
  closingProgress?: number;
}
export interface SolarController {
  zoom: (amount: number) => void;
  reset: () => void;
  seekMission: (progress: number) => void;
  getState: () => FlightTelemetry;
}
interface Props {
  request: FlightRequest;
  motion: boolean;
  flightPaused: boolean;
  speed: number;
  paths: boolean;
  labels: boolean;
  interfaceVisible: boolean;
  introActive: boolean;
  introLeaving: boolean;
  controller: React.RefObject<SolarController | null>;
  onTelemetry: (value: FlightTelemetry) => void;
  onPreparation: (value: ScenePreparation) => void;
  onSelect: (id: BodyId) => void;
  onInteract: () => void;
  storyBinding: React.RefObject<StoryBinding | null>;
  transferReading: React.RefObject<ReadingArea | null>;
}

const glowVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const glowFragment = `varying vec2 vUv;void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r),3.)*.45;gl_FragColor=vec4(1.,.31,.06,a);}`;
const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

function SolarScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  // oxlint-disable-next-line react/react-compiler -- The animation loop reads current props without recreating GPU resources.
  live.current = props;
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>(
    'loading',
  );
  const [loadProgress, setLoadProgress] = useState(0);

  const onPreparation = props.onPreparation;
  useEffect(() => {
    onPreparation({ status, progress: loadProgress });
  }, [status, loadProgress, onPreparation]);

  // oxlint-disable-next-line react/react-compiler -- This effect owns mutable Three.js resources and the imperative controller.
  useEffect(() => {
    const controller = props.controller;
    const element = host.current;
    if (!element) return;
    let disposed = false,
      failed = false,
      raf = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        // Antialias the scene render target, not the final fullscreen triangle.
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      // oxlint-disable-next-line react/react-compiler -- Renderer creation failure must immediately select the existing fallback.
      setStatus('fallback');
      return;
    }
    const openingMissionIndex = live.current.request.missionIndex;
    if (openingMissionIndex !== undefined)
      void loadEphemeris(openingMissionIndex).catch(() => {});
    renderer.setPixelRatio(
      scenePixelRatio(
        element.clientWidth,
        element.clientHeight,
        window.devicePixelRatio,
      ),
    );
    renderer.setClearColor(0x000102);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.className = 'solar-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      'Interactive solar system. Drag to orbit, scroll to zoom. Arrow keys rotate; plus and minus zoom; Home resets.',
    );
    element.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.025, 4000);
    const composer = createSceneRendering(renderer, scene, camera);
    const resources: Array<{ dispose: () => void }> = [];
    const textures: THREE.Texture[] = [];
    const bodyMeshes = new Map<BodyId, THREE.Mesh>();
    const bodyGroups = new Map<BodyId, THREE.Group>();
    const spins: THREE.Object3D[] = [];
    const materials: THREE.ShaderMaterial[] = [];
    const atmospheres: THREE.Mesh[] = [];
    const sunPosition = new THREE.Vector3();
    const atlasPositions = new Map<Destination, THREE.Vector3>();
    const positions = new Map<Destination, THREE.Vector3>();
    positions.set('overview', new THREE.Vector3());
    const orbitGroup = new THREE.Group();
    scene.add(orbitGroup);
    const atlasOrbits: THREE.Line[] = [];
    const atlasOrbitMaterials = new Map<THREE.LineBasicMaterial, number>();
    let atlasCometTail:
      | THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
      | undefined;
    let mission: MissionFlight | null = null;
    let expedition: ExpeditionFlight | null = null;
    let departingMission: MissionFlight | null = null;
    let historicalView: ExpeditionView | null = null;
    let expeditionToAtlas = false;
    let cameraFraming: NonNullable<ExpeditionView['framing']> = {
      horizontal: 0.28,
      vertical: 0.12,
    };
    let cameraBank = 0;
    let seekMotion: {
      elapsed: number;
      from: number;
      to: number;
      cameraOffset: THREE.Vector3;
      lookOffset: THREE.Vector3;
      verticalOffset: number;
    } | null = null;
    let historical = false;
    const welcomeCamera = new WelcomeCamera();
    let manualMission = false;
    let manualPauseSeen = false;
    let missionLoading = false;
    let loadSerial = 0;
    let pendingSeek: number | undefined;
    let width = 1,
      height = 1,
      mobile = false;
    let elapsed = 0,
      lastTime = 0,
      lastReport = 0;
    let currentDestination: Destination = 'overview';
    const look = new THREE.Vector3();
    const offset = new THREE.Vector3(0, 155, 215);
    let distance = offset.length();
    camera.position.copy(offset);
    let yaw = 0.2,
      pitch = 0.32,
      userZoom = 1,
      orbitDrift = 0;
    const automaticOrbit = new AtlasAutoOrbit();
    let automaticView: AtlasOrbitViewport | undefined;
    let lastSerial = -1;
    let flight: {
      t: number;
      duration: number;
      curve: THREE.CatmullRomCurve3;
      fromLook: THREE.Vector3;
      toLook: THREE.Vector3;
      endOffset: THREE.Vector3;
      radius: number;
      overview: boolean;
      leadArrival: boolean;
      framing: AtlasFramingTransition;
      resizeCorrection?: {
        progress: number;
        from: THREE.Vector3;
        to: THREE.Vector3;
      };
    } | null = null;
    let telemetry: FlightTelemetry = {
      phase: 'orbit',
      progress: 1,
      ready: false,
      destination: 'overview',
      distance,
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const resize = () => {
      const req = live.current.request;
      const fittedView =
        currentDestination !== 'overview' &&
        !(
          req.feature &&
          (currentDestination === 'belt' || currentDestination === 'kuiper')
        );
      const atlasArrival =
        expeditionToAtlas && req.missionIndex === undefined ? expedition : null;
      const atlasCamera =
        width > 1 &&
        height > 1 &&
        lastSerial === req.serial &&
        !historical &&
        !missionLoading &&
        !expedition &&
        req.missionIndex === undefined;
      const refit = atlasCamera && fittedView;
      const previousFraming = atlasCamera
        ? atlasFraming(currentDestination, req.feature)
        : null;
      const previousFit = refit
        ? viewFor(currentDestination, req.feature).offset.length()
        : 0;
      width = element.clientWidth;
      height = element.clientHeight;
      mobile = width <= 760;
      if (automaticView) {
        automaticView.width = width;
        automaticView.height = height;
      }
      if (previousFraming) {
        const nextFraming = atlasFraming(currentDestination, req.feature);
        if (flight) flight.framing.retarget(nextFraming, flight.t);
        else {
          cameraFraming.horizontal +=
            nextFraming.horizontal - previousFraming.horizontal;
          cameraFraming.vertical +=
            nextFraming.vertical - previousFraming.vertical;
        }
      }
      if (atlasArrival) {
        const next = viewFor(currentDestination, req.feature, atlasPositions);
        atlasArrival.resizeArrival({
          position: next.target.clone().add(next.offset),
          look: next.target,
          framing: atlasFraming(currentDestination, req.feature),
        });
      }
      if (previousFit > 0) {
        const next = viewFor(currentDestination, req.feature);
        const ratio = next.offset.length() / previousFit;
        // Keep the inspected direction and relative zoom when the available
        // viewing area changes. A resize never resets an orbital drag.
        camera.position.sub(look).multiplyScalar(ratio).add(look);
        distance *= ratio;
        if (flight) {
          // Join a resized arrival from the current rendered position. Its
          // correction starts and ends gently without restarting the flight.
          flight.endOffset.copy(next.offset);
          flight.resizeCorrection = {
            progress: flight.t,
            from: camera.position
              .clone()
              .sub(flight.curve.getPoint(smooth(flight.t))),
            to: next.target
              .clone()
              .add(next.offset)
              .sub(flight.curve.getPoint(1)),
          };
        }
      }
      camera.aspect = width / height;
      camera.fov = mobile ? 49 : 42;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(
        scenePixelRatio(width, height, window.devicePixelRatio),
      );
      renderer.setSize(width, height);
      composer.setSize();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const fail = () => {
      if (disposed) return;
      failed = true;
      cancelAnimationFrame(raf);
      setStatus('fallback');
      live.current.onTelemetry({ ...telemetry, ready: false });
    };
    renderer.debug.onShaderError = fail;
    const contextLost = (event: Event) => {
      event.preventDefault();
      fail();
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    let loaded = 0;
    const tex = async (url: string, srgb = true) => {
      const t = await loadSceneTexture(url);
      if (disposed) {
        t.dispose();
        throw new Error('Disposed');
      }
      textures.push(t);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      renderer.initTexture(t);
      setLoadProgress(Math.round((++loaded / textureUrls.length) * 100));
      return t;
    };
    const textureCache = new Map<string, THREE.Texture>();
    const textureUrls = [
      ...new Set(
        bodies
          .filter((b) => b.texture)
          .map((b) => '/textures/solar/' + b.texture),
      ),
      '/textures/solar/earth-night-2k.jpg',
      '/textures/solar/earth-clouds-2k.jpg',
      '/textures/rings.png',
    ];
    const load = Promise.all(
      textureUrls.map(async (url) => {
        try {
          const texture = await tex(url, !url.includes('clouds'));
          textureCache.set(url, texture);
        } catch (e) {
          if (disposed) throw e;
          console.warn('A planetary texture could not be loaded.', url);
        }
      }),
    );

    const seeded = (() => {
      let s = 73;
      return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
    })();
    const sky = createCelestialSky(renderer);
    const skyExposure = new SkyExposure();
    const skyLightBodies: SkyLightBody[] = [];
    scene.add(sky.mesh);
    resources.push(sky);
    const details = new PlanetDetail(renderer);
    resources.push(details);
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x41566e,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
    });
    resources.push(orbitMaterial);
    function makeOrbit(
      radius: number,
      parent?: THREE.Object3D,
      color?: number,
    ) {
      const points = [];
      for (let i = 0; i <= 300; i++) {
        const a = (i / 300) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius),
        );
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = color
        ? new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
          })
        : orbitMaterial;
      const line = new THREE.Line(geo, mat);
      atlasOrbits.push(line);
      atlasOrbitMaterials.set(mat, mat.opacity);
      (parent || orbitGroup).add(line);
      resources.push(geo);
      if (color) resources.push(mat);
      return line;
    }
    const rockGeometry = createBeltRockGeometry();
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x97938b,
      emissive: 0x18191a,
      emissiveIntensity: 0.3,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    resources.push(rockGeometry, rockMaterial);
    const pointLight = new THREE.PointLight(0xffdfb2, 1.6, 0, 0);
    scene.add(pointLight);
    const spacecraftLighting = new SpacecraftLighting(scene);
    const ambientLight = new THREE.AmbientLight(0x9cb8e6, 0.1);
    scene.add(ambientLight);
    const prepareSpacecraft = createSpacecraftPreparation(
      renderer,
      camera,
      scene,
      () => !disposed,
      {
        lights: [pointLight, spacecraftLighting.light, ambientLight],
        compile: composer.compile,
      },
    );
    resources.push(spacecraftLighting);
    function makeBelt(count: number, min: number, max: number, size: number) {
      const mesh = new THREE.InstancedMesh(
        rockGeometry,
        rockMaterial.clone(),
        count,
      );
      mesh.material.transparent = true;
      mesh.material.depthWrite = false;
      softenNearbyBeltRocks(mesh.material);
      resources.push(mesh.material);
      const dummy = new THREE.Object3D();
      const glints = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const a = seeded() * Math.PI * 2,
          r = min + (max - min) * (seeded() + seeded()) * 0.5;
        dummy.position.set(
          Math.cos(a) * r,
          (seeded() - 0.5) * 1.4,
          Math.sin(a) * r,
        );
        dummy.rotation.set(seeded() * 6, seeded() * 6, seeded() * 6);
        const s = size * (0.18 + seeded() * 0.82);
        const appearance = beltRockAppearance(i, count);
        const [x, y, z] = appearance.proportions;
        dummy.scale.set(s * x, s * y, s * z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, appearance.tint);
        dummy.position.toArray(glints, i * 3);
        new THREE.Color(0xcbb58f)
          .multiplyScalar(0.35 + seeded() * 0.65)
          .toArray(colors, i * 3);
      }
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(glints, 3),
      );
      dustGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const dustMaterial = new THREE.ShaderMaterial({
        uniforms: {
          pointSize: { value: 2.2 * renderer.getPixelRatio() },
          presence: { value: 1 },
        },
        vertexShader:
          'attribute vec3 color;varying vec3 tint;uniform float pointSize;void main(){tint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize;}',
        fragmentShader:
          'varying vec3 tint;uniform float presence;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(tint,(1.-smoothstep(.1,1.,r))*.65*presence);}',
        transparent: true,
        depthWrite: false,
      });
      mesh.add(new THREE.Points(dustGeometry, dustMaterial));
      resources.push(dustGeometry, dustMaterial);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      resources.push(mesh);
      return mesh;
    }
    const belt = makeBelt(3600, 47, 56, 0.13);
    const kuiper = makeBelt(2100, 171, 216, 0.32);
    const beltRegion = createBeltRegion();
    const pathVisibility = new PathVisibility();
    let pathPresence = 1;
    scene.add(beltRegion.group);
    resources.push(beltRegion);
    const moonMarkers = createBodyMarkers(renderer.getPixelRatio());
    scene.add(moonMarkers.points);
    resources.push(moonMarkers);
    function buildBodies() {
      const spheres = new SharedBodySpheres();
      resources.push(spheres);
      for (const b of bodies) {
        const local = new THREE.Vector3(
          Math.cos(b.angle) * b.orbit,
          0,
          Math.sin(b.angle) * b.orbit,
        );
        if (b.parent)
          local.applyAxisAngle(
            new THREE.Vector3(0, 0, 1),
            bodyById[b.parent].tilt ?? 0.05,
          );
        const parent = b.parent ? positions.get(b.parent) : null;
        const center = parent ? local.add(parent) : local;
        positions.set(b.id, center);
        atlasPositions.set(b.id, center.clone());
        if (b.id === 'belt' || b.id === 'kuiper') continue;
        const group = new THREE.Group();
        group.position.copy(center);
        scene.add(group);
        bodyGroups.set(b.id, group);
        skyLightBodies.push({
          object: group,
          radius: b.radius,
          emissive: b.id === 'sun',
        });
        const tilt = new THREE.Group();
        tilt.name = 'body-axis';
        tilt.rotation.z = b.tilt ?? 0.05;
        group.add(tilt);
        const geometry =
          b.id === 'comet'
            ? new THREE.IcosahedronGeometry(b.radius, 2)
            : spheres.geometry;
        if (b.id === 'comet') {
          if (b.shape) geometry.scale(...b.shape);
          // An explicitly illustrative nucleus, with a matte, irregular
          // silhouette. This is not a measured shape model of 67P.
          const vertices = geometry.getAttribute('position');
          for (let i = 0; i < vertices.count; i++) {
            const x = vertices.getX(i),
              y = vertices.getY(i),
              z = vertices.getZ(i);
            const relief =
              1 + 0.11 * Math.sin(x * 47 + y * 29) * Math.sin(z * 53 - y * 31);
            vertices.setXYZ(i, x * relief, y * relief, z * relief);
          }
          geometry.scale(1.7, 0.72, 1);
          geometry.computeVertexNormals();
          resources.push(geometry);
        }
        const map = b.texture
          ? textureCache.get('/textures/solar/' + b.texture)
          : null;
        const profile = surfaceProfile(b.id);
        const material = new THREE.ShaderMaterial({
          vertexShader: bodyVertex,
          fragmentShader: bodyFragment,
          uniforms: {
            map: { value: map ?? null },
            detailMap: { value: map ?? null },
            detailMix: { value: 0 },
            contrast: { value: profile.contrast },
            lightGain: { value: profile.lightGain },
            limb: { value: profile.limb },
            wrap: { value: profile.wrap },
            hasRings: { value: b.id === 'saturn' ? 1 : 0 },
            ringMap: { value: textureCache.get('/textures/rings.png') },
            ringNormal: {
              value: new THREE.Vector3(0, 1, 0).applyQuaternion(
                tilt.quaternion,
              ),
            },
            bodyRadius: { value: b.radius },
            nightMap: {
              value:
                textureCache.get('/textures/solar/earth-night-2k.jpg') ?? null,
            },
            hasNight: { value: b.id === 'earth' ? 1 : 0 },
            hasMap: { value: map ? 1 : 0 },
            textureWest: { value: b.textureWest ? 1 : 0 },
            tint: {
              value: new THREE.Color(b.id === 'comet' ? '#62594f' : b.color),
            },
            center: { value: group.position },
            sunPosition: { value: sunPosition },
            isSun: { value: b.id === 'sun' ? 1 : 0 },
            time: { value: 0 },
          },
        });
        const mesh =
          b.id === 'comet'
            ? new THREE.Mesh(geometry, material)
            : spheres.create(b, material);
        mesh.userData.bodyId = b.id;
        tilt.add(mesh);
        bodyMeshes.set(b.id, mesh);
        spins.push(mesh);
        materials.push(material);
        details.register(b.id, material, group, b.radius);
        resources.push(material);
        if (b.orbit && !b.parent && b.id !== 'comet') makeOrbit(b.orbit);
        if (b.parent) {
          const parentGroup = bodyGroups.get(b.parent);
          if (parentGroup)
            makeOrbit(
              b.orbit,
              parentGroup.getObjectByName('body-axis'),
              0x638397,
            );
        }
        if (
          [
            'earth',
            'venus',
            'mars',
            'jupiter',
            'saturn',
            'titan',
            'neptune',
            'uranus',
          ].includes(b.id)
        ) {
          const am = new THREE.ShaderMaterial({
            vertexShader: bodyVertex,
            fragmentShader: atmosphereFragment,
            uniforms: {
              sunPosition: { value: sunPosition },
              strength: {
                value:
                  b.id === 'mars'
                    ? 0.2
                    : b.id === 'jupiter' || b.id === 'saturn'
                      ? 0.26
                      : 0.64,
              },
              glow: {
                value: new THREE.Color(b.id === 'earth' ? '#2387e8' : b.color),
              },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const at = spheres.create(b, am, 'atmosphere');
          tilt.add(at);
          atmospheres.push(at);
          resources.push(am);
        }
        if (b.id === 'earth') {
          const cloudMap = textureCache.get(
            '/textures/solar/earth-clouds-2k.jpg',
          );
          if (cloudMap) {
            const cm = new THREE.MeshPhongMaterial({
              color: 0xffffff,
              alphaMap: cloudMap,
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
            });
            details.register(
              'earth-clouds',
              cloudDetailSurface(cm),
              group,
              b.radius * 1.012,
            );
            const cloud = spheres.create(b, cm, 'clouds');
            tilt.add(cloud);
            spins.push(cloud);
            resources.push(cm);
          }
        }
        if (b.id === 'saturn' || b.id === 'uranus') {
          const inner = b.radius * (b.id === 'saturn' ? 1.14 : 1.65),
            outer = b.radius * (b.id === 'saturn' ? 2.31 : 2.05);
          const rg = new THREE.RingGeometry(inner, outer, 512, 1);
          const p = rg.attributes.position;
          for (let i = 0; i < p.count; i++)
            rg.attributes.uv.setXY(
              i,
              (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner),
              0.5,
            );
          rg.rotateX(-Math.PI / 2);
          const rm = new THREE.ShaderMaterial({
            vertexShader: bodyVertex,
            fragmentShader: ringFragment,
            uniforms: {
              map: { value: textureCache.get('/textures/rings.png') },
              mapped: { value: b.id === 'saturn' ? 1 : 0 },
              sun: {
                value: center
                  .clone()
                  .negate()
                  .normalize()
                  .applyAxisAngle(new THREE.Vector3(0, 0, 1), -(b.tilt ?? 0)),
              },
              planetRadius: { value: b.radius },
              flattening: { value: b.id === 'saturn' ? 0.92 : 1 },
              innerRadius: { value: inner },
              outerRadius: { value: outer },
            },
            side: THREE.DoubleSide,
            transparent: true,
            // This ring is a single plane: a second back/front pass adds no
            // transparency ordering information, only another geometry draw.
            forceSinglePass: true,
            depthWrite: false,
          });
          const rings = new THREE.Mesh(rg, rm);
          rings.name = 'planet-rings';
          tilt.add(rings);
          resources.push(rg, rm);
        }
        if (b.id === 'sun') {
          const gg = new THREE.PlaneGeometry(45, 45);
          const gm = new THREE.ShaderMaterial({
            vertexShader: glowVertex,
            fragmentShader: glowFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const halo = new THREE.Mesh(gg, gm);
          halo.name = 'sun-halo';
          group.add(halo);
          resources.push(gg, gm);
          const cg = new THREE.SphereGeometry(b.radius * 1.045, 80, 64);
          const cm = new THREE.ShaderMaterial({
            vertexShader: bodyVertex,
            fragmentShader:
              // Fade at both sides of the shell: a bright geometric silhouette
              // reads as an orange hoop once full-scene bloom is removed.
              'varying vec3 vWorld;varying vec3 vNormal;void main(){float facing=abs(dot(normalize(vNormal),normalize(cameraPosition-vWorld)));float rim=smoothstep(0.,.3,facing)*(1.-smoothstep(.3,.55,facing));gl_FragColor=vec4(2.,.5,.06,rim*.26);}',
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          group.add(new THREE.Mesh(cg, cm));
          resources.push(cg, cm);
        }
        if (b.id === 'comet') {
          const tailGeo = new THREE.BufferGeometry();
          const pts = new Float32Array(2200 * 3);
          const cols = new Float32Array(2200 * 3);
          const away = center.clone().normalize();
          const cross = new THREE.Vector3(-away.z, 0, away.x);
          for (let i = 0; i < 2200; i++) {
            const t = seeded(),
              r = seeded() * (0.2 + t * 2),
              a = seeded() * Math.PI * 2;
            const v = away
              .clone()
              .multiplyScalar(t * 22)
              .addScaledVector(cross, Math.cos(a) * r + t * t * 3);
            v.y += Math.sin(a) * r;
            pts.set(v.toArray(), i * 3);
            cols.set([0.3 * (1 - t), 0.6 * (1 - t), 0.8 * (1 - t)], i * 3);
          }
          tailGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
          tailGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
          const tm = createCometMaterial();
          const tail = new THREE.Points(tailGeo, tm);
          atlasCometTail = tail;
          tail.name = 'atlas-comet-tail';
          group.add(tail);
          resources.push(tailGeo, tm);
        }
      }
    }
    function viewFor(id: Destination, feature = '', layout = positions) {
      const target = (layout.get(id) ?? new THREE.Vector3()).clone();
      if (id === 'overview')
        return { target, offset: new THREE.Vector3(45, 180, 240), radius: 120 };
      const b = bodyById[id];
      const radius = b.radius;
      if ((id === 'belt' || id === 'kuiper') && !feature)
        return {
          target: (layout.get('sun') ?? new THREE.Vector3()).clone(),
          offset: fitAtlasRegion(
            id === 'belt'
              ? new THREE.Vector3(14, 65, 78)
              : new THREE.Vector3(5, 44.8, 89.6),
            id === 'belt' ? 57 : 217,
            width,
            height,
          ),
          radius,
        };
      if (id === 'belt' || id === 'kuiper')
        return {
          target,
          offset: new THREE.Vector3(5, radius * 1.4, radius * 2.8),
          radius,
        };
      const towardSun = target.clone().negate().normalize();
      if (id === 'sun') towardSun.set(0.2, 0.1, 1);
      const tangent = new THREE.Vector3(-towardSun.z, 0, towardSun.x);
      let direction = towardSun
        .clone()
        .multiplyScalar(0.85)
        .addScaledVector(tangent, 0.75);
      direction.y = 0.38;
      direction.normalize();
      let multiplier = id === 'saturn' ? 7.4 : id === 'comet' ? 17 : 4.4;
      if (feature === 'rings') {
        direction.copy(atlasRingViewDirection(b, towardSun));
        multiplier = id === 'saturn' ? 6.8 : 5.8;
      }
      if (feature === 'night') {
        direction = towardSun.clone().negate().addScaledVector(tangent, 0.25);
        direction.y = 0.18;
        direction.normalize();
      }
      if (feature === 'surface' || feature === 'clouds' || feature === 'storm')
        multiplier = 2.6;
      if (feature === 'corona') multiplier = 3.5;
      if (feature === 'tail') multiplier = 30;
      if ((feature === 'earthrise' || feature === 'parent') && b.parent) {
        const parent = layout.get(b.parent)!;
        target.lerp(parent, 0.22);
        direction.copy(target).sub(parent).normalize();
        direction.add(new THREE.Vector3(0.6, 0.3, 0.7)).normalize();
        multiplier = (b.orbit / b.radius) * 2.5;
      }
      if (mobile) multiplier *= 1.9;
      const portraitOffset = direction.multiplyScalar(radius * multiplier);
      const systemView =
        (feature === 'parent' || feature === 'earthrise') && b.parent;
      let fitted = portraitOffset;
      if (!feature) fitted = fitAtlasPortrait(portraitOffset, b, width, height);
      else if (
        mobile ||
        systemView ||
        feature === 'rings' ||
        isCompactLandscape(width, height)
      ) {
        const subjects = [
          { body: b, center: layout.get(id)!.clone().sub(target) },
        ];
        if (systemView)
          subjects.push({
            body: bodyById[b.parent!],
            center: layout.get(b.parent!)!.clone().sub(target),
          });
        fitted = fitAtlasFeature(
          portraitOffset,
          subjects,
          width,
          height,
          feature === 'surface' || feature === 'clouds' || feature === 'storm'
            ? 'detail'
            : 'globe',
        );
      }
      return {
        target,
        offset: fitted,
        radius,
      };
    }
    function atlasFraming(id: Destination, feature = '') {
      if ((id === 'belt' || id === 'kuiper') && !feature)
        return atlasRegionFraming(width, height);
      const portrait = !['overview', 'belt', 'kuiper'].includes(id);
      if (portrait) return atlasPortraitFraming(width, height);
      return {
        horizontal: 0.28,
        vertical: mobile ? -0.16 : 0.12,
      };
    }
    function restoreAtlas() {
      if (!historical) {
        missionLoading = false;
        return;
      }
      historical = false;
      missionLoading = false;
      for (const b of bodies) {
        const group = bodyGroups.get(b.id);
        const original = atlasPositions.get(b.id)!;
        positions.set(b.id, original.clone());
        if (group) {
          group.visible = true;
          group.position.copy(original);
          group.scale.setScalar(1);
          group
            .getObjectByName('body-axis')!
            .rotation.set(0, 0, b.tilt ?? 0.05);
          const rings = group.getObjectByName('planet-rings') as
            | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
            | undefined;
          if (rings)
            rings.material.uniforms.sun.value
              .copy(original)
              .negate()
              .normalize()
              .applyQuaternion(
                group.getObjectByName('body-axis')!.quaternion.clone().invert(),
              );
        }
      }
      sunPosition.set(0, 0, 0);
      pointLight.position.set(0, 0, 0);
      camera.near = 0.025;
      camera.far = 4000;
      camera.updateProjectionMatrix();
      const view = viewFor(currentDestination);
      look.copy(view.target);
      camera.position.copy(view.target).add(view.offset);
      distance = view.offset.length();
    }
    function applyHistoricalFrame(
      data: Pick<EphemerisBundle, 'radiiKm' | 'poles'>,
      bodyPositions: Map<BodyId, THREE.Vector3>,
    ) {
      historical = true;
      for (const b of bodies) {
        const group = bodyGroups.get(b.id);
        if (!group) continue;
        const position = bodyPositions.get(b.id);
        group.visible = !!position;
        if (!position) continue;
        positions.set(b.id, position.clone());
        group.position.copy(position);
        group.scale.setScalar(
          (data.radiiKm[b.id] ?? 1) / KM_PER_UNIT / b.radius,
        );
        const pole = data.poles?.[b.id];
        if (pole)
          group
            .getObjectByName('body-axis')!
            .quaternion.setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(pole[0], pole[2], -pole[1]).normalize(),
            );
        else
          group
            .getObjectByName('body-axis')!
            .rotation.set(0, 0, b.tilt ?? 0.05);
        const rings = group.getObjectByName('planet-rings') as
          | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
          | undefined;
        if (rings) {
          const axis = group.getObjectByName('body-axis')!;
          rings.material.uniforms.sun.value
            .copy(bodyPositions.get('sun')!)
            .sub(position)
            .normalize()
            .applyQuaternion(axis.quaternion.clone().invert());
        }
      }
      sunPosition.copy(bodyPositions.get('sun')!);
      pointLight.position.copy(sunPosition);
    }
    const markerIds = contextBodies;
    const markerGeometry = new THREE.BufferGeometry();
    const markerPositions = new Float32Array(markerIds.length * 3);
    markerGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(markerPositions, 3),
    );
    markerGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        markerIds.flatMap((id) =>
          new THREE.Color(bodyById[id].color).toArray(),
        ),
        3,
      ),
    );
    markerGeometry.setAttribute(
      'pointScale',
      new THREE.Float32BufferAttribute(
        markerIds.map((id) => (id === 'sun' ? 3 : 1)),
        1,
      ),
    );
    const markerMaterial = new THREE.ShaderMaterial({
      uniforms: {
        opacity: { value: 0 },
        pointSize: { value: 7 * renderer.getPixelRatio() },
      },
      vertexShader:
        'attribute vec3 color;attribute float pointScale;varying vec3 tint;uniform float pointSize;void main(){tint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize*pointScale;}',
      fragmentShader: `varying vec3 tint;
        uniform float opacity;
        void main() {
          float radius = length(gl_PointCoord - .5) * 2.;
          float edge = max(fwidth(radius), .08);
          float coverage = 1. - smoothstep(.68 - edge, .68 + edge, radius);
          gl_FragColor = vec4(tint * 1.25, coverage * opacity);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const markers = new THREE.Points(markerGeometry, markerMaterial);
    markers.frustumCulled = false;
    markers.visible = false;
    scene.add(markers);
    resources.push(markerGeometry, markerMaterial);

    function showTransitionContext(
      frame: ReturnType<ExpeditionFlight['update']>,
    ) {
      markers.visible = frame.overview > 0;
      markerMaterial.uniforms.opacity.value = frame.overview;
      markerMaterial.uniforms.pointSize.value = 7 * renderer.getPixelRatio();
      if (!markers.visible) return;
      markerIds.forEach((id, i) => {
        const position = frame.bodies.get(id);
        if (!position) return;
        markerPositions[i * 3] = position.x - frame.look.x;
        markerPositions[i * 3 + 1] = position.y - frame.look.y;
        markerPositions[i * 3 + 2] = position.z - frame.look.z;
      });
      markerGeometry.attributes.position.needsUpdate = true;
    }

    function placeMission(
      record: MissionFlight | null,
      opacity: number,
      origin: THREE.Vector3,
    ) {
      if (!record) return;
      record.group.position.copy(record.origin).sub(origin);
      record.group.visible = opacity > 0.001;
      record.showPath(pathPresence);
      record.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
          return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          material.userData.baseOpacity ??= material.opacity;
          material.userData.baseTransparent ??= material.transparent;
          material.transparent = true;
          material.opacity = material.userData.baseOpacity * opacity;
        }
      });
    }
    function startSeek(progress: number) {
      if (!mission) return;
      const previous = mission.update(0, true, false, mobile);
      // An interrupted discovery may be zoomed in. Measure the return offset
      // against the pursuit pose, not the close-up that seeking cancels.
      mission.seek(previous.progress);
      const frame = mission.update(0, true, false, mobile);
      seekMotion = {
        elapsed: 0,
        from: frame.progress,
        to: THREE.MathUtils.clamp(progress, 0, 1),
        cameraOffset: camera.position.clone().sub(frame.position),
        lookOffset: look.clone().sub(frame.look),
        verticalOffset: cameraFraming.vertical - 0.2,
      };
      manualMission = false;
      userZoom = 1;
    }
    function captureAtlas(et: number, utc: string): ExpeditionView {
      return {
        position: camera.position.clone(),
        look: look.clone(),
        bodies: new Map(
          bodies.map((body) => [body.id, atlasPositions.get(body.id)!.clone()]),
        ),
        radiiKm: Object.fromEntries(
          bodies.map((b) => [b.id, b.radius * KM_PER_UNIT]),
        ),
        et,
        utc,
        atlasBlend: 1,
        fovOffset: 0,
        bank: 0,
        framing: { ...cameraFraming },
      };
    }
    async function beginFlight(req: FlightRequest, instant = false) {
      if (!positions.size) return;
      automaticOrbit.reset();
      const selected =
        req.destination === 'overview' ? undefined : bodyById[req.destination];
      automaticView =
        selected?.parent &&
        (req.feature === 'parent' || req.feature === 'earthrise')
          ? {
              width,
              height,
              subject: selected,
              parent: bodyById[selected.parent],
            }
          : selected?.id === 'uranus' && req.feature === 'rings'
            ? { width, height, subject: selected, minimumRingAperture: 0.55 }
            : undefined;
      const ticket = ++loadSerial;
      manualMission = false;
      pendingSeek = undefined;
      seekMotion = null;
      if (req.missionIndex !== undefined) {
        const milestone = milestones[req.missionIndex];
        if (milestone) {
          flight = null;
          currentDestination = milestone.body;
          userZoom = 1;
          orbitDrift = 0;
          missionLoading = true;
          telemetry = {
            phase: 'travel',
            progress: 0,
            ready: false,
            destination: currentDestination,
            distance,
            missionIndex: req.missionIndex,
          };
          live.current.onTelemetry(telemetry);
          try {
            // Keep the outgoing composition intact until both records are ready.
            const [data, overview, spacecraft] = await Promise.all([
              loadEphemeris(req.missionIndex),
              historicalView && historicalView.atlasBlend !== 1 && !instant
                ? loadTimelapse()
                : Promise.resolve(null),
              loadSpacecraftModel(milestone.mission),
            ]);
            if (disposed || ticket !== loadSerial) {
              disposeSpacecraft(spacecraft);
              return;
            }
            const incoming = new MissionFlight(milestone, data, spacecraft, {
              terminal: req.missionIndex === milestones.length - 1,
            });
            try {
              if (data.tracks.craft)
                await prepareSpacecraft(incoming.craft, {
                  group: incoming.group,
                  current: () => ticket === loadSerial,
                });
            } catch (error) {
              incoming.dispose();
              throw error;
            }
            if (disposed || ticket !== loadSerial) {
              incoming.dispose();
              return;
            }
            departingMission?.dispose();
            departingMission = mission;
            mission = incoming;
            if (pendingSeek !== undefined) mission.seek(pendingSeek);
            pendingSeek = undefined;
            const frame = mission.update(0, true, false, mobile);
            scene.add(mission.group);
            mission.group.visible = false;
            const destination: ExpeditionView = {
              ...frame,
              position: frame.position.clone().add(mission.origin),
              look: frame.look.clone().add(mission.origin),
              bodies: new Map(
                [...mission.bodyPositions].map(([id, pos]) => [
                  id,
                  pos.clone().add(mission!.origin),
                ]),
              ),
              radiiKm: data.radiiKm,
              poles: data.poles,
              atlasBlend: 0,
              framing: {
                horizontal: 0.12,
                vertical:
                  0.2 + (mobile ? (frame.discovery?.amount ?? 0) * 0.2 : 0),
              },
            };
            const departure =
              historicalView ?? captureAtlas(frame.et, frame.utc);
            expeditionToAtlas = false;
            expedition =
              !instant && !reduced.matches
                ? new ExpeditionFlight(departure, destination, overview, mobile)
                : null;
            if (!expedition) {
              departingMission?.dispose();
              departingMission = null;
              mission.group.visible = true;
            }
            missionLoading = false;
            // The next chapter needs no network round trip for the wide time-lapse.
            void loadTimelapse().catch(() => {});
            const nextIndex = req.missionIndex + 1;
            if (nextIndex < milestones.length) {
              void loadEphemeris(nextIndex).catch(() => {});
              preloadSpacecraftModel(milestones[nextIndex].mission);
            }
          } catch {
            if (disposed || ticket !== loadSerial) return;
            missionLoading = false;
            telemetry = {
              ...telemetry,
              ready: true,
              ephemerisError:
                'Trajectory data could not be loaded. Retry this chapter.',
            };
            live.current.onTelemetry(telemetry);
          }
          return;
        }
      }
      const outgoingView = historicalView;
      expedition = null;
      markers.visible = false;
      departingMission?.dispose();
      departingMission = null;
      if (outgoingView) departingMission = mission;
      else mission?.dispose();
      mission = null;
      restoreAtlas();
      const dest = viewFor(req.destination, req.feature);
      if (outgoingView && !reduced.matches && !instant) {
        const destination = captureAtlas(outgoingView.et, outgoingView.utc);
        destination.position.copy(dest.target).add(dest.offset);
        destination.look.copy(dest.target);
        destination.framing = atlasFraming(req.destination, req.feature);
        expedition = new ExpeditionFlight(
          outgoingView,
          destination,
          null,
          mobile,
        );
        expeditionToAtlas = true;
        historicalView = outgoingView;
        currentDestination = req.destination;
        flight = null;
        userZoom = 1;
        orbitDrift = 0;
        missionLoading = false;
        return;
      }
      departingMission?.dispose();
      departingMission = null;
      historicalView = null;
      const start = camera.position.clone();
      const previousBody =
        currentDestination === 'overview'
          ? undefined
          : bodyById[currentDestination];
      const leadArrival = Boolean(
        !req.feature &&
        selected?.parent &&
        ['uranus', 'neptune'].includes(selected.parent) &&
        (previousBody?.id === selected.parent ||
          previousBody?.parent === selected.parent),
      );
      const end = dest.target.clone().add(dest.offset);
      const travel = start.distanceTo(end);
      const fromLook = look.clone();
      const departure = start.clone().add(
        start
          .clone()
          .sub(fromLook)
          .normalize()
          .multiplyScalar(Math.min(travel * 0.18, 30)),
      );
      const approach = end.clone().add(
        dest.offset
          .clone()
          .normalize()
          .multiplyScalar(Math.min(travel * 0.15, 34)),
      );
      departure.y += Math.min(travel * 0.12, 22);
      approach.y += Math.min(travel * 0.12, 22);
      const curve = new THREE.CatmullRomCurve3(
        [start, departure, approach, end],
        false,
        'centripetal',
      );
      const duration =
        instant || reduced.matches
          ? 0.01
          : Math.max(3.5, Math.min(8, 3.8 + travel * 0.024));
      flight = {
        t: instant || reduced.matches ? 1 : 0,
        duration,
        curve,
        fromLook,
        toLook: dest.target,
        endOffset: dest.offset,
        radius: dest.radius,
        overview: req.destination === 'overview',
        leadArrival,
        framing: new AtlasFramingTransition(
          cameraFraming,
          atlasFraming(req.destination, req.feature),
        ),
      };
      currentDestination = req.destination;
      userZoom = 1;
      orbitDrift = 0;
      telemetry = {
        phase: 'travel',
        progress: 0,
        ready: true,
        destination: currentDestination,
        distance,
      };
      live.current.onTelemetry(telemetry);
    }
    let dragging = false;
    const gesture = new PointerGesture();
    function interact() {
      // A transfer is camera choreography; let it arrive before orbital inspection.
      if (expedition || missionLoading) return;
      live.current.onInteract();
      if (mission) {
        if (!manualMission) {
          seekMotion = null;
          manualMission = true;
          manualPauseSeen = live.current.flightPaused;
          const delta = camera.position.clone().sub(look);
          distance = delta.length();
          userZoom = 1;
          const spherical = new THREE.Spherical().setFromVector3(delta);
          yaw = spherical.theta;
          pitch = Math.PI / 2 - spherical.phi;
        }
        return;
      }
      if (flight) {
        ++loadSerial;
        restoreAtlas();
        const radius =
          currentDestination === 'overview'
            ? 120
            : bodyById[currentDestination].radius;
        const delta = camera.position.clone().sub(look);
        distance = Math.max(radius * 1.3, delta.length());
        const sph = new THREE.Spherical().setFromVector3(delta);
        yaw = sph.theta;
        pitch = Math.PI / 2 - sph.phi;
        flight = null;
      }
    }
    const down = (e: PointerEvent) => {
      gesture.start(e.pointerId, e.clientX, e.clientY);
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const motion = gesture.move(e.pointerId, e.clientX, e.clientY);
      if (!motion || expedition || missionLoading) return;
      if (motion.interacting) interact();
      if (motion.pinchScale !== undefined) {
        userZoom = THREE.MathUtils.clamp(userZoom * motion.pinchScale, 0.5, 8);
      } else {
        yaw -= motion.dx * 0.004;
        pitch = THREE.MathUtils.clamp(pitch + motion.dy * 0.004, -1.3, 1.3);
      }
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const up = (e: PointerEvent) => {
      const click = gesture.end(e.pointerId, e.clientX, e.clientY);
      dragging = gesture.active;
      if (click && !flight && !expedition && !missionLoading) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(
          [...bodyMeshes.values()],
          false,
        )[0];
        if (hit) live.current.onSelect(hit.object.userData.bodyId);
      }
    };
    const cancel = (e: PointerEvent) => {
      gesture.cancel(e.pointerId);
      dragging = gesture.active;
    };
    const zoomBy = (amount: number) => {
      if (expedition || missionLoading) return;
      interact();
      userZoom = THREE.MathUtils.clamp(
        userZoom * Math.exp(-amount * 0.18),
        0.52,
        8,
      );
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(-e.deltaY * 0.012);
    };
    const key = (e: KeyboardEvent) => {
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '=',
          '-',
          'Home',
        ].includes(e.key)
      )
        return;
      e.preventDefault();
      interact();
      if (e.key === 'ArrowLeft') yaw -= 0.12;
      if (e.key === 'ArrowRight') yaw += 0.12;
      if (e.key === 'ArrowUp') pitch = Math.min(1.3, pitch + 0.1);
      if (e.key === 'ArrowDown') pitch = Math.max(-1.3, pitch - 0.1);
      if (e.key === '+' || e.key === '=') zoomBy(1);
      if (e.key === '-') zoomBy(-1);
      if (e.key === 'Home') void beginFlight(live.current.request);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', key);
    // oxlint-disable-next-line react/react-compiler -- Publish imperative scene controls through the caller-owned ref.
    controller.current = {
      zoom: zoomBy,
      reset: () => {
        void beginFlight(live.current.request);
      },
      getState: () => telemetry,
      seekMission: (progress) => {
        if (missionLoading || expedition) pendingSeek = progress;
        else startSeek(progress);
      },
    };
    const projection = new THREE.Vector3();
    const storyProjector = new StoryProjector();
    const storyCenter = new THREE.Vector3();
    const focusRight = new THREE.Vector3();
    const focusUp = new THREE.Vector3();
    const framedLook = new THREE.Vector3();
    const viewDirection = new THREE.Vector3();
    function animate(now: number) {
      if (disposed || failed) return;
      raf = requestAnimationFrame(animate);
      const wallDelta = Math.min((now - lastTime) / 1000 || 0.016, 0.25);
      const dt = Math.min(wallDelta, 0.045);
      lastTime = now;
      if (document.hidden) return;
      const p = live.current;
      const welcomePresence = welcomeCamera.update(
        wallDelta,
        p.introActive,
        p.introLeaving,
        reduced.matches,
        !!mission && !missionLoading && mission.data.id === 'sputnik',
      );
      const precedingView = historicalView;
      if (p.motion && !reduced.matches) elapsed += dt;
      if (p.request.serial !== lastSerial) {
        lastSerial = p.request.serial;
        void beginFlight(p.request, p.request.entrance || lastSerial === 0);
      }
      pathPresence = pathVisibility.update(
        p.paths && !flight && !expedition && !seekMotion && !missionLoading,
        // Presentation controls remain responsive while the mission is paused.
        wallDelta,
        reduced.matches,
      );
      // Keep the departure composition still until its guides are gone.
      const travelDelta = pathPresence === 0 || reduced.matches ? wallDelta : 0;
      if (expedition && !missionLoading) {
        let incoming: ReturnType<MissionFlight['update']> | undefined;
        if (mission && expedition.acquiring) {
          const acquisition = mission.update(
            travelDelta * p.speed,
            p.flightPaused,
            reduced.matches,
            mobile,
          );
          incoming = acquisition;
          expedition.setArrival({
            ...acquisition,
            position: acquisition.position.clone().add(mission.origin),
            look: acquisition.look.clone().add(mission.origin),
            bodies: new Map(
              [...mission.bodyPositions].map(([id, position]) => [
                id,
                position.clone().add(mission!.origin),
              ]),
            ),
            radiiKm: mission.data.radiiKm,
            poles: mission.data.poles,
            atlasBlend: 0,
            framing: {
              horizontal: 0.12,
              vertical:
                0.2 + (mobile ? (acquisition.discovery?.amount ?? 0) * 0.2 : 0),
            },
          });
        }
        const frame = expedition.update(
          travelDelta,
          p.flightPaused,
          reduced.matches,
        );
        cameraFraming = frame.framing;
        cameraBank = frame.bank;
        const relativeBodies = new Map(
          [...frame.bodies].map(([id, position]) => [
            id,
            position.clone().sub(frame.look),
          ]),
        );
        applyHistoricalFrame(frame, relativeBodies);
        camera.position.copy(frame.position).sub(frame.look);
        look.set(0, 0, 0);
        distance = camera.position.length();
        // Keep enough depth precision to separate cloud layers from surfaces.
        camera.near = Math.max(1e-10, distance / 100);
        camera.far = Math.max(30000, distance * 3);
        camera.fov = (mobile ? 49 : 42) + frame.fovOffset;
        camera.updateProjectionMatrix();
        historicalView = frame;
        placeMission(
          departingMission,
          frame.phase === 'departing'
            ? 1 - easeFlight(frame.progress / 0.15)
            : 0,
          frame.look,
        );
        placeMission(
          mission,
          frame.phase === 'arriving'
            ? easeFlight((frame.progress - 0.78) / 0.18)
            : 0,
          frame.look,
        );
        showTransitionContext(frame);
        telemetry = {
          phase: 'travel',
          progress: incoming?.progress ?? 0,
          ready: true,
          destination: currentDestination,
          distance,
          missionIndex: p.request.missionIndex,
          utc: expeditionToAtlas ? undefined : frame.utc,
          transition: frame.phase,
          transitionProgress: frame.progress,
          transitionClock: !!expedition.data,
          chapterTransfer: true,
          discovery: incoming?.discovery,
          missionPhase: incoming?.phase,
          focus: incoming?.focus ?? expedition.to.focus,
        };
        if (frame.done) {
          expedition = null;
          departingMission?.dispose();
          departingMission = null;
          markers.visible = false;
          if (expeditionToAtlas) {
            restoreAtlas();
            camera.position.copy(frame.position);
            look.copy(frame.look);
            distance = camera.position.distanceTo(look);
            const spherical = new THREE.Spherical().setFromVector3(
              camera.position.clone().sub(look),
            );
            yaw = spherical.theta;
            pitch = Math.PI / 2 - spherical.phi;
            expeditionToAtlas = false;
            historicalView = null;
          } else {
            // Rebase camera AND bodies together on the final rendered frame.
            camera.position.copy(frame.position).sub(mission!.origin);
            look.copy(frame.look).sub(mission!.origin);
            applyHistoricalFrame(mission!.data, mission!.bodyPositions);
            mission!.group.position.set(0, 0, 0);
            if (pendingSeek !== undefined) {
              startSeek(pendingSeek);
              pendingSeek = undefined;
            }
          }
        }
      } else if (mission && !missionLoading && !telemetry.ephemerisError) {
        camera.fov = mobile ? 49 : 42;
        cameraBank = 0;
        markers.visible = false;
        if (manualMission) {
          if (p.flightPaused) manualPauseSeen = true;
          else if (manualPauseSeen)
            startSeek(mission.update(0, true, false, mobile).progress);
        }
        if (seekMotion) {
          seekMotion.elapsed = reduced.matches
            ? 1.4
            : Math.min(1.4, seekMotion.elapsed + travelDelta);
          mission.seek(
            THREE.MathUtils.lerp(
              seekMotion.from,
              seekMotion.to,
              easeFlight(seekMotion.elapsed / 1.4),
            ),
          );
        }
        const frame = mission.update(
          wallDelta * p.speed,
          p.flightPaused ||
            manualMission ||
            !!seekMotion ||
            (mission.data.id === 'sputnik' && welcomePresence > 0),
          reduced.matches,
          mobile,
        );
        if (!manualMission)
          cameraFraming = {
            horizontal: 0.12,
            vertical: 0.2 + (mobile ? (frame.discovery?.amount ?? 0) * 0.2 : 0),
          };
        mission.group.position.set(0, 0, 0);
        mission.group.visible = true;
        applyHistoricalFrame(mission.data, mission.bodyPositions);
        if (manualMission) {
          const desired = new THREE.Vector3()
            .setFromSphericalCoords(
              distance * userZoom,
              Math.PI / 2 - pitch,
              yaw,
            )
            .add(look);
          for (const [id, center] of mission.bodyPositions) {
            const radius = (mission.data.radiiKm[id] ?? 1) / KM_PER_UNIT;
            if (desired.distanceTo(center) < radius * 1.2) {
              const away = desired.clone().sub(center).normalize();
              if (away.lengthSq() === 0) away.set(0, 1, 0);
              desired.copy(center).addScaledVector(away, radius * 1.2);
            }
          }
          camera.position.copy(desired);
        } else {
          camera.position.copy(frame.position);
          look.copy(frame.look);
          if (seekMotion) {
            const remaining = 1 - easeFlight(seekMotion.elapsed / 1.4);
            camera.position.addScaledVector(seekMotion.cameraOffset, remaining);
            look.addScaledVector(seekMotion.lookOffset, remaining);
            cameraFraming.vertical += seekMotion.verticalOffset * remaining;
            for (const [id, center] of mission.bodyPositions) {
              const radius = (mission.data.radiiKm[id] ?? 1) / KM_PER_UNIT;
              if (camera.position.distanceTo(center) < radius * 1.2) {
                const away = camera.position.clone().sub(center).normalize();
                if (away.lengthSq() === 0) away.set(0, 1, 0);
                camera.position
                  .copy(center)
                  .addScaledVector(away, radius * 1.2);
              }
            }
            if (seekMotion.elapsed === 1.4) seekMotion = null;
          }
          if (mission.data.id === 'sputnik' && welcomePresence > 0) {
            const center = mission.bodyPositions.get('earth')!;
            const sourcePole = mission.data.poles?.earth;
            const pole = sourcePole
              ? new THREE.Vector3(sourcePole[0], sourcePole[2], -sourcePole[1])
              : new THREE.Vector3(0, 1, 0);
            welcomePortrait(
              camera.position,
              look,
              center,
              mission.bodyPositions.get('sun')!,
              mission.data.radiiKm.earth! / KM_PER_UNIT,
              pole,
              welcomePresence,
              width,
              height,
              welcomeCamera.drift,
            );
            cameraFraming = welcomeFraming(
              cameraFraming,
              welcomePresence,
              width,
              height,
            );
          }
          distance = camera.position.distanceTo(look);
        }
        camera.near = Math.max(1e-10, camera.position.distanceTo(look) / 100);
        camera.far = Math.max(30000, frame.position.length() * 3);
        camera.updateProjectionMatrix();
        telemetry = {
          phase: frame.phase === 'discovery' ? 'orbit' : 'travel',
          progress: frame.progress,
          ready: true,
          destination: currentDestination,
          missionPhase: frame.phase,
          missionIndex: p.request.missionIndex,
          distance: camera.position.distanceTo(look),
          utc: frame.utc,
          focus: frame.focus,
          rangeKm: frame.rangeKm,
          relativeSpeedKmS: frame.relativeSpeedKmS,
          events: mission.data.events,
          discovery: frame.discovery,
          chapterComplete: frame.chapterComplete,
          closingProgress: frame.closingProgress,
          transition: seekMotion ? 'timelapse' : undefined,
          transitionProgress: seekMotion ? seekMotion.elapsed / 1.4 : undefined,
          transitionClock: seekMotion
            ? seekMotion.from !== seekMotion.to
            : undefined,
        };
        historicalView = {
          position: camera.position.clone().add(mission.origin),
          look: look.clone().add(mission.origin),
          bodies: new Map(
            [...mission.bodyPositions].map(([id, position]) => [
              id,
              position.clone().add(mission!.origin),
            ]),
          ),
          radiiKm: mission.data.radiiKm,
          poles: mission.data.poles,
          et: frame.et,
          utc: frame.utc,
          atlasBlend: 0,
          focus: frame.focus,
          fovOffset: 0,
          bank: 0,
          framing: { ...cameraFraming },
        };
        mission.showPath(pathPresence);
      } else if (flight) {
        cameraBank = 0;
        if (reduced.matches) flight.t = 1;
        else if (!p.flightPaused)
          flight.t = Math.min(
            1,
            flight.t + (travelDelta * p.speed) / flight.duration,
          );
        cameraFraming = flight.framing.at(flight.t);
        const t = smooth(flight.t);
        camera.position.copy(flight.curve.getPoint(t));
        if (flight.resizeCorrection) {
          const correction = flight.resizeCorrection;
          const amount = easeFlight(
            (flight.t - correction.progress) /
              Math.max(1 - correction.progress, 1e-10),
          );
          camera.position.add(
            correction.from.clone().lerp(correction.to, amount),
          );
        }
        look.lerpVectors(
          flight.fromLook,
          flight.toLook,
          flight.leadArrival ? atlasArrivalLookProgress(flight.t) : t,
        );
        telemetry = {
          phase: 'travel',
          progress: flight.t,
          ready: true,
          destination: currentDestination,
          distance: camera.position.distanceTo(look),
        };
        if (flight.t === 1) {
          offset.copy(flight.endOffset);
          distance = offset.length();
          const sph = new THREE.Spherical().setFromVector3(offset);
          yaw = sph.theta;
          pitch = Math.PI / 2 - sph.phi;
          look.copy(flight.toLook);
          flight = null;
          telemetry.phase = 'orbit';
        }
      } else if (!missionLoading && !telemetry.ephemerisError) {
        if (p.motion && !dragging && !reduced.matches) {
          const body = bodyById[currentDestination as BodyId];
          if (body && (body.parent || automaticView)) {
            orbitDrift =
              automaticOrbit.advance(dt, yaw + orbitDrift, {
                radius: distance * userZoom,
                pitch,
                target: look,
                subject: positions.get(body.id)!,
                parent: positions.get(body.parent ?? body.id)!,
                parentRadius: body.parent ? bodyById[body.parent].radius : 0,
                viewport: automaticView,
              }) - yaw;
          } else
            orbitDrift +=
              dt * (currentDestination === 'overview' ? 0.007 : 0.027);
        }
        const desired = new THREE.Vector3()
          .setFromSphericalCoords(
            distance * userZoom,
            Math.PI / 2 - pitch,
            yaw + orbitDrift,
          )
          .add(look);
        camera.position.lerp(
          desired,
          reduced.matches ? 1 : 1 - Math.exp(-dt * 6),
        );
        telemetry = {
          phase: 'orbit',
          progress: 1,
          ready: true,
          destination: currentDestination,
          distance: camera.position.distanceTo(look),
        };
      }
      if (historicalView && precedingView && historicalView !== precedingView)
        historicalView.motion =
          telemetry.chapterComplete && !p.flightPaused
            ? precedingView.motion
            : viewMotion(precedingView, historicalView, wallDelta);
      viewDirection.copy(look).sub(camera.position).normalize();
      focusRight.crossVectors(viewDirection, camera.up).normalize();
      focusUp.crossVectors(focusRight, viewDirection).normalize();
      const frameDistance = camera.position.distanceTo(look);
      const h =
        frameDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const phonePortrait = mobile && !isCompactLandscape(width, height);
      framedLook
        .copy(look)
        .addScaledVector(
          focusRight,
          -h *
            camera.aspect *
            (phonePortrait
              ? (cameraFraming.portraitHorizontal ?? 0) *
                (height <= 760 ? 1.1 : 1)
              : cameraFraming.horizontal),
        );
      framedLook.addScaledVector(
        focusUp,
        -h *
          (phonePortrait
            ? (cameraFraming.portraitVertical ?? cameraFraming.vertical)
            : cameraFraming.vertical),
      );
      // Short phone screens reserve a little more sky for the subject above
      // the reading area. This changes framing, never the historical states.
      if (mobile && height <= 760)
        framedLook.addScaledVector(focusUp, -h * 0.055);
      camera.lookAt(framedLook);
      camera.rotateZ(cameraBank);
      camera.updateMatrixWorld();
      if (p.storyBinding.current) {
        const beat = telemetry.discovery;
        const followCraft =
          mission?.craft.visible && (!beat || beat.subject === 'probe');
        const id = beat?.body ?? telemetry.focus;
        const center = followCraft
          ? mission!.craft.getWorldPosition(storyCenter)
          : id
            ? positions.get(id)
            : undefined;
        const radius = followCraft
          ? mission!.craft.scale.x * 1.8
          : id
            ? ((mission?.data.radiiKm[id] ?? 1) / KM_PER_UNIT) *
              (id === 'saturn' ? 2.3 : 1)
            : 0;
        const companion =
          followCraft && !expedition && telemetry.focus
            ? positions.get(telemetry.focus)
            : undefined;
        storyProjector.update(
          p.storyBinding.current,
          camera,
          (expedition && !expedition.acquiring) ||
            missionLoading ||
            telemetry.ephemerisError
            ? undefined
            : center,
          radius,
          width,
          height,
          dt,
          reduced.matches,
          companion
            ? {
                center: companion,
                radius:
                  ((mission!.data.radiiKm[telemetry.focus!] ?? 1) /
                    KM_PER_UNIT) *
                  (telemetry.focus === 'saturn' ? 2.31 : 1),
              }
            : undefined,
        );
      }
      mission?.presentation.update(
        width,
        height,
        renderer.getPixelRatio(),
        p.interfaceVisible,
        p.storyBinding.current
          ? {
              ...storyProjector.bounds,
              presence: p.storyBinding.current.presence ?? 0,
            }
          : undefined,
        p.transferReading.current ?? undefined,
      );
      moonMarkers.update(
        bodyGroups,
        camera,
        height,
        historical && !expedition && !missionLoading,
        renderer.getPixelRatio(),
      );
      for (const mesh of spins)
        if (!historical && p.motion && !reduced.matches)
          mesh.rotation.y += dt * 0.017;
      for (const mat of materials) mat.uniforms.time.value = elapsed;
      const halo = bodyGroups.get('sun')?.getObjectByName('sun-halo');
      if (halo) halo.quaternion.copy(camera.quaternion);
      sky.update(
        dt,
        reduced.matches,
        camera,
        width,
        skyExposure.update(
          skyExposure.target(camera, skyLightBodies, sunPosition),
          dt,
          reduced.matches,
        ),
      );
      details.update(
        (historical
          ? (telemetry.discovery?.body ?? telemetry.focus)
          : undefined) ?? p.request.destination,
        dt,
        reduced.matches,
        p.request.destination,
        { camera, height },
      );
      const saturn = bodyMeshes.get('saturn');
      if (saturn) {
        const group = bodyGroups.get('saturn')!;
        const material = saturn.material as THREE.ShaderMaterial;
        material.uniforms.bodyRadius.value =
          bodyById.saturn.radius * group.scale.x;
        material.uniforms.ringNormal.value
          .set(0, 1, 0)
          .applyQuaternion(group.getObjectByName('body-axis')!.quaternion);
      }
      const atlasBlend = historicalView?.atlasBlend ?? (historical ? 0 : 1);
      const atlasIllustration =
        historicalView?.atlasParticles ?? (historical ? 0 : 1);
      orbitGroup.position.copy(sunPosition);
      const atlasPathPresence = pathPresence * atlasIllustration;
      orbitGroup.visible = atlasPathPresence > 0.001;
      for (const line of atlasOrbits) line.visible = atlasPathPresence > 0.001;
      for (const [material, opacity] of atlasOrbitMaterials)
        material.opacity = opacity * atlasPathPresence;
      if (atlasCometTail) {
        atlasCometTail.visible = atlasIllustration > 0.001;
        atlasCometTail.material.opacity = 0.7 * atlasIllustration;
      }
      // The band remains across every destination and follows the layout.
      // Only the undated individual rocks leave before historical time moves.
      beltRegion.update(sunPosition, atlasBlend, pathPresence);
      for (const field of [belt, kuiper]) {
        field.position.copy(sunPosition);
        field.visible = atlasIllustration > 0.001;
        field.material.opacity = atlasIllustration;
        const particles = field.children[0] as THREE.Points<
          THREE.BufferGeometry,
          THREE.ShaderMaterial
        >;
        particles.material.uniforms.presence.value = atlasIllustration;
      }
      belt.rotation.y = elapsed * 0.0004;
      kuiper.rotation.y = elapsed * 0.00015;
      const occupied: Array<{ x: number; y: number }> = [];
      for (const b of bodies) {
        const button = labelRefs.current[b.id];
        if (!button) continue;
        const pos = positions.get(b.id);
        if (!pos) continue;
        const camDistance = camera.position.distanceTo(pos);
        const near = camDistance < Math.max(b.radius * 45, 14);
        const relevant =
          currentDestination === 'overview' ||
          telemetry.phase === 'travel' ||
          near;
        projection.copy(pos).project(camera);
        const onScreen =
          projection.z < 1 &&
          projection.z > -1 &&
          Math.abs(projection.x) < 0.93 &&
          Math.abs(projection.y) < 0.68;
        const x = (projection.x * 0.5 + 0.5) * width;
        const projectedRadius =
          (b.radius /
            camDistance /
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
          height *
          0.5;
        const y = (-projection.y * 0.5 + 0.5) * height + projectedRadius + 12;
        const collision = occupied.some(
          (point) => Math.abs(point.x - x) < 110 && Math.abs(point.y - y) < 26,
        );
        const visible =
          !historical &&
          !missionLoading &&
          !collision &&
          atlasLabelFits(x, y, width, height) &&
          p.labels &&
          onScreen &&
          relevant &&
          (currentDestination === 'overview' ? !b.parent : true);
        button.style.display = visible ? 'flex' : 'none';
        if (visible) {
          button.style.transform = `translate(${x}px,${y}px) translateX(-50%)`;
          occupied.push({ x, y });
        }
      }
      const litCraft =
        mission?.group.visible && mission.craft.visible
          ? mission.craft
          : departingMission?.group.visible && departingMission.craft.visible
            ? departingMission.craft
            : undefined;
      pointLight.intensity = spacecraftLighting.update(litCraft, sunPosition)
        ? 0
        : 1.6;
      composer.render();
      if (failed) return;
      if (now - lastReport > (expedition ? 60 : 120)) {
        lastReport = now;
        p.onTelemetry(telemetry);
      }
    }
    load
      .then(async () => {
        if (disposed || failed) return;
        buildBodies();
        await composer.compile(scene);
        if (disposed || failed) return;
        setStatus('ready');
        setLoadProgress(100);
        void beginFlight(live.current.request, true);
        lastSerial = live.current.request.serial;
        raf = requestAnimationFrame(animate);
      })
      .catch(fail);
    return () => {
      disposed = true;
      ++loadSerial;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', key);
      mission?.dispose();
      departingMission?.dispose();
      resources.forEach((r) => r.dispose());
      textures.forEach((t) => t.dispose());
      composer.dispose();
      renderer.dispose();
      canvas.remove();
      controller.current = null;
    };
  }, [props.controller]);

  return (
    <div className={`solar-scene ${status}`} inert={props.introActive}>
      <div ref={host} className="canvas-host" />
      <div className="body-labels" aria-label="Visible destinations">
        {bodies.map((b) => (
          <button
            key={b.id}
            ref={(el) => {
              labelRefs.current[b.id] = el;
            }}
            onClick={() => props.onSelect(b.id)}
            style={
              {
                display: 'none',
                '--body-color': b.color,
              } as React.CSSProperties
            }
          >
            <span />
            {b.name}
          </button>
        ))}
      </div>
      {status === 'loading' && !props.introActive && (
        <div className="scene-loading">
          <span className="loading-orbit" />
          <p>CHARTING THE SOLAR SYSTEM</p>
          <span>{Math.min(loadProgress, 99)}%</span>
        </div>
      )}
      {status === 'fallback' && !props.introActive && (
        <div className="scene-error">
          <p>3D isn’t available right now.</p>
          <span>
            You can still follow the mission timeline and read about every
            destination.
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(SolarScene);
