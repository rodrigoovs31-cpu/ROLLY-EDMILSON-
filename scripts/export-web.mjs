// Copia SOLO los archivos públicos de la web a una carpeta (por defecto web-dist/),
// que es lo único que sirve nginx. Lista blanca: el código del servidor, .env,
// scripts y archivos de configuración nunca quedan expuestos.
//   node scripts/export-web.mjs [carpeta-destino]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(process.argv[2] || join(ROOT, 'web-dist'));
if (OUT === resolve(ROOT)) throw new Error('El destino no puede ser la raíz del proyecto.');

const ROOT_FILES = /^(?:[a-z0-9-]+\.html|manifest\.webmanifest|robots\.txt|sitemap\.xml|sw\.js)$/;
const DIRS = ['assets', 'vendor'];
const SKIP = /(^|\/)\.|\.map$|\.md$|sw-template\.js$/;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0;
for (const name of readdirSync(ROOT)) {
  if (ROOT_FILES.test(name) && statSync(join(ROOT, name)).isFile()) {
    cpSync(join(ROOT, name), join(OUT, name));
    files++;
  }
}
for (const dir of DIRS) {
  if (!existsSync(join(ROOT, dir))) continue;
  cpSync(join(ROOT, dir), join(OUT, dir), {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(ROOT.length).replace(/\\/g, '/');
      const keep = !SKIP.test(rel);
      if (keep && statSync(src).isFile()) files++;
      return keep;
    },
  });
}
console.log(`Web exportada en ${OUT} (${files} archivos).`);
