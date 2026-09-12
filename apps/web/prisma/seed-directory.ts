import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Las fichas de EJEMPLO del directorio.
 *
 * Existen por lo mismo que existen `ejemplo-ar` y las demás invitaciones de
 * muestra: un directorio vacío no se puede enseñar, no se puede probar y no se
 * puede vender. Quien abre `/d/ar` tiene que ver qué forma tiene una ficha antes
 * de decidir pagar por la suya.
 *
 * Y como se sirven en la calle, se marcan como lo que son:
 *
 *   - El nombre lleva «(ejemplo)» en su idioma. No una letra pequeña abajo: el
 *     nombre, que es lo único que se lee en un listado.
 *   - NINGÚN contacto es público. Es la parte que de verdad importa: una ficha
 *     inventada con un teléfono dentro es alguien recibiendo llamadas para una
 *     boda que no organiza. Sin `isPublic`, la ficha no enseña ni un número.
 *   - La dirección es la de la región, no una calle. No hay mapa.
 *
 * Se borran solas el día que sobren: `npm run db:seed` no las toca si ya están,
 * y quitarlas es borrar las diez filas cuyo slug empieza por `ejemplo-`.
 */

interface EjemploTraduccion {
  name: string;
  tagline: string;
  services: string[];
}

interface Ejemplo {
  slug: string;
  legalName: string;
  governorate:
    | 'beirut'
    | 'mount_lebanon'
    | 'north'
    | 'akkar'
    | 'bekaa'
    | 'baalbek_hermel'
    | 'south'
    | 'nabatieh';
  district: string;
  city: string;
  categories: string[];
  capacity?: number;
  since?: number;
  /** La traducción por idioma. El árabe es el principal y nunca falta. */
  t: Record<'ar' | 'en' | 'fr' | 'es' | 'pt', EjemploTraduccion>;
}

/** Lo que dice la etiqueta, en cada idioma. */
const MARCA = { ar: '(مثال)', en: '(example)', fr: '(exemple)', es: '(ejemplo)', pt: '(exemplo)' };

function ficha(
  base: Omit<Ejemplo, 't'>,
  textos: Record<'ar' | 'en' | 'fr' | 'es' | 'pt', EjemploTraduccion>,
): Ejemplo {
  return { ...base, t: textos };
}

