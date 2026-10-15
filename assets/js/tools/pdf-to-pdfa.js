import { readBytes, loadPdfDoc, getPdfLib, openPdfjs, renderPage, canvasToBlob, freeCanvas, pdfBlob, baseName, yieldUI } from '../lib.js';
import { h, field, segmented } from '../ui.js';

// Perfil de color sRGB (generado con LittleCMS), exigido por PDF/A como "intención de salida".
const SRGB_ICC = Uint8Array.from(atob('AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACgAPAAkAEQAjYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c'), (c) => c.charCodeAt(0));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isoNow = () => new Date(Math.floor(Date.now() / 1000) * 1000);

function xmp(title, date) {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreatorTool>DocuMaus</xmp:CreatorTool>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso}</xmp:MetadataDate>
   <pdf:Producer>DocuMaus</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ¿La página usa fuentes que no están incrustadas en el archivo? (PDF/A exige incrustarlas)
function usesMissingFonts(lib, context, resources, seen = new Set()) {
  const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef } = lib;
  if (!resources || seen.has(resources)) return false;
  seen.add(resources);
  const get = (dict, key) => { const v = dict.get(PDFName.of(key)); return v instanceof PDFRef ? context.lookup(v) : v; };
  const fontOk = (font) => {
    if (!(font instanceof PDFDict)) return true;
    const sub = get(font, 'Subtype')?.toString();
    if (sub === '/Type3') return true;
    if (sub === '/Type0') {
      const desc = get(font, 'DescendantFonts');
      const first = desc instanceof PDFArray ? desc.lookup(0) : null;
      return fontOk(first);
    }
    const fd = get(font, 'FontDescriptor');
    if (!(fd instanceof PDFDict)) return false;
    return ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.has(PDFName.of(k)));
  };
  const fonts = get(resources, 'Font');
  if (fonts instanceof PDFDict) {
    for (const [, ref] of fonts.entries()) {
      if (!fontOk(ref instanceof PDFRef ? context.lookup(ref) : ref)) return true;
    }
  }
  const xobjects = get(resources, 'XObject');
  if (xobjects instanceof PDFDict) {
    for (const [, ref] of xobjects.entries()) {
      const xo = ref instanceof PDFRef ? context.lookup(ref) : ref;
      if (xo instanceof PDFRawStream && xo.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') {
        const inner = xo.dict.get(PDFName.of('Resources'));
        if (usesMissingFonts(lib, context, inner instanceof PDFRef ? context.lookup(inner) : inner, seen)) return true;
      }
    }
  }
  return false;
}

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a PDF/A',
  busyLabel: 'Convirtiendo a PDF/A…',

  options(ctx, el) {
    ctx.opts = { mode: 'auto' };
    el.append(
      field('Modo', segmented('pdfa-mode', [
        { value: 'auto', label: 'Conservar el texto' }, { value: 'image', label: 'Máxima compatibilidad' },
      ], 'auto', (v) => { ctx.opts.mode = v; })),
      h('p.side-note', {}, 'Se genera PDF/A-2b. "Conservar el texto" solo convierte a imagen las páginas que usan fuentes no incrustadas. "Máxima compatibilidad" convierte todas las páginas a imagen.'),
    );
  },

  async run(ctx) {
    const lib = await getPdfLib();
    const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFNumber } = lib;
    const files = [];
    let rasterized = 0;
    let total = 0;
    for (const [fi, entry] of ctx.files.entries()) {
      const bytes = await readBytes(entry.file);
      const src = await loadPdfDoc(bytes);
      try { src.getForm().flatten(); } catch { /* sin formulario */ }
      const out = await PDFDocument.create({ updateMetadata: false });
      const pdfjsDoc = await openPdfjs(bytes);
      try {
        const n = src.getPageCount();
        total += n;
        for (let i = 0; i < n; i++) {
          ctx.progress((fi + i / n) / ctx.files.length, `Página ${i + 1} de ${n}…`);
          await yieldUI();
          const srcPage = src.getPage(i);
          const raster = ctx.opts.mode === 'image' || usesMissingFonts(lib, src.context, srcPage.node.Resources());
          if (raster) {
            rasterized++;
            const page = await pdfjsDoc.getPage(i + 1);
            const vp = page.getViewport({ scale: 1 });
            const canvas = await renderPage(page, 200 / 72);
            const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
            freeCanvas(canvas);
            page.cleanup();
            const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
            out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          } else {
            const [copy] = await out.copyPages(src, [i]);
            out.addPage(copy);
            copy.node.delete(PDFName.of('AA'));
            const annots = copy.node.lookup(PDFName.of('Annots'));
            if (annots instanceof PDFArray) {
              const keep = [];
              for (let k = 0; k < annots.size(); k++) {
                const a = annots.lookup(k);
                if (a instanceof PDFDict && a.get(PDFName.of('Subtype'))?.toString() === '/Link') {
                  a.set(PDFName.of('F'), PDFNumber.of(4));
                  a.delete(PDFName.of('A'));
                  keep.push(annots.get(k));
                }
              }
              if (keep.length) copy.node.set(PDFName.of('Annots'), out.context.obj(keep));
              else copy.node.delete(PDFName.of('Annots'));
            }
          }
        }
      } finally {
        pdfjsDoc.destroy();
      }

      const title = src.getTitle() || baseName(entry.name);
      const date = isoNow();
      out.setTitle(title);
      out.setCreator('DocuMaus');
      out.setProducer('DocuMaus');
      out.setCreationDate(date);
      out.setModificationDate(date);
      const ctxPdf = out.context;
      const meta = ctxPdf.stream(new TextEncoder().encode(xmp(title, date)), { Type: 'Metadata', Subtype: 'XML' });
      out.catalog.set(PDFName.of('Metadata'), ctxPdf.register(meta));
      const icc = ctxPdf.register(ctxPdf.flateStream(SRGB_ICC, { N: 3 }));
      const intent = ctxPdf.register(ctxPdf.obj({
        Type: 'OutputIntent', S: 'GTS_PDFA1',
        OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'),
        DestOutputProfile: icc,
      }));
      out.catalog.set(PDFName.of('OutputIntents'), ctxPdf.obj([intent]));
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      ctxPdf.trailerInfo.ID = ctxPdf.obj([PDFHexString.of(id), PDFHexString.of(id)]);
      files.push({ name: `${baseName(entry.name)}-pdfa.pdf`, blob: pdfBlob(await out.save({ useObjectStreams: false })) });
    }
    return {
      files,
      zipName: 'maus-pdfa.zip',
      summary: rasterized === 0
        ? 'Tu PDF/A-2b está listo y conserva todo el texto.'
        : `Tu PDF/A-2b está listo. ${rasterized} de ${total} páginas se convirtieron a imagen para cumplir la norma.`,
    };
  },
};
