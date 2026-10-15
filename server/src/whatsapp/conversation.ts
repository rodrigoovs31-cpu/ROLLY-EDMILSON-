// Conversación de WhatsApp: recibe el PDF, ofrece las 4 acciones, procesa y devuelve el documento.
//
//  PDF recibido ──► lista (1 comprimir · 2 proteger · 3 Word · 4 unir)
//      1 / 3 ──────────────────────────────► procesar ► enviar documento
//      2 ──► pedir contraseña ──► texto ───► procesar ► enviar documento
//      4 ──► pedir 2.º PDF ─────► PDF ─────► procesar ► enviar documento
import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../lib/logger.js';
import { EngineError } from '../engine/errors.js';
import { safeBaseName, type Output, type PdfEngine } from '../engine/pdf.js';
import type { JobsRepo } from '../repos/jobs.js';
import type { Action, SessionsRepo, WaSession } from '../repos/sessions.js';
import type { SubscriptionsRepo } from '../repos/subscriptions.js';
import { GraphError, MediaTooLargeError, type GraphClient } from './client.js';
import { actionMenu, parseAction, t, type Copy } from './messages.js';
import type { InboundMessage } from './types.js';

export interface ConversationDeps {
  graph: GraphClient;
  engine: PdfEngine;
  sessions: SessionsRepo;
  subscriptions: SubscriptionsRepo;
  jobs: JobsRepo;
  log: Logger;
  copy: Copy;
  dataDir: string;
  maxBytes: number;
  limit: <T>(fn: () => Promise<T>) => Promise<T>;  // limita los trabajos pesados simultáneos
}

const isPdfDoc = (d: { mime_type?: string; filename?: string }) =>
  d.mime_type === 'application/pdf' || /\.pdf$/i.test(d.filename ?? '');

export class Conversation {
  constructor(private readonly d: ConversationDeps) {}

  private say(to: string, text: string) {
    return this.d.graph.sendText(to, text, text.includes('http'));
  }

  async handle(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    this.d.graph.markRead(msg.id).catch((err) => this.d.log.debug({ err }, 'no se pudo marcar como leído'));

    switch (msg.type) {
      case 'document':
        if (msg.document && isPdfDoc(msg.document)) return this.onPdf(phone, msg.document);
        return void (await this.say(phone, t.onlyPdf(this.d.copy)));
      case 'interactive': {
        const id = msg.interactive?.list_reply?.id ?? msg.interactive?.button_reply?.id ?? '';
        return this.onChoice(phone, id);
      }
      case 'button':
        return this.onChoice(phone, msg.button?.payload ?? msg.button?.text ?? '');
      case 'text':
        return this.onText(phone, msg.text?.body ?? '');
      case 'image':
        return void (await this.say(phone, t.onlyPdf(this.d.copy)));
      default:
        return this.onText(phone, '');
    }
  }

  private async onText(phone: string, raw: string) {
    const text = raw.trim();
    const open = await this.d.sessions.findOpen(phone);

    if (/^(cancelar|cancela|salir|stop)$/i.test(text)) {
      if (!open) return void (await this.say(phone, t.nothingToCancel));
      await this.cleanup(await this.d.sessions.closeOpen(phone, 'CANCELED'));
      return void (await this.say(phone, t.canceled));
    }
    if (open?.step === 'AWAIT_PASSWORD') return this.onPassword(open, raw);
    if (open?.step === 'CHOOSE_ACTION') {
      const action = parseAction(text);
      if (action) return this.onChoice(phone, action);
    }
    if (open?.step === 'AWAIT_SECOND_PDF') return void (await this.say(phone, t.askSecondPdf));
    if (/^(pro|plan|planes|precio|precios|pagar|premium)\b/i.test(text)) return void (await this.say(phone, t.pro(this.d.copy)));

    const sub = await this.d.subscriptions.forPhone(phone);
    await this.say(phone, t.welcome(this.d.copy, sub.used_quota, sub.monthly_quota));
  }

