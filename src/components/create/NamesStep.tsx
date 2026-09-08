import { MAX_HONOREES, MAX_HOSTS, type InvitationDraft } from '@/lib/create/draft';
import { HOST_ROLES, type Dictionary } from '@/lib/types';

import { Field, FIELD_CLASS } from './Field';

/**
 * Fixed slots rather than an "add another" button: the whole flow works without
 * a line of client JavaScript, and two names covers a wedding.
 */
export function NamesStep({
  draft,
  dictionary,
}: {
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-sm text-[#23201a]">{copy.honoreesLabel}</legend>
        {Array.from({ length: MAX_HONOREES }, (_, index) => (
          <input
            key={index}
            name={`honoree${index}`}
            defaultValue={draft.honorees[index] ?? ''}
            maxLength={120}
            required={index === 0}
            className={FIELD_CLASS}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="pb-2 text-sm text-[#23201a]">{copy.hostsLabel}</legend>
        {Array.from({ length: MAX_HOSTS }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 sm:flex-row">
            <input
              name={`hostName${index}`}
              defaultValue={draft.hosts[index]?.name ?? ''}
              maxLength={120}
              className={`${FIELD_CLASS} sm:flex-1`}
            />
            <Field label={copy.hostRoleLabel}>
              <select
                name={`hostRole${index}`}
                defaultValue={draft.hosts[index]?.role ?? 'parents'}
                className={FIELD_CLASS}
              >
                {HOST_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {dictionary.roles[role]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
