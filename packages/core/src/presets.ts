import type { EventType, TemplateId, Theme } from './types';

/**
 * A memorial is not a celebration. Rendering one in the same gold and floral
 * frame as a wedding is not a matter of taste — it offends — so the template and
 * the palette are decided by the kind of event, not left to whoever fills in the
 * form.
 */
export function templateFor(eventType: EventType): TemplateId {
  return eventType === 'memorial' ? 'sober-memorial' : 'classic-gold';
}

const CELEBRATION: Theme = { primary: '#6B4E16', accent: '#C9A227', background: '#FBF6EC' };
const MOURNING: Theme = { primary: '#2F332E', accent: '#8B8C7E', background: '#F2F1ED' };

export function themeFor(eventType: EventType): Theme {
  return eventType === 'memorial' ? MOURNING : CELEBRATION;
}
