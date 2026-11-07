/** Persistencia de la base serializada en IndexedDB. */
const NOMBRE = 'bodega-datos';
const TIENDA = 'archivos';
const CLAVE = 'base';

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TIENDA);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

export async function leerBase(): Promise<Uint8Array | null> {
  const idb = await abrir();
  try {
    return await new Promise((resolve, reject) => {
      const req = idb.transaction(TIENDA, 'readonly').objectStore(TIENDA).get(CLAVE);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

export async function guardarBase(bytes: Uint8Array): Promise<void> {
  const idb = await abrir();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(TIENDA, 'readwrite');
      tx.objectStore(TIENDA).put(bytes, CLAVE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

export async function borrarBase(): Promise<void> {
  const idb = await abrir();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(TIENDA, 'readwrite');
      tx.objectStore(TIENDA).delete(CLAVE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}
