#!/usr/bin/env bash
#
# Levanta el almacén de las fotos del directorio con MinIO, en esta misma
# máquina.
#
#   sudo bash deploy/minio-instalar.sh
#
# ANTES DE USARLO: MinIO RETIRÓ el binario del servidor de la edición
# comunitaria. `dl.min.io` contesta 410 «Gone» tanto en la dirección de siempre
# como en la del archivo de una versión concreta, y la imagen de contenedor
# `minio/minio` dejó de servirse sin credenciales. O sea que este guion NO puede
# descargar nada por su cuenta, y lo dirá.
#
# Para una instalación normal use el otro, que no necesita descargar nada:
#
#   sudo bash deploy/almacen-instalar.sh      ← el disco de esta máquina
#
# Este sigue aquí para dos casos que sí valen: alguien que YA tenga el binario
# (MINIO_BIN=), y quien quiera un almacén compatible con S3 de verdad.
#
# Y si el binario de MinIO no se puede descargar desde aquí —ver abajo—, con la
# dirección puesta a mano o con el archivo ya bajado:
#
#   sudo MINIO_URL=https://…/minio  bash deploy/minio-instalar.sh
#   sudo MINIO_BIN=/root/minio      bash deploy/minio-instalar.sh
#
# QUÉ HACE, en orden, y todo es idempotente: ejecutarlo dos veces no rompe nada
# y no vuelve a generar credenciales.
#
#   1. CONSIGUE el binario de MinIO y comprueba que ARRANCA — lo primero de
#      todo, antes de tocar nada de la máquina.
#   2. Crea el usuario `minio` y /var/lib/minio, que no los tiene nadie más.
#   3. GENERA las credenciales aquí, con /dev/urandom. No salen de esta máquina
#      y no están escritas en ningún archivo del repositorio.
#   4. Arranca el servicio, SOLO en 127.0.0.1.
#   5. CIFRA la secreta con la llave de la instalación y escribe las cinco
#      variables en apps/web/.env, que ya está en 600.
#   6. Crea el bucket y comprueba de verdad que se puede escribir, leer y
#      borrar — con el código del producto, no con otro cliente.
#   7. Reinicia la web.
#
# EL ORDEN DE 1 IMPORTA. Estaba en medio, y el día que `dl.min.io` empezó a
# contestar 410 el guion se paró en seco con un «curl: (22)» a secas después de
# haber dejado media máquina preparada. Lo que se trae de internet se trae y se
# comprueba ANTES de crear un usuario, una carpeta o una credencial: así un
# fallo no deja nada detrás y volver a ejecutarlo es limpio.
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

# La versión FIJADA. Se pone una concreta y no «la última» porque la última es
# justo lo que dejó de existir: una dirección con un número dentro se puede
# comprobar, y el día que cambie se cambia aquí y se ve en el historial.
VERSION_MINIO="${VERSION_MINIO:-RELEASE.2025-10-15T17-29-55Z}"

rojo() { printf '\033[31m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
aviso(){ printf '  \033[33m·\033[0m %s\n' "$*"; }
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
  echo "  Si lo que falló fue el último paso —el bucket— no hace falta repetir"
  echo "  nada de esto. Basta con:"
  echo
  echo "    cd $DIR && npm run storage:check --workspace @citas/web"
  echo
  echo "  Para empezar de cero, quite a mano las líneas STORAGE_* y vuelva."
  exit 1
fi

# ------------------------------------------------------------------ el binario
paso "MinIO"

case "$(uname -m)" in
  x86_64|amd64)   ARCO=amd64 ;;
  aarch64|arm64)  ARCO=arm64 ;;
  *) rojo "Arquitectura no contemplada: $(uname -m). Baje el binario a mano y use MINIO_BIN=/ruta/minio."; exit 1 ;;
esac

# Comprueba que lo descargado es un ejecutable de verdad y que ARRANCA.
#
# Sin esto, un servidor que contesta una página de error con un 200 —un portal
# cautivo, un proxy de empresa, una CDN enfadada— se instalaba como si fuera el
# binario y el fallo aparecía después, en `systemctl`, sin ninguna pista.
sirve() {
  local archivo="$1"
  [ -s "$archivo" ] || return 1
  head -c 4 "$archivo" | grep -qa 'ELF' || return 1
  chmod 0755 "$archivo"
  "$archivo" --version >/dev/null 2>&1
}

if [ -n "${MINIO_BIN:-}" ]; then
  # Alguien lo bajó por su cuenta. Se comprueba igual: la comprobación no es
  # desconfianza, es que un archivo a medias se ve idéntico a uno entero.
  sirve "$MINIO_BIN" || { rojo "$MINIO_BIN no es un binario de MinIO que arranque aquí."; exit 1; }
  install -m 0755 "$MINIO_BIN" /usr/local/bin/minio
  ok "instalado desde $MINIO_BIN"
