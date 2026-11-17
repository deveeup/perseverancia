// Mini versión del patrón de telemetría de Open MCT (ver API.md:532-547 en github.com/nasa/openmct):
//   · cada dato tiene METADATA: nombre, unidad, proveedor y valores con pista domain (eje X) / range (eje Y)
//   · cada PROVEEDOR declara qué datos sabe dar (supportsX) y los entrega con request (historia) y
//     subscribe (en vivo), devolviendo una función para cancelar
//   · el registro elige al proveedor; si hay varios para un dato, el último registrado gana (como en Open MCT)
//   · un datum es un objeto sencillo: { utc: milisegundos Unix, value: número, ...extras }
// Diferencia con Open MCT: aquí supportsX recibe la CLAVE del dato (p. ej. 'distance'), no un objeto de dominio.

export class Telemetry {
  #providers = [];

  addProvider(provider) {
    this.#providers.unshift(provider);
  }

  #find(method, key) {
    return this.#providers.find((p) => p[method]?.(key));
  }

  /** { key, name, unit, provider, description, values: [...] } */
  metadata(key) {
    const p = this.#find('supportsMetadata', key);
    if (!p) throw new Error(`No hay proveedor de metadatos para "${key}"`);
    return p.getMetadata(key);
  }

  /** Promesa de un arreglo de datums ordenado por utc. options: { start, end } en ms. */
  request(key, options = {}) {
    const p = this.#find('supportsRequest', key);
    return p ? p.request(key, options) : Promise.reject(new Error(`No hay proveedor de historia para "${key}"`));
  }

  /** Llama a callback(datum) con cada dato nuevo. Devuelve la función para cancelar. */
  subscribe(key, callback) {
    const p = this.#find('supportsSubscribe', key);
    return p ? p.subscribe(key, callback) : () => {};
  }
}
