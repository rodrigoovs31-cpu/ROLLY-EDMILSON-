// Arma un Word (.docx) editable con títulos, párrafos y viñetas.
import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import type { PageLayout } from './text-layout.js';

const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;

// Quita caracteres de control que Word no acepta en XML.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

export async function buildDocx(pages: PageLayout[], opts: { title: string; creator: string }): Promise<Buffer> {
  const children: Paragraph[] = [];
  pages.forEach((page, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const p of page.paragraphs) {
      const text = clean(p.text);
      if (p.kind === 'h1' || p.kind === 'h2' || p.kind === 'h3') {
        children.push(new Paragraph({ text, heading: HEADINGS[p.kind], spacing: { before: 200, after: 120 } }));
      } else if (p.kind === 'li') {
        children.push(new Paragraph({ children: [new TextRun(text)], bullet: { level: 0 }, spacing: { after: 60 } }));
      } else {
        children.push(new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } }));
      }
    }
  });
  if (!children.length) children.push(new Paragraph(''));
  const doc = new Document({
    title: clean(opts.title),
    creator: opts.creator,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
