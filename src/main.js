import * as THREE from 'three';
import { buildTerrain, groundAt, groundNormalAt } from './terrain.js';
import { buildSky, buildEnvironment, dirFromAzEl, HORIZON } from './sky.js';
import { buildRocks } from './rocks.js';
import { buildDust } from './dust.js';
import { loadRover, RoverDrive } from './rover.js';
import { Tracks } from './tracks.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const CHECK = new URLSearchParams(location.search).has('check');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(CHECK ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.FogExp2(HORIZON, 0.0055);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 4000);

// ---------- mundo ----------
const CAM_AZ = Math.atan2(60, 80); // rumbo inicial: hacia el sol y las lunas
const fwdOf = (h) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
scene.add(buildTerrain());

/** Busca un punto alto con un corredor transitable (pendiente suave) a lo largo del rumbo inicial. */
function findSpawn() {
  const f = fwdOf(CAM_AZ), l = new THREE.Vector3(f.z, 0, -f.x);
  const n = new THREE.Vector3();
  const slope = (x, z) => { groundNormalAt(x, z, n); return Math.hypot(n.x, n.z) / n.y; };
  let best = null, fallback = null;
  for (let x = -90; x <= 90; x += 3)
    for (let z = -90; z <= 90; z += 3) {
      let worst = 0;
      for (let s = -20; s <= 14; s += 2)
        for (const o of [-3, 0, 3]) worst = Math.max(worst, slope(x + f.x * s + l.x * o, z + f.z * s + l.z * o));
      const h = groundAt(x, z);
      if (!fallback || worst < fallback.worst) fallback = { x, z, worst };
      if (worst < 0.4 && (!best || h > best.h)) best = { x, z, h };
    }
  return best ?? fallback;
}
const spawn = findSpawn();
const PREROLL = 15; // en ?check el rover llega a `spawn` tras recorrer esta distancia (deja huellas visibles)
const keepClear = [];
for (let s = -PREROLL - 4; s <= 14; s += 4)
  keepClear.push({ x: spawn.x + Math.sin(CAM_AZ) * s, z: spawn.z + Math.cos(CAM_AZ) * s, r: 5 });

const rocks = buildRocks(spawn, CAM_AZ, keepClear);
scene.add(rocks);
const sky = buildSky(CAM_AZ);
scene.add(sky.group);
const dust = buildDust();
scene.add(dust);
const tracks = new Tracks();
scene.add(tracks.mesh);

