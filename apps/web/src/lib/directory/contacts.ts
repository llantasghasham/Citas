import type { ContactChannel } from './categories';

/**
 * A dónde lleva cada canal de contacto.
 *
 * Un teléfono es `tel:`, un WhatsApp es `wa.me` —el mismo `wa.me` que usa el
 * envío invitado por invitado, por la misma razón: funciona siempre y no
 * necesita nada conectado— y las redes son la dirección de su perfil. Lo que
 * está GUARDADO es el identificador limpio, no una URL: así el día que
 * Instagram cambie la suya se cambia aquí y no en trescientas fichas.
 *
 * Devuelve `null` cuando el canal no lleva a ningún sitio: entonces se enseña el
 * valor como texto y no como un enlace roto.
 */
export function contactHref(channel: string, value: string): string | null {
  switch (channel as ContactChannel) {
    case 'phone':
      return `tel:${value}`;
    case 'whatsapp':
      // `wa.me` quiere el número sin el «+» ni separadores; lo guardado es E.164.
      return `https://wa.me/${value.replace(/\D/g, '')}`;
    case 'email':
      return `mailto:${value}`;
    case 'website':
      return /^https?:\/\//.test(value) ? value : `https://${value}`;
    case 'instagram':
      return `https://instagram.com/${value.replace(/^@/, '')}`;
    case 'facebook':
      return `https://facebook.com/${value.replace(/^@/, '')}`;
    case 'tiktok':
      return `https://tiktok.com/@${value.replace(/^@/, '')}`;
    default:
      return null;
  }
}
