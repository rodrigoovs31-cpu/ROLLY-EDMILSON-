// Firma digital de PDF con el certificado del usuario (.p12 / .pfx), dentro del navegador.
// Formato estándar PKCS#7 desacoplado (adbe.pkcs7.detached), el que validan Adobe Acrobat y otros lectores.
// Recibe las librerías por parámetro para poder probarse también fuera del navegador.

const SIG_BYTES = 16384; // espacio reservado para la firma
const BR_PLACEHOLDER = '9999999999';

export class SignError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const toBinary = (bytes) => {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return s;
};

// Lee el certificado y la llave privada del archivo .p12/.pfx.
export function readCertificate(forge, p12Bytes, password) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(toBinary(p12Bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    if (/password|mac|invalid/i.test(String(err?.message))) throw new SignError('password', 'La contraseña del certificado no es correcta.');
    throw new SignError('format', 'No pudimos leer el certificado. Usa un archivo .p12 o .pfx.');
  }
  const oids = forge.pki.oids;
  const keys = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] || []),
  ].map((b) => b.key).filter(Boolean);
  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] || []).map((b) => b.cert).filter(Boolean);
  if (!keys.length || !certs.length) {
    throw new SignError('format', 'El archivo no contiene una llave de firma. Exporta tu certificado "con la clave privada".');
  }
  const key = keys[0];
  if (!key.n) throw new SignError('format', 'Este certificado usa un tipo de llave que todavía no es compatible (solo RSA).');
  const cert = certs.find((c) => c.publicKey?.n && c.publicKey.n.equals(key.n));
  if (!cert) throw new SignError('format', 'No encontramos el certificado que corresponde a la llave.');
  const attr = (name) => cert.subject.getField(name)?.value || '';
  const byOid = (oid) => cert.subject.attributes.find((a) => a.type === oid)?.value || '';
  return {
    key, cert, chain: certs.filter((c) => c !== cert),
    name: attr('CN') || attr('O') || 'Firmante',
    organization: attr('O'),
    serial: byOid('2.5.4.5'),
    issuer: cert.issuer.getField('CN')?.value || cert.issuer.getField('O')?.value || '',
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
  };
}

// ¿El PDF ya tiene firmas digitales? (volver a guardarlo completo las invalidaría)
export function hasDigitalSignatures(PDFLib, doc) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) return false;
  const fields = acro.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) return false;
  const stack = [...fields.asArray()];
  while (stack.length) {
    const f = doc.context.lookup(stack.pop());
    if (!(f instanceof PDFDict)) continue;
    if (f.get(PDFName.of('FT'))?.toString() === '/Sig' && f.get(PDFName.of('V'))) return true;
    const kids = f.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) stack.push(...kids.asArray());
  }
  return false;
}

/**
 * Firma el PDF. opts: { reason, location, label: { page: 'first'|'last', pos: 'br'|'bl' } | null, date }
 * Devuelve los bytes del PDF firmado.
 */
