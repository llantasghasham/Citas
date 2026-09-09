# Cobro en Líbano: Whish

**Decidido.** El cobro en Líbano se hace con Whish. Este documento es lo que hay
que pedirle a Whish para terminar la integración, y las reglas que el código ya
respeta.

---

## Qué hay construido

- `src/lib/payments/types.ts` — el dominio: importes en unidad menor, estados,
  y el *puerto* `PaymentProvider` que aísla al resto de la aplicación.
- `src/lib/payments/whish.ts` — el adaptador de Whish.
- `src/lib/payments/mock.ts` — proveedor de desarrollo, para poder construir y
  probar el flujo entero antes de tener credenciales. Se niega a arrancar en
  producción.
- `prisma/schema.prisma` — `Order`, `Payment` y `PaymentEvent`.

## El contrato, ya confirmado

Ya no es una suposición. Esto es lo que expone el servicio `itel-service` de
Whish, contrastado en varias integraciones vivas e independientes. Lo que sigue
faltando son las CREDENCIALES, no el formato.

| | |
|---|---|
| Base, producción | `https://api.whish.money/itel-service/api` |
| Base, pruebas | `https://lb.sandbox.whish.money/itel-service/api` |
| Crear cobro | `POST payment/collect` |
| Consultar estado | `POST payment/collect/status` |
| Saldo | `POST payment/account/balance` |
| Cabeceras | `channel`, `secret`, `websiteUrl` |

**Tres detalles que costaron un error cada uno** y que estaban mal en el
adaptador hasta ahora:

1. Las rutas cuelgan de `payment/`, no de la raíz.
2. La cabecera es `websiteUrl`, en camelCase. En minúsculas no autentica.
3. El estado se consulta por el `externalId` **que enviamos nosotros**, junto
   con la moneda — no por un identificador de Whish. Y ese `externalId` es
   NUMÉRICO, mientras que los identificadores de este proyecto son cuids. Por
   eso el adaptador genera uno propio y lo guarda como `providerRef`: es el
   único asa que Whish y esta aplicación comparten, y guardarlo mal dejaría un
   cobro imposible de reconciliar.

Cuerpo de `payment/collect`: `amount`, `currency`, `invoice`, `externalId`,
`successCallbackUrl`, `failureCallbackUrl`, `successRedirectUrl`,
`failureRedirectUrl`. La respuesta viene envuelta en `{ status, code, dialog,
data }` y el enlace de pago está en `data.collectUrl`. **El servicio responde
200 aunque haya rechazado la petición**: el fallo se lee en `status: false` del
cuerpo, no en el código HTTP.

## Cómo paga el cliente, y por qué importa

Whish **no permite cobrar dentro de nuestra página**. `collect` devuelve un
`collectUrl` y al pagador se le manda allí, a una página alojada por Whish.

Eso decide el diseño del producto entero:

- **No se puede incrustar** el pago en la aplicación ni en la app móvil. El
  cliente siempre sale a la página de Whish y vuelve.
- A cambio, **ningún número de tarjeta toca este servidor**, y con eso se evita
  todo el peso de cumplir PCI.
- Como el pagador es el cliente final, que NO tiene cuenta aquí, el enlace de
  pago tiene que poder abrirse sin sesión y viajar por WhatsApp, igual que las
  invitaciones.

## Qué pedirle a Whish

Al abrir la cuenta de comercio, pedir por escrito:

1. **Credenciales de sandbox y de producción**: `channel`, `secret` y
   `websiteUrl`. Es lo único que bloquea hoy.
2. La **«Whish Collect Web Service Technical Specification»**, última versión,
   para confirmar por escrito lo que ya está en la tabla de arriba.
3. **Endpoints y nombres de campo exactos** para: crear un cobro, consultar su
   estado, consultar tipo de cambio y consultar saldo.
4. **Cómo se notifica el pago.** ¿Hay callback de servidor a servidor? ¿Va
   firmado? ¿Con qué cabecera y qué algoritmo se verifica la firma? *(Si no va
   firmado, el callback no puede decidir nada por sí solo — ver reglas abajo.)*
5. **Monedas soportadas y formato del importe.** ¿USD y LBP? ¿El importe va en
   céntimos o en unidades enteras? **Esta es la pregunta cara.** Dentro, el
   dinero son enteros en la unidad menor: 2000 son veinte dólares. El adaptador
   envía 20, no 2000 (`toProviderAmount()`), porque una API que pide `currency`
   al lado del `amount` casi siempre espera las unidades normales. Es una
   suposición. Se eligió así por lo que cuesta fallar: si Whish quisiera
   céntimos, cobra 0,20 $ en vez de 20 $ y se ve en el primer cobro de prueba;
   al revés, le cobraría 2.000 $ a una pareja. **El primer cobro real, de un
   dólar, hay que mirarlo en el panel de Whish antes de vender nada.**
6. **Idempotencia.** Si se envía dos veces el mismo `externalId`, ¿se crea un
   segundo cobro o devuelve el primero?
7. **Caducidad** de un cobro sin pagar.
8. **Devoluciones.** ¿Hay API de reembolso o se hace a mano?
9. **Comisión y liquidación.** Cuánto se llevan, cada cuánto liquidan y a qué
   cuenta.
10. **Límites** por transacción y por día.

## Reglas de la integración

Estas ya están en el código y no se negocian:

- **El navegador nunca decide un pago.** Que el pagador vuelva a la URL de éxito
  no significa que haya pagado. Se confirma preguntándole al proveedor.
- **El callback es un aviso, no una prueba.** Mientras no haya una firma que
  podamos verificar, el callback solo dice *qué pedido mirar*; quien decide es
  `getStatus()`, servidor contra servidor.
- **Idempotencia por pedido.** El `orderId` viaja como identificador externo, y
  `(provider, providerRef)` es único en la base de datos: la misma notificación
  dos veces no cobra dos veces.
- **Conciliación.** Un proceso periódico revisa los pagos que llevan rato en
  `pending` y le pregunta al proveedor. Los callbacks se pierden; el dinero no
  puede perderse con ellos.
- **Todo evento se guarda crudo** en `PaymentEvent`. Cuando un cobro se discute
  —y se discute—, es lo único que sirve.
- **Importes en entero.** Céntimos en USD, unidades en LBP. Ningún decimal toca
  dinero.

## Variables de entorno

```bash
PAYMENTS_PROVIDER=whish        # 'mock' en desarrollo; prohibido en producción
WHISH_BASE_URL=https://…       # sandbox o producción, según entorno
WHISH_CHANNEL=…
WHISH_SECRET=…
WHISH_WEBSITE_URL=https://…
```

## Lo que sigue faltando

Whish resuelve el cobro por billetera, que es el grueso del cliente libanés.
Para **tarjeta** sigue abierto Areeba o Tap, y para quien paga en efectivo, OMT.
Eso se añade como un segundo proveedor detrás del mismo puerto, sin tocar la
aplicación.
