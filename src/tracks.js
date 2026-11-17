import * as THREE from 'three';
import { groundNormalAt } from './terrain.js';

const SPACING = 0.32; // m recorridos por una rueda entre marca y marca
const LENGTH = SPACING * 1.08; // un poco de solape para que no queden huecos

/** Textura de bandas en V (como el relieve de las ruedas), usada como alphaMap. */
function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 4, 64); // bordes
  g.fillRect(60, 0, 4, 64);
  g.lineWidth = 7;
  g.strokeStyle = '#fff';
  for (let y = 4; y < 80; y += 22) {
    g.beginPath(); g.moveTo(6, y + 10); g.lineTo(32, y - 6); g.lineTo(58, y + 10); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(4, 0, 56, 64); // fondo semitransparente: la huella es una franja oscura con relieve
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Tracks {
  constructor({ capacity = 14000, wheelWidth = 0.4 } = {}) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: '#3f2010',
      alphaMap: treadTexture(),
      transparent: true,
      opacity: 0.4,
      roughness: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.capacity = capacity;
    this.total = 0;
    this.wheelWidth = wheelWidth;
    this.last = null;
    this.acc = null;
  }

  get count() { return this.total; }

  /** Llamar tras cada paso de simulación con las posiciones de rueda (sobre el suelo). */
  update(rover) {
    const n = rover.wheelWorld.length;
    if (!this.last) {
      this.last = rover.wheelWorld.map((p) => p.clone());
      this.acc = new Array(n).fill(0);
      return;
    }
    const dir = new THREE.Vector3(), nrm = new THREE.Vector3(), X = new THREE.Vector3(), Z = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const p = rover.wheelWorld[i];
      dir.set(p.x - this.last[i].x, 0, p.z - this.last[i].z);
      const d = dir.length();
      if (d < SPACING) continue;
      dir.divideScalar(d);
      groundNormalAt(p.x, p.z, nrm);
      Z.copy(dir).addScaledVector(nrm, -dir.dot(nrm)).normalize(); // tangente al suelo
      X.crossVectors(nrm, Z).normalize();
      m.makeBasis(X.multiplyScalar(this.wheelWidth), nrm, Z.multiplyScalar(LENGTH));
      m.setPosition(p.x + nrm.x * 0.05, p.y + nrm.y * 0.05, p.z + nrm.z * 0.05);
      this.mesh.setMatrixAt(this.total % this.capacity, m);
      this.total++;
      this.last[i].copy(p);
    }
    this.mesh.count = Math.min(this.total, this.capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