export async function signPdf({ PDFLib, forge }, pdfBytes, signer, opts = {}) {
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFNumber, StandardFonts, rgb, degrees } = PDFLib;
  const date = opts.date || new Date();
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  if (hasDigitalSignatures(PDFLib, doc)) {
    throw new SignError('signed', 'Este PDF ya tiene una firma digital. Firmarlo aquí la invalidaría; para varias firmas usa ReFirma de RENIEC.');
  }
  const pages = doc.getPages();
  const page = opts.label?.page === 'first' ? pages[0] : pages[pages.length - 1];

  // Sello visible con los datos de la firma
  if (opts.label) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const safe = (f, t) => [...String(t)].filter((ch) => { try { f.encodeText(ch); return true; } catch { return false; } }).join('');
    const pad = (n) => String(n).padStart(2, '0');
    const when = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const lines = [
      [bold, 'Firmado digitalmente por:'],
      [font, signer.name],
      signer.serial ? [font, signer.serial] : null,
      [font, `Fecha: ${when}`],
      opts.reason ? [font, `Motivo: ${opts.reason}`] : null,
    ].filter(Boolean).map(([f, t]) => [f, safe(f, t).slice(0, 60)]);
    const size = 7.5;
    const w = Math.max(...lines.map(([f, t]) => f.widthOfTextAtSize(t, size))) + 14;
    const hgt = lines.length * size * 1.35 + 10;
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const vw = rot % 180 ? box.height : box.width;
    const margin = 24;
    const vx = opts.label.pos === 'bl' ? margin : vw - margin - w;
    const vy = margin;
    // Coordenadas visibles → reales según el giro de la página
    const map = (x, y) => {
      const W = box.width, H = box.height;
      const [px, py] = rot === 90 ? [W - y, x] : rot === 180 ? [W - x, H - y] : rot === 270 ? [y, H - x] : [x, y];
      return { x: box.x + px, y: box.y + py };
    };
    const corner = map(vx, vy);
    page.drawRectangle({ x: corner.x, y: corner.y, width: w, height: hgt, rotate: degrees(rot), color: rgb(0.97, 0.98, 1), borderColor: rgb(0.18, 0.44, 0.86), borderWidth: 0.8 });
    lines.forEach(([f, t], i) => {
      const p = map(vx + 7, vy + hgt - 5 - size - i * size * 1.35);
      page.drawText(t, { x: p.x, y: p.y, size, font: f, color: rgb(0.09, 0.1, 0.17), rotate: degrees(rot) });
    });
  }

  // Diccionario de firma con espacio reservado
  const ctx = doc.context;
  const sig = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, Number(BR_PLACEHOLDER), Number(BR_PLACEHOLDER), Number(BR_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
    M: PDFString.fromDate(date),
    Name: PDFString.of(signer.name),
  });
  if (opts.reason) sig.set(PDFName.of('Reason'), PDFString.of(opts.reason));
  if (opts.location) sig.set(PDFName.of('Location'), PDFString.of(opts.location));
  const sigRef = ctx.register(sig);
  const widget = ctx.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0],
    V: sigRef, T: PDFString.of(`Firma ${Date.now().toString(36)}`), F: 132, P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(widgetRef);
  else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  let acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) {
    acro = ctx.obj({ Fields: [] });
    doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro));
  }
  let fields = acro.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) { fields = ctx.obj([]); acro.set(PDFName.of('Fields'), fields); }
  fields.push(widgetRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

  // Ubica el espacio reservado y calcula qué bytes se firman
  const text = new TextDecoder('latin1').decode(bytes);
  const zeros = '0'.repeat(SIG_BYTES * 2);
  const contentsAt = text.indexOf(`<${zeros}>`);
  const brText = `[ 0 ${BR_PLACEHOLDER} ${BR_PLACEHOLDER} ${BR_PLACEHOLDER} ]`;
  const brAt = text.indexOf(brText);
  if (contentsAt < 0 || brAt < 0) throw new SignError('internal', 'No se pudo preparar la firma en este PDF.');
  const contentsEnd = contentsAt + zeros.length + 2;
  const range = [0, contentsAt, contentsEnd, bytes.length - contentsEnd];
  const brValue = `[ ${range.join(' ')} ]`.padEnd(brText.length, ' ');
  for (let i = 0; i < brValue.length; i++) bytes[brAt + i] = brValue.charCodeAt(i);

  const signed = new Uint8Array(range[1] + range[3]);
  signed.set(bytes.subarray(0, range[1]), 0);
  signed.set(bytes.subarray(range[2]), range[1]);

  // Firma PKCS#7 (CMS) desacoplada con SHA-256
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(signed));
  p7.addCertificate(signer.cert);
  for (const c of signer.chain) p7.addCertificate(c);
  p7.addSigner({
    key: signer.key,
    certificate: signer.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: date },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  let hex = '';
  for (let i = 0; i < der.length; i++) hex += der.charCodeAt(i).toString(16).padStart(2, '0');
  if (hex.length > zeros.length) throw new SignError('internal', 'La firma es más grande de lo esperado.');
  hex = hex.padEnd(zeros.length, '0');
  for (let i = 0; i < hex.length; i++) bytes[contentsAt + 1 + i] = hex.charCodeAt(i);
  return bytes;
}
