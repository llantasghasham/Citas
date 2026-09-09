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

## El mensaje para Whish, listo para pegar

Se manda por el canal OFICIAL de Whish —el botón «Business» de su propia
aplicación, o `apps.whish.money`—, nunca a un número que aparezca en un grupo.

**Qué se puede decir y qué no.** El **Account ID** y el teléfono registrado SÍ:
es como te identifican y no son secretos. La **clave (`secret`) NO se manda
nunca de vuelta**, ni siquiera a alguien que diga ser soporte: ellos te la dan a
ti, no al revés. Si alguna vez alguien te la pide, no es soporte.

### Primer mensaje

> مرحبًا، أنا صاحب الحساب رقم **[Account ID]** المسجّل على الرقم **[الهاتف]**.
>
> عندي منصّة لبطاقات الدعوات الرقمية على النطاق **citas.posxml.com**، وبدّي
> فعّل الدفع عبر Whish Collect لزبائني.
>
> بحاجة لفتح **حساب تاجر (Merchant / Business)** والحصول على:
> `channel` و`secret` و`websiteUrl` للتجربة (sandbox) وللإنتاج، مع نسخة من
> **Whish Collect Web Service Technical Specification**.
>
> شو الخطوات والأوراق المطلوبة؟ وشكرًا.

En inglés, por si contestan en inglés:

> Hello. I am the holder of account **[Account ID]**, registered to
> **[phone]**.
>
> I run a digital wedding-invitation platform at **citas.posxml.com** and I
> would like to collect payments from my clients through Whish Collect.
>
> I need to open a **merchant (business) account** and receive the `channel`,
> `secret` and `websiteUrl` for both sandbox and production, together with a
> copy of the **Whish Collect Web Service Technical Specification**.
>
> What are the steps and the documents required? Thank you.

### Segundo mensaje, cuando ya haya cuenta

La pregunta 3 es la cara: contestarla mal cobra cien veces de más o cien veces
de menos. No se cierra sin respuesta POR ESCRITO.

> 1. `channel`, `secret` و`websiteUrl` — للـ sandbox وللإنتاج.
> 2. الوثيقة التقنية لـ Whish Collect، آخر نسخة.
> 3. **صيغة المبلغ**: هل `amount` بالوحدة الكاملة (20 = عشرون دولارًا) أم
>    بالسنتات (2000 = عشرون دولارًا)؟ وأي عملات مدعومة؟
> 4. هل يوجد **callback** من خادم إلى خادم؟ وهل هو **موقّع**؟ بأي ترويسة وأي
>    خوارزمية نتحقّق من التوقيع؟
> 5. إذا أُرسل نفس `externalId` مرّتين: هل يُنشأ تحصيل ثانٍ أم يُعاد الأول؟
> 6. متى تنتهي صلاحية طلب تحصيل غير مدفوع؟
> 7. العمولة، ودورة التسوية، وإلى أي حساب.
> 8. الحدود لكل عملية ولكل يوم.

Y en inglés:

> 1. `channel`, `secret` and `websiteUrl` — for sandbox and for production.
> 2. The latest Whish Collect technical specification document.
> 3. **Amount format**: is `amount` in whole currency units (20 = twenty
>    dollars) or in cents (2000 = twenty dollars)? Which currencies?
> 4. Is there a **server-to-server callback**? Is it **signed**? With which
>    header and which algorithm do we verify the signature?
> 5. If the same `externalId` is sent twice, is a second collection created or
>    is the first one returned?
> 6. How long before an unpaid collection expires?
> 7. Fee, settlement cycle, and to which account.
> 8. Limits per transaction and per day.

Lo que contesten a la 3 se comprueba igual con un cobro real de un dólar mirado
en el panel de Whish. Una respuesta por WhatsApp no es una prueba.

## Al abrir la cuenta de comercio, pedir por escrito:

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
