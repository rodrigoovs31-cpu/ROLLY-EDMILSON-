import { pino, type Logger } from 'pino';

// Nunca se registran tokens, contraseñas ni el contenido de los mensajes.
export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: { service: 'rolly_api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-hub-signature-256"]',
        '*.password',
        '*.access_token',
        '*.token',
      ],
      censor: '[oculto]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
  });
}

export type { Logger };
