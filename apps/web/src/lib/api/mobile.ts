import { getBearerSession, type AuthenticatedSession } from '@/lib/auth/session';

/** JSON body, or null when the request did not send one we can parse. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function str(body: Record<string, unknown> | null, key: string): string {
  const value = body?.[key];
  return typeof value === 'string' ? value : '';
}

export interface Authorized {
  session: AuthenticatedSession;
}

/**
 * Every mobile endpoint goes through here. The app is a client like any other:
 * it proves who it is with a bearer token and gets nothing on trust.
 */
export async function authorize(request: Request): Promise<Authorized | Response> {
  const session = await getBearerSession(request.headers);
  if (session === null) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return { session };
}

export function isResponse(value: Authorized | Response): value is Response {
  return value instanceof Response;
}
