/**
 * Las categorías del directorio y las regiones del Líbano.
 *
 * Listas CERRADAS en código, como las claves de las preferencias y como los
 * versículos, y por la misma razón: lo que se guarda es un código y lo que lee
 * una persona lo pone el diccionario en su idioma. Si fueran filas que cualquiera
 * añade, en un mes habría «fotografo», «Fotógrafo», «FOTOGRAFIA» y «photo», y el
 * buscador no encontraría a nadie.
 *
 * Añadir una es una decisión de producto: se escribe aquí, se traduce en los
 * cinco idiomas del portal y se despliega.
 */

export const CATEGORY_GROUPS = {
  venue: ['wedding_hall', 'party_hall', 'restaurant', 'hotel', 'farm', 'outdoor_venue'],
  food: ['catering', 'traditional_food', 'dessert', 'cake', 'baklava', 'coffee_and_sweets'],
  music: ['dj', 'singer', 'band', 'musician', 'traditional_music', 'dabke_group', 'mc'],
  decor: ['flowers', 'wedding_decoration', 'lighting', 'stage', 'entrance_decoration', 'table_decoration'],
  rental: ['tables_chairs', 'tents', 'dishes', 'sound_system', 'lighting_equipment', 'generator', 'transportation'],
  media: ['photographer', 'videographer', 'drone_video', 'live_streaming', 'photo_booth', 'album_printing'],
  services: [
    'wedding_planner',
    'event_planner',
    'bridal_stylist',
    'makeup_artist',
    'hairdresser',
    'dress_shop',
    'suit_shop',
    'jewelry',
    'invitation_designer',
    'printing',
    'security',
    'cleaning',
  ],
} as const;

export type CategoryGroup = keyof typeof CATEGORY_GROUPS;

export const CATEGORIES = Object.values(CATEGORY_GROUPS).flat();
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function groupOf(category: Category): CategoryGroup {
  for (const [group, list] of Object.entries(CATEGORY_GROUPS)) {
    if ((list as readonly string[]).includes(category)) return group as CategoryGroup;
  }
  throw new Error(`Categoría sin grupo: ${category}`);
}

/** Cuántas puede tener un proveedor en la Fase 1. Una de ellas, la principal. */
export const MAX_CATEGORIES = 3;

/**
 * Las ocho gobernaciones y sus distritos.
 *
 * No es un «cantón» de texto libre: un directorio que se busca por región no
 * funciona si cada uno escribe su zona como quiere. Los nombres que lee una
 * persona salen del diccionario; aquí solo están las claves.
 *
 * La CIUDAD sí es texto, y es la línea correcta: son cientos, cambian, y nadie
 * va a mantener una lista de los pueblos del Líbano dentro del código.
 */
export const GOVERNORATES = {
  beirut: ['beirut'],
  mount_lebanon: ['aley', 'baabda', 'chouf', 'jbeil', 'keserwan', 'matn'],
  north: ['batroun', 'bcharre', 'koura', 'miniyeh_danniyeh', 'tripoli', 'zgharta'],
  akkar: ['akkar'],
  bekaa: ['rachaya', 'western_bekaa', 'zahle'],
  baalbek_hermel: ['baalbek', 'hermel'],
  south: ['jezzine', 'sidon', 'tyre'],
  nabatieh: ['bint_jbeil', 'hasbaya', 'marjeyoun', 'nabatieh'],
} as const;

export type GovernorateKey = keyof typeof GOVERNORATES;

export const GOVERNORATE_KEYS = Object.keys(GOVERNORATES) as GovernorateKey[];

export function isGovernorate(value: string): value is GovernorateKey {
  return GOVERNORATE_KEYS.includes(value as GovernorateKey);
}

/** ¿Es este distrito de esta gobernación? Un distrito suelto no significa nada. */
export function isDistrictOf(governorate: GovernorateKey, district: string): boolean {
  return (GOVERNORATES[governorate] as readonly string[]).includes(district);
}

/** Los canales de contacto, cada uno con su propio interruptor de publicación. */
export const CONTACT_CHANNELS = [
  'phone',
  'whatsapp',
  'email',
  'website',
  'instagram',
  'facebook',
  'tiktok',
] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function isContactChannel(value: string): value is ContactChannel {
  return (CONTACT_CHANNELS as readonly string[]).includes(value);
}
