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
const $ = (id) => document.getElementById(id);
const icons = {
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
function toast(text) {
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
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend)
    throw new Error(
      'WebGPU kunde inte starta. Kontrollera att hårdvaruacceleration är påslagen i webbläsaren.',
    );
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
  const { cells } = makeGrid();
  let town = demoTown(cells);
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) town = deserialize(saved, cells.length);
  } catch {
    toast('Din tidigare sparning kunde inte läsas. En ny hamn är redo.');
  }
  const architecture = new Architecture(scene, cells);
  const env = environment(scene, renderer, camera, cells);
  const history = new History();
  let selected = 0,
    mode = 'build',
    hover = null,
    dirty = true,
    soundOn = false,
    soundContext = null;
  function rebuild() {
    architecture.rebuild(town);
    env.updateShore(town);
    env.boats.visible = town.size > 20;
    $('town-count').textContent = `${town.size} PLATSER · ${architecture.stats.floors} VÅNINGAR`;
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
    try {
      localStorage.setItem(SAVE_KEY, serialize(town));
    } catch {
      toast('Det gick inte att autospara. Använd Spara by i inställningarna.');
    }
    dirty = true;
  }
  rebuild();
  const lineMat = new T.LineBasicNodeMaterial({
    color: '#ffefcf',
    transparent: true,
    opacity: 0.9,
    depthTest: true,
  });
  let highlight = new T.LineSegments(new T.BufferGeometry(), lineMat);
  env.addOverlay(highlight, 2);
  const ghostMat = new T.MeshBasicNodeMaterial({
    color: PALETTE[0],
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: T.DoubleSide,
  });
  const ghost = new T.Mesh(new T.BufferGeometry(), ghostMat);
  env.addOverlay(ghost, 1);
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
    document.querySelectorAll('.swatch').forEach((b) => {
      const active = Number(b.dataset.color) === index;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-pressed', String(active));
    });
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
    $('build').classList.toggle('active', m === 'build');
    $('erase').classList.toggle('active', m === 'erase');
    $('build').setAttribute('aria-pressed', String(m === 'build'));
    $('erase').setAttribute('aria-pressed', String(m === 'erase'));
    dirty = true;
  }
  select(0);
  const ray = new T.Raycaster(),
    pointer = new T.Vector2(10, 10),
    plane = new T.Plane(new T.Vector3(0, 1, 0), 0),
    hitPoint = new T.Vector3();
  function pick(remove = false) {
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(architecture.pickMeshes, false);
    if (hits.length) {
      const hit = hits[0],
        meta = hit.object.userData.faces[hit.faceIndex];
      if (!meta) return null;
      let { id, level, edge } = meta;
      if (remove) return { id, level };
      if (selected === -1) {
        if (edge >= 0) id = cells[id].neighbors[edge];
        else if (level === 0) return null;
        return id >= 0 && town.get(id)?.[0] == null ? { id, level: 0 } : null;
      }
      if (edge < 0) level++;
      else {
        id = cells[id].neighbors[edge];
      }
      if (id < 0 || level > 24 || town.get(id)?.[level] != null) return null;
      return { id, level };
    }
    if (remove) return null;
    if (ray.ray.intersectPlane(plane, hitPoint)) {
      const cell = cells.find(
        (c) =>
          Math.abs(c.center[0] - hitPoint.x) < 2 &&
          Math.abs(c.center[1] - hitPoint.z) < 2 &&
          inside([hitPoint.x, hitPoint.z], c.points),
      );
      if (cell && town.get(cell.id)?.[0] == null) return { id: cell.id, level: 0 };
    }
    return null;
  }
  function updateHover() {
    hover = pick(mode === 'erase');
    highlight.visible = ghost.visible = !!hover;
    if (!hover) return;
    const c = cells[hover.id],
      // Include a selected roof even when neighbors hide the walls beneath it.
      roofMargin =
        mode === 'erase' && hover.level > 0 && top(town.get(hover.id)) === hover.level
          ? (architecture.roofHeights.get(hover.id * 32 + hover.level) ?? 0.6) + 0.07
          : 0.02,
      y = hover.level === 0 ? BASE + 0.018 : BASE + hover.level * FLOOR + roofMargin,
      bottom = hover.level === 0 ? 0.01 : BASE + (hover.level - 1) * FLOOR + 0.02;
    const lines = [],
      tri = [];
    for (let e = 0; e < 4; e++) {
      const a = c.points[e],
        b = c.points[(e + 1) % 4];
      lines.push(a[0], y, a[1], b[0], y, b[1], a[0], bottom, a[1], a[0], y, a[1]);
      tri.push(
        a[0],
        bottom,
        a[1],
        a[0],
        y,
        a[1],
        b[0],
        y,
        b[1],
        a[0],
        bottom,
        a[1],
        b[0],
        y,
        b[1],
        b[0],
        bottom,
        b[1],
      );
    }
    highlight.geometry.dispose();
    highlight.geometry = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(lines, 3),
    );
    ghost.geometry.dispose();
    ghost.geometry = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(tri, 3),
    );
    const col = mode === 'erase' ? '#f58973' : selected === -1 ? '#eae2c6' : PALETTE[selected];
    lineMat.color.set(mode === 'erase' ? '#fa8975' : '#fff1ca');
    ghostMat.color.set(col);
  }
  function plop(remove) {
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
  function edit(remove = false) {
    const target = pick(remove);
    if (!target) return;
    history.push(town);
    const levels = town.get(target.id)?.slice() || [];
    if (remove) {
      levels[target.level] = null;
      while (levels.length && levels.at(-1) === null) levels.pop();
      if (levels.length) town.set(target.id, levels);
      else town.delete(target.id);
    } else {
      while (levels.length <= target.level) levels.push(null);
      levels[target.level] = target.level === 0 ? 0 : Math.max(0, selected);
      town.set(target.id, levels);
      architecture.animate(target.id, target.level);
    }
    rebuild();
    plop(remove);
    updateHover();
  }
  let start = null,
    activePointers = new Set(),
    multiTouch = false;
  const canvas = renderer.domElement;
  const pointerFrom = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    dirty = true;
  };
  canvas.addEventListener('pointermove', pointerFrom);
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      pointerFrom(e);
      activePointers.add(e.pointerId);
      if (activePointers.size > 1) multiTouch = true;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
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
      !e.shiftKey &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6 &&
      performance.now() - start.t < 700 &&
      e.button !== 1
    )
      edit(e.button === 2 || mode === 'erase');
    activePointers.delete(e.pointerId);
    if (!activePointers.size) {
      multiTouch = false;
      start = null;
    }
  });
  canvas.addEventListener('pointercancel', (e) => {
    activePointers.delete(e.pointerId);
    start = null;
    multiTouch = false;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.set(10, 10);
    highlight.visible = ghost.visible = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  controls.addEventListener('change', () => (dirty = true));
  $('build').onclick = () => setMode('build');
  $('erase').onclick = () => setMode('erase');
  $('undo').onclick = () => {
    town = history.undo(town, cells.length);
    rebuild();
  };
  $('redo').onclick = () => {
    town = history.redo(town, cells.length);
    rebuild();
  };
  function home() {
    const list = [...town.keys()].map((id) => cells[id].center);
    let x = 0,
      z = 0;
    if (list.length) {
      x = list.reduce((s, p) => s + p[0], 0) / list.length;
      z = list.reduce((s, p) => s + p[1], 0) / list.length;
    }
    controls.target.set(x, 1.8, z);
    camera.position.set(x + 72, 74.6, z + 100);
    const radius = list.reduce((r, p) => Math.max(r, Math.hypot(p[0] - x, p[1] - z)), 0);
    camera.zoom = Math.min(1, 10 / Math.max(1, radius));
    camera.updateProjectionMatrix();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    camera.updateMatrixWorld();
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
  function download(blob, name) {
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
      const loaded = deserialize(await f.text(), cells.length);
      history.push(town);
      town = loaded;
      rebuild();
      home();
      toast('Välkommen tillbaka till din by');
    } catch {
      toast('Filen är inte en giltig Riviera-by.');
    }
    e.target.value = '';
  };
  $('new').onclick = () => {
    history.push(town);
    town = new Map();
    rebuild();
    home();
    $('settings-panel').classList.add('hidden');
    toast('Ett tomt hav. Klicka för att lägga den första stenen.');
  };
  let photoRequested = false;
  $('photo').onclick = () => {
    photoRequested = true;
  };
  $('sound').onclick = async () => {
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
    } else if (e.key.toLowerCase() === 'b') setMode('build');
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
  renderer.setAnimationLoop(() => {
    architecture.clock.value = performance.now() / 1000;
    if (architecture.clock.value - architecture.started.value < 0.6)
      env.sun.shadow.needsUpdate = true;
    controls.update();
    if (dirty) {
      updateHover();
      dirty = false;
    }
    env.boats.children.forEach((b, i) => {
      b.position.y = 0.016 + Math.sin(performance.now() * 0.0008 + i) * 0.023;
      b.rotation.z = Math.sin(performance.now() * 0.0007 + i) * 0.018;
    });
    if (photoRequested) {
      highlight.visible = ghost.visible = false;
    }
    env.pipeline.render();
    frames++;
    if (performance.now() - lastFps > 1000) {
      fps = (frames * 1000) / (performance.now() - lastFps);
      frames = 0;
      lastFps = performance.now();
    }
    if (photoRequested) {
      photoRequested = false;
      canvas.toBlob((blob) => {
        if (blob) download(blob, 'ett-vykort-fran-riviera.png');
      }, 'image/png');
      dirty = true;
      toast('Ett vykort från din Riviera');
    }
  });
  // Read-only diagnostics used by the automated interaction checks.
  window.riviera = {
    get stats() {
      return {
        ...architecture.stats,
        fps,
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
      const roof = architecture.roofPlans.get(id * 32 + level);
      const p = new T.Vector3(
        c.center[0],
        level === 0
          ? BASE
          : BASE + level * FLOOR + (roof ? roof.sample(...c.center).height - 0.08 : 0.25),
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
        BASE + (level - 0.5) * FLOOR,
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
}
init().catch((error) => {
  console.error(error);
  $('fatal').textContent = error.message;
  $('fatal').classList.remove('hidden');
});
