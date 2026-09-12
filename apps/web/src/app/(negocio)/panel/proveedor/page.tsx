import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import {
  CATEGORY_GROUPS,
  CONTACT_CHANNELS,
  GOVERNORATES,
  GOVERNORATE_KEYS,
  MAX_CATEGORIES,
  type CategoryGroup,
  type GovernorateKey,
} from '@/lib/directory/categories';
import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { readProviderDetail } from '@/lib/directory/service';
import { currentProviderScope, myProviders, panelLocale } from '@/lib/directory/session';
import {
  DIRECTORY_LOCALES,
  getDirectoryDictionary,
  type DirectoryDictionary,
} from '@citas/core';

import {
  setCategoriesAction,
  setContactsAction,
  setTranslationAction,
  updateProviderAction,
} from './actions';

interface Props {
  searchParams: Promise<{ p?: string; error?: string; guardado?: string; creado?: string }>;
}

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';
const ETIQUETA = 'flex flex-col gap-1 text-xs text-[#6a6456]';
const BOTON = 'self-start bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90';
const SECCION = 'flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4';

/** El perfil del negocio: lo básico, lo que se lee, las categorías y el contacto. */
export default async function ProviderProfilePage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  const scope = await currentProviderScope(session.userId, params.p);
  if (scope === null) return <Chooser userId={session.userId} copy={copy} />;

  const provider = await readProviderDetail(scope);
  if (provider === null) redirect('/panel/proveedor/nuevo');

  const oculto = <input type="hidden" name="providerId" value={provider.id} />;
  const distritos = GOVERNORATES[provider.governorate as GovernorateKey] ?? [];
  const elegidas = new Set(provider.categories.map((one) => one.category));
  const principal = provider.categories.find((one) => one.isPrimary)?.category ?? '';

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl">{provider.legalName}</h1>
        <ProviderStatus status={provider.status} copy={copy} />
      </header>

      <PanelNotice params={params} copy={copy} />

      {/* --------------------------------------------------------- lo básico */}
      <form action={updateProviderAction} className={SECCION}>
        {oculto}
        <h2 className="text-lg">{copy.panel.profile}</h2>

        <label className={ETIQUETA}>
          {copy.panel.legalName}
          <input name="legalName" defaultValue={provider.legalName} maxLength={120} className={CAJA} />
          <span className="opacity-70">{copy.panel.legalNameHelp}</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={ETIQUETA}>
            {copy.search.governorate}
            <select name="governorate" defaultValue={provider.governorate} className={CAJA}>
              {GOVERNORATE_KEYS.map((one) => (
                <option key={one} value={one}>
                  {copy.governorates[one]}
                </option>
              ))}
            </select>
          </label>

          <label className={ETIQUETA}>
            {copy.search.district}
            {/* Los distritos son los de la gobernación GUARDADA. Sin JavaScript
                de cliente no hay forma de rellenarlos al cambiar la de al lado,
                así que cambiar de región es guardar y volver. */}
            <select name="district" defaultValue={provider.district} className={CAJA}>
              {distritos.map((one) => (
                <option key={one} value={one}>
                  {copy.districts[one]}
                </option>
              ))}
            </select>
          </label>

          <label className={ETIQUETA}>
            {copy.panel.city}
            <input name="city" defaultValue={provider.city} maxLength={80} className={CAJA} />
          </label>

          <label className={ETIQUETA}>
            {copy.panel.mainLocale}
            <select name="mainLocale" defaultValue={provider.mainLocale} className={CAJA}>
              {DIRECTORY_LOCALES.map((one) => (
                <option key={one} value={one}>
                  {one.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className={ETIQUETA}>
            {copy.panel.capacity}
            <input
              type="number"
              name="capacity"
              min={1}
              defaultValue={provider.capacity ?? ''}
              className={CAJA}
            />
          </label>

          <label className={ETIQUETA}>
            {copy.panel.year}
            <input
              type="number"
              name="since"
              min={1800}
              max={2100}
              defaultValue={provider.since ?? ''}
              className={CAJA}
            />
          </label>
        </div>

        <label className={ETIQUETA}>
          {copy.panel.address}
          <input
            name="addressPublic"
            defaultValue={provider.addressPublic ?? ''}
            maxLength={200}
            className={CAJA}
          />
          <span className="opacity-70">{copy.panel.addressHelp}</span>
        </label>

        <button type="submit" className={BOTON}>
          {copy.panel.save}
        </button>
      </form>

      {/* ------------------------------------------------------ las categorías */}
      <form action={setCategoriesAction} className={SECCION}>
        {oculto}
        <h2 className="text-lg">{copy.panel.categoriesTitle}</h2>
        <p className="text-xs text-[#6a6456]">{copy.panel.categoriesHelp}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(CATEGORY_GROUPS) as CategoryGroup[]).map((group) => (
            <fieldset key={group} className="flex flex-col gap-1">
              <legend className="text-xs text-[#8a6c22]">{copy.groups[group]}</legend>
              {CATEGORY_GROUPS[group].map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="category"
                    value={category}
                    defaultChecked={elegidas.has(category)}
                  />
                  {copy.categories[category]}
                </label>
              ))}
            </fieldset>
          ))}
        </div>

        <label className={ETIQUETA}>
          {copy.panel.primary}
          <select name="primary" defaultValue={principal} className={CAJA}>
            {(Object.keys(CATEGORY_GROUPS) as CategoryGroup[]).map((group) => (
              <optgroup key={group} label={copy.groups[group]}>
                {CATEGORY_GROUPS[group].map((category) => (
                  <option key={category} value={category}>
                    {copy.categories[category]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="opacity-70">
            {copy.panel.categoriesHelp} ({MAX_CATEGORIES})
          </span>
        </label>

        <button type="submit" className={BOTON}>
          {copy.panel.save}
        </button>
      </form>

      {/* ------------------------------------------------------ las traducciones */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">{copy.panel.translationsTitle}</h2>
        <p className="text-xs text-[#6a6456]">{copy.panel.translationsHelp}</p>

        {DIRECTORY_LOCALES.map((one) => {
          const texto = provider.translations.find((row) => row.locale === one);
          return (
            <details key={one} open={one === provider.mainLocale} className="border border-[#ddd6c6] bg-white">
              <summary className="cursor-pointer px-4 py-2 text-sm">
                {one.toUpperCase()}
                {texto === undefined ? '' : ` · ${texto.name}`}
              </summary>
              <form action={setTranslationAction} className="flex flex-col gap-3 p-4">
                {oculto}
                <input type="hidden" name="locale" value={one} />

                <label className={ETIQUETA}>
                  {copy.panel.name}
                  <input name="name" defaultValue={texto?.name ?? ''} maxLength={120} className={CAJA} />
                </label>
                <label className={ETIQUETA}>
                  {copy.panel.tagline}
                  <input
                    name="tagline"
                    defaultValue={texto?.tagline ?? ''}
                    maxLength={160}
                    className={CAJA}
                  />
                </label>
                <label className={ETIQUETA}>
                  {copy.panel.description}
                  <textarea
                    name="description"
                    defaultValue={texto?.description ?? ''}
                    rows={4}
                    className={CAJA}
                  />
                </label>
                <label className={ETIQUETA}>
                  {copy.provider.services}
                  <textarea
                    name="services"
                    defaultValue={(texto?.services ?? []).join('\n')}
                    rows={4}
                    className={CAJA}
                  />
                  <span className="opacity-70">{copy.panel.servicesHelp}</span>
                </label>

                <button type="submit" className={BOTON}>
                  {copy.panel.save}
                </button>
              </form>
            </details>
          );
        })}
      </section>

      {/* --------------------------------------------------------- el contacto */}
      <form action={setContactsAction} className={SECCION}>
        {oculto}
        <h2 className="text-lg">{copy.panel.contactsTitle}</h2>
        <p className="text-xs text-[#6a6456]">{copy.panel.contactsHelp}</p>

        {CONTACT_CHANNELS.map((channel) => {
          const guardado = provider.contacts.find((one) => one.channel === channel);
          return (
            <div key={channel} className="flex flex-wrap items-end gap-3">
              <label className={`${ETIQUETA} flex-1`}>
                {copy.channels[channel]}
                <input
                  name={`value-${channel}`}
                  defaultValue={guardado?.value ?? ''}
                  maxLength={200}
                  dir="ltr"
                  className={CAJA}
                />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  name={`public-${channel}`}
                  defaultChecked={guardado?.isPublic ?? false}
                />
                {copy.panel.public}
              </label>
            </div>
          );
        })}

        <button type="submit" className={BOTON}>
          {copy.panel.save}
        </button>
      </form>
    </>
  );
}

/** Quien administra dos negocios elige; no se adivina cuál quería editar. */
async function Chooser({ userId, copy }: { userId: string; copy: DirectoryDictionary }) {
  const mine = await myProviders(userId);
  if (mine.length === 0) redirect('/panel/proveedor/nuevo');

  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl">{copy.panel.title}</h1>
      <ul className="flex flex-col gap-2">
        {mine.map((one) => (
          <li key={one.id}>
            <Link
              href={`/panel/proveedor?p=${encodeURIComponent(one.id)}`}
              className="block border border-[#ddd6c6] bg-white p-3 text-sm hover:bg-[#fbf6ec]"
            >
              {one.legalName}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/panel/proveedor/nuevo" className="self-start text-sm underline">
        {copy.panel.newTitle}
      </Link>
    </section>
  );
}
