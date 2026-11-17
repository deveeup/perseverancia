import * as THREE from 'three';

// ---------- ruido ----------
function hash(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    a *= 0.5;
  }
  return s;
}

const smooth = (t) => t * t * (3 - 2 * t);

// ---------- altura (compartida con rocas, cámara, etc.) ----------
export function heightAt(x, z) {
  const wx = x + (fbm(x * 0.01, z * 0.01, 3) - 0.5) * 70;
  const wz = z + (fbm(x * 0.01 + 5, z * 0.01 + 5, 3) - 0.5) * 70;
  // crestas de duna perpendiculares al viento, perfil asimétrico (suave a barlovento, abrupto a sotavento)
  const d = wx * 0.82 + wz * 0.57;
  const p = d / 36 + fbm(wx * 0.02, wz * 0.02, 3) * 2.2;
  const f = p - Math.floor(p);
  const saw = f < 0.78 ? smooth(f / 0.78) * 0.9 + 0.1 * (f / 0.78) : smooth((1 - f) / 0.22);
  const amp = 4 + fbm(wx * 0.007, wz * 0.007, 3) * 14;
  const rolling = (fbm(x * 0.015, z * 0.015, 4) - 0.5) * 6;
  const ripples = (fbm(x * 0.5, z * 0.5, 2) - 0.5) * 0.18;
  return saw * amp + rolling + ripples;
}

// ---------- altura real de la malla (para ruedas, huellas, etc.) ----------
// heightAt() es la fórmula ideal; la malla la interpola linealmente cada `cell` metros,
// así que para apoyar cosas sobre el suelo visible se usa groundAt().
let grid = null;

export function groundAt(x, z) {
  if (!grid) return heightAt(x, z);
  const { h, n, size, cell } = grid;
  const gx = (x + size / 2) / cell, gz = (z + size / 2) / cell;
  if (gx < 0 || gz < 0 || gx >= n - 1 || gz >= n - 1) return heightAt(x, z);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const u = gx - ix, v = gz - iz;
  const a = h[iz * n + ix], b = h[(iz + 1) * n + ix], c = h[(iz + 1) * n + ix + 1], d = h[iz * n + ix + 1];
  // misma partición en triángulos que PlaneGeometry: (a,b,d) y (b,c,d)
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

export function groundNormalAt(x, z, out = new THREE.Vector3(), e = 0.6) {
  const dx = groundAt(x + e, z) - groundAt(x - e, z);
  const dz = groundAt(x, z + e) - groundAt(x, z - e);
  return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
}

// ---------- malla ----------
export function buildTerrain({ size = 1000, segments = 450 } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const n = segments + 1, cell = size / segments;
  const heights = new Float32Array(n * n);
  const colors = new Float32Array(pos.count * 3);
  const lo = new THREE.Color('#a85c34'); // óxido en valles
  const mid = new THREE.Color('#c98450'); // ocre
  const hi = new THREE.Color('#e6ad70'); // arena clara en crestas
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const ix = Math.round((x + size / 2) / cell), iz = Math.round((z + size / 2) / cell);
    heights[iz * n + ix] = h;
    const t = THREE.MathUtils.clamp((h + 3) / 14, 0, 1);
    const grain = fbm(x * 0.8, z * 0.8, 2);
    c.copy(lo).lerp(mid, Math.min(1, t * 1.6)).lerp(hi, Math.max(0, t - 0.45) * 1.8);
    c.multiplyScalar(0.88 + grain * 0.28);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  grid = { h: heights, n, size, cell };
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