  private async onPdf(phone: string, doc: { id: string; filename?: string }) {
    const open = await this.d.sessions.findOpen(phone);
    if (open?.step === 'AWAIT_SECOND_PDF' && open.storage_dir) {
      const second = join(open.storage_dir, 'second.pdf');
      if (!(await this.download(phone, doc.id, second))) return;
      if (!(await this.validate(phone, second))) return;
      await this.d.sessions.update(open.id, { extra_file_name: (doc.filename ?? 'documento.pdf').slice(0, 200) });
      return this.process(open, 'merge');
    }

    const sub = await this.d.subscriptions.forPhone(phone);
    if (sub.status !== 'active') return void (await this.say(phone, t.suspended));
    if (!this.d.subscriptions.hasQuota(sub)) {
      return void (await this.say(phone, t.quotaExceeded(this.d.copy, sub.monthly_quota)));
    }

    // Un PDF nuevo reemplaza cualquier conversación anterior sin terminar.
    await this.cleanup(await this.d.sessions.closeOpen(phone, 'CANCELED'));

    const dir = join(this.d.dataDir, randomUUID());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const input = join(dir, 'input.pdf');
    if (!(await this.download(phone, doc.id, input))) return void (await this.cleanup([dir]));
    const info = await this.validate(phone, input);
    if (!info) return void (await this.cleanup([dir]));

    const fileName = (doc.filename?.trim() || 'documento.pdf').slice(0, 200);
    const size = (await stat(input)).size;
    await this.d.sessions.create({ phone, fileName, fileSize: size, storageDir: dir });
    await this.d.graph.sendList(phone, actionMenu(this.d.copy, fileName, size, info.pages));
  }

  private async onChoice(phone: string, rawId: string) {
    const action = parseAction(rawId);
    const open = await this.d.sessions.findOpen(phone);
    if (!open) return void (await this.say(phone, t.sendPdfFirst));
    if (!action) return void (await this.d.graph.sendList(phone, actionMenu(this.d.copy, open.file_name, Number(open.file_size ?? 0), 0)));

    if (action === 'protect') {
      await this.d.sessions.update(open.id, { action_requested: 'protect', step: 'AWAIT_PASSWORD', extendTtl: true });
      return void (await this.say(phone, t.askPassword));
    }
    if (action === 'merge') {
      await this.d.sessions.update(open.id, { action_requested: 'merge', step: 'AWAIT_SECOND_PDF', extendTtl: true });
      return void (await this.say(phone, t.askSecondPdf));
    }
    return this.process(open, action);
  }

  private async onPassword(open: WaSession, raw: string) {
    // La contraseña solo vive en memoria durante el cifrado: no se guarda ni se registra.
    const password = raw.replace(/^\s+|\s+$/g, '');
    if (password.length < 4 || password.length > 64 || /[\r\n]/.test(password)) {
      return void (await this.say(open.phone_number, t.badPassword));
    }
    return this.process(open, 'protect', password);
  }

