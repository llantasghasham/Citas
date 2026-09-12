-- Los actos: un evento deja de ser una fecha y pasa a ser un contenedor.
--
-- Una boda libanesa puede ser compromiso, fiesta familiar, henna, preparación,
-- zaffe, ceremonia, cena y despedida, repartidos en varios días, en sedes
-- distintas y CON GENTE DISTINTA en cada uno. Con una sola fecha, una sola sede
-- y una sola respuesta por invitado eso no se puede representar: lo que hacía
-- falta no era otra plantilla, era esto.
--
-- Nada se rompe al aplicarla. Cada evento que ya existe recibe un acto PRINCIPAL
-- con su fecha, su hora, su zona y su sede; un grupo «todos» con todos sus
-- invitados dentro; y la regla que deja pasar a ese grupo a ese acto. Sus
-- respuestas se copian a la tabla por acto. Un evento de ayer se comporta hoy
-- igual que ayer, y ya está listo para tener un segundo acto mañana.

CREATE TYPE "ActType" AS ENUM (
  'engagement', 'family_party', 'henna', 'preparation', 'zaffe',
  'ceremony', 'dinner', 'reception', 'farewell', 'other'
);
CREATE TYPE "ActVisibility" AS ENUM ('public', 'segmented');
CREATE TYPE "AudienceMode" AS ENUM ('allow', 'deny');

