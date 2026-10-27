/** A finite, frame-rate-independent fade. Flights wait for the departing
 * paths to reach zero; arrivals restore them gently from the current opacity.
 * Reversing a toggle or interrupting a flight never resets that opacity. */
export class PathVisibility {
  private value = 1;
  private from = 1;
  private target = 1;
  private elapsed = 0;

  update(visible: boolean, delta: number, reduced: boolean) {
    const target = visible ? 1 : 0;
    if (target !== this.target) {
      this.from = this.value;
      this.target = target;
      this.elapsed = 0;
    }
    if (reduced) {
      this.value = target;
      this.from = target;
      this.elapsed = 0;
      return this.value;
    }
    const delay = target ? 0.12 : 0;
    const duration = target ? 1.2 : 0.45;
    this.elapsed = Math.min(
      delay + duration,
      this.elapsed + Math.max(0, delta),
    );
    const t = Math.min(1, Math.max(0, (this.elapsed - delay) / duration));
    // Reflect the upper half to avoid cancellation producing negative alpha
    // just before a fade reaches its exact endpoint at some refresh rates.
    const s = t <= 0.5 ? t : 1 - t;
    const ramp = s * s * s * (10 - s * (15 - 6 * s));
    const eased = t <= 0.5 ? ramp : 1 - ramp;
    this.value =
      this.elapsed === delay + duration
        ? target
        : this.from + (target - this.from) * eased;
    return this.value;
  }
}
