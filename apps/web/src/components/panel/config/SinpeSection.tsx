import {
  addSinpeAccountAction,
  assignMovementAction,
  editSinpeAccountAction,
  readPastedEmailAction,
  removeSinpeAccountAction,
} from '@/app/panel/configuracion/sinpe-actions';
import { FIELD_CLASS } from '@/components/create/Field';
import { formatMoney } from '@/lib/billing/plans';
import type { AccountRow, AssignableOrder, MovementRow } from '@/lib/payments/sinpe/accounts';
import { formatDateTime } from '@/lib/time/display';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@citas/core';

type Copy = Dictionary['admin']['sinpe'];

const CONTROL =
  'h-10 w-full border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-10 border border-[#23201a] bg-white px-5 text-sm text-[#23201a] hover:opacity-70';
const STRONG =
  'h-11 self-start bg-[#23201a] px-6 text-base text-[#f4efe6] hover:opacity-90';

/**
 * El cobro por SINPE Móvil.
 *
 * Esta pantalla enseña lo que no se puede ver en ningún otro sitio: el SINPE no
 * tiene pasarela, así que no hay a quién preguntarle si el dinero entró. Solo
 * está el correo del banco.
 *
 * Por eso el orden es este y no otro: primero los buzones que NO conectan —un
 * buzón caído es plata que deja de entrar, y desde fuera se ve igual que si
 * nadie hubiera pagado—, luego los buzones, luego lo leído, y al final una caja
 * para pegar un aviso a mano.
 */
