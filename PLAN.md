# Plan: paisaje de Marte cinematográfico (Vite + Three.js)

## 1. Intención
Carpeta vacía (solo `CLAUDE.md`). Node 22.9 / npm 10.8 y Chrome en `/Applications/Google Chrome.app` ya están disponibles; el puerto 5173 está libre. Se crea un proyecto Vite + Three.js con un paisaje marciano de película: dunas, rocas, cielo caramelo con polvo, sol de tarde cálido con sombras suaves y las dos lunas (Fobos y Deimos). Base del proyecto Perseverancia (después vendrán el rover y su movimiento). El servidor corre en `http://localhost:5173` para verlo en vivo.

## 2. Cómo revisarse: `npm run check`
`scripts/check.mjs` con `playwright-core` (no descarga navegadores) y `executablePath` de tu Chrome (override con `CHROME_PATH`):
- Lanza Chrome headless con `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` para que WebGL funcione sin ventana. Viewport 1280×720, DPR 1.
- Abre `http://localhost:5173/?check` (anima congelada y cámara fija, así la captura es repetible). Espera `window.__ready === true`.
- Guarda `screenshots/check.png`.
- Lista errores de consola (`console.error`, `pageerror`, `requestfailed`) y sale con código 1 si hay alguno.
- Imprime `window.__info`: nº de rocas, y si sol, Fobos y Deimos están dentro del frustum de la cámara. Es una comprobación objetiva además de mirar la imagen.
- Si el servidor no responde, falla con mensaje claro (no lo arranca solo).

## 3. Límites
- Máximo **3 rondas** de check → mirar captura (Read de la imagen) → corregir. Si algo queda mal tras la ronda 3, lo reporto tal cual.
- Solo se escribe dentro de `/Users/deveeup/projects/perseverancia`. Sin git (la carpeta no es repo), sin commits.
- Sin assets externos ni descargas de texturas: todo procedural (ruido, shaders, canvas). Dependencias: `vite`, `three`, `playwright-core` (dev).
- Sin rover todavía; ese es el siguiente pedido.
- El servidor dev queda corriendo en segundo plano y no lo apago.

## 4. Listo cuando
`npm run check` termina con 0 errores y la captura muestra: dunas, rocas, cielo caramelo con polvo, sol bajo con luz cálida y sombras suaves, y las dos lunas. Además `window.__info` confirma sol y lunas en cuadro.

## Ejecución

### Fase A: algo visible en menos de 2 min (justo tras aprobar)
Todo en un solo lote (varios `Write` en paralelo, sin `npm create vite`, que es interactivo):
1. `package.json` (`type: module`; scripts `dev`, `build`, `check`), `vite.config.js` (`port: 5173`, `strictPort`), `index.html`, `.gitignore`.
2. `npm install three vite` + `npm install -D playwright-core`.
3. `src/main.js` mínimo: renderer ACES, cielo en degradado caramelo, plano de dunas con ruido, luz direccional baja y cálida, niebla color horizonte.
4. `npm run dev` en segundo plano → ya se ve en `localhost:5173`.

### Fase B: mejora grande 1 (escena completa) → **check ronda 1**
Archivos en `src/`:
- `terrain.js`: `heightAt(x,z)` compartida (fbm + crestas de duna con domain warp, con asimetría barlovento/sotavento). Malla 256×256 con vertex colors ocre→óxido y textura de grano en canvas. Las rocas usan el mismo `heightAt` para apoyarse bien.
- `sky.js`: esfera con shader (horizonte caramelo, cenit más polvoriento, halo cálido hacia el sol, banda de polvo en el horizonte). Disco solar a ~12° de elevación. Fobos (grande, irregular) y Deimos (pequeño) como icosaedros desplazados con ruido, iluminados por la misma dirección del sol.
- `rocks.js`: `InstancedMesh` con 3 variantes de icosaedro deformado, ~400 instancias con escala, rotación y color variados, agrupadas por ruido. Proyectan y reciben sombra.
- `main.js`: `DirectionalLight` cálida (`#ffb27a`) con `PCFSoftShadowMap` y `shadow.radius` para sombras suaves, `HemisphereLight` de relleno anaranjado, `FogExp2` del color del horizonte, cámara a baja altura con deriva lenta (congelada con `?check`). Expone `window.__ready` y `window.__info`.

### Fase C: mejora grande 2 (acabado) → **check ronda 2**
- `dust.js`: partículas de polvo flotando con luz de contraluz y bruma más densa en el horizonte.
- Bloom suave (`UnrealBloomPass`) para el halo del sol; viñeta y gradación de color cálida.
- Detalle en el terreno: normal map procedural de ripples en las dunas.

### Fase D: corrección → **check ronda 3**
Solo lo que haya quedado mal en las rondas 1–2 (encuadre de lunas, contraste de sombras, rendimiento en SwiftShader, etc.). Después reporto el estado final y la URL.

## Archivos críticos
`package.json`, `vite.config.js`, `index.html`, `src/{main,terrain,sky,rocks,dust}.js`, `scripts/check.mjs`. No hay código previo que reutilizar.

## Verificación
1. `curl -sI http://localhost:5173` responde 200.
2. `npm run check` → 0 errores, `screenshots/check.png` generado, `__info` con sol y lunas en el frustum.
3. Leo la captura y confirmo uno por uno: dunas, rocas, cielo caramelo con polvo, sol cálido, sombras suaves, dos lunas.
