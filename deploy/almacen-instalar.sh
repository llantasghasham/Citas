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

# Ejecuta un guion del proyecto EXACTAMENTE como lo hacen los temporizadores:
# `node node_modules/tsx/dist/cli.mjs <guion>`, desde `apps/web`.
#
# NO con `npm run`. Es la única forma que depende del PATH, y en una máquina de
# producción eso falla con un «tsx: command not found» que no se parece en nada
# a la causa. Las cuatro unidades de systemd de este proyecto —conciliación,
# recordatorios, SINPE y el servicio de WhatsApp— llaman por la ruta completa
# desde el primer día; esto se salía de esa norma y por eso se rompió.
correr_guion() {
  local guion="$1"
  local tsx="$DIR/node_modules/tsx/dist/cli.mjs"

  if [ ! -f "$tsx" ]; then
    rojo "No encuentro $tsx"
    echo
    echo "  Faltan las dependencias de DESARROLLO. Y esto importa más allá de"
    echo "  este guion: los temporizadores de conciliación de cobros, de"
    echo "  recordatorios y de SINPE arrancan por esa MISMA ruta, así que si no"
    echo "  está, esos tres llevan sin correr desde que se instalaron así."
    echo
    echo "  Compruébelo:  systemctl list-timers 'citas-*'"
    echo "                journalctl -u citas-sinpe -n 20"
    echo
    echo "  Y se arregla reinstalando sin omitir las de desarrollo:"
    echo
    echo "    cd $DIR && sudo -u $APP_USER npm ci --ignore-scripts \\"
    echo "      --include-workspace-root --workspace @citas/web \\"
    echo "      --workspace @citas/core --workspace @citas/whatsapp"
    return 1
  fi

  ( cd "$DIR/apps/web" && sudo -u "$APP_USER" "$NODE_BIN" "$tsx" "$guion" )
}

# ¿La web está corriendo con el `.env` de AHORA, o con uno anterior?
#
# Se compara cuándo se levantó el servicio con cuándo se tocó el archivo. Es la
# diferencia entre «configurado» y «en marcha», y sin mirarla un guion puede
# terminar en verde dejando la aplicación sin almacén. Si no se puede saber
# —systemd no contesta, el servicio no existe— se contesta que SÍ: reiniciar de
# más cuesta unos segundos y no reiniciar deja las subidas rotas.
hay_que_reiniciar() {
  local arrancada t_srv t_env
  arrancada="$(systemctl show -p ActiveEnterTimestamp --value citas 2>/dev/null || true)"
  [ -n "$arrancada" ] || return 0
  t_srv="$(date -d "$arrancada" +%s 2>/dev/null || echo 0)"
  [ "$t_srv" -gt 0 ] || return 0
  t_env="$(stat -c %Y "$ENV_FILE")"
  [ "$t_env" -gt "$t_srv" ]
}

[ "$(id -u)" -eq 0 ] || { rojo "Hay que ejecutarlo como root (sudo)."; exit 1; }
[ -f "$ENV_FILE" ] || { rojo "No encuentro $ENV_FILE. Ponga DIR=/ruta/a/citas."; exit 1; }

# De quién es el .env es de quién es la aplicación: no hace falta preguntarlo.
APP_USER="$(stat -c '%U' "$ENV_FILE")"
APP_GROUP="$(stat -c '%G' "$ENV_FILE")"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { rojo "No encuentro node en el PATH."; exit 1; }

# ------------------------------------------------------- ya estaba configurado
#
# No se niega a secas: COMPRUEBA el que ya hay y se va. Negarse dejaba sin
# salida a quien llegó hasta aquí y falló la comprobación —la carpeta hecha y la
# variable escrita, y el guion contestando «no lo repita»—, que es justo el
# momento en que uno vuelve a lanzarlo. Lo que no hace, y eso sigue igual, es
# TOCAR nada: cambiar la carpeta de un almacén en uso deja las filas de la base
# apuntando a archivos de la carpeta anterior, y eso se descubre como galerías
# rotas en la ficha de gente real.
if grep -q '^STORAGE_DIR=' "$ENV_FILE"; then
  paso "Ya estaba configurado — solo compruebo"
  YA="$(grep -m1 '^STORAGE_DIR=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
  ok "$YA"
  if correr_guion scripts/storage-check.ts; then
    ok "escribir, leer y borrar: correcto"

    # LA WEB LEE EL .env AL ARRANCAR, no cada vez. Así que un proceso que se
    # levantó ANTES de que se escribiera STORAGE_DIR sigue sin almacén —en
    # producción `storeFor()` se levanta, o sea que subir una foto falla— y
    # desde aquí se vería todo en verde. Faltaba justamente este paso: la
    # primera vez el guion murió en la comprobación y nunca llegó a reiniciar.
    if hay_que_reiniciar; then
      paso "Reiniciando la web"
      echo "  La web se levantó antes de que se escribiera STORAGE_DIR, así que"
      echo "  todavía está corriendo sin almacén."
      systemctl restart citas
      ok "listo"
    else
      ok "la web ya estaba corriendo con esta configuración"
    fi

    echo
    echo "  Para cambiar la carpeta hay que quitar esa línea a mano, y antes"
    echo "  mover los archivos: la base apunta a lo que hay dentro."
    exit 0
  fi
  echo
  rojo "El almacén NO funciona."
  echo "  Corrija lo de arriba y vuelva a lanzar este mismo guion: ya no"
  echo "  reescribe nada, solo comprueba."
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
if correr_guion scripts/storage-check.ts; then
  ok "escribir, leer y borrar: correcto"
else
  echo
  rojo "El almacén no quedó listo."
  echo
  echo "  STORAGE_DIR ya está escrito en el .env. Corrija lo que diga el error"
  echo "  de arriba y vuelva a lanzar ESTE MISMO GUION: al ver la variable ya"
  echo "  puesta no reescribe nada, solo comprueba."
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

 EL RESPALDO. `backup-citas.sh` YA se lleva las fotos
 —lee STORAGE_DIR del .env y las empaqueta junto a los
 volcados— pero la copia que corre en el cron es la que
 se copió a /usr/local/bin el día de la instalación.
 Actualícela, o seguirá respaldando solo PostgreSQL:

   cp $DIR/deploy/backup-citas.sh /usr/local/bin/
   cp $DIR/deploy/probar-restauracion.sh /usr/local/bin/
   chmod 700 /usr/local/bin/backup-citas.sh \\
             /usr/local/bin/probar-restauracion.sh

 Y compruébelo de verdad, que es lo que vale:

   /usr/local/bin/backup-citas.sh
   /usr/local/bin/probar-restauracion.sh

 La segunda desempaqueta las fotos y cuenta cuántas
 salieron. Una boda sin sus fotos se arregla; el
 catálogo de doscientos proveedores, no.
────────────────────────────────────────────────────────────
EOF
