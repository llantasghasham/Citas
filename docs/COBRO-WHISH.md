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

**Lo único que falta es el contrato exacto.** Está aislado a propósito en la
constante `CONTRACT` y en dos funciones de mapeo dentro de `whish.ts`. Cuando
llegue la especificación, no se toca nada más.

## Qué pedirle a Whish

Al abrir la cuenta de comercio, pedir por escrito:

1. La **«Whish Collect Web Service Technical Specification»**, última versión.
2. **Credenciales de sandbox y de producción**: `channel`, `secret` y
   `websiteUrl`, y la **URL base** de cada entorno.
3. **Endpoints y nombres de campo exactos** para: crear un cobro, consultar su
   estado, consultar tipo de cambio y consultar saldo.
4. **Cómo se notifica el pago.** ¿Hay callback de servidor a servidor? ¿Va
   firmado? ¿Con qué cabecera y qué algoritmo se verifica la firma? *(Si no va
   firmado, el callback no puede decidir nada por sí solo — ver reglas abajo.)*
5. **Monedas soportadas y formato del importe.** ¿USD y LBP? ¿El importe va en
   céntimos o en unidades enteras?
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
