// Procesa en segundo plano los mensajes guardados por el webhook.
// Varias tareas en paralelo, pero nunca dos del mismo cliente a la vez (lo garantiza la base de datos).
import type { Logger } from '../lib/logger.js';
import type { EventsRepo } from '../repos/events.js';
import type { Conversation } from './conversation.js';
import { inboundMessage } from './types.js';

export class MessageQueue {
  private running = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private idle: Array<() => void> = [];

  constructor(
    private readonly events: EventsRepo,
    private readonly conversation: Conversation,
    private readonly log: Logger,
    private readonly concurrency: number,
    private readonly pollMs = 2000,
  ) {}

  start() {
    this.stopped = false;
    this.timer = setInterval(() => this.kick(), this.pollMs);
    this.timer.unref();
    this.kick();
  }

  // Despierta a los trabajadores (lo llama el webhook al guardar un mensaje).
  kick() {
    while (!this.stopped && this.running < this.concurrency) {
      this.running++;
      void this.loop().finally(() => {
        this.running--;
        if (this.running === 0) this.idle.splice(0).forEach((r) => r());
      });
    }
  }

  private async loop() {
    while (!this.stopped) {
      let event;
      try {
        event = await this.events.claimNext();
      } catch (err) {
        this.log.error({ err }, 'no se pudo leer la cola de mensajes');
        return;
      }
      if (!event) return;
      const parsed = inboundMessage.safeParse(event.payload);
      if (!parsed.success) {
        await this.events.finish(event.id, 'payload inválido');
        continue;
      }
      try {
        await this.conversation.handle(parsed.data);
        await this.events.finish(event.id);
      } catch (err) {
        this.log.error({ err, event: event.id }, 'error al atender un mensaje');
        await this.events.finish(event.id, err instanceof Error ? err.message.slice(0, 500) : 'error').catch(() => {});
      }
    }
  }

  // Para las pruebas y el apagado ordenado: espera a que termine lo que está en curso.
  drain(): Promise<void> {
    if (this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.drain();
  }
}
