import * as THREE from 'three';
import { createModelBufferQueue } from './model-dependencies';
import type { CraftKind } from './mission-journeys';

/** A schematic silhouette, enlarged for visibility. No model is presented as flight hardware CAD. */
export function createSpacecraft(
  kind: CraftKind,
  solarWings: boolean,
  mission = '',
) {
  const group = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({
    color: '#c6d3dc',
    metalness: 0.72,
    roughness: 0.32,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: '#d6a653',
    metalness: 0.6,
    roughness: 0.43,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#172633',
    metalness: 0.45,
    roughness: 0.55,
  });
  const cells = new THREE.MeshStandardMaterial({
    color: '#203e70',
    metalness: 0.5,
    roughness: 0.28,
    emissive: '#0b1836',
    emissiveIntensity: 0.4,
  });
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    group.add(part);
    return part;
  }
  function strut(a: THREE.Vector3, b: THREE.Vector3, radius = 0.018) {
    const part = mesh(
      new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6),
      silver,
    );
    part.position.copy(a).add(b).multiplyScalar(0.5);
    part.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
  }
  if (kind === 'satellite') {
    mesh(new THREE.SphereGeometry(0.45, 32, 24), silver);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        strut(
          new THREE.Vector3(x * 0.22, y * 0.22, 0.25),
          new THREE.Vector3(x * 0.72, y * 0.72, -1.8),
          0.009,
        );
  } else if (kind === 'capsule') {
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 24), silver).rotation.x =
      Math.PI / 2;
    mesh(new THREE.ConeGeometry(0.4, 0.55, 24), silver, 0, 0, 0.68).rotation.x =
      Math.PI / 2;
    mesh(
      new THREE.CylinderGeometry(0.18, 0.26, 0.35, 20, 1, true),
      dark,
      0,
      0,
      -0.64,
    ).rotation.x = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.7, 0.55, 0.5), gold, 0, 0, -1.06);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        strut(
          new THREE.Vector3(x * 0.3, y * 0.2, -1),
          new THREE.Vector3(x * 0.65, y * 0.55, -1.35),
        );
  } else if (kind === 'lander') {
    mesh(new THREE.CylinderGeometry(0.35, 0.55, 0.38, 12), gold);
    mesh(
      new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      silver,
      0,
      0.15,
    );
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      strut(
        new THREE.Vector3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3),
        new THREE.Vector3(Math.cos(a) * 0.8, -0.5, Math.sin(a) * 0.8),
      );
      mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.04, 12),
        dark,
        Math.cos(a) * 0.8,
        -0.5,
        Math.sin(a) * 0.8,
      );
    }
  } else {
    mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.68, 8), gold).rotation.x =
      Math.PI / 2;
    if (kind === 'solar-probe') {
      mesh(
        new THREE.CylinderGeometry(0.73, 0.73, 0.1, 8),
        dark,
        0,
        0,
        0.55,
      ).rotation.x = Math.PI / 2;
    } else {
      const radius = solarWings ? 0.64 : 0.96;
      const depth = solarWings ? 0.2 : 0.27;
      const profile = Array.from({ length: 25 }, (_, i) => {
        const r = (radius * i) / 24;
        return new THREE.Vector2(r, depth * (r / radius) ** 2);
      });
      const reflector = silver.clone();
      reflector.side = THREE.DoubleSide;
      reflector.color.set('#deddd4');
      reflector.metalness = 0.32;
      reflector.roughness = 0.52;
      const dish = mesh(
        new THREE.LatheGeometry(profile, 64),
        reflector,
        0,
        0,
        0.42,
      );
      dish.rotation.x = Math.PI / 2;
      mesh(
        new THREE.TorusGeometry(radius, 0.012, 6, 64),
        silver,
        0,
        0,
        0.42 + depth,
      );
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        strut(
          new THREE.Vector3(
            Math.cos(angle) * radius * 0.82,
            Math.sin(angle) * radius * 0.82,
            0.42 + depth * 0.7,
          ),
          new THREE.Vector3(0, 0, 1.13),
          0.009,
        );
      }
      mesh(
        new THREE.CylinderGeometry(0.035, 0.06, 0.13, 12),
        dark,
        0,
        0,
        1.17,
      ).rotation.x = Math.PI / 2;
    }
    strut(new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(2, 0.25, -0.35));
    mesh(new THREE.BoxGeometry(0.2, 0.22, 0.3), dark, 2, 0.25, -0.35);
    if (solarWings || kind === 'solar-probe') {
      for (const side of [-1, 1]) {
        mesh(
          new THREE.BoxGeometry(1.25, 0.045, 0.65),
          cells,
          side * 1.16,
          0,
          -0.18,
        );
        for (let i = 0; i < 7; i++)
          mesh(
            new THREE.BoxGeometry(0.012, 0.05, 0.66),
            silver,
            side * (0.55 + i * 0.2),
            0,
            -0.18,
          );
      }
    } else {
      strut(
        new THREE.Vector3(-0.2, 0, 0),
        new THREE.Vector3(-1.3, -0.35, -0.5),
        0.035,
      );
      for (const y of [-0.58, -0.19]) {
        mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.48, 16),
          dark,
          -1.35,
          y,
          -0.5,
        ).rotation.z = Math.PI / 2;
        for (let i = 0; i < 9; i++)
          mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 0.012, 12),
            silver,
            -1.56 + i * 0.053,
            y,
            -0.5,
          ).rotation.z = Math.PI / 2;
      }
    }
  }
  if (solarWings) {
    const mastEnd = new THREE.Vector3(
      0.12,
      0.04,
      mission.includes('MARINER 2') ? -2.05 : -1.3,
    );
    for (const x of [-0.22, 0.22]) {
      strut(new THREE.Vector3(x, -0.15, -0.3), mastEnd, 0.014);
      strut(new THREE.Vector3(x, 0.15, -0.3), mastEnd, 0.014);
    }
    mesh(
      new THREE.BoxGeometry(0.18, 0.22, 0.16),
      silver,
      mastEnd.x,
      mastEnd.y,
      mastEnd.z,
    );
  }
  return group;
}

