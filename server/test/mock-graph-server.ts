// Servidor de la Graph API simulada (para probar la pila Docker completa sin Meta).
//   npx tsx test/mock-graph-server.ts 4545
import { writeFileSync } from 'node:fs';
import { startMockGraph } from './mock-graph.js';
import { photoPdf, textPdf } from './fixtures.js';

const port = Number(process.argv[2] ?? 4545);
const graph = await startMockGraph(process.env.META_ACCESS_TOKEN ?? 'test-access-token-123', process.env.PHONE_NUMBER_ID ?? '1234567890', port);
const photoId = graph.addMedia(await photoPdf(2));
const textId = graph.addMedia(await textPdf(3));
console.log(JSON.stringify({ base: graph.base, photoId, textId }));
setInterval(() => {
  writeFileSync(process.argv[3] ?? '/tmp/mock-graph.json', JSON.stringify({
    sent: graph.sent,
    uploads: [...graph.uploads.values()].map((u) => ({ id: u.id, fileName: u.fileName, mime: u.mime, size: u.bytes.length })),
  }, null, 1));
}, 500);
