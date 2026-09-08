/**
 * Name of the cookie that remembers which guest this browser is, so someone can
 * come back and change their reply without ever creating an account.
 */
export function guestCookieName(slug: string): string {
  return `citas_guest_${slug}`;
}