CREATE TABLE "EventAct" (
    "id"           TEXT NOT NULL,
    "eventId"      TEXT NOT NULL,
    "type"         "ActType" NOT NULL DEFAULT 'other',
    "label"        TEXT,
    "order"        INTEGER NOT NULL DEFAULT 0,
    "date"         TEXT NOT NULL,
    "time"         TEXT NOT NULL,
    "endTime"      TEXT,
    "timezone"     TEXT NOT NULL,
    "venueName"    TEXT NOT NULL,
    "venueAddress" TEXT NOT NULL,
    "venueMapUrl"  TEXT NOT NULL,
    "venueLat"     DOUBLE PRECISION,
    "venueLng"     DOUBLE PRECISION,
    "capacity"     INTEGER,
    "optional"     BOOLEAN NOT NULL DEFAULT false,
    "rsvpEnabled"  BOOLEAN NOT NULL DEFAULT true,
    "rsvpDeadline" TIMESTAMP(3),
    "visibility"   "ActVisibility" NOT NULL DEFAULT 'segmented',
    "isMain"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventAct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventAct_id_eventId_key" ON "EventAct"("id", "eventId");
CREATE INDEX "EventAct_eventId_order_idx" ON "EventAct"("eventId", "order");
-- Un solo acto principal por evento, y lo impide la BASE: dos principales
-- serían dos «respuestas globales» distintas y nadie sabría cuál manda.
CREATE UNIQUE INDEX "EventAct_main_key" ON "EventAct"("eventId") WHERE "isMain";
ALTER TABLE "EventAct" ADD CONSTRAINT "EventAct_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActTranslation" (
    "id"           TEXT NOT NULL,
    "actId"        TEXT NOT NULL,
    "locale"       "Locale" NOT NULL,
    "label"        TEXT NOT NULL,
    "description"  TEXT,
    "venueName"    TEXT,
    "venueAddress" TEXT,
    CONSTRAINT "ActTranslation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActTranslation_actId_locale_key" ON "ActTranslation"("actId", "locale");
ALTER TABLE "ActTranslation" ADD CONSTRAINT "ActTranslation_actId_fkey"
    FOREIGN KEY ("actId") REFERENCES "EventAct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AudienceSegment" (
    "id"        TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudienceSegment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AudienceSegment_eventId_key_key" ON "AudienceSegment"("eventId", "key");
CREATE UNIQUE INDEX "AudienceSegment_id_eventId_key" ON "AudienceSegment"("id", "eventId");
ALTER TABLE "AudienceSegment" ADD CONSTRAINT "AudienceSegment_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `eventId` se repite en las tres tablas de abajo a propósito: es lo que ata las
-- DOS claves foráneas al mismo evento. Sin él, la base admitiría meter al
-- invitado de una boda en el grupo de otra, y lo único que lo impediría sería el
-- cuidado de quien escribe la consulta — que es justo lo que este proyecto no
-- acepta como garantía.
CREATE TABLE "GuestSegment" (
    "id"        TEXT NOT NULL,
    "guestId"   TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestSegment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuestSegment_guestId_segmentId_key" ON "GuestSegment"("guestId", "segmentId");
CREATE INDEX "GuestSegment_segmentId_idx" ON "GuestSegment"("segmentId");
ALTER TABLE "GuestSegment" ADD CONSTRAINT "GuestSegment_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestSegment" ADD CONSTRAINT "GuestSegment_segmentId_eventId_fkey"
    FOREIGN KEY ("segmentId", "eventId") REFERENCES "AudienceSegment"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActAudience" (
    "id"        TEXT NOT NULL,
    "actId"     TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "mode"      "AudienceMode" NOT NULL DEFAULT 'allow',
    CONSTRAINT "ActAudience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActAudience_actId_segmentId_key" ON "ActAudience"("actId", "segmentId");
CREATE INDEX "ActAudience_actId_idx" ON "ActAudience"("actId");
ALTER TABLE "ActAudience" ADD CONSTRAINT "ActAudience_actId_eventId_fkey"
    FOREIGN KEY ("actId", "eventId") REFERENCES "EventAct"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActAudience" ADD CONSTRAINT "ActAudience_segmentId_eventId_fkey"
    FOREIGN KEY ("segmentId", "eventId") REFERENCES "AudienceSegment"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuestActInvite" (
    "id"        TEXT NOT NULL,
    "guestId"   TEXT NOT NULL,
    "actId"     TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "maxParty"  INTEGER,
    "excluded"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestActInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuestActInvite_guestId_actId_key" ON "GuestActInvite"("guestId", "actId");
CREATE INDEX "GuestActInvite_actId_idx" ON "GuestActInvite"("actId");
ALTER TABLE "GuestActInvite" ADD CONSTRAINT "GuestActInvite_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestActInvite" ADD CONSTRAINT "GuestActInvite_actId_eventId_fkey"
    FOREIGN KEY ("actId", "eventId") REFERENCES "EventAct"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuestActRsvp" (
    "id"          TEXT NOT NULL,
    "guestId"     TEXT NOT NULL,
    "actId"       TEXT NOT NULL,
    "eventId"     TEXT NOT NULL,
    "status"      "RsvpStatus" NOT NULL,
    "party"       INTEGER NOT NULL DEFAULT 1,
    "message"     TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuestActRsvp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuestActRsvp_guestId_actId_key" ON "GuestActRsvp"("guestId", "actId");
CREATE INDEX "GuestActRsvp_actId_status_idx" ON "GuestActRsvp"("actId", "status");
ALTER TABLE "GuestActRsvp" ADD CONSTRAINT "GuestActRsvp_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestActRsvp" ADD CONSTRAINT "GuestActRsvp_actId_eventId_fkey"
    FOREIGN KEY ("actId", "eventId") REFERENCES "EventAct"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------ traslado
-- Cada evento que ya existe estrena su acto principal, con lo que el evento
-- traía dentro. El tipo sale del tipo de evento: una boda que solo tenía una
-- fecha era su recepción, y un memorial no se convierte en una celebración.
INSERT INTO "EventAct" (
    "id", "eventId", "type", "order", "date", "time", "timezone",
    "venueName", "venueAddress", "venueMapUrl", "venueLat", "venueLng",
    "rsvpEnabled", "rsvpDeadline", "visibility", "isMain", "updatedAt"
)
SELECT
    gen_random_uuid()::text, e."id",
    CASE WHEN e."type" = 'wedding' THEN 'reception'::"ActType" ELSE 'other'::"ActType" END,
    0, e."date", e."time", e."timezone",
    e."venueName", e."venueAddress", e."venueMapUrl", e."venueLat", e."venueLng",
    e."rsvpEnabled", e."rsvpDeadline",
    -- Lo que ya era público sigue siéndolo: esconderlo ahora rompería enlaces
    -- que están repartidos por WhatsApp desde hace meses.
    'public'::"ActVisibility", true, now()
FROM "Event" e;

-- Un grupo con todos. Es lo que hace que el acto principal siga llegándole a
-- todo el mundo sin que nadie tenga que asignar a nadie.
INSERT INTO "AudienceSegment" ("id", "eventId", "key", "name")
SELECT gen_random_uuid()::text, e."id", 'todos', 'Todos'
FROM "Event" e;

INSERT INTO "GuestSegment" ("id", "guestId", "segmentId", "eventId")
SELECT gen_random_uuid()::text, g."id", s."id", g."eventId"
FROM "Guest" g
JOIN "AudienceSegment" s ON s."eventId" = g."eventId" AND s."key" = 'todos';

INSERT INTO "ActAudience" ("id", "actId", "segmentId", "eventId", "mode")
SELECT gen_random_uuid()::text, a."id", s."id", a."eventId", 'allow'::"AudienceMode"
FROM "EventAct" a
JOIN "AudienceSegment" s ON s."eventId" = a."eventId" AND s."key" = 'todos'
WHERE a."isMain";

-- Y lo que ya habían contestado. Sin esto, una boda de la semana que viene
-- perdería las doscientas confirmaciones que ya tenía.
INSERT INTO "GuestActRsvp" (
    "id", "guestId", "actId", "eventId", "status", "party", "message",
    "respondedAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text, r."guestId", a."id", g."eventId",
    r."status", r."party", r."message", r."respondedAt", r."updatedAt"
FROM "Rsvp" r
JOIN "Guest" g ON g."id" = r."guestId"
JOIN "EventAct" a ON a."eventId" = g."eventId" AND a."isMain";
