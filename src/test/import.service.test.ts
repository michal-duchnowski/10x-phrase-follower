import { describe, it, expect } from "vitest";
import {
  normalizeText,
  parseLine,
  processImportLines,
  validateImportCommand,
  generatePositions,
  createBasicTokens,
} from "../lib/import.service";
import { ApiError } from "../lib/errors";

describe("Import Service", () => {
  describe("normalizeText", () => {
    it("should remove zero-width characters", () => {
      const input = "Hello\u200B\u200C\u200D\uFEFFworld";
      const result = normalizeText(input);
      expect(result).toBe("Hello world");
    });

    it("should convert typographic quotes to simple quotes", () => {
      const input = "He said \"Hello\" and 'Goodbye'";
      const result = normalizeText(input);
      expect(result).toBe("He said \"Hello\" and 'Goodbye'");
    });

    it("should reduce multiple spaces to single spaces", () => {
      const input = "Hello    world   test";
      const result = normalizeText(input);
      expect(result).toBe("Hello world test");
    });

    it("should trim whitespace", () => {
      const input = "  Hello world  ";
      const result = normalizeText(input);
      expect(result).toBe("Hello world");
    });

    it("should preserve hyphens and em-dashes", () => {
      const input = "Hello-world and Hello—world";
      const result = normalizeText(input);
      expect(result).toBe("Hello-world and Hello—world");
    });
  });

  describe("parseLine", () => {
    it("should parse valid EN ::: PL format", () => {
      const result = parseLine("Hello world ::: Cześć świecie", 1);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        en: "Hello world",
        pl: "Cześć świecie",
        lineNo: 1,
        rawText: "Hello world ::: Cześć świecie",
      });
    });

    it("should reject empty line", () => {
      const result = parseLine("", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Empty line");
    });

    it("should reject line without separator", () => {
      const result = parseLine("Hello world Cześć świecie", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Missing separator (:::) between EN and PL parts");
    });

    it("should reject line with multiple separators", () => {
      const result = parseLine("Hello ::: world ::: Cześć", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Multiple separators (:::) found, expected exactly one");
    });

    it("should reject empty EN part", () => {
      const result = parseLine(" ::: Cześć świecie", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Empty EN part");
    });

    it("should reject empty PL part", () => {
      const result = parseLine("Hello world ::: ", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Empty PL part");
    });

    it("should reject EN part exceeding 2000 characters", () => {
      const longText = "a".repeat(2001);
      const result = parseLine(`${longText} ::: Cześć`, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("EN part exceeds 2000 characters");
    });

    it("should reject PL part exceeding 2000 characters", () => {
      const longText = "a".repeat(2001);
      const result = parseLine(`Hello ::: ${longText}`, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("PL part exceeds 2000 characters");
    });

    it("should handle whitespace around separator", () => {
      const result = parseLine("  Hello world  :::  Cześć świecie  ", 1);
      expect(result.success).toBe(true);
      expect(result.data?.en).toBe("Hello world");
      expect(result.data?.pl).toBe("Cześć świecie");
    });
  });

  describe("processImportLines", () => {
    it("should process valid lines", () => {
      const lines = ["Hello ::: Cześć", "Goodbye ::: Do widzenia", "Thank you ::: Dziękuję"];
      const result = processImportLines(lines);
      expect(result.accepted).toHaveLength(3);
      expect(result.rejected).toHaveLength(0);
    });

    it("should reject invalid lines", () => {
      const lines = ["Hello ::: Cześć", "Invalid line without separator", " ::: Empty EN", "Goodbye ::: Do widzenia"];
      const result = processImportLines(lines);
      expect(result.accepted).toHaveLength(2);
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected[0].reason).toBe("Missing separator (:::) between EN and PL parts");
      expect(result.rejected[1].reason).toBe("Empty EN part");
    });

    it("should apply normalization when requested", () => {
      const lines = ["  Hello    world  :::  Cześć   świecie  ", 'He said "Hello" ::: Powiedział "Cześć"'];
      const result = processImportLines(lines, true);
      expect(result.accepted).toHaveLength(2);
      expect(result.accepted[0].en).toBe("Hello world");
      expect(result.accepted[0].pl).toBe("Cześć świecie");
      expect(result.accepted[1].en).toBe('He said "Hello"');
      expect(result.accepted[1].pl).toBe('Powiedział "Cześć"');
    });
  });

  describe("validateImportCommand", () => {
    it("should validate correct command", () => {
      const command = {
        notebook_id: "00000000-0000-0000-0000-000000000000",
        name: "Test Notebook",
        lines: ["Hello ::: Cześć"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).not.toThrow();
    });

    it("should reject missing name", () => {
      const command = {
        lines: ["Hello ::: Cześć"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject invalid name length", () => {
      const command = {
        name: "a".repeat(101),
        lines: ["Hello ::: Cześć"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject empty lines array", () => {
      const command = {
        name: "Test Notebook",
        lines: [],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject too many lines", () => {
      const command = {
        name: "Test Notebook",
        lines: new Array(101).fill("Hello ::: Cześć"),
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject non-string lines", () => {
      const command = {
        name: "Test Notebook",
        lines: ["Hello ::: Cześć", 123],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject invalid notebook_id type", () => {
      const command = {
        notebook_id: 123,
        name: "Test Notebook",
        lines: ["Hello ::: Cześć"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });
  });

  describe("generatePositions", () => {
    it("should generate positions stepped by 10", () => {
      const positions = generatePositions(5);
      expect(positions).toEqual([10, 20, 30, 40, 50]);
    });

    it("should handle empty array", () => {
      const positions = generatePositions(0);
      expect(positions).toEqual([]);
    });
  });

  describe("createBasicTokens", () => {
    it("should create basic tokenization", () => {
      const tokens = createBasicTokens("Hello world", "Cześć świecie");
      expect(tokens.en).toHaveLength(2);
      expect(tokens.pl).toHaveLength(2);
      expect(tokens.en[0]).toEqual({ text: "Hello", start: 0, end: 5 });
      expect(tokens.en[1]).toEqual({ text: "world", start: 6, end: 11 });
    });

    it("should handle empty strings", () => {
      const tokens = createBasicTokens("", "");
      expect(tokens.en).toEqual([]);
      expect(tokens.pl).toEqual([]);
    });
  });
});
