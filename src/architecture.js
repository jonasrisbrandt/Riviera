import * as T from 'three/webgpu';
import { profiler } from './profiler.js';
import {
  color,
  mix,
  positionWorld,
  positionLocal,
  sin,
  cos,
  uv,
  smoothstep,
  fract,
  floor,
  float,
  uniform,
  attribute,
  vec3,
  exp,
  vec2,
  normalView,
  positionView,
  fwidth,
} from 'three/tsl';
export { PALETTE, COLOR_NAMES, BASE, FLOOR } from './palette.js';
function materials() {
  const plaster = new T.MeshStandardNodeMaterial({ roughness: 0.96, vertexColors: true });
  const grain = sin(
    positionWorld.x
      .mul(91)
      .add(positionWorld.y.mul(139))
      .add(sin(positionWorld.z.mul(131))),
  )
    .mul(0.012)
    .add(0.988);
  plaster.colorNode = color('#ffffff').mul(grain);
  plaster.roughnessNode = float(0.96);
  const roof = new T.MeshStandardNodeMaterial({ roughness: 0.9, vertexColors: true });
  const tileUV = uv().div(vec2(0.24, 0.23)),
    rowIndex = floor(tileUV.y);
  const tileX = tileUV.x.add(fract(rowIndex.mul(0.5)).mul(0.7));
  const tx = fract(tileX),
    ty = fract(tileUV.y),
    aa = fwidth(tileUV).min(0.2);
  const vertical = smoothstep(float(0.94).sub(aa.x), float(0.985).add(aa.x), tx);
  const horizontal = smoothstep(float(0.89).sub(aa.y), float(0.97).add(aa.y), ty);
  const variation = fract(sin(floor(tileX).mul(127.1).add(rowIndex.mul(311.7))).mul(43758.5453));
  const tileShade = sin(tx.mul(Math.PI)).mul(0.035).add(variation.mul(0.09));
  roof.colorNode = mix(color('#eee0c4'), color('#ffffff'), tileShade.add(0.72)).mul(
    float(1).sub(horizontal.mul(0.23)).sub(vertical.mul(0.1)),
  );
  // Fine rolled tile relief stays on the GPU; rows use physical roof distances.
  const footprint = fwidth(tileUV);
  const reliefFade = float(1).sub(smoothstep(0.25, 0.75, footprint.x.max(footprint.y)));
  // Differentiate the smooth tile profile analytically: differentiating fract()
  // across a row boundary produces bright pinpricks on receding roof slopes.
  const du = cos(tx.mul(Math.PI * 2))
    .mul(0.003 * Math.PI * 2)
    .mul(reliefFade);
  const dv = sin(ty.mul(Math.PI * 2))
    .mul(-0.002 * Math.PI * 2)
    .mul(reliefFade);
  const dpdx = positionView.dFdx(),
    dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView),
    r2 = normalView.cross(dpdx),
    det = dpdx.dot(r1);
  const gradient = r1
    .mul(du.mul(tileUV.x.dFdx()).add(dv.mul(tileUV.y.dFdx())))
    .add(r2.mul(du.mul(tileUV.x.dFdy()).add(dv.mul(tileUV.y.dFdy()))))
    .mul(det.sign());
  roof.normalNode = normalView.mul(det.abs()).sub(gradient).normalize();
  // colorNode replaces material diffuse color, vertexColors still multiply it.
  const stone = new T.MeshStandardNodeMaterial({ roughness: 1, vertexColors: true });
  const brickUV = uv().mul(5);
  const row = floor(brickUV.y);
  const mortar = smoothstep(0.94, 1, fract(brickUV.y)).max(
    smoothstep(0.94, 1, fract(brickUV.x.add(row.mul(0.5)))),
  );
  stone.colorNode = mix(color('#ffffff'), color('#8e978b'), mortar.mul(0.26));
  const detail = new T.MeshStandardNodeMaterial({ roughness: 0.85, vertexColors: true });
  return { plaster, roof, stone, detail };
}

import { ArchitectureView } from './architecture-view.js';
export class Architecture extends ArchitectureView {
  constructor(scene, cells, renderer) {
    super(scene, cells, renderer, materials());
    this.clock = uniform(0);
    this.started = uniform(-10);
    this.activeKey = uniform(-1);
    const age = this.clock.sub(this.started).clamp(0, 2);
    const bounce = sin(age.mul(18))
      .mul(exp(age.mul(-8)))
      .mul(0.15)
      .sub(exp(age.mul(-18)).mul(0.2));
    const amount = attribute('buildKey').equal(this.activeKey).select(bounce, float(0));
    for (const m of Object.values(this.mat))
      m.positionNode = positionLocal.add(
        vec3(0, positionLocal.y.sub(attribute('baseY')).mul(amount), 0),
      );
  }
  commitAnimation(target) {
    this.activeKey.value = target ? target.id * 32 + target.level : -1;
    this.started.value = target ? performance.now() / 1000 : -10;
  }
}
