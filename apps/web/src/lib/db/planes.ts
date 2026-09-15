/**
 * QUÉ TABLA VIVE EN QUÉ PLANO. En un solo sitio, y cerrada.
 *
 * Esto existe por un fallo que se descubrió ejecutando `npm run db:split --
 * copiar` en producción por primera vez, y que era mucho peor que el error que
 * dio: la lista de tablas que se mudan a la base de cada oficina estaba escrita
 * a mano dentro del guion y se había quedado ATRÁS. Movía diez tablas. Faltaban
 * CATORCE, y no eran menores: los actos de una boda, sus traducciones, los
 * grupos de invitados, quién entra a cada acto, las respuestas por acto, las
 * entradas de la puerta, las preferencias de cocina y accesibilidad, las
 * campañas, a quién le llegó cada una, los permisos y las bajas.
 *
 * Es decir: se encendía la flota y una boda de varios días perdía los días. Sin
 * un error, porque copiar no falla por lo que no copia.
 *
 * La lista está ahora AQUÍ y no en el guion, y hay una prueba
 * (`tests/planes.test.ts`) que compara estas dos listas con los modelos que de
 * verdad hay en `schema.prisma` y falla si alguno no está en NINGUNA. Una tabla
 * nueva no se puede olvidar: el día que alguien la añada, la prueba se pone en
 * rojo y le obliga a decidir de qué lado cae. Es la misma idea que las áreas del
 * historial o las categorías del directorio, aplicada a lo que decide dónde
 * viven los datos de una boda.
 */

/**
 * Lo que se muda a la base de la OFICINA, **en este orden**.
 *
 * El orden es el de las claves foráneas y no es negociable: un invitado no se
 * puede escribir antes que su evento, una traducción antes que su acto, ni una
 * entrada de la puerta antes que el invitado que entró. Las mesas van antes que
 * los invitados porque un invitado sentado apunta a la suya.
 */
export const OFFICE_TABLES = [
  // El evento y su estructura
  'event',
  'eventAct',
  'actTranslation',
  'audienceSegment',
  'actAudience',

  // Lo que cuelga del evento
  'eventHost',
  'eventHonoree',
  'invitationVersion',
  'render',
  'table',

  // Las personas invitadas y todo lo suyo
  'guest',
  'guestSegment',
  'guestActInvite',
  'guestActRsvp',
  'rsvp',
  'guestPreference',
  'checkIn',
  'invitationVisit',

  // Permisos, campañas y envíos
  'consent',
  'optOut',
  'messageCampaign',
  'messageRecipient',
  'whatsappConnection',
  'whatsappMessage',
] as const;

export type OfficeTable = (typeof OFFICE_TABLES)[number];

/**
 * Lo que se queda en la base de CONTROL, la del arrendador.
 *
 * No se usa para copiar nada: está aquí para que la prueba pueda comprobar que
 * entre las dos listas están TODOS los modelos. Una tabla que no aparezca en
 * ninguna es una tabla sobre la que nadie decidió, y ese es exactamente el
 * fallo que esto viene a impedir.
 */
export const CONTROL_TABLES = [
  // El registro de oficinas y quién entra
  'tenant',
  'user',
  'membership',
  'session',
  'loginCode',

  // Lo que se sirve sin oficina: dicen en qué base seguir buscando
  'publicSlug',
  'guestToken',

  // El dinero de las oficinas al dueño
  'plan',
  'order',
  'payment',
  'paymentEvent',
  'subscription',
  'sinpeAccount',
  'sinpeMovement',

  // La instalación
  'setting',
  'auditLog',
  'brandAsset',

  // El directorio, entero: es global y se busca por región, no por oficina
  'provider',
  'providerTranslation',
  'providerContact',
  'providerMembership',
  'providerCategoryLink',
  'providerMedia',
  'providerReview',
  'providerReport',
  'publicListing',
  'publicListingProvider',
] as const;

/**
 * Cómo se encuentran las filas de UNA oficina en cada tabla que se muda.
 *
 * El camino es el que cada tabla TIENE, no el que parece: `ActAudience` lleva
 * `eventId` dentro pero NO tiene una relación llamada `event` —sus relaciones
 * son `act` y `segment`—, así que hay que llegar por el acto. Suponerlo no da
 * un resultado raro: da un error de Prisma a mitad del copiado, con unas tablas
 * ya escritas y otras no. `tests/planes-db.test.ts` ejecuta cada uno de estos
 * contra la base de verdad, que es lo único que lo comprueba.
 */
export function officeWhere(table: OfficeTable, tenantId: string): Record<string, unknown> {
  switch (table) {
    // Las que llevan la oficina dentro.
    case 'event':
    case 'consent':
    case 'optOut':
    case 'messageCampaign':
    case 'whatsappConnection':
    case 'whatsappMessage':
      return { tenantId };

    // Las que cuelgan del evento y saben llegar a él.
    case 'eventAct':
    case 'audienceSegment':
    case 'eventHost':
    case 'eventHonoree':
    case 'invitationVersion':
    case 'table':
    case 'guest':
    case 'invitationVisit':
      return { event: { tenantId } };

    // Las que cuelgan de un INVITADO. Llevan `eventId` en una clave compuesta,
    // pero su relación es con el invitado y no con el evento.
    case 'guestSegment':
    case 'guestActInvite':
    case 'guestActRsvp':
    case 'rsvp':
    case 'guestPreference':
    case 'checkIn':
    case 'messageRecipient':
      return { guest: { event: { tenantId } } };

    // Y las que cuelgan de un ACTO o de una VERSIÓN.
    case 'actAudience':
    case 'actTranslation':
      return { act: { event: { tenantId } } };
    case 'render':
      return { version: { event: { tenantId } } };
  }
}
