// Cliente mínimo de WhatsApp Cloud API (Graph API v21.0) sin dependencias externas.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { openAsBlob } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Logger } from '../lib/logger.js';

export interface GraphOptions {
  baseUrl: string;         // https://graph.facebook.com
  version: string;         // v21.0
  accessToken: string;
  phoneNumberId: string;
  log: Logger;
  timeoutMs?: number;
}

export interface MediaInfo {
  id: string;
  url: string;
  mime_type: string;
  sha256?: string;
  file_size?: number;
}

export interface ListRow { id: string; title: string; description?: string }
export interface ListMessage {
  header?: string;
  body: string;
  footer?: string;
  button: string;
  sections: Array<{ title: string; rows: ListRow[] }>;
}

export class GraphError extends Error {
  constructor(readonly status: number, readonly code: number | undefined, message: string, readonly fbtraceId?: string) {
    super(message);
    this.name = 'GraphError';
  }
}

export class MediaTooLargeError extends Error {
  constructor(readonly size: number) {
    super('media demasiado grande');
    this.name = 'MediaTooLargeError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = 'rolly-api/1.0';

// Límites de WhatsApp para mensajes interactivos de lista.
const cut = (s: string, n: number) => (Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join('') + '…' : s);

export class GraphClient {
  constructor(private readonly o: GraphOptions) {}

  private url(path: string) {
    return `${this.o.baseUrl.replace(/\/$/, '')}/${this.o.version}/${path}`;
  }

  private get auth() {
    return { Authorization: `Bearer ${this.o.accessToken}`, 'User-Agent': UA };
  }

  // Llamada a la Graph API con reintentos ante 429/5xx (backoff exponencial).
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, form?: FormData): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
      try {
        const res = await fetch(this.url(path), {
          method,
          headers: { ...this.auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: form ?? (body ? JSON.stringify(body) : undefined),
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
        });
        const text = await res.text();
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
        if (res.ok) return json as T;
        const err = (json as { error?: { message?: string; code?: number; fbtrace_id?: string } } | null)?.error;
        last = new GraphError(res.status, err?.code, err?.message ?? `HTTP ${res.status}`, err?.fbtrace_id);
        if (res.status !== 429 && res.status < 500) break;  // error del pedido: no tiene sentido reintentar
      } catch (err) {
        last = err;  // red o tiempo agotado: se reintenta
      }
    }
    throw last;
  }

  // 1) GET /{media-id} → URL temporal (vence en 5 minutos).
  getMediaInfo(mediaId: string): Promise<MediaInfo> {
    return this.call<MediaInfo>('GET', encodeURIComponent(mediaId));
  }

  // 2) Descarga a disco en streaming (sin cargar 100 MB en memoria), con tope de tamaño
  //    y verificación del sha256 que informa Meta.
  async downloadMedia(info: MediaInfo, dest: string, maxBytes: number): Promise<number> {
    if (info.file_size && info.file_size > maxBytes) throw new MediaTooLargeError(info.file_size);
    const res = await fetch(info.url, { headers: this.auth, signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok || !res.body) throw new GraphError(res.status, undefined, `no se pudo descargar el archivo (HTTP ${res.status})`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new MediaTooLargeError(declared);

    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new MediaTooLargeError(size));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), meter, createWriteStream(dest, { mode: 0o600 }));
    } catch (err) {
      await rm(dest, { force: true });
      throw err;
    }
    if (info.sha256 && hash.digest('hex') !== info.sha256.toLowerCase()) {
      await rm(dest, { force: true });
      throw new Error('el archivo descargado no coincide con el sha256 de Meta');
    }
    return size;
  }

  // 3) Sube el resultado: POST /{phone-number-id}/media (multipart) → { id }.
  async uploadMedia(path: string, mime: string, fileName: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', await openAsBlob(path, { type: mime }), fileName);
    const res = await this.call<{ id: string }>('POST', `${this.o.phoneNumberId}/media`, undefined, form);
    return res.id;
  }

  private send(to: string, message: Record<string, unknown>) {
    return this.call<{ messages?: Array<{ id: string }> }>('POST', `${this.o.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...message,
    });
  }

  sendText(to: string, body: string, previewUrl = false) {
    return this.send(to, { type: 'text', text: { body: cut(body, 4096), preview_url: previewUrl } });
  }

  // Lista interactiva: hasta 10 filas; título de fila ≤ 24, botón ≤ 20, descripción ≤ 72.
  sendList(to: string, m: ListMessage) {
    return this.send(to, {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(m.header ? { header: { type: 'text', text: cut(m.header, 60) } } : {}),
        body: { text: cut(m.body, 4096) },
        ...(m.footer ? { footer: { text: cut(m.footer, 60) } } : {}),
        action: {
          button: cut(m.button, 20),
          sections: m.sections.map((s) => ({
            title: cut(s.title, 24),
            rows: s.rows.map((r) => ({
              id: r.id,
              title: cut(r.title, 24),
              ...(r.description ? { description: cut(r.description, 72) } : {}),
            })),
          })),
        },
      },
    });
  }

  // 4) Devuelve el documento procesado al chat.
  sendDocument(to: string, mediaId: string, fileName: string, caption?: string) {
    return this.send(to, {
      type: 'document',
      document: { id: mediaId, filename: fileName, ...(caption ? { caption: cut(caption, 1024) } : {}) },
    });
  }

  // Doble check azul: el cliente ve que su mensaje fue leído.
  async markRead(messageId: string): Promise<void> {
    await this.call('POST', `${this.o.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }
}
