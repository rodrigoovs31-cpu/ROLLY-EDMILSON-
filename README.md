# DocuMaus: herramientas PDF gratis en español

Web completa de herramientas PDF, al estilo de las grandes páginas de PDF pero con marca, diseño y código propios.
Todo funciona **dentro del navegador**: los archivos de tus usuarios nunca se suben a un servidor. Por eso
publicarla es gratis (no necesitas pagar un servidor) y puedes prometer privacidad total.

## Herramientas incluidas (35)

Las mismas categorías que las grandes páginas de PDF. Todas funcionan **gratis y dentro del navegador**.

| Categoría | Herramientas |
|---|---|
| Organizar PDF | Unir, Dividir, Organizar, Eliminar páginas, Extraer páginas, Escanear a PDF (cámara del celular) |
| Optimizar PDF | Comprimir (con peso máximo en MB), OCR PDF (PDF buscable o texto), Reparar PDF |
| Convertir a PDF | JPG, Word (DOCX), PowerPoint (PPTX), Excel (XLSX/XLS/CSV) y HTML a PDF |
| Convertir desde PDF | PDF a JPG, Word (editable), PowerPoint, Excel (tablas con números) y PDF/A-2b |
| Editar PDF | Rotar, Numerar páginas, Marca de agua, Recortar, Editar (texto, imágenes, formas, resaltado, dibujo, tapar), Formularios (rellenar y crear) |
| Seguridad de PDF | Firmar (visual), Firma digital con certificado (Pro), Proteger (AES-256), Desbloquear, Censurar (borra el texto de verdad), Comparar dos versiones |
| Inteligencia PDF | Resumir, Traducir, PDF a Markdown |
| Legal y licitaciones | Armar expediente (plan Legal): anexos 1-A, 1-B…, finalidad probatoria, resaltado, carátula, índice y foliación |

### Qué esperar de cada conversión

- **Word, PowerPoint y HTML a PDF**: cada página se dibuja tal como se ve y se guarda en alta calidad.
  El resultado es fiel al diseño, pero el texto queda como imagen (no se puede seleccionar). Si el documento usa
  fuentes que el equipo no tiene, se reemplazan por otras parecidas. Solo `.docx` y `.pptx` (no los antiguos `.doc`/`.ppt`).
- **Excel a PDF**: tablas con texto seleccionable y encabezados repetidos en cada página.
- **PDF a Word**: Word editable con títulos, párrafos y viñetas. Las columnas y tablas complejas pueden cambiar.
- **PDF a Excel**: detecta filas y columnas por la posición del texto y convierte los montos en números.
  Funciona mejor con PDF generados por sistemas (estados de cuenta, reportes).
- **PDF a PowerPoint**: cada página es una diapositiva (imagen) y su texto va en las notas del orador.
- **PDF/A-2b**: validado con veraPDF (el validador oficial). Conserva el texto; solo pasa a imagen las páginas con fuentes no incrustadas.
- **Censurar**: las páginas censuradas se guardan como imagen para que el texto tapado no se pueda recuperar.

### La IA: Gemini Nano

**Resumir PDF** y **Traducir PDF** usan Gemini Nano, la IA que Google incluye dentro de Chrome en computadora
(Windows, Mac, Linux; Chrome 138 o más nuevo). Funciona en el equipo del usuario: no envía el documento a internet
y no te cuesta nada por uso. En celulares no está disponible: ahí **Resumir** usa un algoritmo que elige las frases
más importantes (TextRank) y **Traducir** ofrece abrir el traductor de documentos de Google.

## DocuMaus Legal: armador de expedientes

Para abogados, notarías, estudios contables y postores de licitaciones del Estado (`armar-expediente.html`).

1. **Escrito principal + medios probatorios**: el primer PDF es el escrito (demanda, recurso, propuesta técnica);
   los demás son anexos. Funciona con PDF de cientos de hojas y todo se arma en el Web Worker, sin subir nada.
