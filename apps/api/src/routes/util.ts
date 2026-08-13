/**
 * Masked client reference shown to partner operators (never a real id) — e.g.
 * `Client ••7134`. Derived from the user id's digits so it is stable per user.
 */
export function maskRef(userId: string): string {
  const digits = userId.replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '0');
  return `Client ••${last4}`;
}
