# Desplegar en un VPS con aaPanel (AlmaLinux / RHEL)

Instructivo escrito para un servidor con **nginx + aaPanel + Node 22** ya
instalados, donde conviven otros sitios. Nada de lo que hay aquí toca `sshd`,
los vhosts existentes ni las bases de datos de otros proyectos.

Cada paso trae su comprobación. **Si una comprobación falla, para ahí.**

## El camino corto: un solo comando

Todo lo que viene después está automatizado en `deploy/install.sh`. Como root:

```bash
curl -fsSL https://raw.githubusercontent.com/llantasghasham/Citas/claude/invitation-render-engine-9sv1tp/deploy/install.sh | bash
```

Se puede volver a ejecutar cuantas veces haga falta: actualiza el código y
recompila **sin tocar el `.env` ni los datos** que ya existan. Elige el puerto
libre él solo —en este servidor corren otros proyectos—, y se detiene con un
mensaje claro en cuanto algo no cuadra en vez de seguir a medias.

**No toca sshd, ni los vhosts de nginx, ni otros proyectos de `/www/wwwroot`.**

Al terminar te dice las tres cosas que quedan y que no se pueden automatizar: el
proxy inverso en aaPanel, el correo saliente y el cron de respaldos.

El resto de este documento explica **qué hace cada paso**, por si prefieres
hacerlo a mano o algo falla y hay que mirar dentro.

---

## 0. Antes de empezar

```bash
node -v                              # >= 20
ss -lntp | grep -E ':3000|:5432'     # los dos puertos deben estar libres
df -h /www                           # 3 GB libres como mínimo
id www                               # el usuario de aaPanel existe
```

Si el 3000 está ocupado, elige otro y cámbialo en los tres sitios donde aparece:
el servicio de systemd, el proxy inverso de nginx y esta guía.

## 1. PostgreSQL

```bash
dnf install -y postgresql-server postgresql-contrib
postgresql-setup --initdb
systemctl enable --now postgresql
postgres --version                   # comprobación
```

Crear la base y su usuario. **La contraseña se genera aquí y no se escribe en
ningún chat ni en ningún historial:**

```bash
PGPASS=$(openssl rand -base64 24)
sudo -u postgres psql -c "CREATE DATABASE citas;"
sudo -u postgres psql -c "CREATE USER citas_app WITH PASSWORD '$PGPASS';"
sudo -u postgres psql -c "ALTER DATABASE citas OWNER TO citas_app;"
echo "$PGPASS"                       # cópiala al .env del paso 3 y limpia la pantalla
```

PostgreSQL escucha por defecto solo en `127.0.0.1`. **No lo abras al exterior.**

## 2. Chromium

La imagen de la invitación se genera fotografiando la página con un navegador.
Sin esto, `/api/render/[slug]` devuelve 500 y **la vista previa de WhatsApp no
funciona**.

```bash
dnf install -y epel-release
dnf install -y chromium
which chromium || which chromium-browser
```

Si EPEL no trae Chromium para tu versión, instala Google Chrome:

```bash
dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
which google-chrome-stable
```

Apunta la ruta que te devuelva: va en `CHROMIUM_PATH`.

## 3. El código

```bash
git clone -b claude/invitation-render-engine-9sv1tp \
  https://github.com/llantasghasham/Citas.git /www/wwwroot/citas
cd /www/wwwroot/citas
```

Crear `apps/web/.env` (la contraseña del paso 1, la ruta del paso 2):

```ini
DATABASE_URL="postgresql://citas_app:LA_CONTRASEÑA@127.0.0.1:5432/citas?schema=public"
DATA_SOURCE="database"
CHROMIUM_PATH="/usr/bin/chromium"
NEXT_PUBLIC_SITE_URL="https://citas.posxml.com"
PAYMENTS_PROVIDER="mock"
SUPERADMIN_EMAIL="tu@correo.com"
```

```bash
chmod 600 apps/web/.env
chown -R www:www /www/wwwroot/citas
```

Instalar y compilar **como `www`**, no como root:

```bash
sudo -u www bash -lc '
  cd /www/wwwroot/citas &&
  npm ci --ignore-scripts --include-workspace-root \
    --workspace @citas/web --workspace @citas/core &&
  npm run db:generate --workspace @citas/web &&
  npm run db:deploy   --workspace @citas/web &&
  npm run db:seed     --workspace @citas/web &&
  npm run build       --workspace @citas/web
'
```

La semilla crea la oficina raíz, las invitaciones de ejemplo y el
superadministrador de `SUPERADMIN_EMAIL`.

## 3 bis. El correo saliente

Sin esto **no se puede entrar al panel**: el acceso es por código de un solo uso
y el emisor de consola se niega a arrancar en producción.

La contraseña del buzón no se escribe en claro en ningún sitio. Primero, la
llave, **fuera del proyecto**:

```bash
mkdir -p /etc/citas
openssl rand -base64 32 > /etc/citas/secret.key
chown www:www /etc/citas/secret.key
chmod 400 /etc/citas/secret.key
```

Después se cifra la contraseña. **Se escribe por la entrada estándar**, no como
argumento: un argumento queda en la lista de procesos y en el historial del
intérprete.

