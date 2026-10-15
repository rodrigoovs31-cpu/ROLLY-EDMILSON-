// Configuración de tu marca.
// Cambia estos valores y guarda: la web los toma automáticamente.
// (Si cambias "name" o "url", vuelve a generar las páginas con: npm run build)

export const SITE = {
  name: 'Maus',
  tagline: 'Herramientas PDF gratis en español',

  // Dominio final de la web, sin barra al final. Ej: 'https://maus.pe'
  // Se usa para SEO (sitemap.xml y enlaces canónicos).
  url: '',

  // Tu WhatsApp con código de país, solo números. Ej: '51987654321'
  // Si lo dejas vacío, los botones de WhatsApp no se muestran.
  whatsapp: '',

  // Correo de contacto que se muestra en la web (opcional).
  email: '',

  // Plan Pro
  currency: 'S/',
  proPrice: '9.90',
  proPeriod: 'mes',
  paymentMethods: ['Yape', 'Plin', 'Transferencia bancaria'],

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
