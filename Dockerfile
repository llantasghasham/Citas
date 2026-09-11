# Imagen de producción de la web.
#
# La decisión que manda sobre todas: el PNG de la invitación se genera
# fotografiando la página con Chromium, así que la imagen lo lleva instalado.
# Eso descarta desplegar en plataformas serverless puras.
FROM node:22-bookworm-slim

# Chromium y las fuentes que necesita para no dibujar cuadros vacíos.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     chromium ca-certificates fonts-liberation openssl \
  && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Solo la web y el paquete compartido: la app móvil no se despliega aquí y sus
# dependencias pesan cientos de megabytes.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --ignore-scripts --include-workspace-root \
      --workspace @citas/web --workspace @citas/core

COPY packages/core packages/core
COPY apps/web apps/web

RUN npm run db:generate --workspace @citas/web \
  && npm run build --workspace @citas/web

# No root, y no es una formalidad. Chromium se NIEGA a usar su recinto como
# root, así que arrancar la imagen como root obliga a quitárselo — una pared
# menos entre una página y la máquina. La unidad de systemd ya corre como `www`;
# este camino tenía que igualarla y no lo hacía.
#
# `node` es el usuario que ya trae la imagen base, con su uid 1000. La carpeta
# de trabajo pasa a ser suya para que Next pueda escribir su caché.
RUN chown -R node:node /app
USER node

EXPOSE 3000
# Las migraciones se aplican al arrancar: un despliegue nunca sirve una versión
# del código contra un esquema viejo.
CMD ["sh", "-c", "npm run db:deploy --workspace @citas/web && npm run start --workspace @citas/web"]
