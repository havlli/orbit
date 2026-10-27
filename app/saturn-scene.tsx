'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export type ViewId = 'arrival' | 'rings' | 'nightfall';
export interface SceneController { zoom: (direction: number) => void; reset: () => void }
interface SceneProps { view: ViewId; paused: boolean; controller: React.RefObject<SceneController | null>; onStatus: (ready: boolean) => void }

const vertex = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normal;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const planetFragment = `
  uniform sampler2D surfaceMap;
  uniform sampler2D ringMap;
  uniform vec3 sun;
  uniform float spin;
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    vec3 normal = normalize(vNormal);
    float diffuse = max(dot(normal, sun), 0.0);
    float shade = 1.0;
    float t = -vPosition.y / sun.y;
    if (t > 0.0) {
      vec3 crossing = vPosition + t * sun;
      float radius = length(crossing.xz);
      if (radius > 1.56 && radius < 3.18) {
        float opacity = texture2D(ringMap, vec2((radius - 1.56) / 1.62, 0.5)).a;
        shade = 1.0 - opacity * 0.86;
      }
    }
    vec3 base = texture2D(surfaceMap, vec2(fract(vUv.x + spin), vUv.y)).rgb;
    vec3 color = base * (0.018 + diffuse * shade * 1.8);
    float rim = pow(1.0 - max(dot(normalize(cameraPosition - vWorld), normalize(vWorldNormal)), 0.0), 3.5);
    color += vec3(0.32, 0.23, 0.14) * rim * pow(max(dot(normal, sun), 0.0), 0.5) * 0.24;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const ringFragment = `
  uniform sampler2D ringMap;
  uniform vec3 sun;
  uniform float night;
  varying vec2 vUv;
  varying vec3 vPosition;
  void main() {
    vec4 ring = texture2D(ringMap, vec2(vUv.x, 0.5));
    if (ring.a < 0.02) discard;
    vec3 p = vPosition / vec3(1.0, 0.9, 1.0);
    vec3 l = normalize(sun / vec3(1.0, 0.9, 1.0));
    float b = dot(p, l);
    float c = dot(p, p) - 1.38 * 1.38;
    float d = b * b - c;
    float shade = (b < 0.0 && d > 0.0) ? 0.065 : 1.0;
    float light = 0.48 + 0.9 * abs(sun.y) + night * 0.18;
    vec3 color = ring.rgb * light * shade;
    gl_FragColor = vec4(color, ring.a * 0.93);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function SaturnScene({ view, paused, controller, onStatus }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const settings = useRef({ view, paused });
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  // oxlint-disable-next-line react/react-compiler -- The animation loop reads the latest settings without recreating the scene.
  settings.current = { view, paused };

  // oxlint-disable-next-line react/react-compiler -- This effect owns the imperative Three.js lifecycle and controller ref.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let frame = 0;
    let renderingFailed = false;
    let renderer: THREE.WebGLRenderer;
    const resources: Array<{ dispose: () => void }> = [];
    const loadedTextures: THREE.Texture[] = [];
    let cleanupEvents = () => {};
    const fail = () => { renderingFailed = true; if (!disposed) { setStatus('fallback'); onStatus(false); } };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { fail(); return; }
    const canvas = renderer.domElement;
    canvas.className = 'space-canvas';
    canvas.setAttribute('aria-label', 'Interactive Saturn. Drag to rotate. Use arrow keys to orbit, plus or minus to zoom, and Home to reset.');
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;
    element.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.debug.onShaderError = () => { cancelAnimationFrame(frame); fail(); };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    camera.position.z = 8.6;
    const system = new THREE.Group();
    scene.add(system);
    let width = 1, height = 1, mobile = false;
    const resize = () => {
      width = element.clientWidth; height = element.clientHeight;
      mobile = width <= 800;
      camera.aspect = width / height;
      camera.fov = mobile ? 47 : 39;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    const textureLoader = new THREE.TextureLoader();
    const loadTexture = async (url: string) => {
      const texture = await textureLoader.loadAsync(url);
      if (disposed) { texture.dispose(); throw new Error('Scene disposed'); }
      loadedTextures.push(texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      return texture;
    };
    let dragging = false;
    let lastX = 0, lastY = 0;
    let dragX = 0, dragY = 0, zoom = 0;
    const pointerDown = (event: PointerEvent) => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      dragX += (event.clientX - lastX) * 0.005;
      dragY = THREE.MathUtils.clamp(dragY + (event.clientY - lastY) * 0.005, -1.1, 1.1);
      lastX = event.clientX; lastY = event.clientY;
    };
    const pointerUp = () => { dragging = false; };
    const changeZoom = (direction: number) => { zoom = THREE.MathUtils.clamp(zoom - direction * 0.5, -2.2, 3); };
    const reset = () => { dragX = 0; dragY = 0; zoom = 0; };
    const wheel = (event: WheelEvent) => { if (mobile && !event.ctrlKey) return; event.preventDefault(); zoom = THREE.MathUtils.clamp(zoom + event.deltaY * 0.003, -2.2, 3); };
    const keyDown = (event: KeyboardEvent) => {
      let handled = true;
      if (event.key === 'ArrowLeft') dragX -= 0.15;
      else if (event.key === 'ArrowRight') dragX += 0.15;
      else if (event.key === 'ArrowUp') dragY = Math.max(-1.1, dragY - 0.12);
      else if (event.key === 'ArrowDown') dragY = Math.min(1.1, dragY + 0.12);
      else if (event.key === '+' || event.key === '=') changeZoom(1);
      else if (event.key === '-') changeZoom(-1);
      else if (event.key === 'Home') reset();
      else handled = false;
      if (handled) event.preventDefault();
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('lostpointercapture', pointerUp);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keyDown);
    const contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); fail(); };
    canvas.addEventListener('webglcontextlost', contextLost);
    // oxlint-disable-next-line react/react-compiler -- Publish the imperative scene controls through the caller-owned ref.
    controller.current = { zoom: changeZoom, reset };
    cleanupEvents = () => {
      canvas.removeEventListener('pointerdown', pointerDown);canvas.removeEventListener('pointermove', pointerMove);canvas.removeEventListener('pointerup', pointerUp);canvas.removeEventListener('pointercancel', pointerUp);canvas.removeEventListener('lostpointercapture', pointerUp);canvas.removeEventListener('wheel', wheel);canvas.removeEventListener('keydown', keyDown);canvas.removeEventListener('webglcontextlost', contextLost);
    };
    Promise.all([loadTexture('/textures/saturn.jpg'), loadTexture('/textures/rings.png')]).then(([surfaceMap, ringMap]) => {
      if (disposed) return;
      const sun = new THREE.Vector3(-3.5, 3, 5).normalize();
      const uniforms = { surfaceMap: { value: surfaceMap }, ringMap: { value: ringMap }, sun: { value: sun.clone() }, spin: { value: 0 }, night: { value: 0 } };
      const planetGeometry = new THREE.SphereGeometry(1.38, 128, 80);
      planetGeometry.scale(1, 0.9, 1);
      const planetMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: planetFragment });
      const planet = new THREE.Mesh(planetGeometry, planetMaterial);
      system.add(planet);
      const ringGeometry = new THREE.RingGeometry(1.56, 3.18, 256, 1);
      const positions = ringGeometry.attributes.position;
      const uv = ringGeometry.attributes.uv;
      for (let i = 0; i < positions.count; i++) {
        const radial = Math.hypot(positions.getX(i), positions.getY(i));
        uv.setXY(i, (radial - 1.56) / 1.62, 0.5);
      }
      ringGeometry.rotateX(-Math.PI / 2);
      const ringMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const rings = new THREE.Mesh(ringGeometry, ringMaterial);
      system.add(rings);
      resources.push(planetGeometry, planetMaterial, ringGeometry, ringMaterial);
      // Seeded, quiet stars keep the view spatial without a noisy photographic backdrop.
      let seed = 41;
      const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const starPositions = new Float32Array(480 * 3);
      for (let i = 0; i < starPositions.length; i += 3) { starPositions[i] = (random() - 0.5) * 44; starPositions[i + 1] = (random() - 0.5) * 26; starPositions[i + 2] = -10 - random() * 15; }
      const starsGeometry = new THREE.BufferGeometry();starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      const starMaterial = new THREE.PointsMaterial({ color: 0xbfc9c1, size: 0.022, transparent: true, opacity: 0.48, depthWrite: false });
      const stars = new THREE.Points(starsGeometry, starMaterial);scene.add(stars);resources.push(starsGeometry, starMaterial);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let lastTime = 0, drift = 0, previousView = settings.current.view;
      let firstFrame = true;
      const targetQuaternion = new THREE.Quaternion();const rotation = new THREE.Euler();const inverse = new THREE.Quaternion();
      const worldSun = sun.clone();
      const targets = { arrival: { x: 0.45, z: 0.32, distance: 8.6, night: 0 }, rings: { x: 0.9, z: -0.18, distance: 7.7, night: 0 }, nightfall: { x: 0.31, z: 0.26, distance: 8.4, night: 1 } };
      const animate = (time: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(animate);
        const delta = Math.min((time - lastTime) / 1000 || 0.016, 0.05);lastTime = time;
        if (document.hidden) return;
        const current = settings.current;
        if (previousView !== current.view) { reset(); previousView = current.view; }
        const target = targets[current.view];
        const lerp = firstFrame || reduced.matches ? 1 : 1 - Math.exp(-delta * 2.8);
        if (!current.paused && !dragging && !reduced.matches) { drift += delta * 0.014; uniforms.spin.value += delta * 0.003; }
        rotation.set(target.x + dragY, dragX + Math.sin(drift) * 0.075, target.z + Math.sin(drift * 0.7) * 0.018);
        targetQuaternion.setFromEuler(rotation);system.quaternion.slerp(targetQuaternion, lerp);
        // Mobile composition centers the planet below the text, with enough room for the ring silhouette.
        const desiredDistance = mobile ? target.distance * (1.0 / Math.max(camera.aspect, 0.3)) : target.distance;
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, desiredDistance + zoom, lerp);
        const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
        system.position.set(mobile ? viewHeight * camera.aspect * 0.055 : viewHeight * camera.aspect * 0.20, mobile ? -viewHeight * 0.07 : viewHeight * 0.035, 0);
        uniforms.night.value = THREE.MathUtils.lerp(uniforms.night.value, target.night, lerp);
        worldSun.set(-3.5, 3, THREE.MathUtils.lerp(5, -6, uniforms.night.value)).normalize();
        inverse.copy(system.quaternion).invert();uniforms.sun.value.copy(worldSun).applyQuaternion(inverse);
        stars.rotation.y = reduced.matches || current.paused ? stars.rotation.y : Math.sin(drift * 0.2) * 0.04;
        renderer.render(scene, camera);
        if (renderingFailed) { cancelAnimationFrame(frame); return; }
        if (firstFrame) { firstFrame = false; setStatus('ready'); onStatus(true); }
      };
      frame = requestAnimationFrame(animate);
    }).catch(fail);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); cleanupEvents(); controller.current = null;
      resources.forEach(resource => resource.dispose()); loadedTextures.forEach(texture => texture.dispose()); renderer.dispose(); canvas.remove();
    };
  }, [controller, onStatus]);

  return <div className={`scene scene-${status}`}>
    {/* oxlint-disable-next-line nextjs/no-img-element -- This static app uses a local fallback image without Next image optimization. */}
    <img className="saturn-fallback" src="/saturn-cassini.jpg" alt={status === 'fallback' ? 'Saturn and its rings, photographed by the Cassini spacecraft' : ''}/>
    <div className="canvas-host" ref={host}/>
    {status === 'fallback' && <span className="fallback-notice">CASSINI PHOTOGRAPH · 3D UNAVAILABLE ON THIS DEVICE</span>}
  </div>;
}
