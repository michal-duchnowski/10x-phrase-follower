import { describe, it, expect } from "vitest";
import {
  validateUUID,
  validateTextLength,
  validateInteger,
  validatePaginationParams,
  validateSortParams,
  validateSearchQuery,
  validateJsonBody,
  validateArray,
  validateBoolean,
  validateOptionalBoolean,
  sanitizeText,
  validateNonEmptyText,
  validateRateLimit,
} from "../lib/validation.service";
import { ApiError } from "../lib/errors";

describe("Validation Service", () => {
  describe("validateUUID", () => {
    it("should accept valid UUID v4", () => {
      const validUUID = "550e8400-e29b-41d4-a716-446655440000";
      expect(() => validateUUID(validUUID)).not.toThrow();
    });

    it("should reject invalid UUID format", () => {
      const invalidUUID = "not-a-uuid";
      expect(() => validateUUID(invalidUUID)).toThrow(ApiError);
    });

    it("should reject non-UUID v4", () => {
      const nonV4 = "550e8400-e29b-31d4-a716-446655440000"; // v3 UUID
      expect(() => validateUUID(nonV4)).toThrow(ApiError);
    });
  });

  describe("validateTextLength", () => {
    it("should accept text within length limits", () => {
      expect(() => validateTextLength("Hello", 1, 10, "Text")).not.toThrow();
    });

    it("should reject text that is too short", () => {
      expect(() => validateTextLength("", 1, 10, "Text")).toThrow(ApiError);
    });

    it("should reject text that is too long", () => {
      expect(() => validateTextLength("a".repeat(11), 1, 10, "Text")).toThrow(ApiError);
    });

    it("should reject non-string input", () => {
      expect(() => validateTextLength(123 as unknown as string, 1, 10, "Text")).toThrow(ApiError);
    });
  });

  describe("validateInteger", () => {
    it("should accept valid integer within range", () => {
      const result = validateInteger(5, 1, 10, "Value");
      expect(result).toBe(5);
    });

    it("should reject non-integer", () => {
      expect(() => validateInteger(5.5, 1, 10, "Value")).toThrow(ApiError);
    });

    it("should reject value below minimum", () => {
      expect(() => validateInteger(0, 1, 10, "Value")).toThrow(ApiError);
    });

    it("should reject value above maximum", () => {
      expect(() => validateInteger(11, 1, 10, "Value")).toThrow(ApiError);
    });
  });

  describe("validatePaginationParams", () => {
    it("should use default values", () => {
      const url = new URL("http://example.com");
      const result = validatePaginationParams(url);
      expect(result.limit).toBe(25);
      expect(result.cursor).toBeNull();
    });

    it("should parse valid limit", () => {
      const url = new URL("http://example.com?limit=50");
      const result = validatePaginationParams(url);
      expect(result.limit).toBe(50);
    });

    it("should allow a custom phrase page limit of 200", () => {
      expect(validatePaginationParams(new URL("http://example.com?limit=200"), 200).limit).toBe(200);
      expect(validatePaginationParams(new URL("http://example.com?limit=201"), 200).limit).toBe(200);
    });

    it("should cap limit at 100", () => {
      const url = new URL("http://example.com?limit=150");
      const result = validatePaginationParams(url);
      expect(result.limit).toBe(100);
    });

    it("should reject invalid limit", () => {
      const url = new URL("http://example.com?limit=abc");
      expect(() => validatePaginationParams(url)).toThrow(ApiError);
    });

    it("should reject negative limit", () => {
      const url = new URL("http://example.com?limit=-1");
      expect(() => validatePaginationParams(url)).toThrow(ApiError);
    });
  });

  describe("validateSortParams", () => {
    it("should use default values", () => {
      const url = new URL("http://example.com");
      const result = validateSortParams(url, ["name", "date"], "name");
      expect(result.sort).toBe("name");
      expect(result.order).toBe("desc");
    });

    it("should accept valid sort and order", () => {
      const url = new URL("http://example.com?sort=date&order=asc");
      const result = validateSortParams(url, ["name", "date"], "name");
      expect(result.sort).toBe("date");
      expect(result.order).toBe("asc");
    });

    it("should reject invalid sort field", () => {
      const url = new URL("http://example.com?sort=invalid");
      expect(() => validateSortParams(url, ["name", "date"], "name")).toThrow(ApiError);
    });

    it("should reject invalid order", () => {
      const url = new URL("http://example.com?order=invalid");
      expect(() => validateSortParams(url, ["name", "date"], "name")).toThrow(ApiError);
    });
  });

  describe("validateSearchQuery", () => {
    it("should accept valid search query", () => {
      const url = new URL("http://example.com?q=hello");
      const result = validateSearchQuery(url);
      expect(result).toBe("hello");
    });

    it("should return null when no query", () => {
      const url = new URL("http://example.com");
      const result = validateSearchQuery(url);
      expect(result).toBeNull();
    });

    it("should reject query that is too long", () => {
      const url = new URL(`http://example.com?q=${"a".repeat(101)}`);
      expect(() => validateSearchQuery(url)).toThrow(ApiError);
    });

    it("should reject query with invalid characters", () => {
      const url = new URL("http://example.com?q=hello<script>");
      expect(() => validateSearchQuery(url)).toThrow(ApiError);
    });
  });

  describe("validateJsonBody", () => {
    it("should accept valid object with required fields", () => {
      const body = { name: "test", value: 123 };
      expect(() => validateJsonBody(body, ["name"])).not.toThrow();
    });

    it("should reject non-object", () => {
      expect(() => validateJsonBody("string", ["name"])).toThrow(ApiError);
    });

    it("should reject null", () => {
      expect(() => validateJsonBody(null, ["name"])).toThrow(ApiError);
    });

    it("should reject object missing required field", () => {
      const body = { value: 123 };
      expect(() => validateJsonBody(body, ["name"])).toThrow(ApiError);
    });
  });

  describe("validateArray", () => {
    it("should accept valid array", () => {
      const result = validateArray([1, 2, 3], 1, 10, "Array");
      expect(result).toEqual([1, 2, 3]);
    });

    it("should reject non-array", () => {
      expect(() => validateArray("string", 1, 10, "Array")).toThrow(ApiError);
    });

    it("should reject array that is too short", () => {
      expect(() => validateArray([1], 2, 10, "Array")).toThrow(ApiError);
    });

    it("should reject array that is too long", () => {
      expect(() => validateArray([1, 2, 3], 1, 2, "Array")).toThrow(ApiError);
    });
  });

  describe("validateBoolean", () => {
    it("should accept true", () => {
      const result = validateBoolean(true, "Field");
      expect(result).toBe(true);
    });

    it("should accept false", () => {
      const result = validateBoolean(false, "Field");
      expect(result).toBe(false);
    });

    it("should reject non-boolean", () => {
      expect(() => validateBoolean("true", "Field")).toThrow(ApiError);
    });
  });

  describe("validateOptionalBoolean", () => {
    it("should accept true", () => {
      const result = validateOptionalBoolean(true, "Field");
      expect(result).toBe(true);
    });

    it("should accept undefined", () => {
      const result = validateOptionalBoolean(undefined, "Field");
      expect(result).toBeUndefined();
    });

    it("should accept null", () => {
      const result = validateOptionalBoolean(null, "Field");
      expect(result).toBeUndefined();
    });

    it("should reject non-boolean", () => {
      expect(() => validateOptionalBoolean("true", "Field")).toThrow(ApiError);
    });
  });

  describe("sanitizeText", () => {
    it("should remove control characters", () => {
      const result = sanitizeText("Hello\x00\x1F\x7Fworld");
      expect(result).toBe("Helloworld");
    });

    it("should trim whitespace", () => {
      const result = sanitizeText("  Hello world  ");
      expect(result).toBe("Hello world");
    });
  });

  describe("validateNonEmptyText", () => {
    it("should accept non-empty text", () => {
      const result = validateNonEmptyText("Hello", "Field");
      expect(result).toBe("Hello");
    });

    it("should reject empty text", () => {
      expect(() => validateNonEmptyText("", "Field")).toThrow(ApiError);
    });

    it("should reject whitespace-only text", () => {
      expect(() => validateNonEmptyText("   ", "Field")).toThrow(ApiError);
    });
  });

  describe("validateRateLimit", () => {
    it("should allow first request", () => {
      expect(() => validateRateLimit("test-key", 5, 60000)).not.toThrow();
    });

    it("should allow requests within limit", () => {
      const key = "test-key-2";
      expect(() => validateRateLimit(key, 5, 60000)).not.toThrow();
      expect(() => validateRateLimit(key, 5, 60000)).not.toThrow();
      expect(() => validateRateLimit(key, 5, 60000)).not.toThrow();
    });

    it("should reject requests exceeding limit", () => {
      const key = "test-key-3";
      // Make 5 requests (the limit)
      for (let i = 0; i < 5; i++) {
        validateRateLimit(key, 5, 60000);
      }
      // The 6th request should be rejected
      expect(() => validateRateLimit(key, 5, 60000)).toThrow(ApiError);
    });
  });
});