elif [ -x /usr/local/bin/minio ] && sirve /usr/local/bin/minio; then
  ok "ya estaba instalado ($(/usr/local/bin/minio --version 2>/dev/null | head -1))"
else
  TMP_MINIO="$(mktemp)"
  trap 'rm -f "${TMP_MINIO:-}"' EXIT

  CANDIDATAS=()
  if [ -n "${MINIO_URL:-}" ]; then CANDIDATAS+=("$MINIO_URL"); fi
  CANDIDATAS+=(
    "https://dl.min.io/server/minio/release/linux-$ARCO/archive/minio.$VERSION_MINIO"
    "https://dl.min.io/server/minio/release/linux-$ARCO/minio"
  )

  CONSEGUIDO=""
  for url in "${CANDIDATAS[@]}"; do
    # `-f` NO: con él, `curl` se calla el código y `set -e` mata el guion antes
    # de poder decir cuál falló y con qué. Lo que se quiere aquí es justo lo
    # contrario: probar, contar, y seguir con la siguiente.
    # El `|| true` y no un `|| echo 000`: `curl` YA escribe el código —«000»
    # cuando ni siquiera pudo conectar— y añadirle otro daba «000000».
    codigo="$(curl -sSL --max-time 600 -o "$TMP_MINIO" -w '%{http_code}' "$url" 2>/dev/null)" || true
    [ -n "$codigo" ] || codigo=000
    if [ "$codigo" = "200" ] && sirve "$TMP_MINIO"; then
      CONSEGUIDO="$url"
      break
    fi
    aviso "$codigo — $url"
  done

  if [ -z "$CONSEGUIDO" ]; then
    echo
    rojo "No se pudo descargar MinIO desde ninguna de las direcciones de arriba."
    cat <<EOF

  Esto NO es un fallo de esta máquina ni de este proyecto. MinIO dejó de
  publicar el binario del servidor de la edición comunitaria: la dirección de
  siempre contesta 410 «Gone», que quiere decir que se quitó a propósito.

  No se ha tocado nada: no hay usuario nuevo, ni carpeta, ni credenciales, ni
  una línea escrita en el .env. Se puede volver a ejecutar tal cual.

  DOS SALIDAS, y las dos terminan aquí mismo:

  1. Si encuentra una dirección que sirva —la de un archivo de una versión
     concreta, o una copia propia— pásesela:

       sudo MINIO_URL=https://…/minio bash $0

  2. Si ya tiene el archivo en la máquina (bajado a mano, sacado de la imagen
     de contenedor, o copiado de otro servidor):

       sudo MINIO_BIN=/ruta/al/minio bash $0

  En los dos casos se comprueba que el archivo arranca antes de instalarlo.
EOF
    exit 1
  fi

  install -m 0755 "$TMP_MINIO" /usr/local/bin/minio
  rm -f "$TMP_MINIO"
  trap - EXIT
  ok "descargado de $CONSEGUIDO"
  ok "$(/usr/local/bin/minio --version 2>/dev/null | head -1)"
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
ok "cinco variables escritas en apps/web/.env (la secreta, cifrada)"

# ---------------------------------------------------------------------- bucket
#
# Aquí iba `mc`, el cliente de MinIO, que era un SEGUNDO binario descargado de
# internet. Ya no: lo hace el propio proyecto con su firma, la que está
# comprobada contra el vector oficial de AWS.
#
# Y lo que comprueba no es que el bucket exista. Escribe, lee y borra un objeto
# POR EL MISMO PUERTO QUE EL PRODUCTO, con las variables que se acaban de
# escribir. Si esto sale en verde, lo que está probado es la instalación entera;
# `mc` habría dicho «bucket creado» usando su propio código y sus propias
# credenciales, que no prueba nada de lo que va a correr después.
paso "Bucket y comprobación"
if ( cd "$DIR" && sudo -u "$APP_USER" npm run storage:check --workspace @citas/web --silent ); then
  ok "bucket «$BUCKET», privado, y la ida y vuelta comprobada"
else
  echo
  rojo "El bucket no quedó listo."
  echo
  echo "  Las variables YA están escritas en el .env, así que no repita este"
  echo "  guion: se negaría, y con razón. Corrija lo que diga el error de arriba"
  echo "  y vuelva a lanzar solo el último paso:"
  echo
  echo "    cd $DIR && npm run storage:check --workspace @citas/web"
  exit 1
fi

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
