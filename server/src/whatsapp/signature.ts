import { createHmac, timingSafeEqual } from 'node:crypto';

// Meta firma el cuerpo EXACTO de cada webhook con el "App Secret" de tu app:
//   X-Hub-Signature-256: sha256=<hex(HMAC-SHA256(app_secret, cuerpo))>
// Hay que calcularlo sobre los bytes crudos (no sobre el JSON ya interpretado)
// y compararlo en tiempo constante para no filtrar información.
export function signBody(body: Buffer | string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
}

export function verifySignature(body: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
