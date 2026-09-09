# Publicar las apps de iPhone y Android

La app móvil vive en `apps/mobile` (Expo + React Native) y habla con el mismo
servidor que la web, con el mismo modelo de sesión: un token bearer en vez de
una cookie, la misma tabla y la misma caducidad.

## Qué queda ya preparado en el repositorio

- `app.json` con el identificador de la app en las dos tiendas:
  `com.posxml.citas`. **Se puede cambiar, pero solo ANTES de publicar por
  primera vez**: después, un identificador nuevo es una aplicación nueva, y se
  pierden las reseñas y los usuarios instalados.
- `eas.json` con tres perfiles de construcción:
  - `development` — apunta a `http://localhost:3000`, para desarrollar.
  - `preview` — APK instalable a mano, apuntando a producción. Es el perfil
    para enseñársela a alguien sin pasar por la tienda.
  - `production` — App Bundle de Android y compilación de iOS para la tienda.
- La dirección del servidor va por `EXPO_PUBLIC_API_URL` en cada perfil. Sin
  eso, una compilación de tienda saldría apuntando a `localhost`, es decir,
  rota en el teléfono de cualquiera.
- Los nombres visibles y los textos de permisos, en los cuatro idiomas, en
  `apps/mobile/locales`. Sin esto, Apple muestra la app como si solo hablara
  inglés, que es justo lo contrario de lo que es.

## Qué hace falta y NO puede salir del repositorio

Estas cuatro cosas son cuentas y documentos, no código:

1. **Cuenta de Apple Developer** (99 USD al año) y **cuenta de Google Play
   Console** (25 USD, pago único). Sin ellas no hay publicación posible.
2. **Cuenta de Expo** para las compilaciones. `npx eas init` dentro de
   `apps/mobile` la enlaza y escribe el identificador del proyecto.
3. **Las firmas.** EAS las genera y las guarda por usted la primera vez que
   compila; hay que decirle que sí.
4. **Una política de privacidad publicada**, con su dirección web. Las dos
   tiendas la exigen y la rechazan si el enlace no abre. No la redacto yo: dice
   qué datos recoge usted y qué hace con ellos, y eso es una declaración legal
   suya, no una plantilla.

## Los pasos, una vez tenga lo de arriba

```
cd apps/mobile
npx eas login
npx eas init
npx eas build --profile preview --platform android     # APK para probar
npx eas build --profile production --platform all      # tiendas
npx eas submit --profile production --platform android
npx eas submit --profile production --platform ios
```

## Lo que Apple y Google preguntan al revisar

- **Para qué sirve una cuenta.** La app es para el personal de la oficina, no
  para el invitado. Un revisor que no pueda entrar la rechaza: hay que darles
  un correo de prueba y avisar de que el código llega por correo. Se rellena en
  «App Review Information» → «Sign-in required».
- **Qué datos recoge.** Correo del personal, y nombres y teléfonos de los
  invitados que la oficina importa. Eso hay que declararlo tal cual.
- **Si vende algo.** No. El pago se hace en la web a propósito: las tiendas
  cobran comisión sobre bienes digitales vendidos dentro de la app. La app no
  debe llevar ningún botón que lleve a pagar, ni siquiera un enlace, o Apple lo
  marca.

## El idioma en el móvil

React Native fija la dirección del texto al arrancar. Cambiar a árabe exige
reiniciar la app, y la app lo dice en pantalla en vez de invertir media
interfaz. No es un fallo: es la limitación de la plataforma, dicha en voz alta.
