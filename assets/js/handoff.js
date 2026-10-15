// Pasa el resultado de una herramienta a la siguiente ("Continuar con…" y flujos de trabajo).
// Usa IndexedDB del navegador: el archivo nunca sale del equipo.
const DB = 'maus';
const STORE = 'handoff';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function saveHandoff(files) {
  await tx('readwrite', (s) => s.put(files.map((f) => ({ name: f.name, blob: f.blob, type: f.blob.type })), 'files'));
}

// Devuelve los archivos guardados como objetos File y los borra.
export async function takeHandoff() {
  try {
    const items = await tx('readonly', (s) => s.get('files'));
    await tx('readwrite', (s) => s.delete('files'));
    return (items || []).map((it) => new File([it.blob], it.name, { type: it.type || 'application/pdf' }));
  } catch {
    return [];
  }
}
