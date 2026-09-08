import * as T from 'three/webgpu';
import { attribute, positionLocal, sin, exp, vec3 } from 'three/tsl';
import { laundryPairs } from './laundry-layout.js';
export function createLaundry(scene, clock) {
  const material = new T.MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 1,
    side: T.DoubleSide,
  });
  const age = clock.sub(attribute('birth')).max(0),
    weight = attribute('sway');
  const wobble = sin(age.mul(12))
    .mul(exp(age.mul(-2.4)))
    .mul(0.19)
    .add(sin(clock.mul(1.7).add(positionLocal.x.mul(0.7))).mul(0.026))
    .mul(weight);
  material.positionNode = positionLocal.add(vec3(wobble.mul(0.55), wobble.mul(0.18), wobble));
  const mesh = new T.Mesh(new T.BufferGeometry(), material);
  mesh.name = 'laundry';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  let previous = new Map(),
    signature = '';
  return {
    get count() {
      return previous.size;
    },
    update(cells, town) {
      const pairs = laundryPairs(cells, town),
        nextSignature = pairs.map((p) => p.key).join('|');
      if (signature === nextSignature) return;
      signature = nextSignature;
      const positions = [],
        colors = [],
        births = [],
        weights = [],
        next = new Map();
      function tri(a, b, c, col, birth, w) {
        const color = new T.Color(col);
        for (const [i, v] of [a, b, c].entries()) {
          positions.push(...v);
          colors.push(color.r, color.g, color.b);
          births.push(birth);
          weights.push(Array.isArray(w) ? w[i] : w);
        }
      }
      for (const pair of pairs) {
        const birth = previous.get(pair.key) ?? performance.now() / 1000;
        next.set(pair.key, birth);
        const at = (t) =>
          pair.a.map(
            (v, i) => v + (pair.b[i] - v) * t - (i === 1 ? Math.sin(t * Math.PI) * 0.17 : 0),
          );
        for (let k = 0; k < 20; k++) {
          const t = k / 20,
            u = (k + 1) / 20,
            a = at(t),
            b = at(u),
            c = [b[0], b[1] + 0.014, b[2]],
            d = [a[0], a[1] + 0.014, a[2]];
          tri(a, b, c, '#8b816c', birth, [
            Math.sin(t * Math.PI),
            Math.sin(u * Math.PI),
            Math.sin(u * Math.PI),
          ]);
          tri(a, c, d, '#8b816c', birth, [
            Math.sin(t * Math.PI),
            Math.sin(u * Math.PI),
            Math.sin(t * Math.PI),
          ]);
        }
        const count = 4;
        for (let k = 0; k < count; k++) {
          const t = 0.18 + k * 0.18,
            u = t + 0.105,
            a = at(t),
            b = at(u),
            drop = k % 2 ? 0.31 : 0.41;
          const c = [b[0], b[1] - drop, b[2]],
            d = [a[0], a[1] - drop, a[2]],
            col = ['#f0e8d5', '#b8c9c0', '#d4a393', '#eee3bc'][(k + pair.id) % 4];
          tri(a, d, c, col, birth, [Math.sin(t * Math.PI), 1, 1]);
          tri(a, c, b, col, birth, [Math.sin(t * Math.PI), 1, Math.sin(u * Math.PI)]);
          // Tiny wooden pegs pin each corner to the cord.
          for (const v of [a, b])
            tri(
              [v[0] - 0.016, v[1] + 0.025, v[2]],
              [v[0] + 0.016, v[1] + 0.025, v[2]],
              [v[0], v[1] - 0.045, v[2]],
              '#97774f',
              birth,
              Math.sin(t * Math.PI),
            );
        }
      }
      previous = next;
      const geometry = new T.BufferGeometry();
      for (const [name, array, size] of [
        ['position', positions, 3],
        ['color', colors, 3],
        ['birth', births, 1],
        ['sway', weights, 1],
      ])
        geometry.setAttribute(name, new T.Float32BufferAttribute(array, size));
      geometry.computeVertexNormals();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.visible = pairs.length > 0;
    },
  };
}
