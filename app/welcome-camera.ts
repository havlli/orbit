import * as THREE from 'three';
import { easeFlight } from './expedition-flight';

/** The entrance changes only the viewpoint. The first recorded instant remains
 * held until the portrait has joined the chapter's normal camera. */
export class WelcomeCamera {
  static readonly handoffSeconds = 2.4;
  private elapsed = 0;
  private idleElapsed = 0;

  get drift() {
    return Math.sin((this.idleElapsed * Math.PI * 2) / 75) * 0.07;
  }

  update(
    delta: number,
    open: boolean,
    leaving: boolean,
    reduced: boolean,
    ready = true,
  ) {
    if (open && !leaving) {
      this.elapsed = 0;
      if (ready && !reduced) this.idleElapsed += Math.max(0, delta);
      return 1;
    }
    this.elapsed = reduced
      ? WelcomeCamera.handoffSeconds
      : Math.min(
          WelcomeCamera.handoffSeconds,
          this.elapsed + Math.max(0, delta),
        );
    return 1 - easeFlight(this.elapsed / WelcomeCamera.handoffSeconds);
  }
}

/** A lit three-quarter Earth portrait leaves room for the entrance typography.
 * Interpolate direction and logarithmic distance to join the recorded chapter
 * without a cut or a chord through the planet. */
export function welcomePortrait(
  position: THREE.Vector3,
  look: THREE.Vector3,
  center: THREE.Vector3,
  sun: THREE.Vector3,
  radius: number,
  pole: THREE.Vector3,
  amount: number,
  width: number,
  height: number,
  drift = 0,
) {
  const presence = THREE.MathUtils.clamp(amount, 0, 1);
  if (presence === 0) return;
  const axis = pole.clone().normalize();
  const direction = sun
    .clone()
    .sub(center)
    .normalize()
    .applyAxisAngle(axis, 1 + drift)
    .addScaledVector(axis, 0.12)
    .normalize();
  const offset = position.clone().sub(center);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    offset.clone().normalize(),
    direction,
  );
  offset
    .normalize()
    .applyQuaternion(new THREE.Quaternion().slerp(rotation, presence));
  const landscape = compactWelcomeLandscape(width, height);
  const mobile = width <= 760;
  const halfFov = THREE.MathUtils.degToRad((mobile ? 49 : 42) / 2);
  // Match apparent height across both FOVs, leaving room for the off-axis limb.
  const portraitDistance = landscape
    ? Math.hypot(1, 1 / (0.66 * Math.tan(halfFov)))
    : mobile
      ? 5.6
      : 3.85;
  const distance = Math.exp(
    THREE.MathUtils.lerp(
      Math.log(Math.max(position.distanceTo(center), radius * 1.3)),
      Math.log(radius * portraitDistance),
      presence,
    ),
  );
  position.copy(center).addScaledVector(offset, distance);
  look.lerp(center, presence);
}

export function welcomeFraming(
  framing: { horizontal: number; vertical: number },
  amount: number,
  width: number,
  height: number,
) {
  const presence = THREE.MathUtils.clamp(amount, 0, 1);
  const landscape = compactWelcomeLandscape(width, height);
  const mobile = width <= 760;
  return {
    horizontal: THREE.MathUtils.lerp(
      framing.horizontal,
      landscape ? 0.48 : mobile ? 0 : 0.44,
      presence,
    ),
    vertical: THREE.MathUtils.lerp(
      framing.vertical,
      // The scene already lifts short mobile views by 0.055.
      landscape ? 0.08 - (mobile ? 0.055 : 0) : mobile ? 0.48 : 0.08,
      presence,
    ),
  };
}

function compactWelcomeLandscape(width: number, height: number) {
  return width >= 500 && width <= 1000 && height <= 500 && width > height;
}
