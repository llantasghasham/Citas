import { bodyFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/**
 * Who is inviting: a translated role label plus the host's name as authored.
 * A role label is printed once per run of hosts sharing it, so a two-family
 * wedding reads "The parents · A / B" rather than repeating the label.
 */
export function HostsBlock({ invitation, dictionary }: InvitationPartProps) {
  const { locale, hosts } = invitation;
  if (hosts.length === 0) return null;

  return (
    <ul className={`${bodyFont(locale)} flex flex-col gap-[1cqw] text-[3cqw] text-[color:var(--inv-primary)]`}>
      {hosts.map((host, index) => {
        const showRole = index === 0 || hosts[index - 1]?.role !== host.role;
        return (
          <li key={`${host.role}-${host.name}`}>
            {showRole ? (
              <>
                <span className="opacity-65">{dictionary.roles[host.role]}</span>
                <span className="mx-[0.8cqw] opacity-45">·</span>
              </>
            ) : null}
            <span>{host.name}</span>
          </li>
        );
      })}
    </ul>
  );
}
