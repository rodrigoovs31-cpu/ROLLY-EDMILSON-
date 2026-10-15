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

**Opción A: GitHub Pages**
1. Une esta rama a `main`.
2. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*.
3. En un par de minutos estará en `https://TU-USUARIO.github.io/ROLLY-EDMILSON-/`.
   (En repositorios privados, GitHub Pages requiere un plan de pago; si no lo tienes, usa la opción B.)

**Opción B: Cloudflare Pages o Netlify** (gratis, más rápido y con dominio propio fácil)
1. Crea una cuenta y conecta este repositorio (o arrastra la carpeta del proyecto).
2. No hace falta comando de compilación; la carpeta a publicar es la raíz.

**Dominio propio** (por ejemplo `maus.pe` o `maus.app`): cómpralo, conéctalo en Pages/Cloudflare, ponlo en
`url` dentro de `config.js` y ejecuta `npm run build` para crear el `sitemap.xml` para Google.

## Cómo está hecha

```
index.html, *.html        Páginas generadas por scripts/build.mjs (no editarlas a mano)
assets/css/maus.css       Diseño (modo claro y oscuro)
assets/js/config.js       Tu configuración de marca
assets/js/tools-data.js   Catálogo de herramientas (portada, menú, SEO)
assets/js/tool-page.js    Flujo común: elegir archivos → opciones → procesar → descargar
assets/js/tools/*.js      La lógica de cada herramienta
assets/js/lib.js          Utilidades de PDF (lectura, giro de páginas, descargas, ZIP)
vendor/                   Librerías de código abierto (incluidas, no dependen de internet)
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
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0, se carga desde jsDelivr)
y los íconos de [Lucide](https://lucide.dev) (ISC, ver `vendor/LICENSE-lucide.txt`).
