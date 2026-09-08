# Cómo verlo y cómo publicarlo

Dos cosas distintas: **verlo funcionando en tu máquina** (diez minutos) y
**ponerlo online para clientes** (un servidor de verdad).

---

## 1. Verlo en tu máquina

Requisitos: Node 20 o superior, PostgreSQL, y Chrome o Chromium instalado.

```bash
git clone https://github.com/llantasghasham/Citas.git
cd Citas
git checkout claude/invitation-render-engine-9sv1tp
npm install                       # instala los tres espacios de trabajo

cp apps/web/.env.example apps/web/.env
#   editar DATABASE_URL con tu PostgreSQL

npm run db:deploy                 # crea las tablas
npm run db:seed                   # ejemplos y superadministrador

DATA_SOURCE=database npm run dev
```

| Dirección | Qué es |
| --- | --- |
| `http://localhost:3000/i/ejemplo-ar` | La invitación en árabe |
| `http://localhost:3000/api/render/ejemplo-ar` | Su PNG de 1080×1920 |
| `http://app.localhost:3000/entrar` | El panel (usuario `admin@citas.local`) |
| `http://localhost:3000/crear` | El formulario de creación |

**El correo no se envía en desarrollo**: el código de acceso se imprime en el log
del servidor. Ahí se lee.

### La app móvil

```bash
EXPO_PUBLIC_API_URL=http://TU_IP_LOCAL:3000 npm run mobile
```

Se escanea el código QR con **Expo Go**. `localhost` no sirve: el teléfono
necesita la IP de tu ordenador dentro de la red.

### Sin base de datos

`npm run dev` a secas arranca con `DATA_SOURCE=json`: se ven las invitaciones de
ejemplo y se descargan sus imágenes, pero no hay confirmaciones, ni panel, ni
creación. Sirve para enseñar el resultado en dos minutos.

---

## 2. Ponerlo online

### La condición que manda

**El servidor necesita Chromium.** El PNG se genera fotografiando la página real,
así que no vale un entorno *serverless* puro ni Edge. Hace falta un contenedor o
una máquina donde el navegador esté instalado.

### Con Docker

El repositorio trae `Dockerfile` y `docker-compose.yml`:

```bash
POSTGRES_PASSWORD=... NEXT_PUBLIC_SITE_URL=https://tudominio.com \
  docker compose up -d --build
```

La imagen instala Chromium, compila la web y **aplica las migraciones al
arrancar**, para que un despliegue no sirva nunca código nuevo contra un esquema
viejo. La app móvil no entra en la imagen: sus dependencias pesan cientos de
megabytes y no se despliega ahí.

> El `Dockerfile` está escrito y revisado, pero **la imagen no se ha construido**
> durante el desarrollo: no había un entorno donde hacerlo. Cuenta con dedicarle
> una primera pasada de ajustes.

### Dónde alojarlo

| Pieza | Opciones |
| --- | --- |
| Aplicación | Railway, Render, Fly.io, o un VPS con Docker |
| Base de datos | Neon, Supabase, Railway, o el PostgreSQL del compose |
| Imágenes generadas | Almacenamiento de objetos con CDN delante |

### Lo que hay que configurar antes de abrir a clientes

1. **Un proveedor de correo real** en `apps/web/src/lib/mail/`. El emisor de
   consola se niega a arrancar en producción, a propósito.
2. **Dominio con comodín** `*.tudominio.com`: cada oficina vive en su subdominio.
3. **Un proxy delante**, y el origen no accesible directamente. La oficina se
   resuelve por `x-forwarded-host`, y esa cabecera la tiene que fijar el proxy.
4. **Las credenciales de Whish** (`WHISH_*`). Sin ellas el cobro no funciona;
   con `PAYMENTS_PROVIDER=mock` el código se niega a arrancar en producción.
5. **Verificar los versículos** de `apps/web/data/verses.json` y firmar el campo
   `verifiedBy`.

### La app en las tiendas

Se publica con **EAS Build** de Expo. Recuerda que las tiendas cobran comisión
sobre bienes digitales vendidos dentro de la app: por eso el pago se hace en la
web y la app no vende.
