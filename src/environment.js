import { isBeach } from './terrain.js';
import { shorePoint } from './terrain-builder.js';
import * as T from 'three/webgpu';
import { profiler } from './profiler.js';
import {
  positionWorld,
  time,
  sin,
  cos,
  vec2,
  vec3,
  vec4,
  color,
  mix,
  texture,
  smoothstep,
  float,
  transformNormalToView,
  uniform,
  pass,
  mrt,
  output,
  normalView,
  positionView,
  screenUV,
  cameraNear,
  cameraFar,
  orthographicDepthToViewZ,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
export function environment(scene, renderer, camera, cells) {
  scene.background = new T.Color('#acd0cf');
  scene.fog = new T.Fog('#acd0cf', 220, 450);
  const ambient = new T.HemisphereLight('#e6f1ef', '#b5a48c', 2.25);
  scene.add(ambient);
  const sun = new T.DirectionalLight('#fff0ce', 3.3);
  sun.position.set(-16, 25, 12);
  sun.castShadow = true;
  sun.shadow.camera.name = 'shadow-map';
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -23,
    right: 23,
    top: 23,
    bottom: -23,
    near: 1,
    far: 85,
  });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new T.DirectionalLight('#c3dfed', 0.65);
  fill.position.set(12, 10, -15);
  scene.add(fill);
  const maskCanvas = document.createElement('canvas');
  const maskSize = 2048;
  maskCanvas.width = maskCanvas.height = maskSize;
  const coastCanvas = document.createElement('canvas');
  coastCanvas.width = coastCanvas.height = maskSize;
  const coastContext = coastCanvas.getContext('2d');
  const ctx = maskCanvas.getContext('2d');
  const mask = new T.CanvasTexture(maskCanvas);
  mask.minFilter = T.LinearFilter;
  mask.magFilter = T.LinearFilter;
  mask.generateMipmaps = false;
  const mat = new T.MeshStandardNodeMaterial({ roughness: 0.72, metalness: 0 });
  const x = positionWorld.x,
    z = positionWorld.z;
  // Warped phases break up long parallel highlights. Calculate both partial
  // derivatives of each wave, so lighting follows a consistent height field.
  const warpA = x.mul(0.45).sub(z.mul(0.38)),
    warpB = x.mul(0.61).add(z.mul(0.44)).add(time.mul(0.15));
  const phaseA = x.mul(1.1).add(z.mul(0.7)).add(sin(warpA).mul(0.85)).add(time.mul(0.8)),
    phaseB = z.mul(1.9).sub(x.mul(0.5)).add(sin(warpB).mul(0.6)).add(time.mul(0.62));
  const dx = cos(phaseA)
    .mul(0.01)
    .mul(cos(warpA).mul(0.3825).add(1.1))
    .add(cos(phaseB).mul(0.006).mul(cos(warpB).mul(0.366).sub(0.5)))
    .negate();
  const dz = cos(phaseA)
    .mul(0.01)
    .mul(cos(warpA).mul(-0.323).add(0.7))
    .add(cos(phaseB).mul(0.006).mul(cos(warpB).mul(0.264).add(1.9)))
    .negate();
  mat.normalNode = transformNormalToView(vec3(dx, 1, dz).normalize());
  const shore = texture(
    mask,
    vec2(positionWorld.x.div(80).add(0.5), positionWorld.z.div(80).add(0.5)),
  ).r;
  const smallWave = sin(
    positionWorld.x.mul(3.2).add(sin(positionWorld.z.mul(2.7).add(time.mul(0.5)))),
  ).add(cos(positionWorld.z.mul(3.8).add(time.mul(0.35))));
  const sparkle = smoothstep(1.89, 1.99, smallWave).mul(0.027);
  const pulse = sin(x.mul(2.8).add(z.mul(3.1)).add(time.mul(1.2))).mul(0.025);
  const edge = shore.add(pulse);
  const foam = smoothstep(0.16, 0.34, edge).mul(float(1).sub(smoothstep(0.48, 0.65, edge)));
  const wash = sin(
    shore
      .mul(24)
      .sub(time.mul(1.3))
      .add(sin(x.add(z)).mul(0.5)),
  )
    .mul(0.5)
    .add(0.5)
    .pow(8)
    .mul(smoothstep(0.015, 0.08, shore))
    .mul(float(1).sub(smoothstep(0.25, 0.45, shore)))
    .mul(0.23);
  const waterColor = mix(color('#73b2bb'), color('#8bcfc6'), shore.mul(0.68)).add(vec3(sparkle));
  mat.colorNode = mix(waterColor, color('#f0f8e9'), foam.mul(0.86).add(wash).clamp(0, 0.93));
  // Fine ripples belong in fragment shading. A flat depth surface avoids
  // undersampling waves on a coarse mesh and keeps water out of false AO.
  const water = new T.Mesh(new T.PlaneGeometry(350, 350).rotateX(-Math.PI / 2), mat);
  water.position.y = -0.025;
  water.receiveShadow = true;
  scene.add(water);
  function updateShore(town) {
    const occupied = new Map(town);
    for (const id of town.terrain?.keys() || []) occupied.set(id, [0]);
    coastContext.fillStyle = '#000';
    coastContext.fillRect(0, 0, maskSize, maskSize);
    coastContext.fillStyle = '#fff';
    // Fill the union first, blur once: shared cell boundaries never become foam lines.
    coastContext.beginPath();
    for (const [id, l] of occupied) {
      if (l[0] == null) continue;
      const cell = cells[id],
        record = town.terrain?.get(id);
      const polygon = [];
      for (let e = 0; e < 4; e++) {
        const sea = occupied.get(cell.neighbors[e])?.[0] == null;
        if (record && sea)
          for (let k = 0; k < 8; k++) {
            const q = shorePoint(cell, e, k / 8, -0.025, isBeach(cell, town));
            polygon.push([q[0], q[2]]);
          }
        else polygon.push(cell.points[e]);
      }
      polygon.forEach((q, i) => {
        const x = (q[0] / 80 + 0.5) * maskSize,
          y = (-q[1] / 80 + 0.5) * maskSize;
        i ? coastContext.lineTo(x, y) : coastContext.moveTo(x, y);
      });
      coastContext.closePath();
    }
    coastContext.fill();
    ctx.filter = 'blur(6px)';
    ctx.drawImage(coastCanvas, 0, 0);
    ctx.filter = 'none';
    mask.needsUpdate = true;
  }
  function updateBounds(town) {
    let extent = 18;
    for (const id of town.keys()) extent = Math.max(extent, Math.hypot(...cells[id].center) + 7);
    Object.assign(sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      far: 150,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }
  // Boats add a little scale to the sheltered harbour.
  const boats = new T.Group();
  scene.add(boats);
  const bm = new T.MeshStandardNodeMaterial({ color: '#f5ead4', roughness: 0.72 }),
    wood = new T.MeshStandardNodeMaterial({ color: '#7d6c50', roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const g = new T.Group(),
      shape = new T.Shape();
    shape.moveTo(-0.23, -0.48);
    shape.lineTo(0.23, -0.48);
    shape.quadraticCurveTo(0.3, 0.16, 0, 0.62);
    shape.quadraticCurveTo(-0.3, 0.16, -0.23, -0.48);
    const hull = new T.Mesh(
      new T.ExtrudeGeometry(shape, {
        depth: 0.16,
        bevelEnabled: true,
        bevelSegments: 1,
        steps: 1,
        bevelSize: 0.025,
        bevelThickness: 0.035,
      }),
      bm,
    );
    hull.rotation.x = -Math.PI / 2;
    g.add(hull);
    const inner = new T.Mesh(
      new T.BoxGeometry(0.33, 0.035, 0.57),
      new T.MeshStandardNodeMaterial({ color: ['#397f86', '#b96349', '#688d6d'][i] }),
    );
    inner.position.set(0, 0.18, 0.035);
    g.add(inner);
    for (const z of [-0.14, 0.22]) {
      const seat = new T.Mesh(new T.BoxGeometry(0.38, 0.04, 0.095), wood);
      seat.position.set(0, 0.21, z);
      g.add(seat);
    }
    g.position.set(-2.5 + i * 1.6, 0.015, 3 + i * 0.75);
    g.rotation.y = -0.4 + i * 0.8;
    boats.add(g);
  }
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  scenePass.renderTarget.samples = 4;
  const rgb = scenePass.getTextureNode('output'),
    depth = scenePass.getTextureNode('depth'),
    normal = scenePass.getTextureNode('normal');
  // Editor helpers must never write to the world's normal/depth attachments:
  // transparent normals otherwise make GTAO invent dark edges on the water.
  const overlayScene = new T.Scene();
  overlayScene.name = 'editor';
  const overlayPass = pass(overlayScene, camera, { depthBuffer: false });
  overlayPass.renderTarget.samples = 4;
  renderer.setClearColor(0x000000, 0);
  const overlayColor = overlayPass.getTextureNode('output');
  const worldViewZ = orthographicDepthToViewZ(depth.sample(screenUV).r, cameraNear, cameraFar);
  function addOverlay(object, order = 0) {
    object.material.depthWrite = false;
    object.material.depthTest = false;
    // Still hide helpers behind real surfaces. A small view-space tolerance
    // avoids coplanar flicker on the selected wall without showing hidden edges.
    object.material.maskNode = positionView.z.greaterThanEqual(worldViewZ.sub(0.012));
    object.castShadow = object.receiveShadow = false;
    object.renderOrder = order;
    overlayScene.add(object);
  }
  // Transparent render targets contain premultiplied RGB after alpha blending.
  const withOverlays = (world) =>
    vec4(world.rgb.mul(overlayColor.a.oneMinus()).add(overlayColor.rgb), world.a);
  const aoPass = ao(depth, normal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 0.55;
  aoPass.thickness.value = 1.8;
  aoPass.distanceFallOff.value = 0.7;
  aoPass.scale.value = 1.15;
  const clean = denoise(aoPass.getTextureNode(), depth, normal, camera);
  clean.radius.value = 3;
  const pipeline = new T.RenderPipeline(renderer);
  const aoStrength = uniform(1);
  const occluded = rgb.mul(vec4(vec3(clean.r), 1));
  pipeline.outputNode = withOverlays(occluded);
  function setAO(...args) {
    return profiler.measure('settings.ao', () => setAOWork(...args));
  }
  function setAOWork(enabled) {
    aoStrength.value = enabled ? 1 : 0;
    pipeline.outputNode = withOverlays(enabled ? occluded : rgb);
    pipeline.needsUpdate = true;
  }
  function profileVariant({ aoMode = 'full', denoiseRadius = 3 } = {}) {
    clean.radius.value = denoiseRadius;
    const shade =
      aoMode === 'raw'
        ? rgb.mul(vec4(vec3(aoPass.getTextureNode().r), 1))
        : aoMode === 'off'
          ? rgb
          : occluded;
    pipeline.outputNode = withOverlays(shade);
    pipeline.needsUpdate = true;
  }
  function daylight(...args) {
    return profiler.measure('settings.daylight', () => daylightWork(...args));
  }
  function daylightWork(value) {
    const t = value / 100;
    sun.position.set(-22 + 34 * t, 8 + Math.sin(t * Math.PI) * 25, 18);
    sun.color.set(t > 0.78 ? '#ffbe84' : t < 0.2 ? '#ffdfb2' : '#fff0d5');
    sun.intensity = 2.2 + Math.sin(t * Math.PI) * 1.3;
    ambient.intensity = 1.9 + Math.sin(t * Math.PI) * 0.4;
    sun.shadow.needsUpdate = true;
  }
  return {
    water,
    sun,
    ambient,
    pipeline,
    aoStrength,
    setAO,
    profileVariant,
    addOverlay,
    updateShore,
    updateBounds,
    daylight,
    boats,
  };
}
