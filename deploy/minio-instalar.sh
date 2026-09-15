#!/usr/bin/env bash
#
# Levanta el almacén de las fotos del directorio, en esta misma máquina.
#
#   sudo bash deploy/minio-instalar.sh
#
# QUÉ HACE, en orden, y todo es idempotente: ejecutarlo dos veces no rompe nada
# y no vuelve a generar credenciales.
#
#   1. Descarga MinIO y lo deja en /usr/local/bin.
#   2. Crea el usuario `minio` y /var/lib/minio, que no los tiene nadie más.
#   3. GENERA las credenciales aquí, con /dev/urandom. No salen de esta máquina
#      y no están escritas en ningún archivo del repositorio.
#   4. Arranca el servicio, SOLO en 127.0.0.1.
#   5. Crea el bucket.
#   6. CIFRA la secreta con la llave de la instalación y escribe las seis
#      variables en apps/web/.env, que ya está en 600.
#   7. Reinicia la web.
#
# LO QUE NO HACE, y hay que saberlo: respaldar. Las fotos quedan en
# /var/lib/minio y el respaldo de este proyecto solo copia PostgreSQL. Al final
# lo dice, con la línea que hay que añadir.
set -euo pipefail

DIR="${DIR:-/www/wwwroot/citas}"
ENV_FILE="$DIR/apps/web/.env"
BUCKET="${BUCKET:-citas-directorio}"
DATOS=/var/lib/minio/datos
ENTORNO=/etc/minio/entorno
PUERTO=9000

rojo() { printf '\033[31m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
paso() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rojo "Hay que ejecutarlo como root (sudo)."; exit 1; }
[ -f "$ENV_FILE" ] || { rojo "No encuentro $ENV_FILE. Ponga DIR=/ruta/a/citas."; exit 1; }

# ---------------------------------------------------------------- ya instalado
if grep -q '^STORAGE_ENDPOINT=' "$ENV_FILE"; then
  rojo "apps/web/.env ya tiene STORAGE_ENDPOINT."
  echo
  echo "  Este guion NO lo pisa: reescribir un almacén en uso deja las filas de"
  echo "  la base apuntando a objetos que están en el almacén anterior, y eso se"
  echo "  descubre como galerías rotas en la ficha de gente real."
  echo
  echo "  Para empezar de cero, quite a mano las seis líneas STORAGE_* y vuelva."
  exit 1
fi

# ------------------------------------------------------------------ el binario
paso "MinIO"
if [ -x /usr/local/bin/minio ]; then
  ok "ya estaba instalado"
else
  curl -fsSL -o /usr/local/bin/minio \
    https://dl.min.io/server/minio/release/linux-amd64/minio
  chmod 0755 /usr/local/bin/minio
  ok "descargado en /usr/local/bin/minio"
fi

# ------------------------------------------------------------- usuario y datos
paso "Usuario y carpeta"
if ! id minio >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/minio --shell /usr/sbin/nologin minio
fi
mkdir -p "$DATOS" /etc/minio
chown -R minio:minio /var/lib/minio
# La carpeta de datos NO la lee nadie más: son fotos de negocios reales.
chmod 0750 /var/lib/minio
ok "usuario minio y $DATOS"

# ------------------------------------------------------------------ credencial
paso "Credenciales"
if [ -f "$ENTORNO" ]; then
  ok "ya existían — no se regeneran"
  # shellcheck disable=SC1090
  . "$ENTORNO"
else
  # De /dev/urandom y de ninguna otra parte. Nunca una escrita en un ejemplo:
  # una credencial de ejemplo que alguien deja puesta es una puerta abierta.
  MINIO_ROOT_USER="citas$(head -c 12 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 12)"
  MINIO_ROOT_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  umask 077
  cat > "$ENTORNO" <<EOF
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
EOF
  chown root:minio "$ENTORNO"
  chmod 0640 "$ENTORNO"
  ok "generadas y guardadas en $ENTORNO (0640, no se muestran)"
