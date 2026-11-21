/** Returns an error message, or null when the prefix is valid. */
export function validatePrefix(p: string): string | null {
  if (p.length < 1 || p.length > 3) return 'Prefix must be 1–3 characters long.';
  if (/\s/.test(p)) return 'Prefix cannot contain whitespace.';
  if (/[`@#\\<>]/.test(p)) return 'Prefix cannot contain ` @ # \\ < or >.';
  if (p === '/') return 'Prefix cannot be "/" (reserved for slash commands).';
  return null;
}