export function SinpeSection({
  accounts,
  movements,
  orders,
  outcome,
  read,
  zone,
  dictionary,
  locale,
}: {
  accounts: AccountRow[];
  movements: MovementRow[];
  orders: AssignableOrder[];
  /** Qué pasó al guardar: `guardado`, `asignado`, `incompleto`… */
  outcome?: string;
  /** Qué se leyó del correo pegado: `cobrado`, `duplicado`, `outgoing`… */
  read?: string;
  zone: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.sinpe;
  const broken = accounts.filter((account) => account.lastError !== null);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {outcome === undefined ? null : (
        <Outcome outcome={outcome} copy={copy} saved={dictionary.admin.config.saved} />
      )}
      {read === undefined ? null : <ReadResult read={read} copy={copy} />}

      {broken.map((account) => (
        <p
          key={account.id}
          role="alert"
          className="border border-[#8c2f1e] bg-[#fdf4f2] p-4 text-sm text-[#8c2f1e]"
        >
          {copy.lastError}: {account.name} ·{' '}
          <span className="font-mono text-xs" dir="ltr">
            {account.lastError}
          </span>
        </p>
      ))}

      <section className="flex flex-col gap-4">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.accounts}</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.accountsEmpty}</p>
        ) : (
          accounts.map((account) => (
            <AccountCard key={account.id} account={account} copy={copy} zone={zone} locale={locale} />
          ))
        )}

        <details className="border-t border-[#ddd6c6] pt-5">
          <summary className="cursor-pointer text-sm text-[#6a6456] hover:text-[#23201a]">
            {copy.add}
          </summary>
          <form action={addSinpeAccountAction} className="mt-5 flex flex-col gap-5">
            <AccountFields copy={copy} />
            <button type="submit" className={STRONG}>
              {copy.add}
            </button>
          </form>
        </details>
      </section>

      <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.movements}</h2>
        <p className="text-sm text-[#6a6456]">{copy.assignHint}</p>
        {movements.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.movementsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {movements.map((movement) => (
              <Movement
                key={movement.id}
                movement={movement}
                orders={orders}
                copy={copy}
                zone={zone}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Pegar un aviso a mano no es un adorno: es la única forma de comprobar
          que los patrones de SU banco funcionan antes de confiarle el cobro, y
          sirve además para un SINPE que llegó por mensaje y no por correo. */}
      {accounts.length === 0 ? null : (
        <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.paste}</h2>
          <p className="text-sm text-[#6a6456]">{copy.pasteHint}</p>
          <form action={readPastedEmailAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {copy.pasteAccount}
              <select name="accountId" className={CONTROL} defaultValue={accounts[0]?.id ?? ''}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            {/* De quién viene: Davivienda no nombra al banco en el cuerpo, y
                lo único que lo dice es su dirección de correo. */}
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {copy.pasteFrom}
              <input name="from" maxLength={200} dir="ltr" className={CONTROL} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {copy.pasteSubject}
              <input name="subject" maxLength={500} className={CONTROL} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {copy.pasteBody}
              <textarea
                name="body"
                required
                rows={8}
                className={`${FIELD_CLASS} min-h-40 font-mono text-xs`}
                dir="ltr"
              />
            </label>
            <button type="submit" className={STRONG}>
              {copy.pasteButton}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function Outcome({
  outcome,
  copy,
  saved,
}: {
  outcome: string;
  copy: Copy;
  saved: string;
}) {
  const good = outcome === 'guardado' || outcome === 'asignado';
  const text =
    outcome === 'asignado'
      ? copy.assigned
      : outcome === 'asignarFallo'
        ? copy.assignFailed
        : outcome === 'guardado'
          ? saved
          : copy.readNotANotice;

  return <p className={`text-sm ${good ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}>{text}</p>;
}

/** Qué se sacó del correo pegado, dicho con todas las letras. */
function ReadResult({ read, copy }: { read: string; copy: Copy }) {
  const text: Record<string, string> = {
    cobrado: copy.readApplied,
    guardado: copy.readOk,
    duplicado: copy.readDuplicate,
    outgoing: copy.readOutgoing,
    account_notice: copy.readAccountNotice,
    not_a_notice: copy.readNotANotice,
  };
  const good = read === 'cobrado' || read === 'guardado';
  return (
    <p className={`text-sm ${good ? 'text-[#2f6b3a]' : 'text-[#8a6c22]'}`}>
      {text[read] ?? copy.readNotANotice}
    </p>
  );
}

function AccountCard({
  account,
  copy,
  zone,
  locale,
}: {
  account: AccountRow;
  copy: Copy;
  zone: string;
  locale: Locale;
}) {
  return (
    <details className="border border-[#ddd6c6] bg-white/60 p-5">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={`${displayFont(locale)} text-lg`}>{account.name}</span>
        <span className="font-mono text-sm text-[#6a6456]" dir="ltr">
          {account.phone}
        </span>
        {account.tenantId === null ? (
          <span className="text-xs text-[#8a6c22]">{copy.platform}</span>
        ) : null}
        <span className="ms-auto text-xs text-[#6a6456]">
          {copy.lastChecked}:{' '}
          {account.lastCheckedAt === null
            ? copy.never
            : formatDateTime(account.lastCheckedAt, locale, zone)}
        </span>
      </summary>

      <form action={editSinpeAccountAction} className="mt-5 flex flex-col gap-5">
        <input type="hidden" name="id" value={account.id} />
        <AccountFields copy={copy} account={account} />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={BUTTON}>
            {copy.add}
          </button>
        </div>
      </form>

      <form action={removeSinpeAccountAction} className="mt-4">
        <input type="hidden" name="id" value={account.id} />
        <button type="submit" className="text-sm text-[#8c2f1e] underline">
          {copy.remove}
        </button>
      </form>
    </details>
  );
}

/** Los campos de un buzón. Los mismos al añadir y al editar, a propósito. */
function AccountFields({ copy, account }: { copy: Copy; account?: AccountRow }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
        {copy.name}
        <input name="name" required maxLength={80} defaultValue={account?.name ?? ''} className={CONTROL} />
        <span className="text-xs text-[#8a8272]">{copy.nameHint}</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.bank}
          <input name="bank" maxLength={40} defaultValue={account?.bank ?? ''} className={CONTROL} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.phone}
          <input
            name="phone"
            maxLength={20}
            defaultValue={account?.phone ?? ''}
            dir="ltr"
            inputMode="tel"
            className={CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.imapHost}
          <input
            name="imapHost"
            required
            maxLength={200}
            defaultValue={account?.imapHost ?? ''}
            dir="ltr"
            className={CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.imapPort}
          <input
            type="number"
            name="imapPort"
            min={1}
            max={65535}
            defaultValue={account?.imapPort ?? 993}
            dir="ltr"
            className={`${CONTROL} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.imapUser}
          <input
            name="imapUser"
            required
            maxLength={200}
            defaultValue={account?.imapUser ?? ''}
            dir="ltr"
            autoComplete="off"
            className={CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.folder}
          <input
            name="folder"
            maxLength={100}
            defaultValue={account?.folder ?? 'INBOX'}
            dir="ltr"
            className={CONTROL}
          />
        </label>
      </div>

      {/* Se escribe, nunca se lee: el campo sale vacío aunque haya una guardada,
          y vacío significa «déjala como está». La misma regla que el SMTP. */}
      <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
        {copy.imapPassword}
        <input
          type="password"
          name="imapPassword"
          defaultValue=""
          dir="ltr"
          autoComplete="new-password"
          className={CONTROL}
        />
        <span className="text-xs text-[#8a8272]">{copy.imapPasswordHint}</span>
      </label>

      {/* Encendido por defecto, y con su explicación debajo: apagarlo deja que
          alguien en medio lea la contraseña del buzón y todo el correo. */}
      <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
        <span className="flex items-center gap-2 text-sm text-[#23201a]">
          <input
            type="checkbox"
            name="verifyCertificate"
            value="1"
            defaultChecked={account?.verifyCertificate ?? true}
          />
          {copy.verifyCertificate}
        </span>
        <span className="text-xs text-[#8a8272]">{copy.verifyCertificateHint}</span>
      </label>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-[#23201a]">
          <input type="checkbox" name="active" value="1" defaultChecked={account?.active ?? true} />
          {copy.active}
        </label>
        <label className="flex items-center gap-2 text-sm text-[#23201a]">
          <input
            type="checkbox"
            name="forSubscriptions"
            value="1"
            defaultChecked={account?.forSubscriptions ?? true}
          />
          {copy.forSubscriptions}
        </label>
      </div>
    </>
  );
}

/** Un movimiento leído, con su desplegable para asignarlo si no tiene dueño. */
function Movement({
  movement,
  orders,
  copy,
  zone,
  locale,
}: {
  movement: MovementRow;
  orders: AssignableOrder[];
  copy: Copy;
  zone: string;
  locale: Locale;
}) {
  const colour =
    movement.status === 'applied'
      ? 'text-[#2f6b3a]'
      : movement.status === 'ignored'
        ? 'text-[#6a6456]'
        : 'text-[#8a6c22]';

  return (
    <li className="flex flex-col gap-2 border border-[#ddd6c6] bg-white/60 p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-[#23201a]">
          {movement.senderName ?? copy.sender}
        </span>
        <span className="tabular-nums text-[#23201a]">
          {formatMoney(movement.amount, 'CRC', locale)}
        </span>
        <span className={colour}>{copy.states[movement.status]}</span>
        <span className="ms-auto text-xs text-[#6a6456]">
          {formatDateTime(movement.receivedAt, locale, zone)}
        </span>
      </div>

      <p className="flex flex-wrap gap-x-4 text-xs text-[#6a6456]">
        <span dir="ltr">
          {copy.reference}: <span className="font-mono">{movement.reference}</span>
        </span>
        {movement.detail === null ? null : (
          <span>
            {copy.detail}: {movement.detail}
          </span>
        )}
        <span>{movement.accountName}</span>
      </p>

      {movement.status !== 'pending' ? null : (
        <form action={assignMovementAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="movementId" value={movement.id} />
          <select name="orderId" defaultValue="" className={`${CONTROL} max-w-sm`}>
            <option value="">{copy.assignNone}</option>
            {orders
              // Solo los del mismo importe: asignar un cobro de veinticinco mil
              // a un SINPE de mil no lo arregla que lo pulse una persona.
              .filter((order) => order.amount === movement.amount)
              .map((order) => (
                <option key={order.id} value={order.id}>
                  {order.tenantName} · {order.description} ·{' '}
                  {formatMoney(order.amount, order.currency, locale)}
                  {order.payCode === null ? '' : ` · ${order.payCode}`}
                </option>
              ))}
          </select>
          <button type="submit" className={BUTTON}>
            {copy.assign}
          </button>
        </form>
      )}
    </li>
  );
}