fi

# -------------------------------------------------------------------- servicio
paso "Servicio"
install -m 0644 "$DIR/deploy/minio.service" /etc/systemd/system/minio.service
systemctl daemon-reload
systemctl enable --now minio >/dev/null 2>&1 || systemctl restart minio

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PUERTO/minio/health/live" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PUERTO/minio/health/live" >/dev/null 2>&1 \
  || { rojo "MinIO no responde. Mire: journalctl -u minio -n 50"; exit 1; }
ok "responde en 127.0.0.1:$PUERTO (y solo ahí)"

# ---------------------------------------------------------------------- bucket
paso "Bucket"
if [ -x /usr/local/bin/mc ]; then
  ok "mc ya estaba"
else
  curl -fsSL -o /usr/local/bin/mc \
    https://dl.min.io/client/mc/release/linux-amd64/mc
  chmod 0755 /usr/local/bin/mc
fi
export MC_HOST_citas="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@127.0.0.1:$PUERTO"
/usr/local/bin/mc mb --ignore-existing "citas/$BUCKET" >/dev/null
# PRIVADO, y se deja dicho: las fotos se sirven por `/api/d/media/<id>`, que
# comprueba que la imagen esté aprobada Y el negocio publicado. Un bucket
# público se saltaría las dos cosas — una foto retirada por una reclamación de
# derechos seguiría viéndose con su dirección directa.
/usr/local/bin/mc anonymous set none "citas/$BUCKET" >/dev/null 2>&1 || true
ok "bucket «$BUCKET», privado"

# ------------------------------------------------------------------ el fichero
paso "Configuración de la web"
KEY_FILE="$(grep -m1 '^CITAS_SECRET_KEY_FILE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[ -n "$KEY_FILE" ] || { rojo "No encuentro CITAS_SECRET_KEY_FILE en el .env."; exit 1; }
APP_USER="$(stat -c '%U' "$ENV_FILE")"

# La secreta se cifra con la MISMA llave que la del SMTP y la de Whish, y entra
# por la ENTRADA ESTÁNDAR: un secreto como argumento queda en la lista de
# procesos y en el historial del intérprete.
CIFRADA="$(printf %s "$MINIO_ROOT_PASSWORD" | sudo -u "$APP_USER" env \
  CITAS_SECRET_KEY_FILE="$KEY_FILE" \
  npm run secret:encrypt --workspace @citas/web --silent --prefix "$DIR")"

cat >> "$ENV_FILE" <<EOF

# Almacén de las fotos del directorio. Lo escribió deploy/minio-instalar.sh.
# La secreta va cifrada con CITAS_SECRET_KEY_FILE; en claro no se acepta en
# producción. El endpoint es el BUCLE LOCAL a propósito.
STORAGE_ENDPOINT=http://127.0.0.1:$PUERTO
STORAGE_REGION=us-east-1
STORAGE_BUCKET=$BUCKET
STORAGE_ACCESS_KEY_ID=$MINIO_ROOT_USER
STORAGE_SECRET_ACCESS_KEY_ENC=$CIFRADA
EOF
ok "seis variables escritas en apps/web/.env (la secreta, cifrada)"

paso "Reiniciando la web"
systemctl restart citas
ok "listo"

cat <<EOF

────────────────────────────────────────────────────────────
 El almacén está en marcha. Compruébelo en /panel/sistema:
 la fila «Almacén de fotos del directorio» tiene que ponerse
 en verde y decir el servidor y el bucket.

 FALTA UNA COSA, y no la puede hacer este guion:

 EL RESPALDO. Las fotos viven en $DATOS y
 el respaldo de este proyecto solo copia PostgreSQL. Añada
 esta carpeta a /usr/local/bin/backup-citas.sh, o al menos:

   tar -czf /respaldos/minio-\$(date +%F).tar.gz $DATOS

 Una boda sin sus fotos se arregla; el catálogo de
 doscientos proveedores, no.
────────────────────────────────────────────────────────────
EOF