  private async process(session: WaSession, action: Action, password?: string) {
    const phone = session.phone_number;
    const dir = session.storage_dir!;
    const input = join(dir, 'input.pdf');
    const base = safeBaseName(session.file_name);
    const started = performance.now();
    let sizeIn = Number(session.file_size ?? 0);

    await this.d.sessions.update(session.id, { action_requested: action, status: 'PROCESSING' });
    await this.say(phone, t.working(action)).catch(() => {});

    try {
      const { out, caption } = await this.d.limit(async () => {
        switch (action) {
          case 'compress': {
            const r = await this.d.engine.compress(input, dir, base);
            return { out: r as Output, caption: t.caption.compress(r.sizeIn, r.size, r.note === 'already_optimized') };
          }
          case 'protect': {
            const r = await this.d.engine.protect(input, join(dir, 'protegido.pdf'), password ?? '', base);
            return { out: r, caption: t.caption.protect };
          }
          case 'word': {
            const r = await this.d.engine.toWord(input, join(dir, 'documento.docx'), base);
            return { out: r as Output, caption: t.caption.word(r.paragraphs) };
          }
          case 'merge': {
            const second = join(dir, 'second.pdf');
            sizeIn += (await stat(second)).size;
            const r = await this.d.engine.merge([input, second], join(dir, 'unido.pdf'), base);
            return { out: r as Output, caption: t.caption.merge(r.pages) };
          }
        }
      });

      const mediaId = await this.d.graph.uploadMedia(out.path, out.mime, out.fileName);
      await this.d.graph.sendDocument(phone, mediaId, out.fileName, caption + t.footerMore(this.d.copy));
      await this.d.sessions.update(session.id, { status: 'DELIVERED', step: 'DONE' });
      await this.d.subscriptions.consume(phone);
      await this.d.jobs.record({
        action: jobAction(action), channel: 'whatsapp', fileSizeIn: sizeIn, fileSizeOut: out.size,
        processingTimeMs: performance.now() - started,
      });
      this.d.log.info({ session: session.id, action, sizeIn, sizeOut: out.size, ms: Math.round(performance.now() - started) }, 'documento entregado');
    } catch (err) {
      const code = err instanceof EngineError ? err.code : 'failed';
      if (!(err instanceof EngineError)) this.d.log.error({ err, session: session.id, action }, 'error al procesar');
      if (code === 'bad_password') {
        await this.d.sessions.update(session.id, { status: 'RECEIVED' });
        return void (await this.say(phone, t.badPassword));
      }
      await this.d.sessions.update(session.id, { status: 'FAILED', step: 'DONE', error_code: code });
      await this.d.jobs.record({
        action: jobAction(action), channel: 'whatsapp', fileSizeIn: sizeIn, status: 'failed', errorCode: code,
        processingTimeMs: performance.now() - started,
      }).catch(() => {});
      await this.say(phone, this.errorText(code)).catch(() => {});
      return;
    } finally {
      // bad_password deja la sesión abierta para reintentar; en los demás casos se borra todo.
      const s = await this.d.sessions.findOpen(phone);
      if (s?.id !== session.id) await this.cleanup([dir]);
    }
  }

  private errorText(code: string): string {
    const e = t.errors;
    switch (code) {
      case 'password': return e.password;
      case 'not_pdf': return e.not_pdf;
      case 'damaged': return e.damaged;
      case 'no_text': return e.no_text(this.d.copy);
      case 'timeout': return e.timeout;
      case 'too_big': return e.too_big(Math.round(this.d.maxBytes / 1024 / 1024));
      default: return e.failed;
    }
  }

  // Descarga el archivo de Meta. Devuelve false (y avisa al cliente) si no se pudo.
  private async download(phone: string, mediaId: string, dest: string): Promise<boolean> {
    try {
      const info = await this.d.graph.getMediaInfo(mediaId);
      await this.d.graph.downloadMedia(info, dest, this.d.maxBytes);
      return true;
    } catch (err) {
      if (err instanceof MediaTooLargeError) {
        await this.say(phone, this.errorText('too_big'));
      } else {
        this.d.log.warn({ err: err instanceof GraphError ? { status: err.status, code: err.code, msg: err.message } : err }, 'descarga fallida');
        await this.say(phone, t.errors.download);
      }
      return false;
    }
  }

  // Valida que sea un PDF que podamos abrir. Devuelve la info o null (y avisa).
  private async validate(phone: string, file: string) {
    try {
      const info = await this.d.engine.inspect(file);
      if (info.encryption === 'password') throw new EngineError('password');
      return info;
    } catch (err) {
      const code = err instanceof EngineError ? err.code : 'failed';
      if (!(err instanceof EngineError)) this.d.log.error({ err }, 'error al validar PDF');
      await this.say(phone, this.errorText(code));
      return null;
    }
  }

  private async cleanup(dirs: string[]) {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

const jobAction = (a: Action) => ({ compress: 'comprimir', protect: 'proteger', word: 'pdf-a-word', merge: 'unir' })[a];
