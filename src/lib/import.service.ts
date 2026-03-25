import type { ImportNotebookCommand, PhraseTokens } from "../types";
import { ApiErrors } from "./errors";

/**
 * Import service for parsing and normalizing EN ::: PL format lines
 */

export interface ParsedLine {
  en: string;
  pl: string;
  lineNo: number;
  rawText: string;
}

export interface ImportResult {
  accepted: ParsedLine[];
  rejected: {
    lineNo: number;
    rawText: string;
    reason: string;
  }[];
}

/**
 * Normalizes single underscores to double underscores for formatting.
 * Converts _text_ to __text__ but preserves existing __text__
 */
function normalizeUnderscores(text: string): string {
  // First, protect existing double underscores by temporarily replacing them
  const placeholder = "___DOUBLE_UNDERSCORE_PLACEHOLDER___";
  let normalized = text.replace(/__/g, placeholder);

  // Now replace single underscores
  normalized = normalized.replace(/_([^_\s]+?)_/g, "__$1__");

  // Restore double underscores
  normalized = normalized.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "__");

  return normalized;
}

/**
 * Normalizes text according to PRD requirements:
 * - Remove zero-width and control characters
 * - Convert typographic quotes to simple quotes
 * - Normalize single underscores to double underscores (_text_ -> __text__)
 * - Reduce multiple spaces to single spaces
 * - Trim whitespace
 * - Preserve hyphens and em-dashes
 */
export function normalizeText(text: string): string {
  let normalized = text
    // Remove zero-width and control characters
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
    // Convert typographic quotes to simple quotes
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'");

  // Normalize single underscores to double underscores for formatting
  normalized = normalizeUnderscores(normalized);

  return (
    normalized
      // Reduce multiple spaces to single spaces
      .replace(/\s+/g, " ")
      // Trim whitespace
      .trim()
  );
}

/**
 * Parses a single line in EN ::: PL format
 */
export function parseLine(line: string, lineNo: number): { success: boolean; data?: ParsedLine; reason?: string } {
  const rawText = line;
  const trimmed = line.trim();

  // Check for empty line
  if (trimmed.length === 0) {
    return { success: false, reason: "Empty line" };
  }

  // Count separators
  const separatorCount = (trimmed.match(/:::/g) || []).length;

  if (separatorCount === 0) {
    return { success: false, reason: "Missing separator (:::) between EN and PL parts" };
  }

  if (separatorCount > 1) {
    return { success: false, reason: "Multiple separators (:::) found, expected exactly one" };
  }

  // Split by separator
  const parts = trimmed.split(":::");
  if (parts.length !== 2) {
    return { success: false, reason: "Invalid format after splitting by separator" };
  }

  const [enRaw, plRaw] = parts;
  const en = enRaw.trim();
  const pl = plRaw.trim();

  // Check for empty parts
  if (en.length === 0) {
    return { success: false, reason: "Empty EN part" };
  }

  if (pl.length === 0) {
    return { success: false, reason: "Empty PL part" };
  }

  // Check length limits
  if (en.length > 2000) {
    return { success: false, reason: "EN part exceeds 2000 characters" };
  }

  if (pl.length > 2000) {
    return { success: false, reason: "PL part exceeds 2000 characters" };
  }

  return {
    success: true,
    data: {
      en,
      pl,
      lineNo,
      rawText,
    },
  };
}

/**
 * Processes import lines with normalization and validation
 */
export function processImportLines(lines: string[], normalize = false): ImportResult {
  const accepted: ParsedLine[] = [];
  const rejected: { lineNo: number; rawText: string; reason: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i];

    // Apply normalization if requested
    if (normalize) {
      line = normalizeText(line);
    }

    const result = parseLine(line, lineNo);

    if (result.success && result.data) {
      accepted.push(result.data);
    } else {
      rejected.push({
        lineNo,
        rawText: lines[i], // Keep original text for logging
        reason: result.reason || "Unknown parsing error",
      });
    }
  }

  return { accepted, rejected };
}

/**
 * Validates import command and limits
 */
export function validateImportCommand(command: ImportNotebookCommand): void {
  const { notebook_id, name, lines, normalize } = command;

  if (notebook_id !== undefined && typeof notebook_id !== "string") {
    throw ApiErrors.validationError("notebook_id must be a string (UUID)");
  }

  // Validate notebook name
  if (!name || typeof name !== "string") {
    throw ApiErrors.validationError("Notebook name is required and must be a string");
  }

  if (name.length < 1 || name.length > 100) {
    throw ApiErrors.validationError("Notebook name must be between 1 and 100 characters");
  }

  // Validate lines
  if (!Array.isArray(lines)) {
    throw ApiErrors.validationError("Lines must be an array");
  }

  if (lines.length === 0) {
    throw ApiErrors.validationError("Lines array cannot be empty");
  }

  if (lines.length > 100) {
    throw ApiErrors.limitExceeded("Import exceeds 100 phrases limit");
  }

  // Validate normalize flag
  if (normalize !== undefined && typeof normalize !== "boolean") {
    throw ApiErrors.validationError("Normalize must be a boolean");
  }

  // Validate each line is a string
  for (let i = 0; i < lines.length; i++) {
    if (typeof lines[i] !== "string") {
      throw ApiErrors.validationError(`Line ${i + 1} must be a string`);
    }
  }
}

/**
 * Generates position values for phrases (stepped by 10)
 */
export function generatePositions(count: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push((i + 1) * 10);
  }
  return positions;
}

/**
 * Creates tokenization data for a phrase (basic word-level tokenization)
 * This is a simplified implementation for Stage 1
 */
export function createBasicTokens(en: string, pl: string): PhraseTokens {
  const tokenize = (text: string) => {
    const tokens: { text: string; start: number; end: number }[] = [];
    const words = text.split(/(\s+)/);
    let currentPos = 0;

    for (const word of words) {
      if (word.trim().length > 0) {
        tokens.push({
          text: word,
          start: currentPos,
          end: currentPos + word.length,
        });
      }
      currentPos += word.length;
    }

    return tokens;
  };

  return {
    en: tokenize(en),
    pl: tokenize(pl),
  };
}
