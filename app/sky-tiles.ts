import * as THREE from 'three';

export const SKY_COLUMNS = 16;
export const SKY_ROWS = 8;
export const SKY_ROW_COLUMNS = [4, 8, 16, 16, 16, 16, 8, 4] as const;
export const SKY_TILE_SIZE = 1024;
export const SKY_GUTTER = 4;
export const SKY_EXTENT = SKY_TILE_SIZE + 2 * SKY_GUTTER;
export const SKY_OBLIQUITY = THREE.MathUtils.degToRad(84381.448 / 3600);

export interface SkyTile {
  id: number;
  row: number;
  column: number;
  geometry: THREE.BufferGeometry;
  bounds: THREE.Sphere;
  direction: THREE.Vector3;
}

/** Same sphere UV convention as the base sky, without a longitude offset at
 * the poles. Every shared edge has identical positions and source coordinates. */
export function createSkyTile(row: number, column: number): SkyTile {
  const divisions = 16;
  const columns = SKY_ROW_COLUMNS[row];
  if (column < 0 || column >= columns)
    throw new Error('Invalid sky tile column');
  const horizontalDivisions = (divisions * SKY_COLUMNS) / columns;
  const position: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let y = 0; y <= divisions; y++) {
    const theta = ((row + y / divisions) / SKY_ROWS) * Math.PI;
    for (let x = 0; x <= horizontalDivisions; x++) {
      const phi = ((column + x / horizontalDivisions) / columns) * Math.PI * 2;
      position.push(
        -Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
      uv.push(x / horizontalDivisions, 1 - y / divisions);
    }
  }
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < horizontalDivisions; x++) {
      const a = y * (horizontalDivisions + 1) + x,
        b = a + horizontalDivisions + 1;
      indices.push(a + 1, a, b + 1, a, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(position, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const transform = new THREE.Matrix4()
    .makeRotationX(-SKY_OBLIQUITY)
    .multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  const bounds = geometry.boundingSphere!.clone().applyMatrix4(transform);
  return {
    id: row * SKY_COLUMNS + column,
    row,
    column,
    geometry,
    bounds,
    direction: bounds.center.clone().normalize(),
  };
}

export function createSkyTiles() {
  return SKY_ROW_COLUMNS.flatMap((columns, row) =>
    Array.from({ length: columns }, (_, column) => createSkyTile(row, column)),
  );
}

/** Ignore camera translation: these directions remain fixed at infinity.
 * Slightly widen the loading frustum to acquire detail before it enters view. */
export function visibleSkyTiles(
  tiles: SkyTile[],
  camera: THREE.PerspectiveCamera,
) {
  const rotation = camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
  const projection = camera.projectionMatrix.clone();
  projection.elements[0] *= 0.88;
  projection.elements[5] *= 0.88;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    projection.multiply(rotation),
  );
  const sidePlanes = frustum.planes.slice(0, 4);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  return (
    tiles
      // The sky shader projects to infinity. Mission near/far planes describe
      // local worlds and must never remove its unit-radius selection geometry.
      .filter((tile) =>
        sidePlanes.every(
          (plane) =>
            plane.distanceToPoint(tile.bounds.center) >= -tile.bounds.radius,
        ),
      )
      .sort((a, b) => forward.dot(b.direction) - forward.dot(a.direction))
  );
}

export type SkyTextureLoader = (id: number) => Promise<THREE.Texture>;
export type SkyTexturePreparation = (
  texture: THREE.Texture,
  current: () => boolean,
) => Promise<boolean>;
type SkyTextureResult = { id: number; texture: THREE.Texture };

/** Two requests at most, including decoded and prepared results. Only one tile
 * is prepared at a time, with at most one GPU replacement beyond the resident
 * limit. Existing detail stays resident until its replacement is complete. */
export class SkyTileCache {
  readonly resident = new Map<number, THREE.Texture>();
  private wanted: number[] = [];
  private inFlight = new Set<number>();
  private failed = new Set<number>();
  private ready: SkyTextureResult[] = [];
  private preparing: SkyTextureResult | null = null;
  private prepared: SkyTextureResult | null = null;
  private disposed = false;
  private limit = 24;

  constructor(
    private readonly load: SkyTextureLoader,
    private readonly enter: (id: number, texture: THREE.Texture) => void,
    private readonly leave: (id: number) => void,
    private readonly prepare?: SkyTexturePreparation,
  ) {}

  request(ids: number[], limit: number) {
    this.limit = Math.max(1, Math.min(24, Math.floor(limit)));
    this.wanted = [...new Set(ids)].slice(0, this.limit);
  }

  private evict() {
    // Retain the most useful visible detail; remove off-view tiles first.
    const id =
      [...this.resident.keys()].find((key) => !this.wanted.includes(key)) ??
      [...this.resident.keys()].sort(
        (a, b) => this.wanted.indexOf(b) - this.wanted.indexOf(a),
      )[0];
    if (id === undefined) return;
    this.leave(id);
    this.resident.get(id)!.dispose();
    this.resident.delete(id);
  }

  private admit(next: SkyTextureResult) {
    this.inFlight.delete(next.id);
    if (!this.wanted.includes(next.id)) next.texture.dispose();
    else {
      while (this.resident.size >= this.limit) this.evict();
      this.resident.set(next.id, next.texture);
      this.enter(next.id, next.texture);
    }
  }

  private async prepareNext(next: SkyTextureResult) {
    const current = () => !this.disposed && this.wanted.includes(next.id);
    let complete = false;
    try {
      complete = await this.prepare!(next.texture, current);
    } catch {
      if (current()) this.failed.add(next.id);
    }
    this.preparing = null;
    if (complete && current()) this.prepared = next;
    else {
      this.inFlight.delete(next.id);
      next.texture.dispose();
    }
  }

  update() {
    if (this.disposed) return;
    while (this.resident.size > this.limit) this.evict();
    if (this.prepared) {
      const next = this.prepared;
      this.prepared = null;
      this.admit(next);
    }
    if (!this.preparing) {
      const next = this.ready.shift();
      if (next) {
        if (this.prepare && this.wanted.includes(next.id)) {
          this.preparing = next;
          void this.prepareNext(next);
        } else this.admit(next);
      }
    }
    for (const id of this.wanted) {
      if (this.inFlight.size >= 2) break;
      if (this.resident.has(id) || this.inFlight.has(id) || this.failed.has(id))
        continue;
      this.inFlight.add(id);
      void this.load(id)
        .then((texture) => {
          if (this.disposed || !this.wanted.includes(id)) {
            this.inFlight.delete(id);
            texture.dispose();
          } else this.ready.push({ id, texture });
        })
        .catch(() => {
          this.inFlight.delete(id);
          if (!this.disposed && this.wanted.includes(id)) this.failed.add(id);
        });
    }
  }

  dispose() {
    this.disposed = true;
    for (const [id, texture] of this.resident) {
      this.leave(id);
      texture.dispose();
    }
    this.resident.clear();
    for (const result of this.ready) result.texture.dispose();
    this.ready = [];
    this.prepared?.texture.dispose();
    this.prepared = null;
    // The active preparation owns its bitmap until its cancellation settles.
  }
}
