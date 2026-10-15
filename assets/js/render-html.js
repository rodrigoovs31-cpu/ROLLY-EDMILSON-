// Dibuja contenido HTML (documentos de Word, diapositivas, páginas web) y lo convierte en páginas PDF.
import { loadLib, getPdfLib, canvasToBlob, freeCanvas, yieldUI } from './lib.js';

// Si el equipo no tiene las fuentes de Office, usa otras con medidas parecidas.
const FONT_ALIASES = `
@font-face { font-family: "Calibri"; src: local("Calibri"), local("Carlito"), local("Liberation Sans"), local("Arial"), local("Roboto"), local("Helvetica"); }
@font-face { font-family: "Calibri Light"; src: local("Calibri Light"), local("Carlito"), local("Liberation Sans"), local("Arial"), local("Roboto"); }
@font-face { font-family: "Cambria"; src: local("Cambria"), local("Caladea"), local("Liberation Serif"), local("Times New Roman"), local("Noto Serif"), local("Georgia"); }
@font-face { font-family: "Aptos"; src: local("Aptos"), local("Calibri"), local("Carlito"), local("Arial"), local("Roboto"); }
@font-face { font-family: "Segoe UI"; src: local("Segoe UI"), local("Roboto"), local("Arial"), local("Helvetica"); }
.maus-render { position: fixed; left: -30000px; top: 0; background: #fff; color: #000; font-family: Calibri, Arial, sans-serif; }
.maus-render * { animation: none !important; transition: none !important; }
`;

let aliased = false;
function aliasFonts() {
  if (aliased) return;
  aliased = true;
  const style = document.createElement('style');
  style.textContent = FONT_ALIASES;
  document.head.append(style);
}

export function makeHost(width) {
  aliasFonts();
  const host = document.createElement('div');
  host.className = 'maus-render';
  if (width) host.style.width = `${width}px`;
  document.body.append(host);
  return host;
}

export async function waitForAssets(root) {
  try { await document.fonts.ready; } catch { /* sigue */ }
  const imgs = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  await Promise.race([
    Promise.all(imgs.map((img) => img.decode().catch(() => {}))),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
}

/**
 * Convierte elementos en páginas PDF (como imagen de alta calidad).
 * pages: [{ el, widthPt, heightPt, slicePx }] — slicePx: alto en px de cada página si el elemento es más largo.
 */
export async function elementsToPdf(pages, { scale = 2, quality = 0.9, progress = () => {} } = {}) {
  const html2canvas = await loadLib('html2canvas');
  const { PDFDocument } = await getPdfLib();
  const out = await PDFDocument.create();
  for (const [i, p] of pages.entries()) {
    progress(i / pages.length, `Dibujando página ${i + 1} de ${pages.length}…`);
    await yieldUI();
    const canvas = await html2canvas(p.el, {
      scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
      windowWidth: Math.max(p.el.scrollWidth, 800),
    });
    const elW = canvas.width / scale;
    const elH = canvas.height / scale;
    const sliceH = p.slicePx && elH > p.slicePx * 1.02 ? p.slicePx : elH;
    const k = p.widthPt / elW; // puntos por píxel CSS
    for (let top = 0; top < elH - 1; top += sliceH) {
      const hPx = Math.min(sliceH, elH - top);
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.round(hPx * scale);
      const c = part.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, part.width, part.height);
      c.drawImage(canvas, 0, Math.round(top * scale), canvas.width, part.height, 0, 0, part.width, part.height);
      const jpg = await canvasToBlob(part, 'image/jpeg', quality);
      freeCanvas(part);
      const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const pageH = p.heightPt ? Math.max(p.heightPt, hPx * k) : hPx * k;
      out.addPage([p.widthPt, pageH]).drawImage(img, { x: 0, y: pageH - hPx * k, width: p.widthPt, height: hPx * k });
    }
    freeCanvas(canvas);
  }
  return out.save();
}
