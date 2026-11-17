import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { groundAt, groundNormalAt } from './terrain.js';

const BASE = import.meta.env.BASE_URL;
const REAL_WIDTH = 2.7; // m, ancho real de Perseverance de rueda a rueda (NASA)

// ---------- conducción ----------
const MAX_SPEED = 5; // m/s (arcade: el real va a ~0.04 m/s)
const REVERSE_FACTOR = 0.6;
const ACCEL = 6, BRAKE = 9; // m/s²
const TURN_RATE = 1.0; // rad/s, gira incluso detenido
const MAX_SLOPE = Math.tan(THREE.MathUtils.degToRad(34));
export const MAP_LIMIT = 230; // m desde el origen (más allá la malla del terreno se acaba)

// ---------- helpers de geometría ----------
/** Componentes conexos de una malla: agrupa triángulos que comparten vértices (por posición). */
function connectedComponents(g) {
  const pos = g.attributes.position;
  const idx = g.index ? g.index.array : null;
  const triCount = (idx ? idx.length : pos.count) / 3;
  const vid = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);

  const canon = new Int32Array(pos.count);
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    const c = seen.get(key);
    if (c === undefined) { seen.set(key, i); canon[i] = i; } else canon[i] = c;
  }
  const parent = new Int32Array(pos.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < triCount; t++) {
    union(canon[vid(t, 0)], canon[vid(t, 1)]);
    union(canon[vid(t, 1)], canon[vid(t, 2)]);
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(canon[vid(t, 0)]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()].map((tris) => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const t of tris) for (let k = 0; k < 3; k++) box.expandByPoint(v.fromBufferAttribute(pos, vid(t, k)));
    return { tris, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  });
}

/** Geometría nueva con solo los triángulos indicados (vértices compactados). */
function subGeometry(g, tris) {
  const idx = g.index ? g.index.array : null;
  const remap = new Map();
  const order = [];
  const newIndex = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx[t * 3 + k] : t * 3 + k;
      let m = remap.get(v);
      if (m === undefined) { m = order.length; remap.set(v, m); order.push(v); }
      newIndex[i * 3 + k] = m;
    }
  });
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const arr = new a.array.constructor(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++)
      for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.array[order[i] * a.itemSize + c];
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(newIndex, 1));
  return out;
}

/**
 * Las 6 ruedas vienen fundidas en `Wheels_objs`: 3 mallas (una por material: aluminio, neumático, buje)
 * con las piezas de las 6 ruedas mezcladas. Se detectan los 6 neumáticos (cilindros con eje en X) y cada
 * pieza (tornillos, discos, bujes) se asigna a la rueda más cercana, para poder hacerlas girar.
 * Devuelve [] si no se logra identificar exactamente 6 ruedas (el rover se mueve igual, sin giro).
 */
