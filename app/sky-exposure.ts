import * as THREE from 'three';

export interface SkyLightBody {
  /** Scene-root body group, in the same rebased frame as the camera. */
  object: THREE.Object3D;
  radius: number;
  emissive: boolean;
}

/** A photographic exposure cue, not simulated eye adaptation or photometry.
 * Nearby illuminated worlds suppress faint sky; empty space reveals it again.
 * Measure angular coverage instead of distance so historical rebasing and the
 * separately scaled atlas cannot cause exposure jumps. No GPU readback. */
export class SkyExposure {
  value = 1;
  private view = new THREE.Vector3();
  private toSun = new THREE.Vector3();
  private toCamera = new THREE.Vector3();

  target(
    camera: THREE.PerspectiveCamera,
    bodies: readonly SkyLightBody[],
    sun: THREE.Vector3,
  ) {
    const halfView = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let light = 0;
    for (const body of bodies) {
      if (!body.object.visible) continue;
      const center = body.object.position;
      this.view.copy(center).applyMatrix4(camera.matrixWorldInverse);
      if (this.view.z >= 0) continue;
      const radius = body.radius * body.object.scale.x;
      const verticalRadius = radius / (-this.view.z * halfView);
      const horizontalRadius = verticalRadius / camera.aspect;
      const x = this.view.x / (-this.view.z * halfView * camera.aspect);
      const y = this.view.y / (-this.view.z * halfView);
      // Feather the metering window at the edges, including partial disks.
      const horizontal =
        1 -
        THREE.MathUtils.smoothstep(
          Math.abs(x),
          Math.max(0, 1 - horizontalRadius),
          1 + horizontalRadius,
        );
      const vertical =
        1 -
        THREE.MathUtils.smoothstep(
          Math.abs(y),
          Math.max(0, 1 - verticalRadius),
          1 + verticalRadius,
        );
      if (horizontal * vertical === 0) continue;
      this.toSun.copy(sun).sub(center).normalize();
      this.toCamera.copy(camera.position).sub(center).normalize();
      const illuminated = body.emissive
        ? 1
        : Math.pow(Math.max(0, (1 + this.toSun.dot(this.toCamera)) / 2), 1.4);
      const coverage = Math.min(
        1,
        (Math.PI * horizontalRadius * verticalRadius) / 4,
      );
      light +=
        coverage *
        horizontal *
        vertical *
        illuminated *
        (body.emissive ? 24 : 1);
    }
    return THREE.MathUtils.clamp(Math.exp(-light * 5), 0.42, 1);
  }

  update(target: number, delta: number, reduced: boolean) {
    // Settle into a bright close-up, then reopen more slowly on departure.
    const duration = target < this.value ? 1.1 : 2.8;
    const amount = reduced ? 1 : 1 - Math.exp(-Math.max(0, delta) / duration);
    this.value = THREE.MathUtils.lerp(this.value, target, amount);
    return this.value;
  }
}
