/** "ayesha.khan@example.com" -> "a***@example.com": enough to recognise in a log, not the full address. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
}
