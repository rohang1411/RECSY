/**
 * UUID validation utility.
 * Validates whether a value is a valid 36-character hexadecimal UUID string
 * compatible with PostgreSQL's uuid column type.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}
