/**
 * The backend's input rules (src/auth/dto/validators.ts), checked here first for instant feedback.
 * The backend still validates everything itself. Each returns a sentence, or null if the value is fine.
 */

export function emailProblem(email: string): string | null {
  return /^\S+@\S+\.\S+$/.test(email.trim()) ? null : 'Please enter a valid email address.';
}

/**
 * Same rule as NAME_PATTERN in the backend: letters (any alphabet), with a single space, hyphen,
 * apostrophe or dot between the parts. OK: "Ayesha Khan", "Abdul-Rahman", "O'Brien", "M. Ali".
 */
export const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:(?:\. ?|[ '-])\p{L}[\p{L}\p{M}]*)*\.?$/u;

export function nameProblem(name: string): string | null {
  const tidy = name.trim().replace(/\s+/g, ' '); // the backend tidies spaces the same way
  if (tidy.length < 2 || tidy.length > 80) return 'Name must be 2 to 80 characters.';
  if (/\d/.test(tidy)) return 'Name cannot contain numbers.';
  if (!NAME_PATTERN.test(tidy)) return "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots.";
  return null;
}

/** A password being set: 8-72 characters (bcrypt reads only 72 bytes) with a letter and a number. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8 || password.length > 72) return 'Password must be 8 to 72 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain a letter and a number.';
  return null;
}

export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number.';

/** True when all 6 boxes hold a digit. */
export const isCompleteCode = (code: string): boolean => /^\d{6}$/.test(code);
