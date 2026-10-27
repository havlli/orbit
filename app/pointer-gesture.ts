interface PointerPoint {
  x: number;
  y: number;
}

export interface PointerMotion {
  dx: number;
  dy: number;
  interacting: boolean;
  pinchScale?: number;
}

/** Pointer bookkeeping only; camera rotation, zoom limits and selection stay
 * with the scene. A surviving finger continues from its own last position. */
export class PointerGesture {
  private readonly points = new Map<number, PointerPoint>();
  private startPoint: PointerPoint = { x: 0, y: 0 };
  private previous: PointerPoint = { x: 0, y: 0 };
  private pinchDistance = 0;
  private suppressTap = false;

  get active() {
    return this.points.size > 0;
  }

  start(id: number, x: number, y: number) {
    if (!this.active) this.suppressTap = false;
    this.points.set(id, { x, y });
    this.startPoint = this.previous = { x, y };
    if (this.points.size > 1) this.suppressTap = true;
    if (this.points.size === 2) {
      const [a, b] = [...this.points.values()];
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  move(id: number, x: number, y: number): PointerMotion | undefined {
    if (!this.points.has(id)) return;
    const motion: PointerMotion = {
      dx: x - this.previous.x,
      dy: y - this.previous.y,
      interacting:
        Math.abs(x - this.startPoint.x) + Math.abs(y - this.startPoint.y) > 4,
    };
    this.points.set(id, { x, y });
    if (this.points.size === 2) {
      const [a, b] = [...this.points.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      motion.pinchScale =
        this.pinchDistance > 0 && distance > 0
          ? this.pinchDistance / distance
          : 1;
      this.pinchDistance = distance;
    }
    this.previous = { x, y };
    return motion;
  }

  end(id: number, x: number, y: number) {
    const tap =
      this.points.has(id) &&
      this.points.size === 1 &&
      !this.suppressTap &&
      Math.abs(x - this.startPoint.x) + Math.abs(y - this.startPoint.y) < 5;
    this.release(id);
    return tap;
  }

  cancel(id: number) {
    if (this.points.has(id)) this.suppressTap = true;
    this.release(id);
  }

  private release(id: number) {
    if (!this.points.delete(id)) return;
    this.pinchDistance = 0;
    const remaining = this.points.values().next().value;
    if (remaining) {
      // Rebase both drag deltas and movement threshold after a pinch handoff.
      this.startPoint = this.previous = { ...remaining };
    }
  }
}
