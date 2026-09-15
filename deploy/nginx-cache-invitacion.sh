#!/usr/bin/env bash
#
# Pone la caché de nginx que mantiene viva la invitación aunque la aplicación
# se caiga.
#
#   sudo bash deploy/nginx-cache-invitacion.sh
#
# POR QUÉ UN GUION Y NO UNAS LÍNEAS PARA PEGAR: son dos archivos distintos y en
# dos contextos distintos —la despensa va en el `http` y la regla en el
# `location`—, y pegarlas en el sitio equivocado deja nginx sin arrancar. Esto
# las pone donde van, COMPRUEBA con `nginx -t` y, si algo no cuadra, DESHACE
# los dos archivos y no recarga nada. Un ajuste para que el sitio aguante más
# no puede ser lo que lo tire.
#
# Es idempotente: ejecutarlo dos veces no duplica nada.
set -euo pipefail

PRINCIPAL="${PRINCIPAL:-/www/server/nginx/conf/nginx.conf}"
SITIO="${SITIO:-/www/server/panel/vhost/nginx/citas.posxml.com.conf}"
CACHE="${CACHE:-/var/cache/nginx/citas}"
MARCA='# --- citas: caché de la invitación pública ---'

rojo() { printf '\033[31m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
paso() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rojo "Hay que ejecutarlo como root (sudo)."; exit 1; }
[ -f "$PRINCIPAL" ] || { rojo "No encuentro $PRINCIPAL. Póngalo en PRINCIPAL=."; exit 1; }
[ -f "$SITIO" ]     || { rojo "No encuentro $SITIO. Póngalo en SITIO=."; exit 1; }

if grep -q "$MARCA" "$PRINCIPAL" && grep -q "$MARCA" "$SITIO"; then
  ok "ya estaba puesto en los dos archivos"
  paso "Comprobando"
  nginx -t
  exit 0
fi

paso "La carpeta"
mkdir -p "$CACHE"
# Del usuario con el que corre nginx, leído de su propia configuración.
USUARIO="$(awk '$1=="user"{print $2}' "$PRINCIPAL" | tr -d ';' | head -1)"
chown -R "${USUARIO:-www}:${USUARIO:-www}" "$CACHE"
ok "$CACHE, de ${USUARIO:-www}"

paso "Copias de seguridad"
SELLO="$(date +%F-%H%M%S)"
cp -a "$PRINCIPAL" "$PRINCIPAL.antes-de-citas-$SELLO"
cp -a "$SITIO" "$SITIO.antes-de-citas-$SELLO"
ok "guardadas con el sello $SELLO"

deshacer() {
  cp -a "$PRINCIPAL.antes-de-citas-$SELLO" "$PRINCIPAL"
  cp -a "$SITIO.antes-de-citas-$SELLO" "$SITIO"
  rojo "Deshecho: los dos archivos han vuelto a como estaban. No se recargó nada."
}

paso "La despensa y la regla de la cookie"
CACHE="$CACHE" MARCA="$MARCA" python3 - "$PRINCIPAL" <<'PY'
import os, re, sys

ruta, cache, marca = sys.argv[1], os.environ['CACHE'], os.environ['MARCA']
texto = open(ruta, encoding='utf-8').read()

if marca in texto:
    sys.exit(0)

bloque = f'''
    {marca}
    # La despensa. 100 MB sobran: una invitación son unas decenas de kilobytes.
    proxy_cache_path {cache} levels=1:2 keys_zone=citas:10m
                     max_size=100m inactive=7d use_temp_path=off;

    # QUIÉN NO SE CACHEA. La cookie del invitado lleva el SLUG dentro
    # —citas_guest_<slug>— así que cada boda tiene la suya: mirar una sola
    # cubriría esa invitación y ninguna más. Se mira el encabezado entero.
    map $http_cookie $citas_sin_cache {{
        default            0;
        "~*citas_guest_"   1;
    }}
    # --- fin citas ---
'''

# La apertura del bloque http, que en aaPanel suele ir con la llave en la
# línea siguiente. Se busca la llave de verdad, no se supone dónde está.
m = re.search(r'^\s*http\s*(\{|\n\s*\{)', texto, re.M)
if m is None:
    sys.stderr.write('No encuentro el bloque http en la configuración principal.\n')
    sys.exit(1)

corte = texto.index('{', m.start()) + 1
open(ruta, 'w', encoding='utf-8').write(texto[:corte] + bloque + texto[corte:])
PY
ok "despensa y regla escritas en $PRINCIPAL"

MARCA="$MARCA" python3 - "$SITIO" <<'PY'
import os, re, sys

ruta, marca = sys.argv[1], os.environ['MARCA']
texto = open(ruta, encoding='utf-8').read()

if marca in texto:
    sys.exit(0)

bloque = f'''
        {marca}
        proxy_cache citas;
        # Ni se guarda ni se le sirve nada guardado a quien trae su enlace
        # personal: esa página le saluda por su nombre y le enseña su mesa.
        proxy_cache_bypass $citas_sin_cache $http_authorization;
        proxy_no_cache     $citas_sin_cache $http_authorization;
        # Y ESTO es lo que la mantiene viva: si el origen no contesta, se sigue
        # sirviendo la última copia buena en vez de un 502.
        proxy_cache_use_stale error timeout updating invalid_header
                              http_500 http_502 http_503 http_504;
        proxy_cache_background_update on;
        proxy_cache_lock on;
        add_header X-Cache $upstream_cache_status always;
        # --- fin citas ---
'''

# Justo DESPUÉS del `proxy_pass`, que es la única línea que no se repite y que
# identifica sin dudas el `location` que hace de proxy inverso. El otro
# `location /` del archivo es el del certificado y no debe tocarse.
m = re.search(r'^[^\n\S]*proxy_pass\s+[^\n;]+;[^\n]*\n', texto, re.M)
if m is None:
    sys.stderr.write('No encuentro ningún proxy_pass en la configuración del sitio.\n')
    sys.exit(1)

open(ruta, 'w', encoding='utf-8').write(texto[:m.end()] + bloque + texto[m.end():])
PY
ok "regla escrita en $SITIO"

paso "Comprobando la configuración"
if ! nginx -t; then
  deshacer
  exit 1
fi
ok "nginx -t: correcta"

paso "Recargando"
# aaPanel no gestiona nginx con systemd: `systemctl reload nginx` contesta
# «is not active». Se usa lo que hay, en el orden en que suele existir.
if [ -x /etc/init.d/nginx ]; then
  /etc/init.d/nginx reload
elif command -v nginx >/dev/null; then
  nginx -s reload
fi
ok "recargado"

cat <<EOF

────────────────────────────────────────────────────────────
 Compruébelo, dos veces seguidas: MISS y luego HIT.

   curl -sI https://citas.posxml.com/i/ejemplo-ar | grep -i x-cache
   curl -sI https://citas.posxml.com/i/ejemplo-ar | grep -i x-cache

 Y la prueba de verdad — con el servicio PARADO tiene que dar 200:

   systemctl stop citas
   curl -s -o /dev/null -w '%{http_code}\\n' https://citas.posxml.com/i/ejemplo-ar
   systemctl start citas

 Para deshacerlo, las copias están al lado con el sello $SELLO.
────────────────────────────────────────────────────────────
EOF
