import { ApiErrors } from "./errors";

/**
 * Comprehensive validation service for API endpoints
 */

/**
 * Validates UUID format (v4)
 */
export function validateUUID(value: string, fieldName = "ID"): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw ApiErrors.validationError(`Invalid ${fieldName} format. Must be a valid UUID v4`);
  }
}

/**
 * Validates text length constraints
 */
export function validateTextLength(value: string, minLength: number, maxLength: number, fieldName: string): void {
  if (typeof value !== "string") {
    throw ApiErrors.validationError(`${fieldName} must be a string`);
  }

  if (value.length < minLength) {
    throw ApiErrors.validationError(`${fieldName} must be at least ${minLength} characters long`);
  }

  if (value.length > maxLength) {
    throw ApiErrors.validationError(`${fieldName} must be at most ${maxLength} characters long`);
  }
}

/**
 * Validates integer constraints
 */
export function validateInteger(value: unknown, min?: number, max?: number, fieldName = "Value"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw ApiErrors.validationError(`${fieldName} must be an integer`);
  }

  if (min !== undefined && value < min) {
    throw ApiErrors.validationError(`${fieldName} must be at least ${min}`);
  }

  if (max !== undefined && value > max) {
    throw ApiErrors.validationError(`${fieldName} must be at most ${max}`);
  }

  return value;
}

/**
 * Validates pagination parameters
 */
export function validatePaginationParams(
  url: URL,
  maxLimit = 100
): {
  limit: number;
  cursor: string | null;
} {
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");

  let limit = 25; // default
  if (limitParam) {
    const parsedLimit = parseInt(limitParam);
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      throw ApiErrors.validationError("Limit must be a positive integer");
    }
    limit = Math.min(parsedLimit, maxLimit);
  }

  return { limit, cursor };
}

/**
 * Validates sort parameters
 */
export function validateSortParams(
  url: URL,
  allowedSorts: string[],
  defaultSort: string = allowedSorts[0]
): {
  sort: string;
  order: "asc" | "desc";
} {
  const sort = url.searchParams.get("sort") || defaultSort;
  const order = url.searchParams.get("order") || "desc";

  if (!allowedSorts.includes(sort)) {
    throw ApiErrors.validationError(`Invalid sort field. Must be one of: ${allowedSorts.join(", ")}`);
  }

  if (!["asc", "desc"].includes(order)) {
    throw ApiErrors.validationError("Invalid order. Must be 'asc' or 'desc'");
  }

  return { sort, order: order as "asc" | "desc" };
}

/**
 * Validates search query parameter
 */
export function validateSearchQuery(url: URL): string | null {
  const q = url.searchParams.get("q");

  if (q !== null) {
    if (typeof q !== "string") {
      throw ApiErrors.validationError("Search query must be a string");
    }

    if (q.length > 100) {
      throw ApiErrors.validationError("Search query must be at most 100 characters");
    }

    // Check for potentially malicious patterns
    if (/[<>"'&]/.test(q)) {
      throw ApiErrors.validationError("Search query contains invalid characters");
    }
  }

  return q;
}

/**
 * Validates JSON body structure
 */
export function validateJsonBody(body: unknown, requiredFields: string[]): void {
  if (typeof body !== "object" || body === null) {
    throw ApiErrors.validationError("Request body must be a valid JSON object");
  }

  for (const field of requiredFields) {
    if (!(field in body)) {
      throw ApiErrors.validationError(`Missing required field: ${field}`);
    }
  }
}

/**
 * Validates array constraints
 */
export function validateArray(value: unknown, minLength?: number, maxLength?: number, fieldName = "Array"): unknown[] {
  if (!Array.isArray(value)) {
    throw ApiErrors.validationError(`${fieldName} must be an array`);
  }

  if (minLength !== undefined && value.length < minLength) {
    throw ApiErrors.validationError(`${fieldName} must have at least ${minLength} items`);
  }

  if (maxLength !== undefined && value.length > maxLength) {
    throw ApiErrors.validationError(`${fieldName} must have at most ${maxLength} items`);
  }

  return value;
}

/**
 * Validates boolean field
 */
export function validateBoolean(value: unknown, fieldName = "Field"): boolean {
  if (typeof value !== "boolean") {
    throw ApiErrors.validationError(`${fieldName} must be a boolean`);
  }
  return value;
}

/**
 * Validates optional boolean field
 */
export function validateOptionalBoolean(value: unknown, fieldName = "Field"): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validateBoolean(value, fieldName);
}

/**
 * Sanitizes text input by trimming and removing control characters
 */
export function sanitizeText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .trim()
  );
}

/**
 * Validates that a value is not empty after sanitization
 */
export function validateNonEmptyText(value: string, fieldName: string): string {
  const sanitized = sanitizeText(value);
  if (sanitized.length === 0) {
    throw ApiErrors.validationError(`${fieldName} cannot be empty`);
  }
  return sanitized;
}

/**
 * Validates rate limiting (basic implementation)
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function validateRateLimit(key: string, maxRequests: number, windowMs: number): void {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    // Reset or create entry
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    return;
  }

  if (entry.count >= maxRequests) {
    throw ApiErrors.limitExceeded("Rate limit exceeded. Please try again later.");
  }

  entry.count++;
}

/**
 * Cleans up expired rate limit entries
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}