2. **Etiquetas automáticas**: ANEXO 1-A, 1-B, 1-C… (o Anexo 1, 2, 3…). Se reordenan con flechas o arrastrando y se
   renumeran solas. De un mismo PDF puedes sacar varios anexos con distintas páginas ("Extraer otras páginas").
3. **Finalidad probatoria** de cada anexo (va al índice y a la hoja separadora) y **resaltado fluorescente** amarillo
   `#FFFF00`: arrastrando sobre la hoja o buscando un texto. Se dibuja en modo "multiplicar", así el texto sigue legible.
4. **Foliación**: "FOLIO: 001" arriba a la derecha de cada hoja con doble borde rojo, respetando las hojas giradas.
   Puedes empezar en cualquier número y foliar de la primera a la última o al revés.
5. **Carátula e índice de anexos** con número de anexo, folios y objeto de prueba (el índice se mide antes de dibujarse,
   así sus propios folios también cuadran).

Los folios, sellos y resaltados quedan grabados en el contenido de cada hoja (no son comentarios que se puedan borrar).
Opcional: bloquear la edición con permisos del PDF. Para que cualquier cambio posterior sea **detectable**, el paso
correcto es firmarlo al final con "Firma digital".

**Cómo se cobra**: el armador requiere el plan **Legal** (US$ 19/mes) o **Estudio** (US$ 39/mes, hasta 5 personas).
Sin plan, cualquiera puede probarlo completo y descargar una **vista previa con marca de agua** (así los abogados ven
el resultado antes de pagar). Precios en `config.js` → `plans`; qué plan abre qué función en `pro.planFeatures`.
En `admin.html` eliges el plan (Pro, Legal o Estudio) al generar cada código.

## DocuMaus Pro (cobrar sin servidor)

- **Planes**: Pro (S/ 9) trae firma digital con certificado, flujos de trabajo y sin límites (gratis: 20 archivos a la vez
  y OCR de 10 páginas). Legal (US$ 19) y Estudio (US$ 39) suman el armador de expedientes.
  Se cambia en `config.js` → `proPrice`, `plans`, `pro.features`, `pro.planFeatures` y `pro.freeLimits`.
- **Cómo vendes**: el cliente paga por Yape o transferencia, tú confirmas el pago en tu app y le envías un **código Pro** por WhatsApp.
- **Tu panel**: abre `admin.html` en tu celular (no aparece en el menú ni en Google).
  1. "Crear mis llaves" (una sola vez) y **descarga el respaldo**.
  2. Copia la llave pública en `config.js` → `pro.publicKey`. Mientras esté vacía, todo Pro queda abierto para todos.
  3. Por cada venta: nombre del cliente, plan y meses → "Generar código" → "Enviar por WhatsApp". El panel guarda tu lista de clientes.
- Los códigos están firmados con criptografía: nadie puede inventarlos sin tu llave privada, que solo está en tu equipo.
  Es un candado "de confianza": alguien con conocimientos técnicos podría saltarlo, pero tu negocio real es el servicio y la ayuda.

## Firma digital con certificado

