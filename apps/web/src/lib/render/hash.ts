import { createHash } from 'node:crypto';

import type { Invitation } from '@citas/core';

/**
 * Bumped whenever the templates or the renderer change in a way that alters the
 * image. Without it, a redesign would keep serving yesterday's picture.
 */
export const RENDERER_VERSION = '1';

/**
 * A fingerprint of everything that can change the image: the words, the
 * language, the direction, the numerals, the template and the palette. Two
 * invitations with the same fingerprint produce the same PNG, so one render
 * serves both — and an edit changes the fingerprint and invalidates it.
 */
export function contentHashOf(invitation: Invitation): string {
  const material = {
    v: RENDERER_VERSION,
    templateId: invitation.templateId,
    locale: invitation.locale,
    direction: invitation.direction,
    numeralSystem: invitation.numeralSystem,
    eventType: invitation.eventType,
    hosts: invitation.hosts,
    honorees: invitation.honorees,
    date: invitation.date,
    time: invitation.time,
    timeZone: invitation.timeZone,
    hijriDate: invitation.hijriDate ?? null,
    venue: { name: invitation.venue.name, address: invitation.venue.address },
    message: invitation.message,
    quote: invitation.quote ?? null,
    theme: invitation.theme,
    rsvp: invitation.rsvp,
  };

  return createHash('sha256').update(JSON.stringify(material), 'utf8').digest('hex').slice(0, 32);
}
