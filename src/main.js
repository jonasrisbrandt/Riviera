import { manualLaundryPair, laundryKey } from './laundry-layout.js';
import { terrainPoint } from './terrain-builder.js';
import { SURFACE_STEPS, edgeSurface } from './terrain-surface.js';
import { createLaundry } from './laundry.js';
import {
  MATERIALS,
  TERRAIN_STEP,
  elevation,
  groundY,
  sculpt,
  terrainPick,
  cornerHeights,
  isBeach,
} from './terrain.js';
import { landscapeDemo } from './landscape-demo.js';
import './style.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/italiana/latin-400.css';
import * as T from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { attribute, positionLocal, time, sin, cos, vec3 } from 'three/tsl';
import { makeGrid, demoTown, inside, top } from './grid.js';
import { Architecture, PALETTE, COLOR_NAMES, BASE, FLOOR } from './architecture.js';
import { environment } from './environment.js';
import { SAVE_KEY, serialize, deserialize, History } from './state.js';
import { profiler } from './profiler.js';
import { mountProfiler } from './profiler-ui.js';
import { SpatialIndex } from './spatial.js';
const $ = (id) => document.getElementById(id);
const icons = {
  landscape: '<path d="m2 20 7-14 4 7 3-10 6 17Z M6 12l3 2 2-2 M14 9l2 2 2-2"/>',
  build: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  erase:
    '<path d="m4 13 9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H8l-4-4a2 2 0 0 1 0-3Z M10 8l8 8M10 20h11"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  home: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/>',
  photo: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  settings:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  sound: '<path d="M4 10v4h4l5 4V6L8 10ZM17 9a5 5 0 0 1 0 6M20 6a9 9 0 0 1 0 12"/>',
};
for (const [id, path] of Object.entries(icons))
  $(id).innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