Firma con el certificado del usuario (.pfx o .p12) en formato PDF estándar (PKCS#7, `adbe.pkcs7.detached`).
Probado con pdfsig (Poppler) y pyHanko: firma válida, cubre todo el documento y detecta cualquier cambio posterior.
DocuMaus **no emite certificados** (eso solo lo hacen entidades acreditadas por INDECOPI, como RENIEC con el DNI electrónico).
Si el PDF ya tiene una firma digital, DocuMaus no lo vuelve a firmar para no invalidarla.

## Flujos de trabajo y "sin internet"

- **Flujos** (`flujos.html`): varias herramientas seguidas; el resultado pasa solo al siguiente paso (sin subir nada a internet).
- **Continuar con…**: al terminar cualquier herramienta, puedes mandar el PDF a otra.
- **Sin internet**: el botón "Usar sin internet" guarda los programas en el equipo (service worker `sw.js`, generado por `npm run build`).

## Personalizar tu marca

1. **WhatsApp, precio y medios de pago**: edita `assets/js/config.js`. Ahí pones tu número (con código de país),
   el precio del plan Pro, la moneda, los métodos de pago (Yape, Plin…) y tus redes. Se aplica solo, sin volver a generar nada.
2. **Logo**: `assets/img/logo.svg` (logo), `assets/img/favicon.svg` (ícono de la pestaña),
   `assets/img/apple-touch-icon.png` (ícono en el celular) y `assets/img/og.png` (imagen al compartir en WhatsApp/Facebook).
   El logo del encabezado está dibujado dentro de `scripts/build.mjs` (constante `LOGO`) para que cambie de color en modo oscuro.
3. **Colores**: al inicio de `assets/css/maus.css` (bloque `:root`). El amarillo de la marca es `--brand`.
4. **Textos de cada herramienta**: `assets/js/tools-data.js`.

Si cambias el **nombre** o los textos de `tools-data.js`, vuelve a generar las páginas.
El **dominio** ya no se escribe en el código: se pasa al generar, así la misma web sirve para cualquier dominio
(canónicas, `sitemap.xml`, `robots.txt` y enlaces para compartir):

```bash
SITE_URL=https://tudominio.com npm run build     # con tu dominio (recomendado para Google)
npm run build                                    # sin dominio: enlaces relativos, sin canónicas ni sitemap
```

## Verla en tu computadora

Los navegadores no permiten abrir esta web con doble clic (usa módulos de JavaScript). Levanta un servidor local:

```bash
npm start            # abre http://localhost:8080
```

(Necesita Python 3. También sirve cualquier servidor estático, por ejemplo `npx serve`.)

## Publicarla gratis

DocuMaus es un sitio 100% estático: no tiene servidor, base de datos ni funciones en la nube. El trabajo pesado
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
3. *Framework preset*: **None**.
4. *Build command*: `npm run build && node scripts/export-web.mjs web-dist` · *Build output directory*: `web-dist`
   (así solo se publica la web, no el código del servidor).
5. En *Settings → Environment variables* agrega `SITE_URL` con tu dirección (`https://ALGO.pages.dev` o tu dominio).
6. Guarda. Cada vez que se actualice `main`, la web se publica sola.

El archivo `_headers` ya le dice a Cloudflare que guarde las librerías en caché un año.

**Firebase Hosting** (si lo prefieres): `npm install -g firebase-tools`, `firebase login`,
`firebase init hosting` (elige "usar firebase.json existente") y `firebase deploy`. El archivo `firebase.json` ya está listo.

**Dominio propio** (por ejemplo `documaus.com`): cómpralo, conéctalo en Cloudflare y cambia la variable `SITE_URL`.

## Producción en tu propio servidor (DigitalOcean / AWS) con WhatsApp

La web sigue procesando todo en el navegador. El servidor agrega lo que un sitio estático no puede:
el **asistente de WhatsApp** (el cliente envía un PDF al número de tu negocio y recibe el resultado),
**PostgreSQL** (usuarios, planes y cupos, historial de trabajos) y **HTTPS** con tu dominio.

```
Internet ──► nginx (HTTPS, gzip, web estática, 100 MB)
               ├── /             → web (procesa en el navegador)
               ├── /api/*        → rolly_api (Node.js + TypeScript)
               └── /webhook/whatsapp → rolly_api ──► PostgreSQL 16
                                          └──► qpdf + Ghostscript (comprimir, proteger, unir) y PDF→Word
```

**Asistente de WhatsApp**: el cliente manda un PDF → recibe una lista con 1️⃣ Comprimir, 2️⃣ Proteger con
contraseña, 3️⃣ Convertir a Word, 4️⃣ Unir con otro PDF → elige → recibe el documento en el mismo chat.
Plan gratis con cupo mensual por número y plan **Pro WhatsApp** que activas tú después de cobrar.

### Requisitos
- Un servidor Ubuntu 24.04 con 2 GB de RAM (DigitalOcean "Basic" de 12 USD/mes o AWS Lightsail similar).
- Un dominio con un registro **A** apuntando a la IP del servidor (y `www` si lo usas).
- Una app de Meta con el producto **WhatsApp** y un número verificado ([developers.facebook.com](https://developers.facebook.com)).

### Poner en marcha (comandos exactos)

```bash
# 1. En el servidor: Docker
curl -fsSL https://get.docker.com | sh
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# 2. El proyecto y tu configuración
git clone https://github.com/rodrigoovs31-cpu/ROLLY-EDMILSON-.git maus && cd maus
cp .env.example .env
nano .env        # DOMAIN, LETSENCRYPT_EMAIL, POSTGRES_PASSWORD, META_*, PHONE_NUMBER_ID, ADMIN_API_TOKEN

# 3. Levantar todo (PostgreSQL + API + nginx)
docker compose up -d --build
docker compose ps                     # los 3 deben decir "running" / "healthy"

# 4. Certificado HTTPS gratis (solo la primera vez)
./deploy/init-letsencrypt.sh

# 5. Comprobar
curl https://TU-DOMINIO/api/health    # {"ok":true,"db":true,...}
```

### Conectar WhatsApp (Meta)
1. En tu app de Meta → **WhatsApp → Configuración → Webhook**:
   URL de devolución de llamada `https://TU-DOMINIO/webhook/whatsapp` y como token de verificación
   el mismo valor de `META_VERIFY_TOKEN`. Pulsa *Verificar y guardar*.
2. Suscríbete al campo **messages**.
3. Copia la **Clave secreta de la app** (Configuración → Básica) en `META_APP_SECRET`: con ella el servidor
   comprueba que cada mensaje viene de verdad de Meta (firma `X-Hub-Signature-256`) y rechaza los falsos.
4. Usa un **token permanente** de un usuario del sistema en `META_ACCESS_TOKEN` (el temporal vence en 24 h).
5. `docker compose up -d` para aplicar los cambios del `.env`.

### Cobrar el plan Pro WhatsApp
Cuando un cliente te pague (Yape, Plin o transferencia), actívalo con su número:

```bash
curl -X POST https://TU-DOMINIO/api/admin/subscriptions/pro \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"phone_number":"51987654321","months":1}'
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://TU-DOMINIO/api/admin/stats?days=30
```

### Día a día
```bash
docker compose logs -f rolly_api                      # ver qué pasa
git pull && docker compose up -d --build              # actualizar
docker compose exec postgres pg_dump -U rolly rolly | gzip > respaldo-$(date +%F).sql.gz   # respaldo
docker compose exec rolly_api node dist/scripts/create-admin.js tu@correo.com              # usuario admin
```

### Probar el servidor en tu computadora
```bash
cd server && npm install
npm run typecheck
TEST_DATABASE_URL=postgres://usuario@localhost:5432/rolly_test npm test   # webhook firmado + PostgreSQL + PDF reales
```

**Privacidad**: lo que se procesa en la web nunca sale del navegador. Lo que el cliente envía por WhatsApp sí
pasa por tu servidor: se borra al terminar (o a los 30 minutos si no elige nada), la contraseña para proteger
no se guarda y del mensaje solo queda el tipo. Está explicado en `privacidad.html` (Ley 29733).

## Cómo está hecha

```
index.html, *.html        Páginas generadas por scripts/build.mjs (no editarlas a mano)
assets/css/maus.css       Diseño (modo claro y oscuro)
assets/js/config.js       Tu configuración de marca
assets/js/tools-data.js   Catálogo de herramientas (portada, menú, SEO)
assets/js/tool-page.js    Flujo común: elegir archivos → opciones → procesar → descargar
assets/js/tools/*.js      La lógica de cada herramienta
assets/js/lib.js          Utilidades de PDF (lectura, giro de páginas, descargas, ZIP) y carga de librerías
assets/js/page-editor.js  Visor de páginas con elementos encima (Editar, Censurar, Recortar, Formularios)
assets/js/text-layout.js  Lee títulos, párrafos y columnas del PDF (PDF a Word/Excel/Markdown, Traducir, Comparar)
assets/js/render-html.js  Dibuja Word, PowerPoint y HTML como páginas PDF
assets/js/pdf-engine.js   Cliente del Web Worker (unir, marca de agua, extraer, optimizar sin congelar la página)
assets/workers/           El Web Worker y su núcleo pdf-core.js (con respaldo en la página si no hubiera worker)
vendor/                   Copia de respaldo de las librerías (si jsDelivr no responde)
scripts/build.mjs         Generador de páginas, sitemap y robots.txt (lee SITE_URL y API_BASE)
scripts/export-web.mjs    Copia solo los archivos públicos a web-dist/ (lo que sirve nginx o Cloudflare)
server/                   API Node.js + TypeScript: webhook de WhatsApp, PostgreSQL, motor PDF del servidor
  src/server.ts           Arranque, migraciones, mantenimiento y apagado ordenado
  src/whatsapp/           Webhook firmado, cola en PostgreSQL, conversación y cliente de la Graph API v21.0
  src/engine/             qpdf, Ghostscript y PDF→Word en el servidor
  src/db/schema.sql       Tablas users, pdf_jobs, whatsapp_sessions, subscriptions (+ cola whatsapp_events)
  test/                   Pruebas con PostgreSQL real y una Graph API simulada
Dockerfile                Imagen multi-etapa: target "api" (Node 22 Alpine) y "web" (nginx Alpine)
docker-compose.yml        postgres:16-alpine + rolly_api + nginx + certbot
deploy/                   Configuración de nginx y script de Let's Encrypt
```

Para agregar una herramienta: añádela en `tools-data.js`, crea su archivo en `assets/js/tools/` (copia uno parecido)
y ejecuta `npm run build`.

## Mejoras opcionales con servidor

La web funciona sin servidor. Con el servidor de arriba ya tienes WhatsApp y base de datos. Si algún día quieres
conversiones de Office 100% idénticas (fuentes y diseños complejos), se puede sumar [Gotenberg](https://gotenberg.dev)
(LibreOffice) como otro contenedor en el mismo `docker-compose.yml`.

## Licencias de terceros

DocuMaus usa software libre que permite uso comercial:
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0),
[qpdf](https://github.com/qpdf/qpdf) (Apache 2.0) compilado a WebAssembly por [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm) (ISC),
[JSZip](https://github.com/Stuk/jszip) (MIT),
[SortableJS](https://github.com/SortableJS/Sortable) (MIT),
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0),
[docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (Apache 2.0), [docx](https://github.com/dolanmiu/docx) (MIT),
[pptx-preview](https://www.npmjs.com/package/pptx-preview) (ISC, uso comercial permitido), [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (MIT),
[SheetJS](https://sheetjs.com) (Apache 2.0), [jsPDF](https://github.com/parallax/jsPDF) y [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) (MIT),
[html2canvas](https://html2canvas.hertzen.com) (MIT), [node-forge](https://github.com/digitalbazaar/forge) (BSD-3-Clause)
y los íconos de [Lucide](https://lucide.dev) (ISC, ver `vendor/LICENSE-lucide.txt`).
Se descargan desde [jsDelivr](https://www.jsdelivr.com) con versión fija y verificación de integridad (SRI) donde el navegador lo permite.

El servidor usa [Express](https://expressjs.com), [node-postgres](https://node-postgres.com), [zod](https://zod.dev) y
[pino](https://getpino.io) (MIT), [qpdf](https://github.com/qpdf/qpdf) (Apache 2.0) y
[Ghostscript](https://www.ghostscript.com) (AGPL: se usa sin modificar, como programa aparte dentro del contenedor;
si algún día lo modificas, la AGPL te obliga a publicar esos cambios).
