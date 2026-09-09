import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, passwordProblems, MIN_PASSWORD_LENGTH } from '../src/lib/auth/password';

/**
 * Gives an account a password, for the days the mail is not moving.
 *
 * The secret is read from standard input and never from an argument: arguments
 * survive in the process list and in the shell's history, which is exactly how
 * a password stops being one.
 *
 *   echo -n 'the password' | npm run auth:password -- someone@example.com
 *   npm run auth:password -- someone@example.com      # then type it, then Ctrl-D
 *
 * Only the platform's own account and an office's administrator may be given
 * one. The end client signs in with a code; that is the product's rule and this
 * script refuses to be the exception to it.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (email.length === 0) {
    console.error('Usage: npm run auth:password -- <email>   (the password arrives on stdin)');
    process.exitCode = 1;
    return;
  }

  const password = await readStdin();
  const problems = passwordProblems(password);
  if (problems.includes('tooShort')) {
    console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }
  if (problems.includes('padded')) {
    console.error('The password starts or ends with a space. Refusing: it will be retyped wrong.');
    process.exitCode = 1;
    return;
  }

  const url = process.env['DATABASE_URL'];
  if (url === undefined) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, isSuperadmin: true, memberships: { select: { role: true } } },
    });
    if (user === null) {
      console.error(`No account for ${email}. Create it first (npm run db:seed).`);
      process.exitCode = 1;
      return;
    }

    const allowed =
      user.isSuperadmin || user.memberships.some((entry) => entry.role === 'TENANT_ADMIN');
    if (!allowed) {
      console.error(
        `${email} is neither the platform account nor an office administrator. ` +
          'Those accounts sign in with the emailed code, by design.',
      );
      process.exitCode = 1;
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
    console.log(`Password set for ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