let toastTimer;
function toast(...args) {
  return profiler.measure('ui.toast', () => toastWork(...args));
}
function toastWork(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}
async function init() {
  if (!navigator.gpu)
    throw new Error(
      'Riviera behöver WebGPU. Öppna sidan i en aktuell version av Chrome eller Edge med hårdvaruacceleration påslagen.',
    );
  const renderer = new T.WebGPURenderer({
    canvas: $('world'),
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  await profiler.measureAsync('startup.rendererInit', () => renderer.init());
  if (!renderer.backend.isWebGPUBackend)
    throw new Error(
      'WebGPU kunde inte starta. Kontrollera att hårdvaruacceleration är påslagen i webbläsaren.',
    );
  profiler.attachRenderer(renderer);
  const startupScope = profiler.begin('startup.sceneSetup');
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  const scene = new T.Scene(),
    aspect = innerWidth / innerHeight,
    viewHeight = Math.max(14, 11 / aspect),
    camera = new T.OrthographicCamera(
      -viewHeight * aspect,
      viewHeight * aspect,
      viewHeight,
      -viewHeight,
      0.1,
      500,
    );
  camera.position.set(72, 70.6, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI * 0.475;
  controls.minZoom = 0.32;
  controls.maxZoom = 4.5;
  controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE };
  controls.update();
  scene.name = 'world';
  const { cells } = profiler.measure('startup.grid', () => makeGrid());
  let town = profiler.measure('startup.demoTown', () => landscapeDemo(cells));
  try {
    const saved = profiler.measure('storage.read', () => localStorage.getItem(SAVE_KEY));
    if (saved)
      town = profiler.measure('storage.deserialize', () => deserialize(saved, cells.length));
  } catch {
    toast('Din tidigare sparning kunde inte läsas. En ny hamn är redo.');
  }
  const architecture = profiler.measure(
    'startup.architecture',
    () => new Architecture(scene, cells, renderer),
  );
  const env = profiler.measure('startup.environment', () =>
    environment(scene, renderer, camera, cells),
  );
  const laundry = createLaundry(scene, architecture.clock);
  const history = new History();
  for (const key of ['push', 'undo', 'redo']) profiler.wrap(history, key, 'history.' + key);
  profiler.wrap(architecture, 'rebuild', 'build.architecture');
  profiler.wrap(env, 'updateShore', 'build.shoreMask');
  let selected = 0,
    mode = 'build',
    domain = 'buildings',
    terrainTool = 'raise',
    terrainMaterial = 0,
    hover = null,
    dirty = true,
    soundOn = false,
    soundContext = null,
    laundryStart = null,
    laundryMarkerPoint = null,
    laundryPreviewKey = '',
    laundryPreviewResult = null;
  let shoreSignature = null;
  function rebuild(...args) {
    return profiler.measure('build.total', () => rebuildWork(...args));
  }
  function rebuildWork(animation = null) {
    const work = architecture.rebuild(town, animation);
    const uiScope = profiler.begin('build.ui');
    $('town-count').textContent = `${town.size} PLATSER · ${architecture.stats.floors} VÅNINGAR`;
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
    profiler.end(uiScope);
    try {
      const json = profiler.measure('storage.serialize', () => serialize(town));
      profiler.measure('storage.write', () => localStorage.setItem(SAVE_KEY, json));
    } catch {
      toast('Det gick inte att autospara. Använd Spara by i inställningarna.');
    }
    dirty = true;
    return work;
  }
  function updateWorldEnvironment() {
    laundry.update(cells, town);
    const occupied = new Map(town);
    occupied.terrain = town.terrain;
    for (const id of town.terrain?.keys() || []) occupied.set(id, [0]);
    const signature = [...occupied]
      .filter(([, l]) => l[0] != null)
      .map(([id]) => id + ':' + (town.terrain?.get(id) ? (isBeach(cells[id], town) ? 1 : 0) : -1))
      .sort()
      .join(',');
    if (signature !== shoreSignature) {
      env.updateShore(town);
      shoreSignature = signature;
    }
    env.updateBounds(occupied);
    env.boats.visible = occupied.size > 20;
  }
  const initialBuild = rebuild();
  profiler.end(startupScope);
  await initialBuild;
  updateWorldEnvironment();
  if (town.terrain?.size) home();
  const uiStartupScope = profiler.begin('startup.ui');
  architecture.onCommit = () => {
    updateWorldEnvironment();
    dirty = true;
    env.sun.shadow.needsUpdate = true;
  };
  architecture.onError = (error) => {
    console.error(error);
    toast('Bygget kunde inte färdigställas. Ladda om sidan och försök igen.');
  };
  const lineMat = new T.LineBasicNodeMaterial({
    color: '#ffefcf',
    transparent: true,
    opacity: 0.9,
    depthTest: true,
  });
  let highlight = new T.LineSegments(
    new T.BufferGeometry().setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(48 * SURFACE_STEPS), 3),
    ),
    lineMat,
  );
  env.addOverlay(highlight, 2);
  const ghostMat = new T.MeshBasicNodeMaterial({
    color: PALETTE[0],
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: T.DoubleSide,
  });
  const ghost = new T.Mesh(
    new T.BufferGeometry().setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(72 * SURFACE_STEPS), 3),
    ),
    ghostMat,
  );
  env.addOverlay(ghost, 1);
  const laundryPreview = new T.Line(
    new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(new Float32Array(99), 3),
    ),
    new T.LineBasicNodeMaterial({ color: '#fff2c9', transparent: true, opacity: 0.95 }),
  );
  const laundryMarker = new T.Mesh(
    new T.SphereGeometry(0.085, 12, 8),
    new T.MeshBasicNodeMaterial({ color: '#fff2c9' }),
  );
  laundryPreview.visible = laundryMarker.visible = false;
  env.addOverlay(laundryPreview, 3);
  env.addOverlay(laundryMarker, 3);
  function laundryInstruction(text) {
    $('laundry-instruction').textContent = text;
  }
  function resetLaundry() {
    laundryStart = null;
    laundryMarkerPoint = null;
    laundryPreviewKey = '';
    laundryPreview.visible = laundryMarker.visible = false;
    laundryInstruction('Tvättlina · välj första huset');
  }
  function previewLaundry() {
    highlight.visible = ghost.visible = false;
    laundryPreview.visible = false;
    laundryMarker.visible = !!laundryStart;
    if (!laundryStart) return;
    const [id, level] = laundryStart,
      c = cells[id];
    if (laundryMarkerPoint) laundryMarker.position.copy(laundryMarkerPoint);
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return;
    ray.setFromCamera(pointer, camera);
    const meta = architecture.raycast(ray.ray)?.meta;
    if (!meta || meta.level < 1 || meta.id === id) return;
    const key = [...laundryStart, meta.id, meta.level, architecture.appliedRevision].join(':');
    if (key !== laundryPreviewKey) {
      laundryPreviewKey = key;
      laundryPreviewResult = manualLaundryPair(cells, town, laundryStart, [meta.id, meta.level]);
    }
    const pair = laundryPreviewResult.pair;
    laundryInstruction(
      laundryPreviewResult.error || 'Klicka för att fästa linan · samma huspar tar bort den',
    );
    if (!pair) return;
    const a = laundryPreview.geometry.attributes.position;
    for (let k = 0; k <= 32; k++) {
      const t = k / 32;
      a.setXYZ(
        k,
        pair.a[0] + (pair.b[0] - pair.a[0]) * t,
        pair.a[1] + (pair.b[1] - pair.a[1]) * t - Math.sin(t * Math.PI) * 0.17,
        pair.a[2] + (pair.b[2] - pair.a[2]) * t,
      );
    }
    a.needsUpdate = true;
    laundryPreview.geometry.computeBoundingSphere();
    laundryPreview.visible = true;
  }
  function editLaundry(remove, requestedRay) {
    if (remove) {
      resetLaundry();
      dirty = true;
      return;
    }
    const hit = architecture.raycast(requestedRay),
      meta = hit?.meta;
    if (!meta || meta.level < 1 || town.get(meta.id)?.[meta.level] == null) {
      toast('Klicka på ett hus för att fästa tvättlinan.');
      return;
    }
    if (!laundryStart) {
      laundryStart = [meta.id, meta.level];
      laundryMarkerPoint = requestedRay.at(Math.max(0, hit.distance - 0.035), new T.Vector3());
      laundryInstruction('Välj andra huset · högerklick eller Escape avbryter');
      dirty = true;
      return;
    }
    if (laundryStart[0] === meta.id) {
      resetLaundry();
      dirty = true;
      return;
    }
    const result = manualLaundryPair(cells, town, laundryStart, [meta.id, meta.level]);
    if (result.error) {
      toast(result.error);
      return;
    }
    history.push(town);
    const [aid, al] = laundryStart,
      bid = meta.id,
      bl = meta.level,
      key = laundryKey(aid, bid);
    const old = town.clotheslines?.find(([a, , b]) => laundryKey(a, b) === key);
    town.clotheslines = (town.clotheslines || []).filter(([a, , b]) => laundryKey(a, b) !== key);
    const removing = old && old[1] > 0;
    town.clotheslines.push(removing ? [aid, 0, bid, 0] : [aid, al, bid, bl]);
    resetLaundry();
    rebuild().catch(() => {});
    toast(removing ? 'Tvättlinan togs bort.' : 'Tvätten är upphängd!');
  }
  const gridPoints = [];
  for (const c of cells)
    for (let e = 0; e < 4; e++) {
      // Adjacent cells share the same edge; draw it only once.
      if (c.neighbors[e] >= 0 && c.neighbors[e] < c.id) continue;
      const a = c.points[e],
        b = c.points[(e + 1) % 4];
      gridPoints.push(a[0], 0.013, a[1], b[0], 0.013, b[1]);
    }
  const grid = new T.LineSegments(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(gridPoints, 3)),
    new T.LineBasicNodeMaterial({
      color: '#d4ebe0',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  grid.visible = false;
  env.addOverlay(grid);
  // GPU animated birds, one draw call.
  const birdP = [],
    birdIds = [];
  for (let i = 0; i < 12; i++) {
    birdP.push(-0.19, 0, 0, 0, 0, 0.035, 0, 0, -0.045, 0, 0, 0.035, 0.19, 0, 0, 0, 0, -0.045);
    for (let k = 0; k < 6; k++) birdIds.push(i);
  }
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.Float32BufferAttribute(birdP, 3));
  bg.setAttribute('bird', new T.Float32BufferAttribute(birdIds, 1));
  bg.computeVertexNormals();
  const birdMat = new T.MeshBasicNodeMaterial({ color: '#fff5dd', side: T.DoubleSide });
  const bid = attribute('bird'),
    angle = time.mul(0.055).add(bid.mul(2.39)),
    radius = bid.mul(0.31).add(7);
  birdMat.positionNode = positionLocal.add(
    vec3(
      cos(angle).mul(radius),
      sin(time.mul(5).add(bid)).mul(positionLocal.x.abs()).add(bid.mul(0.17)).add(6.3),
      sin(angle).mul(radius),
    ),
  );
  const birdMesh = new T.Mesh(bg, birdMat);
  birdMesh.frustumCulled = false;
  scene.add(birdMesh);
  function select(index) {
    selected = index;
    document.querySelectorAll('#colors .swatch, #stone').forEach((b) => {
      const active = Number(b.dataset.color) === index;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-pressed', String(active));
    });
    setDomain('buildings');
    setMode('build');
  }
  PALETTE.forEach((color, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--swatch', color);
    b.title = COLOR_NAMES[i];
    b.setAttribute('aria-label', COLOR_NAMES[i]);
    b.dataset.color = i;
    b.onclick = () => select(i);
    b.onmouseenter = () => {
      $('color-name').textContent = COLOR_NAMES[i];
      $('color-name').style.top = `${b.getBoundingClientRect().top}px`;
      $('color-name').classList.add('show');
    };
    b.onmouseleave = () => $('color-name').classList.remove('show');
    $('colors').appendChild(b);
  });
  $('stone').dataset.color = -1;
  $('stone').onclick = () => select(-1);
  function setMode(m) {
    mode = m;
    resetLaundry();
    $('laundry-tool').classList.toggle('active', m === 'laundry');
    $('laundry-tool').setAttribute('aria-pressed', String(m === 'laundry'));
    $('laundry-instruction').classList.toggle('hidden', m !== 'laundry');
    $('build').classList.toggle('active', domain === 'buildings' && m === 'build');
    $('erase').classList.toggle('active', m === 'erase');
    $('build').setAttribute('aria-pressed', String(domain === 'buildings' && m === 'build'));
    if (domain === 'terrain') selectTerrainTool(m === 'erase' ? 'lower' : 'raise');
    $('erase').setAttribute('aria-pressed', String(m === 'erase'));
    dirty = true;
  }
  function selectTerrainTool(tool) {
    terrainTool = tool;
    for (const name of ['raise', 'lower', 'paint', 'smooth', 'slope']) {
      $(name).classList.toggle('active', name === tool);
      $(name).setAttribute('aria-pressed', String(name === tool));
    }
    dirty = true;
  }
  function setDomain(value) {
    domain = value;
    resetLaundry();
    $('laundry-tool').classList.remove('active');
    $('laundry-tool').setAttribute('aria-pressed', 'false');
    $('laundry-instruction').classList.add('hidden');
    mode = 'build';
    $('building-palette').classList.toggle('hidden', value !== 'buildings');
    $('terrain-palette').classList.toggle('hidden', value !== 'terrain');
    $('landscape').classList.toggle('active', value === 'terrain');
    $('landscape').setAttribute('aria-pressed', String(value === 'terrain'));
    $('build').classList.toggle('active', value === 'buildings');
    $('build').setAttribute('aria-pressed', String(value === 'buildings'));
    $('erase').classList.remove('active');
    $('erase').setAttribute('aria-pressed', 'false');
    document.querySelector('.hint').innerHTML =
      value === 'terrain'
        ? '<span>Klicka eller dra för att forma<span>Högerklick sänker · Alt + dra roterar</span></span>'
        : '<span>Klicka för att bygga<span>Dra för att upptäcka</span></span>';
    dirty = true;
  }
  MATERIALS.forEach((material, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (i === 0 ? ' selected auto-material' : '');
    b.style.setProperty('--swatch', material.color);
    b.title = material.name;
    b.setAttribute('aria-label', material.name);
    b.setAttribute('aria-pressed', String(i === 0));
    b.onclick = () => {
      terrainMaterial = i;
      $('material-name').textContent = material.name;
      [...$('materials').children].forEach((el, n) => {
        el.classList.toggle('selected', n === i);
        el.setAttribute('aria-pressed', String(n === i));
      });
      dirty = true;
    };
    $('materials').appendChild(b);
  });
  for (const tool of ['raise', 'lower', 'paint', 'smooth', 'slope'])
    $(tool).onclick = () => {
      mode = 'build';
      $('erase').setAttribute('aria-pressed', 'false');
      $('erase').classList.remove('active');
      selectTerrainTool(tool);
    };
  select(0);
  const ray = new T.Raycaster(),
    pointer = new T.Vector2(10, 10),
    plane = new T.Plane(new T.Vector3(0, 1, 0), 0),
    hitPoint = new T.Vector3();
  const cellIndex = new SpatialIndex(
    cells.map((c) => ({
      cell: c,
      x0: Math.min(...c.points.map((p) => p[0])),
      x1: Math.max(...c.points.map((p) => p[0])),
      z0: Math.min(...c.points.map((p) => p[1])),
      z1: Math.max(...c.points.map((p) => p[1])),
    })),
  );
  function pick(...args) {
    return profiler.measure('input.pick', () => pickWork(...args));
  }
  function pickWork(
    remove = false,
    requestedRay = null,
    paint = selected,
    landscape = domain === 'terrain',
    landscapeTool = terrainTool,
  ) {
    if (!requestedRay && (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1)) return null;
    if (!requestedRay) ray.setFromCamera(pointer, camera);
    const pickingRay = requestedRay || ray.ray;
    const hit = profiler.measure('input.raycast', () => architecture.raycast(pickingRay));
    if (hit) {
      const meta = hit.meta;
      if (!meta) return null;
      let { id, level, edge } = meta;
      if (landscape) return terrainPick(meta, cells, town, remove ? 'lower' : landscapeTool);
      if (level === -1) {
        if (remove || town.has(id)) return null;
        return { id, level: paint === -1 ? 0 : 1 };
      }
      if (remove) return { id, level };
      if (paint === -1) {
        if (edge >= 0) id = cells[id].neighbors[edge];
        else if (level === 0) return null;
        return id >= 0 && town.get(id)?.[0] == null ? { id, level: 0 } : null;
      }
      if (edge < 0) level++;
      else {
        const absolute = level + elevation(town, id);
        id = cells[id].neighbors[edge];
        level = Math.max(0, Math.round(absolute - elevation(town, id)));
      }
      if (id < 0 || level + elevation(town, id) > 24 || town.get(id)?.[level] != null) return null;
      return { id, level };
    }
    if (remove && !landscape) return null;
    if (pickingRay.intersectPlane(plane, hitPoint)) {
      const cell = profiler.measure(
        'input.gridSearch',
        () =>
          cellIndex
            .at(hitPoint.x, hitPoint.z)
            .find(({ cell: c }) => inside([hitPoint.x, hitPoint.z], c.points))?.cell,
      );
      if (cell && landscape) return { id: cell.id, level: elevation(town, cell.id) };
      if (cell && town.get(cell.id)?.[0] == null) return { id: cell.id, level: 0 };
    }
    return null;
  }
  let lastHoverKey = '';
  function updateHover(...args) {
    return profiler.measure('input.hover', () => updateHoverWork(...args));
  }
  function updateHoverWork() {
    if (architecture.pending || dragging) {
      highlight.visible = ghost.visible = false;
      return;
    }
    if (mode === 'laundry') {
      previewLaundry();
      return;
    }
    hover = pick(mode === 'erase' || (domain === 'terrain' && terrainTool === 'lower'));
    highlight.visible = ghost.visible = !!hover;
    if (!hover) return;
    const geometryScope = profiler.begin('input.hoverGeometry');
    const c = cells[hover.id],
      // Include a selected roof even when neighbors hide the walls beneath it.
      roofMargin =
        mode === 'erase' && hover.level > 0 && top(town.get(hover.id)) === hover.level
          ? (architecture.roofHeights.get(hover.id * 32 + hover.level) ?? 0.6) + 0.07
          : 0.02,
      offset = groundY(town, hover.id),
      y =
        domain === 'terrain'
          ? Math.max(0.035, offset + (terrainTool === 'raise' ? FLOOR * TERRAIN_STEP : 0.035))
          : offset + (hover.level === 0 ? BASE + 0.018 : BASE + hover.level * FLOOR + roofMargin),
      bottom =
        domain === 'terrain'
          ? Math.max(0.015, offset - (terrainTool === 'lower' ? FLOOR * TERRAIN_STEP : 0))
          : offset + (hover.level === 0 ? 0.01 : BASE + (hover.level - 1) * FLOOR + 0.02);
    const hoverKey = [
      hover.id,
      hover.level,
      roofMargin,
      mode,
      selected,
      domain,
      terrainTool,
      terrainMaterial,
      offset,
    ].join(':');
    if (hoverKey === lastHoverKey) {
      profiler.end(geometryScope);
      return;
    }
    lastHoverKey = hoverKey;
    const lines = [],
      tri = [];
    let highPoints = c.points.map((p) => [p[0], y, p[1]]),
      lowPoints = c.points.map((p) => [p[0], bottom, p[1]]);
    if (domain === 'terrain') {
      const preview = new Map(town);
      preview.terrain = new Map(town.terrain || []);
      sculpt(preview, c.id, terrainTool, terrainMaterial, cells);
      const current = cornerHeights(c, town.terrain || new Map(), town, cells),
        next = cornerHeights(c, preview.terrain, preview, cells);
      highPoints = c.points.map((p, i) =>
        terrainPoint(p, Math.max(0.035, Math.max(current[i], next[i]) + 0.025)),
      );
      lowPoints = c.points.map((p, i) =>
        terrainPoint(p, Math.max(0.015, Math.min(current[i], next[i]) + 0.015)),
      );
    }
    const segments = domain === 'terrain' ? SURFACE_STEPS : 1;
    for (let e = 0; e < 4; e++) {
      const n = (e + 1) % 4;
      for (let k = 0; k < segments; k++) {
        const a = edgeSurface(highPoints[e], highPoints[n], k / segments),
          b = edgeSurface(highPoints[e], highPoints[n], (k + 1) / segments),
          c = edgeSurface(lowPoints[e], lowPoints[n], k / segments),
          d = edgeSurface(lowPoints[e], lowPoints[n], (k + 1) / segments);
        lines.push(...a, ...b);
        if (k === 0) lines.push(...c, ...a);
        tri.push(...c, ...a, ...b, ...c, ...b, ...d);
      }
    }
    highlight.geometry.setDrawRange(0, lines.length / 3);
    ghost.geometry.setDrawRange(0, tri.length / 3);
    highlight.geometry.attributes.position.array.set(lines);
    ghost.geometry.attributes.position.array.set(tri);
    highlight.geometry.attributes.position.needsUpdate =
      ghost.geometry.attributes.position.needsUpdate = true;
    highlight.geometry.computeBoundingSphere();
    ghost.geometry.computeBoundingSphere();
    const col =
      mode === 'erase' || (domain === 'terrain' && terrainTool === 'lower')
        ? '#f58973'
        : domain === 'terrain'
          ? MATERIALS[terrainMaterial].color
          : selected === -1
            ? '#eae2c6'
            : PALETTE[selected];
    lineMat.color.set(mode === 'erase' ? '#fa8975' : '#fff1ca');
    ghostMat.color.set(col);
    profiler.end(geometryScope);
  }
  function plop(...args) {
    return profiler.measure('audio.plop', () => plopWork(...args));
  }
  function plopWork(remove) {
    if (!soundOn || !soundContext) return;
    const o = soundContext.createOscillator(),
      g = soundContext.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(remove ? 290 : 570, soundContext.currentTime);
    o.frequency.exponentialRampToValueAtTime(remove ? 95 : 230, soundContext.currentTime + 0.12);
    g.gain.setValueAtTime(0.12, soundContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, soundContext.currentTime + 0.19);
    o.connect(g).connect(soundContext.destination);
    o.start();
    o.stop(soundContext.currentTime + 0.2);
  }
  function edit(...args) {
    return profiler.measure('input.edit', () => editWork(...args));
  }
  let editGeneration = 0;
  function editWork(
    remove = false,
    requestedRay = null,
    paint = selected,
    context = { domain, mode, tool: terrainTool, material: terrainMaterial },
  ) {
    if (!requestedRay) {
      ray.setFromCamera(pointer, camera);
      requestedRay = ray.ray.clone();
    }
    if (architecture.pending) {
      const generation = editGeneration;
      architecture
        .ready()
        .then(() => {
          if (generation === editGeneration) edit(remove, requestedRay, paint, context);
        })
        .catch(() => {});
      return;
    }
    if (context.mode === 'laundry') {
      editLaundry(remove, requestedRay);
      return;
    }
    const target = pick(remove, requestedRay, paint, context.domain === 'terrain', context.tool);
    if (!target) return;
    if (context.domain === 'terrain') {
      if (context.stroke?.seen.has(target.id)) return;
      const next = new Map(town);
      next.terrain = new Map(town.terrain || []);
      next.clotheslines = town.clotheslines?.map((line) => line.slice());
      if (!sculpt(next, target.id, remove ? 'lower' : context.tool, context.material, cells)) {
        if (context.tool === 'slope' && !remove)
          toast('Välj öppen mark bredvid en lägre granne. Höjdskillnad: ett eller två halvsteg.');
        return;
      }
      if (!context.stroke?.saved) history.push(town);
      if (context.stroke) {
        context.stroke.saved = true;
        context.stroke.seen.add(target.id);
      }
      town = next;
      rebuild().catch(() => {});
      updateHover();
      return;
    }
    history.push(town);
    const levels = town.get(target.id)?.slice() || [];
    if (remove) {
      levels[target.level] = null;
      while (levels.length && levels.at(-1) === null) levels.pop();
      if (levels.length) town.set(target.id, levels);
      else town.delete(target.id);
    } else {
      while (levels.length <= target.level) levels.push(null);
      levels[target.level] = target.level === 0 ? 0 : Math.max(0, paint);
      if (elevation(town, target.id) && levels[0] == null) levels[0] = 0;
      town.set(target.id, levels);
      if (town.terrain?.get(target.id)?.length === 3)
        town.terrain.set(target.id, town.terrain.get(target.id).slice(0, 2));
    }
    rebuild(remove ? null : { id: target.id, level: target.level }).catch(() => {});
    plop(remove);
    updateHover();
  }
  let dragging = false,
    terrainStroke = null;
  let start = null,
    activePointers = new Set(),
    multiTouch = false;
  const canvas = renderer.domElement;
  const pointerFrom = (e) => {
    if (start && activePointers.size && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6)
      dragging = true;
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    dirty = true;
  };
  canvas.addEventListener('pointermove', (e) => {
    pointerFrom(e);
    if (terrainStroke && e.buttons === 1) edit(false, null, selected, terrainStroke);
  });
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      pointerFrom(e);
      activePointers.add(e.pointerId);
      if (activePointers.size > 1) multiTouch = true;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
      if (
        domain === 'terrain' &&
        e.pointerType === 'mouse' &&
        e.button === 0 &&
        !e.shiftKey &&
        !e.altKey
      ) {
        terrainStroke = {
          domain,
          tool: terrainTool,
          material: terrainMaterial,
          stroke: { seen: new Set(), saved: false },
        };
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        edit(false, null, selected, terrainStroke);
      }
      if (e.shiftKey) controls.mouseButtons.LEFT = T.MOUSE.PAN;
      else controls.mouseButtons.LEFT = T.MOUSE.ROTATE;
    },
    true,
  );
  canvas.addEventListener('pointerup', (e) => {
    pointerFrom(e);
    if (
      start &&
      !multiTouch &&
      !dragging &&
      !terrainStroke &&
      !e.altKey &&
      !e.shiftKey &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6 &&
      performance.now() - start.t < 700 &&
      e.button !== 1
    )
      edit(e.button === 2 || mode === 'erase');
    terrainStroke = null;
    controls.enabled = true;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    activePointers.delete(e.pointerId);
    if (!activePointers.size) {
      multiTouch = false;
      start = null;
      dragging = false;
    }
  });
  canvas.addEventListener('pointercancel', (e) => {
    terrainStroke = null;
    controls.enabled = true;
    activePointers.delete(e.pointerId);
    start = null;
    multiTouch = false;
    dragging = false;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.set(10, 10);
    highlight.visible = ghost.visible = false;
    laundryPreview.visible = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  controls.addEventListener('change', () => (dirty = true));
  $('build').onclick = () => {
    setDomain('buildings');
    setMode('build');
  };
  $('landscape').onclick = () => {
    setDomain('terrain');
    selectTerrainTool('raise');
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'laundry') {
      resetLaundry();
      dirty = true;
    }
  });
  $('laundry-tool').onclick = () => {
    setDomain('buildings');
    setMode('laundry');
  };
  $('erase').onclick = () => setMode('erase');
  $('undo').onclick = () => {
    editGeneration++;
    resetLaundry();
    town = history.undo(town, cells.length);
    rebuild().catch(() => {});
  };
  $('redo').onclick = () => {
    editGeneration++;
    resetLaundry();
    town = history.redo(town, cells.length);
    rebuild().catch(() => {});
  };
  function home(...args) {
    return profiler.measure('input.home', () => homeWork(...args));
  }
  function homeWork() {
    const list = [...new Set([...town.keys(), ...(town.terrain?.keys() || [])])].map(
      (id) => cells[id].center,
    );
    let x = 0,
      z = 0;
    if (list.length) {
      x = list.reduce((s, p) => s + p[0], 0) / list.length;
      z = list.reduce((s, p) => s + p[1], 0) / list.length;
    }
    const height = Math.max(
      0,
      ...[...new Set([...town.keys(), ...(town.terrain?.keys() || [])])].map(
        (id) => groundY(town, id) + (town.get(id)?.length || 0) * FLOOR,
      ),
    );
    const targetY = town.terrain?.size ? Math.max(1.8, height * 0.5) : 1.8;
    controls.target.set(x, targetY, z);
    camera.position.set(x + 72, targetY + 72.8, z + 100);
    const radius = list.reduce((r, p) => Math.max(r, Math.hypot(p[0] - x, p[1] - z)), 0);
    camera.zoom = town.terrain?.size
      ? Math.min(1.3, 13 / Math.max(1, radius))
      : Math.min(1, 10 / Math.max(1, radius));
    camera.updateProjectionMatrix();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    camera.updateMatrixWorld();
    if (town.terrain?.size) {
      // Frame the actual projected island, including tall roofs, in portrait and landscape.
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const id of new Set([...town.keys(), ...town.terrain.keys()])) {
        const high =
          groundY(town, id) +
          BASE +
          Math.max(0, top(town.get(id))) * FLOOR +
          (town.has(id) ? 0.9 : 2.1);
        for (const [x, z] of cells[id].points)
          for (const y of [0, high]) {
            const p = new T.Vector3(x, y, z).project(camera);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
      }
      const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const offset = right
        .multiplyScalar((minX + maxX) * 0.25 * (camera.right - camera.left))
        .add(up.multiplyScalar((minY + maxY) * 0.25 * (camera.top - camera.bottom)));
      camera.position.add(offset);
      controls.target.add(offset);
      camera.zoom = Math.min(
        1.3,
        1.7 / (maxX - minX),
        (innerWidth < 701 ? 1.25 : 1.6) / (maxY - minY),
      );
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
    }
  }
  $('home').onclick = home;
  for (const name of ['help', 'settings'])
    $(name).onclick = () => {
      const panel = $(name + '-panel');
      const was = panel.classList.contains('hidden');
      document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
      panel.classList.toggle('hidden', !was);
    };
  document
    .querySelectorAll('.close')
    .forEach((b) => (b.onclick = () => b.closest('.panel').classList.add('hidden')));
  $('ao').onchange = (e) => env.setAO(e.target.checked);
  $('shadows').onchange = (e) => {
    // Keep the WebGPU shadow resources alive when toggling the effect.
    env.sun.shadow.intensity = e.target.checked ? 1 : 0;
    env.sun.shadow.needsUpdate = true;
  };
  $('grid').onchange = (e) => (grid.visible = e.target.checked);
  $('quality').onchange = (e) => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, Number(e.target.value)));
    renderer.setSize(innerWidth, innerHeight);
  };
  $('sun').oninput = (e) => {
    env.daylight(+e.target.value);
    $('time-label').textContent =
      e.target.value < 28 ? 'Morgon' : e.target.value > 78 ? 'Gyllene timmen' : 'Eftermiddag';
  };
  function download(...args) {
    return profiler.measure('export.download', () => downloadWork(...args));
  }
  function downloadWork(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('export').onclick = () => {
    download(new Blob([serialize(town)], { type: 'application/json' }), 'min-riviera.json');
    toast('Din by har sparats');
  };
  $('import').onclick = () => $('file').click();
  $('file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 2_000_000) throw Error();
      const text = await profiler.measureAsync('import.fileRead', () => f.text());
      const loaded = profiler.measure('storage.deserialize', () => deserialize(text, cells.length));
      editGeneration++;
      resetLaundry();
      history.push(town);
      town = loaded;
      await rebuild();
      home();
      toast('Välkommen tillbaka till din by');
    } catch {
      toast('Filen är inte en giltig Riviera-by.');
    }
    e.target.value = '';
  };
  $('landscape-demo').onclick = async () => {
    editGeneration++;
    resetLaundry();
    history.push(town);
    town = landscapeDemo(cells);
    await rebuild();
    home();
    setDomain('terrain');
    selectTerrainTool('raise');
    $('settings-panel').classList.add('hidden');
    toast('En kust att forma. Ångra tar dig tillbaka till din by.');
  };
  $('new').onclick = () => {
    editGeneration++;
    resetLaundry();
    history.push(town);
    town = new Map();
    rebuild().catch(() => {});
    home();
    $('settings-panel').classList.add('hidden');
    if (domain === 'terrain') selectTerrainTool('raise');
    toast(
      domain === 'terrain'
        ? 'Ett tomt hav. Klicka eller dra för att forma en ö.'
        : 'Ett tomt hav. Klicka för att lägga den första stenen.',
    );
  };
  let photoRequested = false;
  $('photo').onclick = () => {
    photoRequested = true;
  };
  $('sound').onclick = async () => {
    const audioScope = profiler.begin('audio.setup');
    soundOn = !soundOn;
    if (!soundContext) {
      soundContext = new AudioContext();
      const buffer = soundContext.createBuffer(
          1,
          soundContext.sampleRate * 4,
          soundContext.sampleRate,
        ),
        data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * 0.04 - 0.02) / 1.02;
        data[i] = last;
      }
      const src = soundContext.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = soundContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      const gain = soundContext.createGain();
      gain.gain.value = 0.16;
      src.connect(filter).connect(gain).connect(soundContext.destination);
      src.start();
    }
    profiler.end(audioScope);
    if (soundOn) await soundContext.resume();
    else await soundContext.suspend();
    $('sound').style.opacity = soundOn ? '1' : '.55';
    $('sound').setAttribute('aria-label', soundOn ? 'Stäng av havsljud' : 'Slå på havsljud');
    toast(soundOn ? 'Ljudet av en stilla kust' : 'Ljud av');
  };
  $('sound').style.opacity = '.55';
  addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      $(e.shiftKey ? 'redo' : 'undo').click();
    } else if (e.key.toLowerCase() === 'b') $('build').click();
    else if (e.key.toLowerCase() === 'l') $('landscape').click();
    else if (e.key.toLowerCase() === 'e') setMode('erase');
    else if (e.key.toLowerCase() === 'h') home();
    else if (e.key === 'Escape')
      document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  });
  addEventListener('resize', () => {
    const a = innerWidth / innerHeight;
    const h = Math.max(14, 11 / a);
    camera.left = -h * a;
    camera.right = h * a;
    camera.top = h;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    dirty = true;
  });
  let frames = 0,
    lastFps = performance.now(),
    fps = 0;
  profiler.end(uiStartupScope);
  renderer.setAnimationLoop(() => {
    profiler.beginFrame(architecture.gpuPending.size > 0);
    const frameScope = profiler.begin('frame');
    architecture.flushGPU();
    const animationScope = profiler.begin('frame.animationUniforms');
    architecture.clock.value = performance.now() / 1000;
    if (architecture.clock.value - architecture.started.value < 0.6)
      env.sun.shadow.needsUpdate = true;
    profiler.end(animationScope);
    profiler.measure('frame.controls', () => controls.update());
    if (dirty) {
      updateHover();
      dirty = false;
    }
    const boatsScope = profiler.begin('frame.boats');
    env.boats.children.forEach((b, i) => {
      b.position.y = 0.016 + Math.sin(performance.now() * 0.0008 + i) * 0.023;
      b.rotation.z = Math.sin(performance.now() * 0.0007 + i) * 0.018;
    });
    profiler.end(boatsScope);
    if (photoRequested) {
      highlight.visible = ghost.visible = false;
    }
    profiler.measure('frame.render', () => env.pipeline.render());
    architecture.markSubmitted();
    frames++;
    if (performance.now() - lastFps > 1000) {
      fps = (frames * 1000) / (performance.now() - lastFps);
      frames = 0;
      lastFps = performance.now();
    }
    if (photoRequested) {
      photoRequested = false;
      const photoStart = performance.now(),
        photoEpoch = profiler.epoch;
      canvas.toBlob((blob) => {
        profiler.record('async.photoEncode', performance.now() - photoStart, photoEpoch);
        if (blob) download(blob, 'ett-vykort-fran-riviera.png');
      }, 'image/png');
      dirty = true;
      toast('Ett vykort från din Riviera');
    }
    profiler.end(frameScope);
    profiler.endFrame();
  });
  // Diagnostics and opt-in controlled profiling experiments.
  window.riviera = {
    ready: () => architecture.ready(),
    verifyGPUInstances: () => architecture.verifyGPUInstances(),
    profiling: {
      start: (label, options) => profiler.start(label, options),
      stop: () => profiler.stop(),
      snapshot: () => ({ ...profiler.snapshot(), town: { ...architecture.stats } }),
      experiment: (options) => {
        if (!profiler.enabled) throw Error('Enable profiling first');
        env.profileVariant(options);
        if (options.pixelRatio !== undefined) {
          renderer.setPixelRatio(options.pixelRatio);
          renderer.setSize(innerWidth, innerHeight);
        }
        architecture.group.visible = options.buildings !== false;
        env.water.visible = options.water !== false;
        birdMesh.visible = options.birds !== false;
        env.boats.visible = options.boats !== false && town.size > 20;
      },
    },
    get stats() {
      return {
        ...architecture.stats,
        domain,
        terrainTool,
        terrainMaterial,
        pending: architecture.pending,
        revision: architecture.revision,
        appliedRevision: architecture.appliedRevision,
        fps,
        clotheslines: laundry.count,
        backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'unknown',
        ao: env.aoStrength.value,
        shadows: env.sun.shadow.intensity > 0,
        history: history.past.length,
      };
    },
    get snapshot() {
      return serialize(town);
    },
    projectCell(id, level = 0) {
      const c = cells[id];
      const roof = architecture.roofCenters.get(id * 32 + level);
      const p = new T.Vector3(
        c.center[0],
        groundY(town, id) +
          (level === 0 ? BASE : BASE + level * FLOOR + (roof !== undefined ? roof - 0.08 : 0.25)),
        c.center[1],
      ).project(camera);
      return { x: ((p.x + 1) * innerWidth) / 2, y: ((1 - p.y) * innerHeight) / 2 };
    },
    projectTerrain(id) {
      const c = cells[id],
        p = new T.Vector3(
          c.center[0],
          cornerHeights(c, town.terrain || new Map(), town, cells).reduce((a, b) => a + b, 0) / 4 +
            0.01,
          c.center[1],
        ).project(camera);
      return { x: ((p.x + 1) * innerWidth) / 2, y: ((1 - p.y) * innerHeight) / 2 };
    },
    projectFace(id, level, edge) {
      const c = cells[id],
        a = c.points[edge],
        b = c.points[(edge + 1) % 4];
      const p = new T.Vector3(
        (a[0] + b[0]) / 2,
        groundY(town, id) + BASE + (level - 0.5) * FLOOR,
        (a[1] + b[1]) / 2,
      ).project(camera);
      return { x: ((p.x + 1) * innerWidth) / 2, y: ((1 - p.y) * innerHeight) / 2 };
    },
    get cells() {
      return cells.map((c) => ({
        id: c.id,
        center: [...c.center],
        points: c.points.map((p) => [...p]),
        neighbors: [...c.neighbors],
      }));
    },
  };
  mountProfiler(profiler, () => window.riviera.profiling.snapshot());
}
init().catch((error) => {
  console.error(error);
  $('fatal').textContent = error.message;
  $('fatal').classList.remove('hidden');
});
