import { API_URL } from './config';

export interface Me {
  email: string;
  role: string | null;
  tenant: { id: string; name: string; locale: string } | null;
  limits: { tier: string; maxEvents: number | null; eventsUsed: number } | null;
}

export interface EventSummary {
  id: string;
  type: string;
  date: string;
  title: string;
  guests: number;
  attending: number;
  declined: number;
  tentative: number;
}

export interface Guest {
  name: string;
  locale: string;
  status: string | null;
  party: number | null;
  message: string | null;
  respondedAt: string | null;
  selfAdded: boolean;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function call<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `${init?.method ?? 'GET'} ${path} → ${response.status}`);
  }
  return (await response.json()) as T;
}

export function requestCode(email: string): Promise<{ sent: boolean }> {
  return call('/api/mobile/auth/request-code', null, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function verifyCode(email: string, code: string): Promise<{ token: string }> {
  return call('/api/mobile/auth/verify', null, {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

export function fetchMe(token: string): Promise<Me> {
  return call('/api/mobile/me', token);
}

export function fetchEvents(token: string): Promise<{ events: EventSummary[] }> {
  return call('/api/mobile/events', token);
}

export function fetchGuests(token: string, eventId: string): Promise<{ guests: Guest[] }> {
  return call(`/api/mobile/events/${eventId}/guests`, token);
}
