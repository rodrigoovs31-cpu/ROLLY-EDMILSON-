// Arma un documento de Word (.docx) a partir de los párrafos leídos del PDF.
import { loadLib } from './lib.js';

const HEADINGS = { h1: 'HEADING_1', h2: 'HEADING_2', h3: 'HEADING_3' };

/**
 * pages: [{ paragraphs: [{ kind: 'h1'|'h2'|'h3'|'p'|'li', text }] }]
 */
export async function buildDocx(pages, { pageBreaks = true, title = '' } = {}) {
  const docx = await loadLib('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = docx;
  const children = [];
  pages.forEach((page, i) => {
    if (i > 0 && pageBreaks) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const p of page.paragraphs) {
      if (HEADINGS[p.kind]) children.push(new Paragraph({ text: p.text, heading: HeadingLevel[HEADINGS[p.kind]], spacing: { before: 200, after: 120 } }));
      else if (p.kind === 'li') children.push(new Paragraph({ children: [new TextRun(p.text)], bullet: { level: 0 }, spacing: { after: 60 } }));
      else children.push(new Paragraph({ children: [new TextRun(p.text)], spacing: { after: 160 } }));
    }
  });
  if (!children.length) children.push(new Paragraph(''));
  const doc = new Document({
    title,
    creator: 'DocuMaus',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
