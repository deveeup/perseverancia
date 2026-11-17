import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './terrain.js';

export const HORIZON = new THREE.Color('#dc8c4a');

// dirección (azimut, elevación) en radianes → vector unitario. Azimut 0 = +Z, crece hacia +X.
export const dirFromAzEl = (az, el) =>
  new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

const rad = (d) => (d * Math.PI) / 180;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- cúpula del cielo ----------
function buildDome(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uHorizon: { value: HORIZON },
      uMid: { value: new THREE.Color('#cf8446') },
      uZenith: { value: new THREE.Color('#a8683c') },
      uSunColor: { value: new THREE.Color('#ffb870') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uHorizon, uMid, uZenith, uSunColor;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, h));
        col = mix(col, uZenith, smoothstep(0.2, 0.95, h));
        // polvo en suspensión: vetas claras cerca del horizonte
        vec2 uv = d.xz / (abs(d.y) + 0.14);
        float dust = noise(uv * 1.3) * 0.6 + noise(uv * 3.7 + 4.0) * 0.4;
        float mask = exp(-h * 4.5) * smoothstep(0.0, 0.05, h);
        col = mix(col, uHorizon * 1.18, dust * mask * 0.6);
        // resplandor del sol + disco
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 5.0) * 0.1 + pow(s, 36.0) * 0.3 + pow(s, 500.0) * 0.8);
        col += uSunColor * 30.0 * smoothstep(0.99972, 0.99984, s);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), mat);
  dome.renderOrder = -1;
  return dome;
}

/** Mapa de entorno (PMREM) generado desde el propio cielo: reflejos cálidos en las piezas metálicas del rover. */
export function buildEnvironment(renderer, sunDir) {
  const s = new THREE.Scene();
  s.add(buildDome(sunDir.clone()));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0, 0.1, 3000);
  pmrem.dispose();
  return rt.texture;
}

// ---------- lunas ----------
function buildMoon({ radius, scale, craters, seed, base, lightDir }) {
  let geo = new THREE.IcosahedronGeometry(1, 22);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);

  const rng = mulberry32(seed);
  const cr = [{ v: new THREE.Vector3(0.45, 0.25, 0.85).normalize(), r: 0.5, d: 0.1 }];
  for (let i = 1; i < craters; i++) {
    cr.push({
      v: new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize(),
      r: 0.1 + rng() ** 2 * 0.35,
      d: 0.03 + rng() * 0.05,
    });
  }

  const pos = geo.attributes.position;
  const tone = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let h = (fbm(p.x * 2.2 + p.y * 1.7 + 10, p.z * 2.2 + p.y * 1.1 + 3, 4) - 0.5) * 0.3;
    let t = 0.85 + (fbm(p.x * 7 + p.z * 3, p.y * 7 + 5, 3) - 0.5) * 0.5;
    for (const c of cr) {
      const a = Math.acos(THREE.MathUtils.clamp(p.dot(c.v), -1, 1));
      if (a < c.r) {
        const k = a / c.r;
        h -= c.d * (1 - k * k);
        t *= 0.72 + 0.28 * k;
      } else if (a < c.r * 1.25) {
        h += c.d * 0.3 * (1 - (a - c.r) / (c.r * 0.25));
        t *= 1.08;
      }
    }
    p.multiplyScalar(1 + h);
    pos.setXYZ(i, p.x * scale.x * radius, p.y * scale.y * radius, p.z * scale.z * radius);
    tone[i] = t;
  }
  geo.setAttribute('aTone', new THREE.BufferAttribute(tone, 1));
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(base) },
      uLight: { value: lightDir },
      uSun: { value: new THREE.Color('#ffc590') },
      uAmb: { value: new THREE.Color('#6a4630') },
    },
    vertexShader: /* glsl */ `
      attribute float aTone;
      varying vec3 vN;
      varying float vTone;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vTone = aTone;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase, uLight, uSun, uAmb;
      varying vec3 vN;
      varying float vTone;
      void main() {
        float lam = clamp(dot(normalize(vN), normalize(uLight)) * 0.9 + 0.12, 0.0, 1.0);
        vec3 col = uBase * vTone * (uAmb + uSun * 1.5 * lam);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

// ---------- API ----------
export function buildSky(camAz) {
  const group = new THREE.Group();
  // sol bajo y hacia un lado: luz rasante lateral → sombras largas y relieve en las dunas
  const sunDir = dirFromAzEl(camAz + rad(27), rad(9)).normalize();
  group.add(buildDome(sunDir));

  const MOON_R = 1200;
  const defs = [
    // Fobos: grande, irregular
    { name: 'phobos', az: -6, el: 20, radius: 70, scale: new THREE.Vector3(1.0, 0.82, 0.88), craters: 14, seed: 7, base: '#a08c7a' },
    // Deimos: más pequeña y lisa
    { name: 'deimos', az: -29, el: 15, radius: 30, scale: new THREE.Vector3(1.0, 0.86, 0.8), craters: 8, seed: 21, base: '#b5a08a' },
  ];
  const moons = {};
  for (const d of defs) {
    const dir = dirFromAzEl(camAz + rad(d.az), rad(d.el));
    // iluminación "de cine": del lado del sol pero girada hacia el espectador, para ver ~3/4 de fase
    const light = sunDir.clone().multiplyScalar(0.8).addScaledVector(dir, -0.7).normalize();
    const m = buildMoon({ ...d, lightDir: light });
    m.position.copy(dir).multiplyScalar(MOON_R);
    m.lookAt(0, 0, 0);
    group.add(m);
    moons[d.name] = m;
  }
  return { group, sunDir, moons, sunWorld: sunDir.clone().multiplyScalar(MOON_R) };
}
