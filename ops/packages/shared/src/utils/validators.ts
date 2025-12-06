/**
 * Shared validation utilities
 */

/**
 * Validate that a string is not empty
 */
export function validateNonEmpty(value: string, fieldName: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
}

/**
 * Validate that a number is within a range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): void {
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
}

/**
 * Validate API key format (basic check)
 */
export function validateApiKey(apiKey: string): void {
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    throw new Error('Invalid API key format. Expected format: sk-ant-...');
  }
}

/**
 * Sanitize API key for logging (show first 10 chars only)
 */
export function sanitizeApiKey(apiKey: string): string {
  return apiKey.substring(0, 10) + '...';
}
