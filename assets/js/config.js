// Configuración de tu marca.
// Cambia estos valores y guarda: la web los toma automáticamente.
// (Si cambias "name", vuelve a generar las páginas con: npm run build)
import { ENV } from './env.js';

export const SITE = {
  name: 'Maus',
  tagline: 'Herramientas PDF gratis en español',

  // Dominio final de la web (canónicas, sitemap y enlaces para compartir).
  // NO se escribe aquí: se define al publicar, así sirve para cualquier dominio:
  //   SITE_URL=https://tudominio.com npm run build
  url: ENV.siteUrl,

  // API del servidor (estadísticas anónimas de uso). Vacío en hosting estático.
  //   API_BASE=/api npm run build
  api: ENV.apiBase,

  // Tu WhatsApp con código de país, solo números. Ej: '51987654321'
  // Si lo dejas vacío, los botones de WhatsApp no se muestran.
  whatsapp: '',

  // Correo de contacto que se muestra en la web (opcional).
  email: '',

  // Plan Pro
  currency: 'S/',
  proPrice: '9',
  proPeriod: 'mes',
  teamPrice: '29',          // plan para estudios y empresas (hasta 5 personas)
  servicePrice: '3',        // "Te lo hacemos": precio desde, por documento
  paymentMethods: ['Yape', 'Plin', 'Transferencia bancaria'],

  // Cobros. Solo se muestran los que llenes.
  payments: {
    yape: '',               // número de Yape, solo números. Ej: '987654321'
    yapeName: '',           // nombre que aparece en Yape (para que el cliente confirme a quién paga)
    cardLink: '',           // link de pago con tarjeta (Izipay o Mercado Pago). Ej: 'https://...'
  },

  // Códigos Pro. La llave pública la crea admin.html (en tu celular). Mientras esté vacía,
  // todas las funciones Pro quedan abiertas para todos.
  pro: {
    publicKey: '',
    // Funciones exclusivas de Pro
    features: ['firma-digital', 'flujos'],
    // Límites del plan gratis
    freeLimits: { files: 20, ocrPages: 10 },
  },

  // true = las librerías pesadas se descargan gratis desde jsDelivr (CDN) y casi no
  // gastan el ancho de banda de tu hosting. Si jsDelivr falla, se usa la carpeta vendor/.
  // false = todo se sirve desde tu propio hosting.
  useCdn: true,

  // Redes sociales (opcional): enlaces completos.
  social: {
    facebook: '',
    instagram: '',
    tiktok: '',
  },
};

export function whatsappLink(message) {
  if (!SITE.whatsapp) return '';
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(message)}`;
}
