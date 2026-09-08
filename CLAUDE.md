# Proyecto: Plataforma de Invitaciones Digitales

## Qué es
App multiidioma para crear y enviar invitaciones de eventos.
Mercado inicial: Líbano. Idiomas: árabe (principal, RTL), español, portugués, inglés.

## Stack
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript estricto
- Tailwind CSS 4 (configuración en CSS, `@theme` en globals.css)
- PostgreSQL vía Prisma (cuando llegue)
- Render de imágenes en servidor (Chromium headless vía puppeteer-core)
- Expo/React Native para las apps móviles (fase posterior)

## Reglas innegociables

### RTL y i18n
- PROHIBIDO: margin-left, margin-right, padding-left, padding-right,
  text-align: left/right, left:, right:, float
- OBLIGATORIO: margin-inline-start/end, padding-inline-start/end,
  text-align: start/end, inset-inline-start/end
- Los atajos simétricos (`px-`, `mx-`, `inset-`) sí están permitidos: se
  comportan igual en ambas direcciones.
- `npm run lint:rtl` verifica esta regla sobre todo `src/`. Debe pasar siempre.
- Cero strings hardcodeados. Todo en /locales/{ar,es,pt,en}.json
- El interletraje (`tracking-*`) y las mayúsculas son recursos latinos: pasan
  por `latinOnly()` porque rompen las uniones cursivas del árabe.
- Todo componente nuevo se prueba en árabe RTL antes de darse por terminado

### Contenido religioso
- Los versículos coránicos y bíblicos vienen SIEMPRE de /data/verses.json,
  una lista fija y verificada.
- NUNCA generar, completar, parafrasear ni corregir un versículo con IA.
- Si un versículo no está en la lista, no se muestra (el loader lanza error).
- Una entrada nueva solo se añade tras verificación humana contra la edición
  citada, anotando el nombre en `verifiedBy`.

### Tipografía
- Fuentes en /public/fonts, cargadas localmente
- Árabe: Amiri, Cairo, Reem Kufi
- Latino: Playfair Display, Inter
- Verificar licencia comercial antes de agregar cualquier fuente
  (las tres actuales son SIL OFL 1.1 — ver public/fonts/README.md)

### Cobro
- Líbano cobra con **Whish**. Costa Rica, si se abre, con Tilopay (SINPE Móvil).
- El navegador NUNCA decide un pago. Un regreso a la URL de éxito no es una
  prueba de cobro: se confirma servidor contra servidor con `getStatus()`.
- El callback es un aviso, no una prueba, mientras no haya firma verificable.
- Importes SIEMPRE en entero, en la unidad menor de la moneda. Ningún decimal
  toca dinero.
- Todo proveedor entra por el puerto `PaymentProvider`. La aplicación no sabe
  qué pasarela hay detrás.
- El proveedor `mock` está prohibido en producción y el código lo impide.

### Render
- Las invitaciones se renderizan en el SERVIDOR, nunca en el cliente
- Salida: PNG 1080x1920 y página web responsive
- La página web y el PNG comparten el MISMO componente (`InvitationCard`);
  no se duplica nunca la maquetación
- Las plantillas son HTML/SVG con capas, nunca imágenes generadas por IA

### Código
- TypeScript estricto, sin `any`
- Componentes pequeños, un archivo por componente
- Nombres en inglés en el código, contenido de usuario en los 4 idiomas
- No instalar dependencias sin preguntarme primero

## Comandos
```
npm run dev        # servidor de desarrollo
npm run build      # build de producción
npm run typecheck  # tsc --noEmit
npm run lint:rtl   # guardia de CSS lógico (RTL)
```

## Documentos
- `MANUAL.md` — manual de uso: arrancar, crear invitaciones, idiomas, PNG,
  versículos, fuentes y problemas frecuentes.
- `docs/ARQUITECTURA.md` — producto completo: oficinas (multiempresa), roles,
  las tres formas de venderlo, apps móviles, descargas y despliegue.
- `prisma/schema.prisma` — modelo de datos de la fase 2. Diseñado, no instalado.
- `docs/COBRO-WHISH.md` — cobro en Líbano con Whish: qué pedirle al proveedor y
  las reglas de la integración.
- `docs/DECISIONES-PENDIENTES.md` — lo que no es código y bloquea fases enteras.

## Estado actual
Fase 1 terminada: motor de render. Todavía sin auth, sin base de datos y sin pagos.
- `GET /i/[slug]` — página web de la invitación
- `GET /api/render/[slug]` — PNG 1080x1920 generado en servidor
- `GET /render/[slug]` — lienzo interno de captura (no indexado)
- Datos en /data/invitations.json (4 ejemplos: ar, es, en, pt)
- Una plantilla: `classic-gold`

## Orden de construcción
1. Base de datos, oficinas (multiempresa) y roles — Prisma + PostgreSQL, OTP,
   tenant por subdominio, historial de cambios
2. RSVP y entregables — confirmaciones, `.ics`, mapa, exportar a Excel
3. Formulario de creación con vista previa en vivo
4. Panel de oficina y facturación
5. Apps móviles — monorepo con Expo

El orden importa en un punto: **las apps móviles necesitan cuentas y roles
detrás**. Construirlas antes obliga a rehacerlas. No adelantar el paso 5.

## Reglas de producto que no se rompen
- Todo dato de negocio cuelga de un tenant. Ninguna consulta sin filtrar por
  oficina: una oficina jamás ve los datos de otra.
- El invitado NO tiene cuenta ni instala nada. La invitación es un enlace web.
- Los permisos se comprueban en el servidor. Ocultar un botón no es un permiso.
- El acceso de soporte del superadmin a un evento ajeno queda siempre registrado.
