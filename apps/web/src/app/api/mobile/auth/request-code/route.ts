import { clientIp } from '@/lib/admin/context';
import { readJson, str } from '@/lib/api/mobile';
import { requestLoginCode } from '@/lib/auth/otp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { email } — always answers the same, whoever asked. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  await requestLoginCode(str(body, 'email'), clientIp(request.headers) ?? undefined);
  return Response.json({ sent: true });
}
