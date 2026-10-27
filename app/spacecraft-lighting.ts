import * as THREE from 'three';

/** Sun-directed self-shadowing for the enlarged visualization model. This is
 * a presentation of model geometry, not reconstructed historical attitude. */
export class SpacecraftLighting {
  readonly light = new THREE.DirectionalLight(0xffdfb2, 0);
  private readonly bounds = new WeakMap<THREE.Group, THREE.Sphere>();
  private readonly center = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly sunlight = new THREE.Vector3();
  private readonly previousSun = new THREE.Vector3();
  private readonly previousPose = new THREE.Matrix4();
  private previousCraft?: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.light.name = 'spacecraft-sunlight';
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.autoUpdate = false;
    this.light.shadow.bias = -0.0001;
    scene.add(this.light, this.light.target);
  }

  private localBounds(craft: THREE.Group) {
    let sphere = this.bounds.get(craft);
    if (sphere) return sphere;
    // Cache in craft-local space: camera enlargement and historical rebasing
    // can then fit the shadow camera without walking meshes every frame.
    const inverse = craft.matrixWorld.clone().invert();
    const relative = new THREE.Matrix4();
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    craft.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      // Blended decals/covers have no binary silhouette. Exclude their carrier
      // triangles rather than casting opaque rectangles through clear texels.
      // Alpha-tested surfaces retain Three's source-map cutout in the depth pass.
      object.castShadow = materials.every(
        (material) =>
          !(material.userData.baseTransparent ?? material.transparent) ||
          material.alphaTest > 0,
      );
      object.receiveShadow = true;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      relative.multiplyMatrices(inverse, object.matrixWorld);
      part.copy(object.geometry.boundingBox).applyMatrix4(relative);
      box.union(part);
    });
    sphere = box.getBoundingSphere(new THREE.Sphere());
    this.bounds.set(craft, sphere);
    return sphere;
  }

  update(craft: THREE.Group | undefined, sun: THREE.Vector3) {
    for (
      let parent: THREE.Object3D | null | undefined = craft;
      parent;
      parent = parent.parent
    )
      if (!parent.visible) craft = undefined;
    this.light.intensity = craft ? 1.6 : 0;
    if (!craft) {
      // Allocate/clear a valid depth map once even before the first probe.
      // Lit atlas meshes already compile a shadow sampler; Three's ordinary
      // fallback texture is incompatible with that sampler in WebGL 2.
      this.light.shadow.needsUpdate = this.light.shadow.map === null;
      this.previousCraft = undefined;
      return false;
    }
    craft.updateWorldMatrix(true, true);
    if (
      this.previousCraft === craft &&
      this.previousPose.equals(craft.matrixWorld) &&
      this.previousSun.equals(sun)
    )
      return true;
    const bounds = this.localBounds(craft);
    this.center.copy(bounds.center).applyMatrix4(craft.matrixWorld);
    craft.getWorldScale(this.scale);
    const radius = Math.max(
      1e-10,
      bounds.radius * Math.max(this.scale.x, this.scale.y, this.scale.z),
    );
    this.sunlight.copy(sun).sub(this.center).normalize();
    this.light.position
      .copy(this.center)
      .addScaledVector(this.sunlight, radius * 4);
    this.light.target.position.copy(this.center);
    const camera = this.light.shadow.camera;
    camera.left = camera.bottom = -radius * 1.06;
    camera.right = camera.top = radius * 1.06;
    camera.near = radius * 0.5;
    camera.far = radius * 7.5;
    camera.updateProjectionMatrix();
    this.light.shadow.normalBias = radius * 0.001;
    this.light.shadow.needsUpdate = true;
    this.previousCraft = craft;
    this.previousPose.copy(craft.matrixWorld);
    this.previousSun.copy(sun);
    return true;
  }

  dispose() {
    this.light.shadow.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
