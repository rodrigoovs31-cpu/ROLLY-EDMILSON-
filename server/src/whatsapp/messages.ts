// Todos los textos que ve el cliente en WhatsApp, en un solo lugar.
import type { ListMessage } from './client.js';
import type { Action } from '../repos/sessions.js';

export interface Copy {
  brand: string;
  siteUrl: string;
  proPrice: string;
  proQuota: number;
  supportWhatsapp?: string;
}

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export const ACTIONS: Record<Action, { emoji: string; title: string; description: string }> = {
  compress: { emoji: '1️⃣', title: 'Comprimir PDF', description: 'Reduce el peso hasta -70% (escaneos y fotos)' },
  protect: { emoji: '2️⃣', title: 'Proteger con clave', description: 'Pon contraseña al PDF (cifrado AES-256)' },
  word: { emoji: '3️⃣', title: 'Convertir a Word', description: 'Recibe un .docx editable' },
  merge: { emoji: '4️⃣', title: 'Unir con otro PDF', description: 'Me envías otro PDF y te devuelvo uno solo' },
};

// "1", "comprimir", "1️⃣ Comprimir PDF"… → acción
export function parseAction(input: string): Action | null {
  const t = input.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (t in ACTIONS) return t as Action;  // id de la fila de la lista
  if (/^(1|1️⃣)\b|^1️⃣|compri/.test(t)) return 'compress';
  if (/^(2|2️⃣)\b|^2️⃣|proteg|contrasen|clave/.test(t)) return 'protect';
  if (/^(3|3️⃣)\b|^3️⃣|word|docx/.test(t)) return 'word';
  if (/^(4|4️⃣)\b|^4️⃣|unir|juntar|combinar/.test(t)) return 'merge';
  return null;
}

export function actionMenu(c: Copy, fileName: string, size: number, pages: number): ListMessage {
  return {
    header: '📄 Recibí tu PDF',
    body: `*${fileName}*\n${pages ? `${pages} ${pages === 1 ? 'página' : 'páginas'} · ` : ''}${mb(size)}\n\n¿Qué hago con este documento? Toca *Elegir acción* o responde con el número (1, 2, 3 o 4).`,
    footer: `${c.brand} · tu archivo se borra al terminar`,
    button: 'Elegir acción',
    sections: [{
      title: 'Herramientas PDF',
      rows: (Object.keys(ACTIONS) as Action[]).map((id) => ({
        id,
        title: `${ACTIONS[id].emoji} ${ACTIONS[id].title}`,
        description: ACTIONS[id].description,
      })),
    }],
  };
}