function extractWheels(model, debug) {
  const src = model.getObjectByName('Wheels_objs');
  if (!src) { debug.wheels = 'no existe el nodo Wheels_objs'; return []; }
  const meshes = src.isMesh ? [src] : src.children.filter((c) => c.isMesh);
  if (!meshes.length || meshes.some((m) => !m.matrix.equals(new THREE.Matrix4()))) {
    debug.wheels = 'estructura de Wheels_objs inesperada (mallas con transformación propia)';
    return [];
  }
  const parts = meshes.map((mesh) => ({ mesh, comps: connectedComponents(mesh.geometry) }));

  // neumático: y ≈ z (diámetro), más ancho que un disco, eje en X
  const tires = parts.flatMap((p) => p.comps).filter(
    (c) => c.size.y > 0.4 && Math.abs(c.size.y - c.size.z) < 0.1 * c.size.y && c.size.x > 0.25 && c.size.x < c.size.y,
  );
  if (tires.length !== 6) { debug.wheels = `se esperaban 6 neumáticos, se hallaron ${tires.length}`; return []; }

  const root = new THREE.Group();
  root.name = 'wheels_root';
  root.position.copy(src.position); root.quaternion.copy(src.quaternion); root.scale.copy(src.scale);
  src.parent.add(root);

  const wheels = tires.map((t, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheel_${i}`;
    pivot.position.copy(t.center);
    root.add(pivot);
    return { pivot, center: t.center, radius: Math.max(t.size.y, t.size.z) / 2, width: t.size.x, pieces: 0 };
  });

  // reparte cada pieza a su rueda (misma zona del eje y dentro del radio); lo demás queda donde estaba
  for (const { mesh, comps } of parts) {
    const byWheel = wheels.map(() => []);
    const rest = [];
    for (const c of comps) {
      let owner = -1, best = Infinity;
      wheels.forEach((w, i) => {
        const dx = Math.abs(c.center.x - w.center.x);
        const dr = Math.hypot(c.center.y - w.center.y, c.center.z - w.center.z);
        if (dx < 0.3 && dr < w.radius * 1.05 && dx + dr < best) { best = dx + dr; owner = i; }
      });
      if (owner >= 0) byWheel[owner].push(...c.tris);
      else rest.push(...c.tris);
    }
    byWheel.forEach((tris, i) => {
      if (!tris.length) return;
      const w = wheels[i];
      const geo = subGeometry(mesh.geometry, tris);
      geo.translate(-w.center.x, -w.center.y, -w.center.z);
      const m = new THREE.Mesh(geo, mesh.material);
      m.castShadow = m.receiveShadow = true;
      w.pivot.add(m);
      w.pieces++;
    });
    if (rest.length) mesh.geometry = subGeometry(mesh.geometry, rest);
    else mesh.visible = false;
  }
  debug.wheels = `6 ruedas separadas (piezas por rueda: ${wheels.map((w) => w.pieces).join(', ')})`;
  return wheels;
}

/** Piezas del modelo que son cámaras (por nombre), y sus tapas aparte. */
function findCameraParts(model) {
  const cams = [], covers = [];
  const hit = (o) => !!o.name && /cam|lens|watson/i.test(o.name);
  model.traverse((o) => {
    if (!hit(o)) return;
    // sub-mallas internas de una pieza ya listada (p. ej. los soportes "…HAZCAM BRACKET…") no se repiten
    for (let p = o.parent; p; p = p.parent) if (hit(p)) return;
    (/cover/i.test(o.name) ? covers : cams).push(o.name);
  });
  return { cams, covers };
}

// ---------- carga ----------
export async function loadRover(envMap) {
  const debug = {};
  const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(`${BASE}models/perseverance.glb`);
  draco.dispose();
  const model = gltf.scene;

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false;
    for (const m of [].concat(o.material)) if (envMap) { m.envMap = envMap; m.envMapIntensity = 0.8; }
  });

  const wheels = extractWheels(model, debug);
  const parts = findCameraParts(model);

  // --- escala real y pivote (centro de las ruedas, apoyado en y = 0) ---
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const wp = wheels.map((w) => w.pivot.getWorldPosition(new THREE.Vector3()));
  let width = size.x, bottom = box.min.y, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  if (wheels.length) {
    const maxX = Math.max(...wp.map((p) => Math.abs(p.x)));
    width = maxX * 2 + wheels[0].width;
    bottom = Math.min(...wp.map((p, i) => p.y - wheels[i].radius));
    cx = wp.reduce((s, p) => s + p.x, 0) / wp.length;
    cz = wp.reduce((s, p) => s + p.z, 0) / wp.length;
  }
  const k = REAL_WIDTH / width;
  debug.modelSize = size.toArray().map((v) => +v.toFixed(3));
  debug.widthModel = +width.toFixed(3);
  debug.scale = +k.toFixed(4);

  model.scale.setScalar(k);
  model.position.set(-cx * k, -bottom * k, -cz * k);
  const object = new THREE.Group();
  object.name = 'perseverance';
  object.add(model);

  const wheelData = wheels.map((w, i) => ({
    pivot: w.pivot,
    radius: w.radius * k,
    x: (wp[i].x - cx) * k,
    z: (wp[i].z - cz) * k,
  }));
  const dims = size.clone().multiplyScalar(k);
  debug.finalSize = dims.toArray().map((v) => +v.toFixed(2));
  debug.wheelRadius = wheelData.map((w) => +w.radius.toFixed(3));

  console.log(`[rover] Modelo cargado. Escala x${k.toFixed(3)} → ${dims.x.toFixed(2)} × ${dims.y.toFixed(2)} × ${dims.z.toFixed(2)} m (an × al × lg); ruedas: ${wheelData.length}`);
  console.log(`[rover] Piezas que son cámaras (${parts.cams.length}):`);
  parts.cams.forEach((n) => console.log(`[rover]   • ${n}`));
  if (parts.covers.length) {
    console.log(`[rover] Tapas de cámaras (${parts.covers.length}):`);
    parts.covers.forEach((n) => console.log(`[rover]   • ${n}`));
  }

  return { object, wheels: wheelData, size: dims, cameraParts: parts, debug };
}

// ---------- física arcade ----------
const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _pts = [0, 1, 2, 3].map(() => new THREE.Vector3());
const _fwd = new THREE.Vector3(), _left = new THREE.Vector3(), _n = new THREE.Vector3(), _X = new THREE.Vector3(), _Z = new THREE.Vector3();

export class RoverDrive {
  constructor(loaded, start, colliders = []) {
    this.object = loaded.object;
    this.wheels = loaded.wheels;
    this.size = loaded.size;
    this.colliders = colliders;
    this.x = start.x;
    this.z = start.z;
    this.heading = start.heading;
    this.speed = 0;
    this.distance = 0;
    this.blocked = false;
    // esquinas para ajustar la inclinación al terreno
    const hx = this.wheels.length ? Math.max(...this.wheels.map((w) => Math.abs(w.x))) : this.size.x * 0.4;
    const hz = this.wheels.length ? Math.max(...this.wheels.map((w) => Math.abs(w.z))) : this.size.z * 0.35;
    this.corners = [[hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]]; // FL, FR, RL, RR (x+ = izquierda)
    this.halfTrack = hx;
    this.radius = Math.max(hx, hz) * 0.9; // huella circular para chocar con rocas
    this.wheelWorld = this.wheels.map(() => new THREE.Vector3());
    this.wheelPrev = this.wheels.map(() => new THREE.Vector3());
    this.moved = this.wheels.map(() => new THREE.Vector3());
    this.alignGround(0, true);
  }

  slopeAt(x, z) {
    const n = groundNormalAt(x, z, _n);
    return Math.hypot(n.x, n.z) / n.y; // tan(inclinación)
  }

  update(dt, input) {
    const dir = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    const turn = (input.l ? 1 : 0) - (input.r ? 1 : 0);
    const target = dir > 0 ? MAX_SPEED : dir < 0 ? -MAX_SPEED * REVERSE_FACTOR : 0;
    const rate = dir === 0 || Math.sign(target) !== Math.sign(this.speed) ? BRAKE : ACCEL;
    const dv = THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);
    this.speed += dv;
    if (Math.abs(this.speed) < 0.01 && dir === 0) this.speed = 0;

    const yawRate = turn * TURN_RATE;
    this.heading += yawRate * dt;

    // avance con límites de mapa, pendiente y rocas
    const step = this.speed * dt;
    let nx = this.x + Math.sin(this.heading) * step;
    let nz = this.z + Math.cos(this.heading) * step;
    this.blocked = false;
    if (Math.abs(nx) > MAP_LIMIT || Math.abs(nz) > MAP_LIMIT) {
      nx = THREE.MathUtils.clamp(nx, -MAP_LIMIT, MAP_LIMIT);
      nz = THREE.MathUtils.clamp(nz, -MAP_LIMIT, MAP_LIMIT);
      this.blocked = true;
    }
    if (step !== 0) {
      const s1 = this.slopeAt(nx, nz);
      if (s1 > MAX_SLOPE && s1 > this.slopeAt(this.x, this.z) + 1e-3) { nx = this.x; nz = this.z; this.blocked = true; }
    }
    for (const c of this.colliders) {
      const dx = nx - c.x, dz = nz - c.z, min = c.r + this.radius * 0.8;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-3;
        nx = c.x + (dx / d) * min;
        nz = c.z + (dz / d) * min;
        this.blocked = true;
      }
    }
    this.distance += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;
    if (this.blocked && step !== 0) this.speed *= 0.5;

    this.alignGround(dt, false);

    // giro de ruedas: cada lado con su velocidad (viraje diferencial)
    const v = this.speed;
    this.wheels.forEach((w, i) => {
      const vw = v + (w.x > 0 ? -1 : 1) * yawRate * Math.abs(w.x);
      w.pivot.rotation.x += (vw * dt) / w.radius;
    });
  }

  /** Apoya el rover en el terreno: altura media de 4 esquinas + inclinación del plano que forman. */
  alignGround(dt, snap) {
    const h = this.heading;
    _f.set(Math.sin(h), 0, Math.cos(h));
    _l.set(Math.cos(h), 0, -Math.sin(h));
    let sumY = 0;
    this.corners.forEach(([cx, cz], i) => {
      const x = this.x + _l.x * cx + _f.x * cz, z = this.z + _l.z * cx + _f.z * cz;
      _pts[i].set(x, groundAt(x, z), z);
      sumY += _pts[i].y;
    });
    _fwd.copy(_pts[0]).add(_pts[1]).sub(_pts[2]).sub(_pts[3]); // adelante
    _left.copy(_pts[0]).add(_pts[2]).sub(_pts[1]).sub(_pts[3]); // izquierda
    _n.crossVectors(_fwd, _left).normalize();
    _X.crossVectors(_n, _fwd).normalize();
    _Z.crossVectors(_X, _n).normalize();
    _q.setFromRotationMatrix(_m.makeBasis(_X, _n, _Z));
    this.object.position.set(this.x, sumY / 4, this.z);
    if (snap) this.object.quaternion.copy(_q);
    else this.object.quaternion.slerp(_q, 1 - Math.exp(-10 * dt));
    this.object.updateMatrixWorld(true);

    // posición de cada rueda en el suelo (para las huellas)
    this.wheels.forEach((w, i) => {
      this.wheelPrev[i].copy(this.wheelWorld[i]);
      this.wheelWorld[i].set(w.x, 0, w.z).applyMatrix4(this.object.matrixWorld);
      this.wheelWorld[i].y = groundAt(this.wheelWorld[i].x, this.wheelWorld[i].z);
    });
  }
}
