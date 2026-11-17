// Uso: node scripts/inspect-glb.mjs public/models/perseverance.glb
// Lee el chunk JSON del GLB e imprime el árbol de nodos, tamaño aproximado y animaciones.
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

console.log('asset:', JSON.stringify(gltf.asset));
console.log('escenas:', gltf.scenes?.length, '| nodos:', gltf.nodes?.length, '| mallas:', gltf.meshes?.length,
  '| materiales:', gltf.materials?.length, '| animaciones:', gltf.animations?.length ?? 0, '| skins:', gltf.skins?.length ?? 0);
console.log('extensiones:', gltf.extensionsUsed?.join(', ') ?? 'ninguna');

const nodes = gltf.nodes;
const roots = gltf.scenes[gltf.scene ?? 0].nodes;
const lines = [];
function walk(i, depth) {
  const n = nodes[i];
  const bits = [];
  if (n.mesh !== undefined) bits.push(`mesh:${gltf.meshes[n.mesh].name ?? n.mesh}`);
  if (n.scale) bits.push(`scale:${n.scale.map((v) => +v.toFixed(4))}`);
  if (n.translation) bits.push(`pos:${n.translation.map((v) => +v.toFixed(3))}`);
  if (n.rotation) bits.push('rot');
  lines.push(`${'  '.repeat(depth)}${n.name ?? '(sin nombre)'} ${bits.join(' ')}`);
  (n.children ?? []).forEach((c) => walk(c, depth + 1));
}
roots.forEach((r) => walk(r, 0));
console.log(`\n--- árbol (${lines.length} líneas) ---`);
console.log(lines.join('\n'));

// Caja envolvente aproximada a partir de los accessors POSITION (sin aplicar transformaciones de nodo)
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const m of gltf.meshes)
  for (const p of m.primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    if (!a.min) continue;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k]); max[k] = Math.max(max[k], a.max[k]); }
  }
console.log('\nbbox bruta (sin transformaciones de nodo):', min.map((v) => +v.toFixed(3)), max.map((v) => +v.toFixed(3)));
