import * as THREE from 'three';

/** Polvo flotando alrededor de la cámara (envuelto en una caja, se mueve con el viento). */
export function buildDust(count = 1800, box = 140) {
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = Math.random() * box;
    base[i * 3 + 1] = Math.random() * 28;
    base[i * 3 + 2] = Math.random() * box;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: box },
      uColor: { value: new THREE.Color('#f2b27a') },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uBox;
      uniform vec3 uCam;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += uTime * (2.2 + aSeed * 2.0);
        p.z += uTime * (0.8 + aSeed);
        p.y += sin(uTime * 0.4 + aSeed * 40.0) * 0.8;
        p.xz = mod(p.xz - uCam.xz + uBox * 0.5, uBox) - uBox * 0.5 + uCam.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp((14.0 + aSeed * 22.0) * 70.0 / max(d, 1.0), 2.0, 64.0);
        vA = (0.05 + aSeed * 0.12) * smoothstep(2.0, 10.0, d) * (1.0 - smoothstep(55.0, 70.0, d));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(uColor, a * a * vA);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
