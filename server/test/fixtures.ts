// PDF de prueba generados al vuelo (no hace falta guardar binarios en el repositorio).
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

// Documento con títulos, párrafos y viñetas (para PDF a Word).
export async function textPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const topics = ['Introduccion', 'Resultados de ventas', 'Conclusiones', 'Anexos', 'Glosario'];
  const words = ['cliente', 'factura', 'region', 'producto', 'mercado', 'trimestre', 'margen', 'pedido', 'campana', 'canal'];
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(`Capitulo ${i}: ${topics[(i - 1) % topics.length]}`, { x: 60, y, size: 22, font: bold });
    y -= 40;
    for (let p = 0; p < 4; p++) {
      const w = (k: number) => words[(i * 7 + p * 3 + k) % words.length];
      for (const line of [
        `En la seccion ${p + 1} revisamos el ${w(0)} y la ${w(1)} de cada ${w(2)}`,
        `para comprobar que las lineas se unen en un solo parrafo sobre ${w(3)}.`,
      ]) {
        page.drawText(line, { x: 60, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 15;
      }
      y -= 12;
    }
    page.drawText(`- Punto ${i}.1 sobre el ${words[i % words.length]}`, { x: 60, y, size: 11, font });
    page.drawText(`- Punto ${i}.2 sobre la ${words[(i + 4) % words.length]}`, { x: 60, y: y - 15, size: 11, font });
  }
  return doc.save();
}

// Páginas con una "foto" grande sin comprimir con JPEG (como un escaneo a 300 ppp).
export async function photoPdf(pages = 3, w = 1600, h = 2000): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < pages; n++) {
    const px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const base = 128 + 60 * Math.sin((x + n * 50) / 90) * Math.cos(y / 120);
        px[i] = Math.max(0, Math.min(255, base + rand() * 40 - 20));
        px[i + 1] = Math.max(0, Math.min(255, base * 0.9 + rand() * 40 - 20));
        px[i + 2] = Math.max(0, Math.min(255, 255 - base + rand() * 40 - 20));
      }
    }
    const stream = doc.context.stream(deflateSync(px), {
      Type: 'XObject', Subtype: 'Image', Width: w, Height: h,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
    });
    const ref = doc.context.register(stream);
    const page = doc.addPage([595, 842]);
    page.node.setXObject(PDFName.of('Im0'), ref);
    const content = doc.context.stream('q 595 0 0 842 0 0 cm /Im0 Do Q');
    page.node.set(PDFName.of('Contents'), doc.context.register(content));
  }
  return doc.save();
}
