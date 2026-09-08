import type { CSSProperties } from 'react';

import { TEMPLATES } from '@/components/templates/registry';
import { getDictionary } from '@/lib/dictionary';
import type { Invitation } from '@/lib/types';

/** The per-invitation palette travels as custom properties, never as classes. */
interface ThemeStyle extends CSSProperties {
  '--inv-primary': string;
  '--inv-accent': string;
  '--inv-background': string;
}

interface InvitationCardProps {
  invitation: Invitation;
  /** Renders live links (web page) versus a static composition (PNG export). */
  interactive?: boolean;
  className?: string;
}

/**
 * Direction and language are set here, on the card root, and the card is a CSS
 * size container: everything below sizes itself relative to the 1080×1920
 * design regardless of the pixel size it is displayed at.
 */
export function InvitationCard({ invitation, interactive = false, className = '' }: InvitationCardProps) {
  const dictionary = getDictionary(invitation.locale);
  const Template = TEMPLATES[invitation.templateId];
  const style: ThemeStyle = {
    '--inv-primary': invitation.theme.primary,
    '--inv-accent': invitation.theme.accent,
    '--inv-background': invitation.theme.background,
  };

  return (
    <article
      dir={invitation.direction}
      lang={invitation.locale}
      style={style}
      aria-label={dictionary.aria.invitationCard}
      className={`aspect-[1080/1920] w-full [container-type:size] ${className}`.trim()}
    >
      <Template invitation={invitation} dictionary={dictionary} interactive={interactive} />
    </article>
  );
}