```bash
cd /www/wwwroot/citas
sudo -u www bash -lc '
  CITAS_SECRET_KEY_FILE=/etc/citas/secret.key \
  printf %s "LA-CONTRASEÑA-DEL-BUZON" | npm run secret:encrypt --workspace @citas/web --silent
'
```

Devuelve algo como `v1.xxxx.yyyy.zzzz`. Eso es lo que va al `.env`, junto con el
resto de los datos que te dio tu proveedor de correo:

```ini
MAILER="smtp"
SMTP_HOST="…"
SMTP_PORT="587"
SMTP_USER="…"
MAIL_FROM="Nombre <buzon@dominio>"
CITAS_SECRET_KEY_FILE="/etc/citas/secret.key"
SMTP_PASSWORD_ENC="v1....."
```

Comprobación: reinicia el servicio, pide un código en `/entrar` con el correo
del superadministrador y mira que llegue.

> **Qué protege esto y qué no.** Enviar correo necesita la contraseña en claro en
> ese instante, así que la llave vive en el mismo servidor: quien pueda leer los
> dos archivos, puede leer la contraseña. Lo que sí evita es que el `.env` la
> revele **por sí solo** —copiado a un respaldo, pegado por error, leído por otro
> proceso—, porque la llave está en otro sitio y con otros permisos. Lo que de
> verdad la protege sigue siendo: permisos `600`, fuera del repositorio, y
> rotarla cuando se filtre.
>
> El puerto 587 es STARTTLS: la conexión abre en claro y se eleva a TLS. Solo el
> 465 es TLS desde el primer byte. El código exige el cifrado en ambos casos.

## 4. El servicio

```bash
which node                           # si no es /usr/bin/node, corrige la unidad
cp /www/wwwroot/citas/deploy/citas.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now citas
systemctl status citas --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/i/ejemplo-ar   # 200
```

## 5. nginx, desde aaPanel

**No edites los archivos de `/www/server/panel/vhost/nginx/` a mano.** En el
panel:

1. *Sitios* → *Añadir sitio* → dominio `citas.posxml.com`, sin PHP, sin base de
   datos (ya la tienes).
2. En el sitio → *Proxy inverso* → destino `http://127.0.0.1:3000`.
3. En el sitio → *SSL* → Let's Encrypt.

Si el proxy devuelve **502** y el `curl` del paso 4 daba 200, casi siempre es
SELinux:

```bash
getenforce
setsebool -P httpd_can_network_connect 1
```

### La cabecera que no puede faltar

La oficina se resuelve por `x-forwarded-host`. aaPanel la añade en su plantilla
de proxy inverso; **compruébalo**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://citas.posxml.com/i/ejemplo-ar
curl -s https://citas.posxml.com/entrar | grep -c 'dir='
```

Y el origen **solo debe ser accesible por nginx**: el servicio escucha en
`127.0.0.1`, así que no abras el 3000 en el cortafuegos.

## 6. Comprobación final

| Prueba | Esperado |
| --- | --- |
| `https://citas.posxml.com/i/ejemplo-ar` | La invitación en árabe |
| `https://citas.posxml.com/api/render/ejemplo-ar` | Un PNG (la primera vez tarda ~3 s) |
| `https://citas.posxml.com/panel` | Redirige a `/entrar` |
| `journalctl -u citas -n 50` | Sin errores |

---

## Lo que queda pendiente después de esto

1. **El correo.** Sin un proveedor real **no podrás entrar al panel**: el código
   de acceso no llega a ninguna parte y el emisor de consola se niega a arrancar
   en producción. Es lo primero que hay que resolver.
2. **El comodín de subdominios.** Cada oficina vive en `oficina.citas.posxml.com`.
   Hace falta un registro DNS `*.citas.posxml.com` y un certificado comodín
   (Let's Encrypt lo emite, pero validando por DNS, no por HTTP).
3. **Las credenciales de Whish** para cobrar de verdad. Con `mock` el código se
   niega a arrancar en producción, así que ese modo es solo para probar el resto.

## Respaldos

aaPanel respalda MariaDB, pero **PostgreSQL no aparece en su panel**. Es la única
ventaja real que tenía MariaDB aquí, y se cubre con un cron:

```bash
cp /www/wwwroot/citas/deploy/backup-citas.sh /usr/local/bin/
chmod 700 /usr/local/bin/backup-citas.sh
crontab -e
# 30 3 * * *  /usr/local/bin/backup-citas.sh
```

Guarda 14 días en `/www/backup/citas`, avisa si el volcado sale vacío, y nunca
pisa los buenos. **Prueba a restaurar uno**: un respaldo que nadie ha restaurado
nunca no es un respaldo.

## Actualizar

```bash
cd /www/wwwroot/citas
sudo -u www git pull
sudo -u www bash -lc '
  cd /www/wwwroot/citas &&
  npm ci --ignore-scripts --include-workspace-root \
    --workspace @citas/web --workspace @citas/core &&
  npm run db:generate --workspace @citas/web &&
  npm run db:deploy   --workspace @citas/web &&
  npm run build       --workspace @citas/web
'
systemctl restart citas
```

`db:deploy` solo aplica migraciones nuevas; nunca borra datos.