export const spacecraftModel = (mission: string) =>
  mission.includes('VOYAGER')
    ? 'voyager'
    : mission.includes('CASSINI')
      ? 'cassini'
      : mission.includes('NEW HORIZONS')
        ? 'new-horizons'
        : mission.includes('PARKER')
          ? 'parker'
          : undefined;

const scheduleModelBufferViews = createModelBufferQueue();
const templates = new Map<string, Promise<THREE.Group>>();

/** Load before the camera departs, so hardware never pops into an active shot.
 * NASA templates retain shared textures; each flight owns its cloned geometry
 * and materials and can dispose them independently. Attitude is illustrative. */
function loadTemplate(id: string) {
  let pending = templates.get(id);
  if (!pending) {
    pending = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) =>
        new GLTFLoader()
          .register(scheduleModelBufferViews)
          .loadAsync(`/models/${id}.glb`),
      )
      .then((gltf) => gltf.scene);
    templates.set(id, pending);
  }
  return pending;
}

/** Warm only the shared template; no flight-owned clone or GPU allocation. */
export function preloadSpacecraftModel(mission: string) {
  const id = spacecraftModel(mission);
  if (id) void loadTemplate(id).catch(() => templates.delete(id));
}

/** Each flight owns its surfaces, while source textures stay shared. */
export function cloneSpacecraftSurface(source: THREE.Material) {
  const material = source.clone();
  if (material instanceof THREE.MeshStandardMaterial) {
    // Retain a distinction between metal, foil and matte insulation. Bound
    // mirror-like glints without flattening every surface to one roughness.
    material.metalness = Math.min(material.metalness, 0.8);
    material.roughness = Math.max(
      material.roughness,
      material.metalness > 0.5 ? 0.36 : 0.5,
    );
  }
  return material;
}

export async function loadSpacecraftModel(mission: string) {
  const id = spacecraftModel(mission);
  if (!id) return undefined;
  try {
    const model = (await loadTemplate(id)).clone(true);
    const materials = new Map<THREE.Material, THREE.Material>();
    const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    const relight = (source: THREE.Material) => {
      if (!materials.has(source))
        materials.set(source, cloneSpacecraftSurface(source));
      return materials.get(source)!;
    };
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      if (!geometries.has(geometry)) geometries.set(geometry, geometry.clone());
      object.geometry = geometries.get(geometry)!;
      object.material = Array.isArray(object.material)
        ? object.material.map(relight)
        : relight(object.material);
    });
    // The visualization assets use a vertical spacecraft axis. Present that
    // axis as +Z, the same local convention used by the procedural silhouettes.
    model.rotation.x = Math.PI / 2;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 4.2 / Math.max(size.x, size.y, size.z);
    model.position.copy(center).multiplyScalar(-scale);
    model.scale.setScalar(scale);
    const group = new THREE.Group();
    group.add(model);
    group.userData.model = id;
    return group;
  } catch (error) {
    templates.delete(id);
    console.warn(
      `The ${id} visualization model could not be loaded; using its schematic silhouette.`,
      error,
    );
    return undefined;
  }
}

/** Dispose a flight-owned clone, including an abandoned asynchronous load. */
export function disposeSpacecraft(model: THREE.Group | undefined) {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  model?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => resources.add(material));
  });
  resources.forEach((resource) => resource.dispose());
}