// ---------- luz: sol de tarde, cálido y bajo ----------
const SHADOW_EXT = 100;
const sun = new THREE.DirectionalLight('#ffb27a', 4.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -SHADOW_EXT, right: SHADOW_EXT, top: SHADOW_EXT, bottom: -SHADOW_EXT, near: 1, far: 600 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#f4b888', '#9a5a32', 1.15));

// la sombra sigue al rover; el centro se ajusta a la rejilla del mapa de sombras para que no "tiemble"
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function updateSun(center) {
  const L = sky.sunDir;
  _r.crossVectors(UP, L).normalize();
  _u.crossVectors(L, _r).normalize();
  const texel = (2 * SHADOW_EXT) / sun.shadow.mapSize.x;
  const a = Math.round(center.dot(_r) / texel) * texel, b = Math.round(center.dot(_u) / texel) * texel;
  _c.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(L, center.dot(L));
  sun.target.position.copy(_c);
  sun.position.copy(_c).addScaledVector(L, 260);
}
updateSun(new THREE.Vector3(spawn.x, spawn.h ?? 0, spawn.z));

// ---------- postproceso: bloom del sol, tonemapping, viñeta cálida ----------
const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.9, 1.1));
composer.addPass(new OutputPass());
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(1.05, 0.3, length((vUv - 0.5) * vec2(1.25, 1.0)));
        c.rgb *= mix(0.68, 1.0, v);
        c.rgb *= vec3(1.04, 1.0, 0.93); // gradación cálida
        gl_FragColor = c;
      }`,
  }),
);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- teclado ----------
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); hud.classList.add('hide'); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const readInput = () => ({
  f: keys.has('KeyW') || keys.has('ArrowUp'),
  b: keys.has('KeyS') || keys.has('ArrowDown'),
  l: keys.has('KeyA') || keys.has('ArrowLeft'),
  r: keys.has('KeyD') || keys.has('ArrowRight'),
});
const hud = document.createElement('div');
hud.id = 'hud';
hud.textContent = 'W / S avanzar · A / D girar';
if (CHECK) hud.style.display = 'none';
document.body.appendChild(hud);

// ---------- rover ----------
let rover = null;
let roverError = null;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camHeading = CAM_AZ;
const CAM_BACK = 7.5, CAM_UP = 3.0, LOOK_AHEAD = 11, LOOK_UP = 1.3;

function chaseCamera(dt, snap) {
  // el rumbo de la cámara sigue al del rover con retardo (siempre por el camino corto)
  const diff = Math.atan2(Math.sin(rover.heading - camHeading), Math.cos(rover.heading - camHeading));
  camHeading += snap ? diff : diff * (1 - Math.exp(-2.5 * dt));
  const f = fwdOf(camHeading);
  const y = rover.object.position.y;
  const wantPos = new THREE.Vector3(rover.x - f.x * CAM_BACK, y + CAM_UP, rover.z - f.z * CAM_BACK);
  wantPos.y = Math.max(wantPos.y, groundAt(wantPos.x, wantPos.z) + 1.5); // nunca bajo el suelo
  const wantLook = new THREE.Vector3(rover.x + f.x * LOOK_AHEAD, y + LOOK_UP, rover.z + f.z * LOOK_AHEAD);
  const k = snap ? 1 : 1 - Math.exp(-5 * dt);
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

const env = buildEnvironment(renderer, sky.sunDir);
loadRover(env)
  .then((loaded) => {
    window.__roverDebug = loaded.debug;
    window.__roverCameraParts = loaded.cameraParts;
    const f = fwdOf(CAM_AZ);
    const back = CHECK ? PREROLL : 0;
    rover = new RoverDrive(loaded, { x: spawn.x - f.x * back, z: spawn.z - f.z * back, heading: CAM_AZ }, rocks.userData.colliders);
    scene.add(rover.object);
    tracks.update(rover);
    if (CHECK) {
      // pre-recorrido determinista (mismo código que el teclado): arranque con una "S" suave y frenado hasta `spawn`
      const dt = 1 / 30;
      for (let t = 0; rover.distance < PREROLL - 1.6 && t < 600; t++) {
        const time = t * dt;
        rover.update(dt, { f: true, b: false, l: time < 0.6, r: time >= 0.6 && time < 1.2 });
        tracks.update(rover);
      }
      for (let t = 0; t < 90; t++) { rover.update(dt, {}); tracks.update(rover); }
    }
    camPos.set(rover.x, rover.object.position.y + CAM_UP, rover.z);
    camHeading = rover.heading;
    chaseCamera(0, true);
    updateSun(_c.set(rover.x, rover.object.position.y, rover.z).addScaledVector(fwdOf(rover.heading), 40));
  })
  .catch((e) => { roverError = String(e?.stack ?? e); console.error('[rover] no se pudo cargar:', e); });

// ---------- info para `npm run check` ----------
const frustum = new THREE.Frustum();
const pv = new THREE.Matrix4();
function computeInfo() {
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pv);
  const vis = (p) => frustum.containsPoint(p);
  window.__info = {
    rocks: rocks.userData.count,
    sunInView: vis(sky.sunWorld.clone().add(camera.position)),
    phobosInView: vis(sky.moons.phobos.position.clone().add(camera.position)),
    deimosInView: vis(sky.moons.deimos.position.clone().add(camera.position)),
    shadows: renderer.shadowMap.enabled && sun.castShadow,
    roverLoaded: !!rover,
    roverError,
    roverSize: rover?.size.toArray().map((v) => +v.toFixed(2)),
    wheelsSpinning: rover?.wheels.length ?? 0,
    cameraParts: window.__roverCameraParts ?? null,
    roverInView: rover ? vis(rover.object.position.clone().setY(rover.object.position.y + 1)) : false,
  };
}
// estado en vivo, para que el check pueda comprobar que WASD funciona y que hay huellas
window.__state = () => ({
  distance: rover?.distance ?? 0,
  speed: rover?.speed ?? 0,
  heading: rover?.heading ?? 0,
  tracks: tracks.count,
  wheelRotation: rover?.wheels.map((w) => +w.pivot.rotation.x.toFixed(2)) ?? [],
});

// ---------- bucle ----------
const clock = new THREE.Clock();
let frames = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = CHECK ? 0 : clock.getElapsedTime();
  if (rover) {
    rover.update(dt, readInput());
    tracks.update(rover);
    chaseCamera(dt, false);
    updateSun(_c.set(rover.x, rover.object.position.y, rover.z).addScaledVector(fwdOf(rover.heading), 40));
  }
  sky.group.position.copy(camera.position);
  dust.material.uniforms.uTime.value = t;
  dust.material.uniforms.uCam.value.copy(camera.position);
  composer.render();
  if ((rover || roverError) && ++frames === 3) {
    computeInfo();
    window.__ready = true;
  }
});
