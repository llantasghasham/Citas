#!/usr/bin/env bash
#
# Levanta el almacén de las fotos del directorio: el DISCO de esta máquina.
#
#   sudo bash deploy/almacen-instalar.sh
#
# POR QUÉ ESTE Y NO MinIO. El plan era MinIO y no se pudo: retiraron el binario
# de la edición comunitaria. `dl.min.io` contesta 410 «Gone» tanto en la
# dirección de siempre como en la del archivo de una versión concreta, y la
# imagen de contenedor dejó de servirse sin credenciales. `minio-instalar.sh`
# sigue aquí para quien consiga un binario o quiera apuntar a R2 o a Amazon.
#
# Y para UNA máquina, esto es mejor de todas formas: MinIO era un proceso más
# que mantener, un puerto más que cerrar, unas credenciales más que rotar y un
# binario más que bajar de internet — todo para hablar el protocolo de S3 con un
# disco que está a diez centímetros. Aquí no hay ninguna de esas cuatro cosas.
#
# QUÉ HACE, y todo es idempotente:
#
#   1. Crea /var/lib/citas/almacen, del usuario de la web y de nadie más.
#   2. Escribe STORAGE_DIR en apps/web/.env.
#   3. COMPRUEBA que se puede escribir, leer y borrar una imagen de verdad, por
#      el mismo puerto que usa el producto.
#   4. Reinicia la web.
#
# NO HAY CREDENCIALES QUE GENERAR, que es justamente la diferencia.
#
# LO QUE NO HACE, y hay que saberlo: respaldar. Las fotos quedan en esa carpeta
# y el respaldo de este proyecto solo copia PostgreSQL. Al final lo dice, con la
# línea que hay que añadir.
set -euo pipefail

DIR="${DIR:-/www/wwwroot/citas}"
ENV_FILE="$DIR/apps/web/.env"
ALMACEN="${ALMACEN:-/var/lib/citas/almacen}"

rojo() { printf '\033[31m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
paso() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rojo "Hay que ejecutarlo como root (sudo)."; exit 1; }
[ -f "$ENV_FILE" ] || { rojo "No encuentro $ENV_FILE. Ponga DIR=/ruta/a/citas."; exit 1; }

# ---------------------------------------------------------------- ya instalado
if grep -q '^STORAGE_DIR=' "$ENV_FILE"; then
  rojo "apps/web/.env ya tiene STORAGE_DIR."
  echo
  echo "  Este guion NO lo pisa: cambiar la carpeta de un almacén en uso deja"
  echo "  las filas de la base apuntando a archivos de la carpeta anterior, y"
  echo "  eso se descubre como galerías rotas en la ficha de gente real."
  echo
  echo "  Para comprobar el que ya hay:"
  echo
  echo "    cd $DIR && npm run storage:check --workspace @citas/web"
  exit 1
fi

if grep -q '^STORAGE_ENDPOINT=' "$ENV_FILE"; then
  rojo "apps/web/.env ya tiene STORAGE_ENDPOINT: hay un almacén de S3 puesto."
  echo
  echo "  Los dos a la vez no se pueden: la aplicación se niega a arrancar, y a"
  echo "  propósito. Con los dos puestos las fotos acabarían en el sitio que no"
  echo "  es, y quitar el otro dejaría las galerías vacías sin avisar."
  exit 1
fi

# ------------------------------------------------------------------- la carpeta
paso "La carpeta"
APP_USER="$(stat -c '%U' "$ENV_FILE")"
APP_GROUP="$(stat -c '%G' "$ENV_FILE")"

# FUERA del directorio de la aplicación, y no es un gusto: un despliegue copia
# el código y se lleva por delante lo que se hubiera dejado al lado. Es la misma
# razón por la que los PNG de `Render` y las fotos de perfil viven en
# PostgreSQL. La aplicación lo comprueba también, al arrancar.
case "$ALMACEN" in
  "$DIR"|"$DIR"/*)
    rojo "$ALMACEN está dentro de $DIR."
    echo "  Un despliegue se lo llevaría por delante. Use algo como /var/lib/citas/almacen."
    exit 1
    ;;
esac

mkdir -p "$ALMACEN"
chown -R "$APP_USER:$APP_GROUP" "$ALMACEN"
# Solo el usuario de la web. Son fotos de negocios reales, y quien pueda leer
# esta carpeta las lee todas — la misma razón por la que MinIO habría escuchado
# solo en el bucle local.
chmod 0700 "$ALMACEN"
ok "$ALMACEN, de $APP_USER y de nadie más (0700)"

# ------------------------------------------------------------------ el fichero
paso "Configuración de la web"
cat >> "$ENV_FILE" <<EOF

# Almacén de las fotos del directorio: el disco de esta máquina.
# Lo escribió deploy/almacen-instalar.sh. Tiene que estar FUERA del directorio
# de la aplicación: un despliegue se lleva por delante lo que haya al lado del
# código. Para un almacén compatible con S3 (R2, Amazon, B2), quite esta línea
# y ponga las STORAGE_* de ese otro; los dos a la vez no se pueden.
STORAGE_DIR=$ALMACEN
EOF
ok "STORAGE_DIR escrito en apps/web/.env"

# ----------------------------------------------------------------- comprobación
#
# No comprueba que la carpeta exista —eso ya se ve— sino que se puede escribir,
# leer y borrar una imagen POR EL MISMO PUERTO QUE EL PRODUCTO, con las
# variables que se acaban de escribir. Si esto sale en verde, lo probado es la
# instalación entera.
paso "Comprobación"
if ( cd "$DIR" && sudo -u "$APP_USER" npm run storage:check --workspace @citas/web --silent ); then
  ok "escribir, leer y borrar: correcto"
else
  echo
  rojo "El almacén no quedó listo."
  echo
  echo "  STORAGE_DIR YA está escrito en el .env, así que no repita este guion:"
  echo "  se negaría, y con razón. Corrija lo que diga el error de arriba y"
  echo "  vuelva a lanzar solo la comprobación:"
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
 en verde y decir «Disco de esta máquina» con la carpeta.

 FALTA UNA COSA, y no la puede hacer este guion:

 EL RESPALDO. Las fotos viven en
 $ALMACEN
 y el respaldo de este proyecto solo copia PostgreSQL. Añada
 esta carpeta a /usr/local/bin/backup-citas.sh, o al menos:

   tar -czf /respaldos/almacen-\$(date +%F).tar.gz $ALMACEN

 Una boda sin sus fotos se arregla; el catálogo de
 doscientos proveedores, no.
────────────────────────────────────────────────────────────
EOF
