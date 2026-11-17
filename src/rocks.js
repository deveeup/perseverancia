import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, heightAt } from './terrain.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rockGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const n = fbm(p.x * 1.6 + seed * 11, p.z * 1.6 + p.y * 1.2 + seed * 7, 4);
    const r = 0.65 + n * 0.8;
    // aristas: cuantiza un poco la forma para que parezca fracturada
    p.multiplyScalar(r);
    p.y = Math.max(p.y, -0.45);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Rocas instanciadas. camPos / camAz: para colocar un grupo bien visible frente a la cámara. */
export function buildRocks(camPos, camAz, keepClear = []) {
  const rng = mulberry32(1234);
  const variants = [1, 2, 3].map(rockGeometry);
  const lists = variants.map(() => []);

  const colliders = [];
  const blocked = (x, z) => keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r);
  const add = (x, z, s) => {
    if (blocked(x, z)) return;
    const v = Math.floor(rng() * variants.length);
    const rock = {
      x, z, s,
      sx: 0.8 + rng() * 0.5, sy: 0.5 + rng() * 0.4, sz: 0.8 + rng() * 0.5,
      ry: rng() * Math.PI * 2, rx: (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * 0.4,
      tone: rng(),
    };
    lists[v].push(rock);
    const r = s * Math.max(rock.sx, rock.sz) * 0.85; // radio aproximado en planta
    if (r > 0.3) colliders.push({ x, z, r });
  };

  // 1) esparcidas por todo el terreno, agrupadas por ruido
  let tries = 0;
  let placed = 0;
  while (placed < 1100 && tries++ < 40000) {
    const x = (rng() - 0.5) * 800, z = (rng() - 0.5) * 800;
    if (Math.hypot(x - camPos.x, z - camPos.z) < 5) continue;
    if (fbm(x * 0.025, z * 0.025, 3) < 0.48 + rng() * 0.1) continue;
    add(x, z, 0.18 + rng() ** 4 * 2.4);
    placed++;
  }
  // 2) rocas "protagonistas" delante de la cámara
  for (let i = 0; i < 90; i++) {
    const az = camAz + (rng() - 0.5) * 1.5;
    const dist = 12 + rng() ** 1.3 * 110;
    add(camPos.x + Math.sin(az) * dist, camPos.z + Math.cos(az) * dist, 0.3 + rng() ** 2 * 1.1);
  }

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), t = new THREE.Vector3();
  const dark = new THREE.Color('#6a3e2c'), light = new THREE.Color('#a87650'), c = new THREE.Color();
  let total = 0;
  variants.forEach((geo, i) => {
    const list = lists[i];
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((r, k) => {
      e.set(r.rx, r.ry, r.rz);
      q.setFromEuler(e);
      sc.set(r.s * r.sx, r.s * r.sy, r.s * r.sz);
      t.set(r.x, heightAt(r.x, r.z) + r.s * r.sy * 0.3, r.z);
      m.compose(t, q, sc);
      inst.setMatrixAt(k, m);
      c.copy(dark).lerp(light, r.tone);
      inst.setColorAt(k, c);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
    total += list.length;
  });
  group.userData.count = total;
  group.userData.colliders = colliders;
  return group;
}
