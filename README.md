# Maus: herramientas PDF gratis en español

Web completa de herramientas PDF, al estilo de las grandes páginas de PDF pero con marca, diseño y código propios.
Todo funciona **dentro del navegador**: los archivos de tus usuarios nunca se suben a un servidor. Por eso
publicarla es gratis (no necesitas pagar un servidor) y puedes prometer privacidad total.

## Herramientas incluidas (15)

| Organizar | Optimizar | Convertir | Editar | Seguridad |
|---|---|---|---|---|
| Unir PDF | Comprimir PDF (con peso máximo en MB) | JPG a PDF | Firmar PDF | Proteger PDF (AES-256) |
| Dividir PDF | OCR: sacar texto (español, inglés, portugués) | PDF a JPG | Numerar páginas | Desbloquear PDF |
| Organizar PDF | | | Marca de agua | |
| Rotar PDF | | | | |
| Eliminar páginas | | | | |
| Extraer páginas | | | | |

Aparecen como **"Pronto"**: Word a PDF, PDF a Word, Excel a PDF y PowerPoint a PDF. Esas conversiones necesitan
un servidor (fase 2, ver abajo).

## Personalizar tu marca

1. **WhatsApp, precio y medios de pago**: edita `assets/js/config.js`. Ahí pones tu número (con código de país),
   el precio del plan Pro, la moneda, los métodos de pago (Yape, Plin…) y tus redes. Se aplica solo, sin volver a generar nada.
2. **Logo**: `assets/img/logo.svg` (logo), `assets/img/favicon.svg` (ícono de la pestaña),
   `assets/img/apple-touch-icon.png` (ícono en el celular) y `assets/img/og.png` (imagen al compartir en WhatsApp/Facebook).
   El logo del encabezado está dibujado dentro de `scripts/build.mjs` (constante `LOGO`) para que cambie de color en modo oscuro.
3. **Colores**: al inicio de `assets/css/maus.css` (bloque `:root`). El amarillo de la marca es `--brand`.
4. **Textos de cada herramienta**: `assets/js/tools-data.js`.

Si cambias el **nombre**, el **dominio** (`url` en config.js) o los textos de `tools-data.js`, vuelve a generar las páginas:

```bash
npm run build
```

## Verla en tu computadora

Los navegadores no permiten abrir esta web con doble clic (usa módulos de JavaScript). Levanta un servidor local:

```bash
npm start            # abre http://localhost:8080
```

(Necesita Python 3. También sirve cualquier servidor estático, por ejemplo `npx serve`.)

## Publicarla gratis

Maus es un sitio 100% estático: no tiene servidor, base de datos ni funciones en la nube. El trabajo pesado
(leer, unir, comprimir, cifrar, firmar los PDF) lo hace el celular o la computadora de cada usuario, así que
no importa cuántos usuarios tengas: tu hosting solo entrega archivos.

Además, las librerías pesadas (el 95% del peso) se descargan gratis desde **jsDelivr**. Tu hosting solo entrega
unos 30 KB comprimidos por visita. Si jsDelivr fallara, la web usa sola la copia de la carpeta `vendor/`
(puedes desactivar la CDN con `useCdn: false` en `config.js`).

| Hosting gratis | Ancho de banda gratis | Uso comercial | Qué pasa si te pasas |
|---|---|---|---|
| **Cloudflare Pages** (recomendado) | Ilimitado para archivos estáticos | Sí | Nada: no hay tope |
| Firebase Hosting (plan Spark) | 10 GB al mes | Sí | La web se desactiva hasta el mes siguiente (no te cobran) |
| GitHub Pages | 100 GB al mes (límite flexible) | No permite sitios comerciales | GitHub puede pedirte que la muevas |

**Cloudflare Pages (recomendado para millones de visitas)**
1. Crea una cuenta gratis en Cloudflare y entra a *Workers & Pages → Create → Pages → Connect to Git*.
2. Elige este repositorio y la rama `main`.
3. *Framework preset*: **None**. *Build command*: déjalo vacío. *Build output directory*: `/`.
4. Guarda. Cada vez que se actualice `main`, la web se publica sola.
5. Pon la dirección que te den (`https://ALGO.pages.dev` o tu dominio) en `url` dentro de `config.js` y ejecuta `npm run build`.

El archivo `_headers` ya le dice a Cloudflare que guarde las librerías en caché un año.

**Firebase Hosting** (si lo prefieres): `npm install -g firebase-tools`, `firebase login`,
`firebase init hosting` (elige "usar firebase.json existente") y `firebase deploy`. El archivo `firebase.json` ya está listo.

**Dominio propio** (por ejemplo `maus.pe`): cómpralo, conéctalo en Cloudflare, ponlo en `url` dentro de
`config.js` y ejecuta `npm run build` para actualizar el `sitemap.xml` para Google.

## Cómo está hecha

```
index.html, *.html        Páginas generadas por scripts/build.mjs (no editarlas a mano)
assets/css/maus.css       Diseño (modo claro y oscuro)
assets/js/config.js       Tu configuración de marca
assets/js/tools-data.js   Catálogo de herramientas (portada, menú, SEO)
assets/js/tool-page.js    Flujo común: elegir archivos → opciones → procesar → descargar
assets/js/tools/*.js      La lógica de cada herramienta
assets/js/lib.js          Utilidades de PDF (lectura, giro de páginas, descargas, ZIP)
vendor/                   Copia de respaldo de las librerías (si jsDelivr no responde)
scripts/build.mjs         Generador de páginas, sitemap y robots.txt
```

Para agregar una herramienta: añádela en `tools-data.js`, crea su archivo en `assets/js/tools/` (copia uno parecido)
y ejecuta `npm run build`.

## Fase 2: conversiones de Office (Word, Excel, PowerPoint)

Necesitan un servidor con LibreOffice. La forma más simple es [Gotenberg](https://gotenberg.dev) (Docker) en un VPS
de 5 a 10 USD al mes. La web llamaría a ese servidor solo para esas herramientas; las demás siguen funcionando en el navegador.

## Licencias de terceros

Maus usa software libre que permite uso comercial:
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0),
[qpdf](https://github.com/qpdf/qpdf) (Apache 2.0) compilado a WebAssembly por [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm) (ISC),
[JSZip](https://github.com/Stuk/jszip) (MIT),
[SortableJS](https://github.com/SortableJS/Sortable) (MIT),
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0)
y los íconos de [Lucide](https://lucide.dev) (ISC, ver `vendor/LICENSE-lucide.txt`).
Se descargan desde [jsDelivr](https://www.jsdelivr.com) con versión fija y verificación de integridad (SRI) donde el navegador lo permite.
