/* oxlint-disable typescript/no-require-imports -- Typed modules use the local compiler hook. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const THREE = require('three');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};
const {
  createBeltRockGeometry,
  beltRockAppearance,
} = require('../app/belt-rocks.ts');

test('the shared fragment is deterministic, irregular and bounded by its unit envelope', () => {
  const first = createBeltRockGeometry();
  const second = createBeltRockGeometry();
  assert.notEqual(first, second);
  for (const attribute of ['position', 'normal', 'color']) {
    assert.deepEqual(
      first.getAttribute(attribute).array,
      second.getAttribute(attribute).array,
    );
  }
  assert.deepEqual(first.index.array, second.index.array);
  assert.equal(first.index.count / 3, 80);
  assert.equal(first.getAttribute('position').count, 42);
  const radii = [];
  const position = first.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const radius = new THREE.Vector3()
      .fromBufferAttribute(position, i)
      .length();
    assert.ok(Number.isFinite(radius) && radius > 0.6 && radius <= 1);
    radii.push(radius);
  }
  assert.ok(
    Math.max(...radii) - Math.min(...radii) > 0.12,
    'broad relief changes the silhouette',
  );
  assert.ok(
    first.boundingBox && first.boundingSphere,
    'bounds are ready before instancing',
  );
  first.dispose();
  second.dispose();
});

test('the fragment is watertight with outward faces and smooth deformation normals', () => {
  const geometry = createBeltRockGeometry();
  const position = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.index;
  const edgeCounts = new Map();
  const averaged = Array.from(
    { length: position.count },
    () => new THREE.Vector3(),
  );
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    a.fromBufferAttribute(position, triangle[0]);
    b.fromBufferAttribute(position, triangle[1]);
    c.fromBufferAttribute(position, triangle[2]);
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(face.lengthSq() > 1e-8, 'no collapsed triangles');
    assert.ok(face.dot(a.clone().add(b).add(c)) > 0, 'winding points outward');
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge];
      const to = triangle[(edge + 1) % 3];
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      averaged[from].add(face);
    }
  }
  for (const count of edgeCounts.values())
    assert.equal(count, 2, 'every edge joins exactly two faces');
  let deformedNormals = 0;
  for (let i = 0; i < normals.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    const radial = new THREE.Vector3()
      .fromBufferAttribute(position, i)
      .normalize();
    assert.ok(Math.abs(normal.length() - 1) < 1e-6);
    assert.ok(
      normal.dot(averaged[i].normalize()) > 0.999999,
      'normals average the actual deformed faces',
    );
    if (normal.distanceTo(radial) > 0.04) deformedNormals++;
  }
  assert.ok(
    deformedNormals > 10,
    'the shape does not retain undeformed sphere normals',
  );
  geometry.dispose();
});

test('broad vertex albedo remains subtle and avoids black or luminous patches', () => {
  const geometry = createBeltRockGeometry();
  const colors = geometry.getAttribute('color');
  const shades = [];
  for (let i = 0; i < colors.count; i++) {
    const components = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    for (const value of components) assert.ok(value >= 0.8 && value <= 1);
    assert.ok(Math.max(...components) - Math.min(...components) < 0.04);
    shades.push(components[0]);
  }
  assert.ok(Math.max(...shades) - Math.min(...shades) > 0.02);
  assert.ok(Math.max(...shades) - Math.min(...shades) < 0.15);
  geometry.dispose();
});

test('instance proportions vary across all axes without exceeding the scalar size', () => {
  const ranges = Array.from({ length: 3 }, () => ({
    min: Infinity,
    max: -Infinity,
  }));
  const tints = new Set();
  for (const fieldSeed of [47, 171]) {
    for (let i = 0; i < 3600; i++) {
      const { proportions, tint } = beltRockAppearance(i, fieldSeed);
      assert.equal(Math.max(...proportions), 1);
      proportions.forEach((value, axis) => {
        assert.ok(value >= 0.58 && value <= 1);
        ranges[axis].min = Math.min(ranges[axis].min, value);
        ranges[axis].max = Math.max(ranges[axis].max, value);
      });
      for (const value of tint.toArray())
        assert.ok(value >= 0.75 && value <= 1);
      tints.add(tint.toArray().join(','));
    }
  }
  for (const range of ranges)
    assert.ok(
      range.max - range.min > 0.35,
      'each axis has meaningful proportion variation',
    );
  assert.ok(tints.size > 7000, 'instance tint is not a repeated short palette');
});

test('appearance is independent of generation order and the global random source', () => {
  const expected = Array.from({ length: 100 }, (_, i) =>
    beltRockAppearance(i, 47),
  );
  const random = Math.random;
  try {
    Math.random = () => {
      throw new Error('Unexpected random sequence consumption');
    };
    for (let i = 99; i >= 0; i--) {
      assert.deepEqual(beltRockAppearance(i, 47), expected[i]);
      beltRockAppearance(i, 171);
      assert.deepEqual(beltRockAppearance(i, 47), expected[i]);
    }
    assert.notDeepEqual(beltRockAppearance(8, 47), beltRockAppearance(8, 171));
  } finally {
    Math.random = random;
  }
});

test('rotated, proportioned instances retain the existing clearance radius', () => {
  const geometry = createBeltRockGeometry();
  const position = geometry.getAttribute('position');
  const point = new THREE.Vector3();
  const transform = new THREE.Object3D();
  for (const scalar of [0.0234, 0.13, 0.0576, 0.32]) {
    for (let i = 0; i < 100; i++) {
      const { proportions } = beltRockAppearance(i, 47);
      transform.scale.set(...proportions).multiplyScalar(scalar);
      transform.rotation.set(i * 0.13, i * 0.27, i * 0.39);
      transform.updateMatrix();
      for (let vertex = 0; vertex < position.count; vertex++) {
        point
          .fromBufferAttribute(position, vertex)
          .applyMatrix4(transform.matrix);
        assert.ok(
          point.length() <= scalar,
          'no shaped vertex exceeds its original scalar envelope',
        );
      }
    }
  }
  geometry.dispose();
});