export const t = {
  welcome: (c: Copy, used: number, quota: number) =>
    `👋 ¡Hola! Soy el asistente de *${c.brand}*.\n\nEnvíame un *PDF como documento* (📎 → Documento) y elige qué hacer:\n` +
    `1️⃣ Comprimir PDF\n2️⃣ Proteger con contraseña\n3️⃣ Convertir a Word\n4️⃣ Unir con otro PDF\n\n` +
    `Este mes usaste ${used} de ${quota} documentos de tu plan.\n` +
    `Más herramientas gratis en ${c.siteUrl}`,
  onlyPdf: (c: Copy) =>
    `Por ahora trabajo solo con *PDF*. 📎 Envíalo como *Documento*.\n\n` +
    `¿Tienes fotos o un Word? Conviértelos gratis en la web (se procesan en tu propio equipo):\n${c.siteUrl}/jpg-a-pdf.html\n${c.siteUrl}/word-a-pdf.html`,
  sendPdfFirst: '📎 Primero envíame el PDF que quieres trabajar (como *Documento*).',
  askPassword:
    '🔐 Escribe la *contraseña* que quieres ponerle al PDF (de 4 a 64 caracteres).\n\n' +
    'Consejo: después de recibir tu archivo, borra el mensaje con la contraseña de este chat. No la guardamos.',
  badPassword: 'La contraseña debe tener entre 4 y 64 caracteres y estar en una sola línea. Escríbela otra vez.',
  askSecondPdf: '➕ Ahora envíame el *otro PDF* (como Documento). Lo pondré *después* del que ya me enviaste.',
  working: (action: Action) =>
    ({ compress: '⏳ Comprimiendo tu PDF…', protect: '⏳ Protegiendo tu PDF…', word: '⏳ Convirtiendo a Word…', merge: '⏳ Uniendo tus PDF…' })[action],
  canceled: 'Listo, cancelé la operación y borré tu archivo. Envíame otro PDF cuando quieras.',
  nothingToCancel: 'No hay ninguna operación pendiente. Envíame un PDF para empezar.',
  expired: '⌛ Pasó mucho tiempo y por seguridad borré el archivo. Envíamelo de nuevo, por favor.',
  quotaExceeded: (c: Copy, quota: number) =>
    `Llegaste al límite de *${quota} documentos* de este mes en tu plan.\n\n` +
    `⭐ Con *Pro WhatsApp* (${c.proPrice}) procesas hasta ${c.proQuota} documentos al mes. Escribe *PRO* para activarlo.\n\n` +
    `Mientras tanto, en la web todo es gratis y sin límite: ${c.siteUrl}`,
  suspended: 'Tu número está suspendido en este servicio. Si crees que es un error, escríbenos.',
  pro: (c: Copy) =>
    `⭐ *${c.brand} Pro WhatsApp* — ${c.proPrice}\n• Hasta ${c.proQuota} documentos al mes por WhatsApp\n• Archivos de hasta 100 MB\n\n` +
    (c.supportWhatsapp
      ? `Para activarlo escribe a nuestro equipo, te indicamos cómo pagar (Yape, Plin o transferencia): https://wa.me/${c.supportWhatsapp}?text=${encodeURIComponent(`Hola, quiero ${c.brand} Pro WhatsApp`)}`
      : `Mira cómo activarlo en ${c.siteUrl}/#planes`),
  proActivated: (c: Copy, until: Date) =>
    `✅ ¡Tu plan *Pro WhatsApp* está activo hasta el ${until.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima' })}! Gracias por confiar en ${c.brand}.`,
  errors: {
    password: '🔒 Este PDF tiene contraseña de apertura. Quítasela primero (o envíame una copia sin contraseña) y vuelve a intentarlo.',
    not_pdf: 'Ese archivo no parece un PDF válido. Revisa que sea un PDF y envíalo de nuevo.',
    damaged: 'No pude leer este PDF: parece dañado. Prueba con "Reparar PDF" en la web y envíamelo otra vez.',
    no_text: (c: Copy) =>
      'Tu PDF parece *escaneado* (es una imagen, no tiene texto), así que el Word saldría vacío.\n\n' +
      `Primero reconoce el texto con OCR gratis en la web: ${c.siteUrl}/ocr-pdf.html y luego envíamelo.`,
    timeout: 'El documento es muy pesado y tardó demasiado. Prueba con uno más pequeño o divídelo en la web.',
    too_big: (maxMb: number) => `El archivo supera el máximo de ${maxMb} MB. Comprímelo o divídelo en la web y envíamelo otra vez.`,
    failed: 'Algo salió mal al procesar tu documento. Inténtalo de nuevo en un momento. Si se repite, escríbenos.',
    download: 'No pude descargar tu archivo de WhatsApp. Envíamelo de nuevo, por favor.',
  },
  caption: {
    compress: (before: number, after: number, alreadyOptimized: boolean) =>
      alreadyOptimized
        ? `✅ Tu PDF ya estaba optimizado (${mb(before)}); no se pudo reducir más sin dañarlo.`
        : `✅ PDF comprimido: ${mb(before)} → *${mb(after)}* (−${Math.round((1 - after / before) * 100)}%).`,
    protect: '✅ Tu PDF ahora pide contraseña para abrirse (cifrado AES-256). No la olvides: no se puede recuperar.',
    word: (paragraphs: number) => `✅ Tu Word editable está listo (${paragraphs} párrafos). Los diseños complejos pueden variar un poco.`,
    merge: (pages: number) => `✅ Uní tus documentos en un PDF de ${pages} páginas.`,
  },
  footerMore: (c: Copy) => `\n\n¿Algo más? Envíame otro PDF. Más herramientas: ${c.siteUrl}`,
};
