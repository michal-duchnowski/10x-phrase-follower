import { describe, it, expect } from "vitest";
import {
  normalizeText,
  parseLine,
  processImportLines,
  validateImportCommand,
  generatePositions,
  createBasicTokens,
  splitImportRecords,
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
      const input = "Hello-world and Hello-world";
      const result = normalizeText(input);
      expect(result).toBe("Hello-world and Hello-world");
    });
  });

  describe("parseLine", () => {
    it("should parse valid EN ::: PL format", () => {
      const result = parseLine("Hello world ::: Czesc swiecie", 1);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        en: "Hello world",
        pl: "Czesc swiecie",
        learningHintMarkdown: null,
        lineNo: 1,
        rawText: "Hello world ::: Czesc swiecie",
      });
    });

    it('should parse valid EN ::: PL :::"hint"::: format', () => {
      const result = parseLine('afford ::: can pay for :::"**Usage:** often with `can`.":::', 1);
      expect(result.success).toBe(true);
      expect(result.data?.learningHintMarkdown).toBe("**Usage:** often with `can`.");
    });

    it("should allow plain separators inside quoted learning hints", () => {
      const result = parseLine('afford ::: can pay for :::"Use ::: inside markdown safely.":::', 1);
      expect(result.success).toBe(true);
      expect(result.data?.learningHintMarkdown).toBe("Use ::: inside markdown safely.");
    });

    it("should reject empty line", () => {
      const result = parseLine("", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Empty line");
    });

    it("should reject line without separator", () => {
      const result = parseLine("Hello world Czesc swiecie", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Missing separator (:::) between EN and PL parts");
    });

    it("should reject line with too many separators", () => {
      const result = parseLine("Hello ::: world ::: Czesc ::: extra", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Too many separators (:::) found, expected EN ::: PL or EN ::: PL :::"hint":::');
    });

    it("should reject empty EN part", () => {
      const result = parseLine(" ::: Czesc swiecie", 1);
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
      const result = parseLine(`${longText} ::: Czesc`, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("EN part exceeds 2000 characters");
    });

    it("should reject PL part exceeding 2000 characters", () => {
      const longText = "a".repeat(2001);
      const result = parseLine(`Hello ::: ${longText}`, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("PL part exceeds 2000 characters");
    });

    it("should reject an oversized learning hint", () => {
      const longText = "a".repeat(12001);
      const result = parseLine(`Hello ::: Czesc :::"${longText}":::`, 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Learning hint exceeds 12000 characters");
    });

    it("should handle whitespace around separator", () => {
      const result = parseLine("  Hello world  :::  Czesc swiecie  ", 1);
      expect(result.success).toBe(true);
      expect(result.data?.en).toBe("Hello world");
      expect(result.data?.pl).toBe("Czesc swiecie");
    });
  });

  describe("splitImportRecords", () => {
    it("should group multiline learning hints into a single import record", () => {
      const lines = ['test ::: ttestowanie :::"#ssss', "sdsdsd", "- sdsdf", '":::', "test 2 ::: trtrt"];

      const records = splitImportRecords(lines);

      expect(records).toHaveLength(2);
      expect(records[0].lineNo).toBe(1);
      expect(records[0].text).toBe('test ::: ttestowanie :::"#ssss\nsdsdsd\n- sdsdf\n":::');
      expect(records[1].lineNo).toBe(5);
      expect(records[1].text).toBe("test 2 ::: trtrt");
    });
  });

  describe("processImportLines", () => {
    it("should process valid lines", () => {
      const lines = ["Hello ::: Czesc", "Goodbye ::: Do widzenia", "Thank you ::: Dziekuje"];
      const result = processImportLines(lines);
      expect(result.accepted).toHaveLength(3);
      expect(result.rejected).toHaveLength(0);
    });

    it("should process lines with learning hints", () => {
      const lines = ['afford ::: can pay for :::"**Usage:** often with `can`.":::'];
      const result = processImportLines(lines);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].learningHintMarkdown).toBe("**Usage:** often with `can`.");
    });

    it("should process multiline learning hints without treating inner lines as phrases", () => {
      const lines = ['test ::: ttestowanie :::"#ssss', "sdsdsd", "- sdsdf", '":::', "test 2 ::: trtrt"];

      const result = processImportLines(lines);

      expect(result.accepted).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);
      expect(result.accepted[0].learningHintMarkdown).toBe("#ssss\nsdsdsd\n- sdsdf");
      expect(result.accepted[1].en).toBe("test 2");
    });

    it("should reject invalid lines", () => {
      const lines = ["Hello ::: Czesc", "Invalid line without separator", " ::: Empty EN", "Goodbye ::: Do widzenia"];
      const result = processImportLines(lines);
      expect(result.accepted).toHaveLength(2);
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected[0].reason).toBe("Missing separator (:::) between EN and PL parts");
      expect(result.rejected[1].reason).toBe("Empty EN part");
    });

    it("should apply normalization when requested", () => {
      const lines = ["  Hello    world  :::  Czesc   swiecie  ", 'He said "Hello" ::: Powiedzial "Czesc"'];
      const result = processImportLines(lines, true);
      expect(result.accepted).toHaveLength(2);
      expect(result.accepted[0].en).toBe("Hello world");
      expect(result.accepted[0].pl).toBe("Czesc swiecie");
      expect(result.accepted[1].en).toBe('He said "Hello"');
      expect(result.accepted[1].pl).toBe('Powiedzial "Czesc"');
    });
  });

  describe("validateImportCommand", () => {
    it("should validate correct command", () => {
      const command = {
        notebook_id: "00000000-0000-0000-0000-000000000000",
        name: "Test Notebook",
        lines: ["Hello ::: Czesc"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).not.toThrow();
    });

    it("should reject missing name", () => {
      const command = {
        lines: ["Hello ::: Czesc"],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject invalid name length", () => {
      const command = {
        name: "a".repeat(101),
        lines: ["Hello ::: Czesc"],
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
        lines: new Array(101).fill("Hello ::: Czesc"),
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject non-string lines", () => {
      const command = {
        name: "Test Notebook",
        lines: ["Hello ::: Czesc", 123],
        normalize: true,
      };
      expect(() => validateImportCommand(command)).toThrow(ApiError);
    });

    it("should reject invalid notebook_id type", () => {
      const command = {
        notebook_id: 123,
        name: "Test Notebook",
        lines: ["Hello ::: Czesc"],
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
      const tokens = createBasicTokens("Hello world", "Czesc swiecie");
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