const EJEMPLOS: Ejemplo[] = [
  ficha(
    {
      slug: 'ejemplo-salon-jbeil',
      legalName: 'EJEMPLO — salón de bodas (Jbeil)',
      governorate: 'mount_lebanon',
      district: 'jbeil',
      city: 'Jbeil',
      categories: ['wedding_hall', 'party_hall'],
      capacity: 400,
      since: 2009,
    },
    {
      ar: {
        name: `قاعة أفراح ${MARCA.ar}`,
        tagline: 'قاعة تتسع لأربعمئة شخص، مع موقف سيارات وحديقة.',
        services: ['قاعة مكيّفة', 'موقف سيارات', 'حديقة للتصوير', 'إضاءة ومسرح'],
      },
      en: {
        name: `Wedding hall ${MARCA.en}`,
        tagline: 'A hall for four hundred, with parking and a garden.',
        services: ['Air-conditioned hall', 'Parking', 'Garden for photos', 'Lighting and stage'],
      },
      fr: {
        name: `Salle de mariage ${MARCA.fr}`,
        tagline: 'Une salle pour quatre cents personnes, avec parking et jardin.',
        services: ['Salle climatisée', 'Parking', 'Jardin pour les photos', 'Éclairage et scène'],
      },
      es: {
        name: `Salón de bodas ${MARCA.es}`,
        tagline: 'Un salón para cuatrocientas personas, con aparcamiento y jardín.',
        services: ['Salón climatizado', 'Aparcamiento', 'Jardín para las fotos', 'Luces y escenario'],
      },
      pt: {
        name: `Salão de casamentos ${MARCA.pt}`,
        tagline: 'Um salão para quatrocentas pessoas, com estacionamento e jardim.',
        services: ['Salão climatizado', 'Estacionamento', 'Jardim para as fotos', 'Luz e palco'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-restaurante-baabda',
      legalName: 'EJEMPLO — restaurante con cocina propia (Baabda)',
      governorate: 'mount_lebanon',
      district: 'baabda',
      city: 'Baabda',
      categories: ['restaurant', 'catering'],
      capacity: 120,
    },
    {
      ar: {
        name: `مطعم يحضّر الطعام ${MARCA.ar}`,
        tagline: 'مطبخ لبناني، في المطعم أو في مكان الحفل.',
        services: ['مقبّلات ومشاوي', 'خدمة في مكان الحفل', 'طعام نباتي'],
      },
      en: {
        name: `Restaurant and kitchen ${MARCA.en}`,
        tagline: 'Lebanese cooking, at the restaurant or at your venue.',
        services: ['Mezze and grills', 'Service at your venue', 'Vegetarian menu'],
      },
      fr: {
        name: `Restaurant et cuisine ${MARCA.fr}`,
        tagline: 'Cuisine libanaise, au restaurant ou sur le lieu de la fête.',
        services: ['Mezzés et grillades', 'Service sur place', 'Menu végétarien'],
      },
      es: {
        name: `Restaurante que prepara la comida ${MARCA.es}`,
        tagline: 'Cocina libanesa, en el restaurante o en el lugar de la fiesta.',
        services: ['Mezze y parrilla', 'Servicio en el salón', 'Menú vegetariano'],
      },
      pt: {
        name: `Restaurante que prepara a comida ${MARCA.pt}`,
        tagline: 'Cozinha libanesa, no restaurante ou no local da festa.',
        services: ['Mezze e grelhados', 'Serviço no local', 'Menu vegetariano'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-queque-keserwan',
      legalName: 'EJEMPLO — pastelería (Keserwan)',
      governorate: 'mount_lebanon',
      district: 'keserwan',
      city: 'Jounieh',
      categories: ['cake', 'dessert'],
    },
    {
      ar: {
        name: `حلويات وكعك الأعراس ${MARCA.ar}`,
        tagline: 'كعكة العرس، والبقلاوة، وحلويات الضيوف.',
        services: ['كعكة أعراس', 'بقلاوة', 'علب للضيوف'],
      },
      en: {
        name: `Wedding cakes and sweets ${MARCA.en}`,
        tagline: 'The cake, the baklava, and boxes for the guests.',
        services: ['Wedding cake', 'Baklava', 'Guest boxes'],
      },
      fr: {
        name: `Gâteaux de mariage ${MARCA.fr}`,
        tagline: 'Le gâteau, les baklavas et les boîtes pour les invités.',
        services: ['Gâteau de mariage', 'Baklava', 'Boîtes pour les invités'],
      },
      es: {
        name: `Venta de queque y dulces ${MARCA.es}`,
        tagline: 'La tarta de la boda, la baklava y las cajas para los invitados.',
        services: ['Tarta de boda', 'Baklava', 'Cajas para los invitados'],
      },
      pt: {
        name: `Venda de bolo e doces ${MARCA.pt}`,
        tagline: 'O bolo do casamento, a baklava e as caixas para os convidados.',
        services: ['Bolo de casamento', 'Baklava', 'Caixas para os convidados'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-dj-beirut',
      legalName: 'EJEMPLO — DJ (Beirut)',
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      categories: ['dj', 'sound_system'],
    },
    {
      ar: {
        name: `دي جي للأعراس ${MARCA.ar}`,
        tagline: 'موسيقى عربية وأجنبية، مع الصوت والإضاءة.',
        services: ['سهرة كاملة', 'صوت وإضاءة', 'زفّة'],
      },
      en: {
        name: `Wedding DJ ${MARCA.en}`,
        tagline: 'Arabic and international music, sound and lights included.',
        services: ['Full evening', 'Sound and lights', 'Zaffe entrance'],
      },
      fr: {
        name: `DJ de mariage ${MARCA.fr}`,
        tagline: 'Musique arabe et internationale, son et lumière compris.',
        services: ['Soirée complète', 'Son et lumière', 'Entrée zaffé'],
      },
      es: {
        name: `DJ para bodas ${MARCA.es}`,
        tagline: 'Música árabe e internacional, con sonido y luces.',
        services: ['Noche completa', 'Sonido y luces', 'Entrada zaffe'],
      },
      pt: {
        name: `DJ para casamentos ${MARCA.pt}`,
        tagline: 'Música árabe e internacional, com som e luzes.',
        services: ['Noite completa', 'Som e luzes', 'Entrada zaffe'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-cantante-zahle',
      legalName: 'EJEMPLO — cantante (Zahlé)',
      governorate: 'bekaa',
      district: 'zahle',
      city: 'Zahlé',
      categories: ['singer', 'band'],
    },
    {
      ar: {
        name: `مطرب وفرقة ${MARCA.ar}`,
        tagline: 'طرب وأغانٍ لبنانية، مع فرقة أو من دونها.',
        services: ['مطرب', 'فرقة كاملة', 'دبكة'],
      },
      en: {
        name: `Singer and band ${MARCA.en}`,
        tagline: 'Lebanese songs, with a band or on his own.',
        services: ['Singer', 'Full band', 'Dabke'],
      },
      fr: {
        name: `Chanteur et orchestre ${MARCA.fr}`,
        tagline: 'Chansons libanaises, avec ou sans orchestre.',
        services: ['Chanteur', 'Orchestre complet', 'Dabké'],
      },
      es: {
        name: `Cantante y grupo ${MARCA.es}`,
        tagline: 'Canción libanesa, con grupo o sin él.',
        services: ['Cantante', 'Grupo completo', 'Dabke'],
      },
      pt: {
        name: `Cantor e grupo ${MARCA.pt}`,
        tagline: 'Canção libanesa, com grupo ou sem ele.',
        services: ['Cantor', 'Grupo completo', 'Dabke'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-mesas-matn',
      legalName: 'EJEMPLO — alquiler de mesas y sillas (Matn)',
      governorate: 'mount_lebanon',
      district: 'matn',
      city: 'Bikfaya',
      categories: ['tables_chairs', 'tents', 'dishes'],
    },
    {
      ar: {
        name: `تأجير طاولات وكراسي ${MARCA.ar}`,
        tagline: 'طاولات وكراسي وخيم وصحون، مع التركيب.',
        services: ['طاولات وكراسي', 'خيمة', 'صحون وكؤوس', 'تركيب وفكّ'],
      },
      en: {
        name: `Table and chair rental ${MARCA.en}`,
        tagline: 'Tables, chairs, tents and dishes, set up and taken down.',
        services: ['Tables and chairs', 'Tent', 'Dishes and glasses', 'Setup and takedown'],
      },
      fr: {
        name: `Location de tables et chaises ${MARCA.fr}`,
        tagline: 'Tables, chaises, tentes et vaisselle, montage compris.',
        services: ['Tables et chaises', 'Tente', 'Vaisselle et verres', 'Montage et démontage'],
      },
      es: {
        name: `Alquiler de mesas y sillas ${MARCA.es}`,
        tagline: 'Mesas, sillas, carpas y vajilla, con montaje.',
        services: ['Mesas y sillas', 'Carpa', 'Vajilla y cristalería', 'Montaje y desmontaje'],
      },
      pt: {
        name: `Aluguer de mesas e cadeiras ${MARCA.pt}`,
        tagline: 'Mesas, cadeiras, tendas e louça, com montagem.',
        services: ['Mesas e cadeiras', 'Tenda', 'Louça e copos', 'Montagem e desmontagem'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-flores-tripoli',
      legalName: 'EJEMPLO — flores (Trípoli)',
      governorate: 'north',
      district: 'tripoli',
      city: 'Tripoli',
      categories: ['flowers', 'wedding_decoration'],
    },
    {
      ar: {
        name: `زهور وتزيين ${MARCA.ar}`,
        tagline: 'باقة العروس، وتزيين القاعة والمدخل.',
        services: ['باقة العروس', 'تزيين الطاولات', 'تزيين المدخل'],
      },
      en: {
        name: `Flowers and decoration ${MARCA.en}`,
        tagline: "The bride's bouquet, the hall and the entrance.",
        services: ['Bridal bouquet', 'Table decoration', 'Entrance decoration'],
      },
      fr: {
        name: `Fleurs et décoration ${MARCA.fr}`,
        tagline: 'Le bouquet de la mariée, la salle et l’entrée.',
        services: ['Bouquet de la mariée', 'Décoration des tables', 'Décoration de l’entrée'],
      },
      es: {
        name: `Flores y decoración ${MARCA.es}`,
        tagline: 'El ramo de la novia, el salón y la entrada.',
        services: ['Ramo de la novia', 'Decoración de mesas', 'Decoración de la entrada'],
      },
      pt: {
        name: `Flores e decoração ${MARCA.pt}`,
        tagline: 'O ramo da noiva, o salão e a entrada.',
        services: ['Ramo da noiva', 'Decoração das mesas', 'Decoração da entrada'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-organizador-beirut',
      legalName: 'EJEMPLO — organización de bodas (Beirut)',
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      categories: ['wedding_planner', 'event_planner'],
    },
    {
      ar: {
        name: `تنظيم أعراس وحفلات ${MARCA.ar}`,
        tagline: 'من اختيار القاعة إلى آخر ضيف.',
        services: ['تنظيم كامل', 'تنسيق يوم العرس', 'ميزانية ومتابعة'],
      },
      en: {
        name: `Wedding and party planning ${MARCA.en}`,
        tagline: 'From choosing the hall to the last guest home.',
        services: ['Full planning', 'Day-of coordination', 'Budget and follow-up'],
      },
      fr: {
        name: `Organisation de mariages ${MARCA.fr}`,
        tagline: 'Du choix de la salle au dernier invité.',
        services: ['Organisation complète', 'Coordination le jour J', 'Budget et suivi'],
      },
      es: {
        name: `Organización de bodas y fiestas ${MARCA.es}`,
        tagline: 'Desde elegir el salón hasta el último invitado.',
        services: ['Organización completa', 'Coordinación el día de la boda', 'Presupuesto y seguimiento'],
      },
      pt: {
        name: `Organização de casamentos e festas ${MARCA.pt}`,
        tagline: 'Desde escolher o salão até ao último convidado.',
        services: ['Organização completa', 'Coordenação no dia', 'Orçamento e acompanhamento'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-video-nabatieh',
      legalName: 'EJEMPLO — vídeo y fotografía (Nabatieh)',
      governorate: 'nabatieh',
      district: 'nabatieh',
      city: 'Nabatieh',
      categories: ['videographer', 'photographer', 'drone_video'],
    },
    {
      ar: {
        name: `تصوير فيديو وصور ${MARCA.ar}`,
        tagline: 'فيديو العرس، والصور، وتصوير من الجو.',
        services: ['فيديو كامل', 'صور', 'تصوير بطائرة', 'ألبوم مطبوع'],
      },
      en: {
        name: `Video and photography ${MARCA.en}`,
        tagline: 'The wedding film, the photographs, and drone footage.',
        services: ['Full film', 'Photographs', 'Drone footage', 'Printed album'],
      },
      fr: {
        name: `Vidéo et photographie ${MARCA.fr}`,
        tagline: 'Le film du mariage, les photos et les vues par drone.',
        services: ['Film complet', 'Photos', 'Prises de vue par drone', 'Album imprimé'],
      },
      es: {
        name: `Grabación de vídeo y fotografía ${MARCA.es}`,
        tagline: 'El vídeo de la boda, las fotos y las tomas con dron.',
        services: ['Vídeo completo', 'Fotos', 'Tomas con dron', 'Álbum impreso'],
      },
      pt: {
        name: `Gravação de vídeo e fotografia ${MARCA.pt}`,
        tagline: 'O vídeo do casamento, as fotos e as imagens com drone.',
        services: ['Vídeo completo', 'Fotos', 'Imagens com drone', 'Álbum impresso'],
      },
    },
  ),

  ficha(
    {
      slug: 'ejemplo-comida-saida',
      legalName: 'EJEMPLO — catering (Saida)',
      governorate: 'south',
      district: 'sidon',
      city: 'Saida',
      categories: ['catering', 'traditional_food'],
      capacity: 600,
    },
    {
      ar: {
        name: `تقديم طعام للأعراس ${MARCA.ar}`,
        tagline: 'مأكولات لبنانية لستمئة ضيف، في أي قاعة.',
        services: ['بوفيه مفتوح', 'خدمة على الطاولات', 'مناقيش وفطور'],
      },
      en: {
        name: `Wedding catering ${MARCA.en}`,
        tagline: 'Lebanese food for six hundred, in any hall.',
        services: ['Open buffet', 'Table service', 'Manakish and breakfast'],
      },
      fr: {
        name: `Traiteur de mariage ${MARCA.fr}`,
        tagline: 'Cuisine libanaise pour six cents personnes, dans n’importe quelle salle.',
        services: ['Buffet', 'Service à table', 'Manakiche et petit-déjeuner'],
      },
      es: {
        name: `Catering para bodas ${MARCA.es}`,
        tagline: 'Comida libanesa para seiscientos invitados, en cualquier salón.',
        services: ['Bufé libre', 'Servicio en mesa', 'Manakish y desayuno'],
      },
      pt: {
        name: `Catering para casamentos ${MARCA.pt}`,
        tagline: 'Comida libanesa para seiscentos convidados, em qualquer salão.',
        services: ['Bufê', 'Serviço à mesa', 'Manakish e pequeno-almoço'],
      },
    },
  ),
];

/**
 * Escribe las fichas de ejemplo. Idempotente: las reescribe enteras cada vez,
 * así que corregir una frase aquí y volver a sembrar la corrige allí.
 */
export async function seedDirectoryExamples(prisma: PrismaClient): Promise<number> {
  for (const ejemplo of EJEMPLOS) {
    const provider = await prisma.provider.upsert({
      where: { slug: ejemplo.slug },
      update: {
        legalName: ejemplo.legalName,
        status: 'approved',
        governorate: ejemplo.governorate,
        district: ejemplo.district,
        city: ejemplo.city,
        capacity: ejemplo.capacity ?? null,
        since: ejemplo.since ?? null,
        mainLocale: 'ar',
      },
      create: {
        slug: ejemplo.slug,
        legalName: ejemplo.legalName,
        status: 'approved',
        submittedAt: new Date(),
        reviewedAt: new Date(),
        publishedAt: new Date(),
        governorate: ejemplo.governorate,
        district: ejemplo.district,
        city: ejemplo.city,
        capacity: ejemplo.capacity ?? null,
        since: ejemplo.since ?? null,
        mainLocale: 'ar',
      },
      select: { id: true },
    });

    // Se reemplazan enteras en vez de añadirse, por lo mismo que el formulario
    // de los grupos de invitados: lo que llega es la lista completa, y lo que
    // falta es lo que hay que quitar.
    await prisma.providerTranslation.deleteMany({ where: { providerId: provider.id } });
    await prisma.providerTranslation.createMany({
      data: Object.entries(ejemplo.t).map(([locale, texto]) => ({
        providerId: provider.id,
        locale,
        name: texto.name,
        tagline: texto.tagline,
        description: texto.tagline,
        services: texto.services,
      })),
    });

    await prisma.providerCategoryLink.deleteMany({ where: { providerId: provider.id } });
    await prisma.providerCategoryLink.createMany({
      data: ejemplo.categories.map((category, index) => ({
        providerId: provider.id,
        category,
        isPrimary: index === 0,
      })),
    });
  }

  return EJEMPLOS.length;
}
