import { REVISION } from 'three';
// Three r185 keeps render objects alive through material listeners; its geometry
// disposal only sees the first pass's attributes. Centralize compatibility here.
export function trackRenderResources(renderer) {
  if (REVISION !== '185')
    throw Error('Riviera resource adapter must be verified before upgrading Three.js.');
  const objects = new WeakMap(),
    manager = renderer._objects;
  const create = manager.createRenderObject;
  manager.createRenderObject = function (...args) {
    const ro = create.apply(this, args),
      mesh = ro.object;
    let set = objects.get(mesh);
    if (!set) {
      set = new Set();
      objects.set(mesh, set);
    }
    set.add(ro);
    const dispose = ro.onDispose;
    ro.onDispose = () => {
      set.delete(ro);
      dispose();
    };
    return ro;
  };
  function attribute(attr) {
    if (attr) renderer._attributes.delete(attr);
  }
  function release(mesh) {
    // Dispose bindings/pipelines for every material variant before removing mesh data.
    for (const ro of [...(objects.get(mesh) || [])]) ro.dispose();
    for (const a of Object.values(mesh.geometry.attributes)) attribute(a);
    attribute(mesh.geometry.index);
    attribute(mesh.instanceMatrix);
    attribute(mesh.instanceColor);
    mesh.geometry.dispose();
    if (mesh.isInstancedMesh) mesh.dispose();
  }
  return { release, attribute };
}
