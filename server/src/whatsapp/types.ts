// Estructura de los webhooks de WhatsApp Cloud API (solo lo que usamos).
// Se valida con zod: un payload inesperado se ignora en lugar de romper el servidor.
import { z } from 'zod';

const media = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
});

export const inboundMessage = z.object({
  from: z.string().regex(/^\d{6,15}$/),
  id: z.string().min(1).max(256),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  document: media.optional(),
  image: media.optional(),
  interactive: z.object({
    type: z.string(),
    list_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
    button_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
  }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
});
export type InboundMessage = z.infer<typeof inboundMessage>;

const status = z.object({
  id: z.string(),
  status: z.string(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

export const webhookBody = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string().optional(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({
        messaging_product: z.string().optional(),
        metadata: z.object({ phone_number_id: z.string(), display_phone_number: z.string().optional() }).optional(),
        contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
        messages: z.array(z.unknown()).optional(),
        statuses: z.array(status).optional(),
      }).passthrough(),
    })),
  })),
});
export type WebhookBody = z.infer<typeof webhookBody>;
