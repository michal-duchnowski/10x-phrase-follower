/**
 * Word bank mode utilities: tokenization and word pool generation.
 * Based on learn-mode-word-bank.md specification.
 */

import type { LearnPhraseDTO } from "../types";
import { normalizeAnswerText } from "./learn.service";

/**
 * Tokenizes a phrase into tokens for word bank mode.
 * Handles contractions (don't, I'm) and removes trailing punctuation.
 *
 * @param text - Text to tokenize
 * @returns Array of token strings
 */
export function tokenizePhrase(text: string): string[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  // Normalize first (remove markdown, trim, etc.)
  let normalized = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
    .replace(/[*_]+/g, " ")
    .trim();

  // Remove trailing punctuation (. ? ! …)
  normalized = normalized.replace(/[.?!…]+$/, "").trim();

  // Split by spaces, but preserve contractions
  // Common contractions: don't, I'm, you're, it's, we're, they're, can't, won't, etc.
  const tokens: string[] = [];
  const words = normalized.split(/\s+/);

  for (const word of words) {
    if (word.length === 0) continue;

    // Check for contractions with apostrophe
    const contractionMatch = word.match(/^([a-zA-Z]+)'([a-zA-Z]+)$/i);
    if (contractionMatch) {
      // Keep contraction as single token (e.g., "don't", "I'm")
      tokens.push(word);
    } else {
      tokens.push(word);
    }
  }

  return tokens.filter((t) => t.length > 0);
}

/**
 * Generates distractors based on heuristics (articles, prepositions, etc.)
 */
function generateHeuristicDistractors(correctTokens: string[]): string[] {
  const distractors: string[] = [];
  const seen = new Set<string>();

  for (const token of correctTokens) {
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    // Articles
    if (lower === "the") {
      distractors.push("a", "an");
    } else if (lower === "a") {
      distractors.push("the", "an");
    } else if (lower === "an") {
      distractors.push("a", "the");
    }

    // Prepositions
    if (lower === "at") {
      distractors.push("in", "on");
    } else if (lower === "in") {
      distractors.push("at", "on");
    } else if (lower === "on") {
      distractors.push("in", "at");
    }

    // Common verbs
    if (lower === "is") {
      distractors.push("are", "was");
    } else if (lower === "are") {
      distractors.push("is", "were");
    } else if (lower === "was") {
      distractors.push("is", "were");
    } else if (lower === "were") {
      distractors.push("are", "was");
    }

    // Do/does/did
    if (lower === "do") {
      distractors.push("does", "did");
    } else if (lower === "does") {
      distractors.push("do", "did");
    } else if (lower === "did") {
      distractors.push("do", "does");
    }

    // Some/any
    if (lower === "some") {
      distractors.push("any");
    } else if (lower === "any") {
      distractors.push("some");
    }
  }

  return distractors.filter((d) => d.length > 0);
}

/**
 * Extracts tokens from all phrases in the notebook (excluding current phrase)
 */
function extractTokensFromNotebook(
  phrases: LearnPhraseDTO[],
  excludePhraseId: string,
  direction: "en_to_pl" | "pl_to_en"
): string[] {
  const allTokens: string[] = [];

  for (const phrase of phrases) {
    if (phrase.id === excludePhraseId) continue;

    const text = direction === "en_to_pl" ? phrase.pl_text : phrase.en_text;
    const tokens = tokenizePhrase(text);
    allTokens.push(...tokens);
  }

  return allTokens;
}

/**
 * Generates word pool for word bank mode.
 * Includes correct tokens (with duplicates) and distractors.
 *
 * @param correctAnswer - The correct answer text
 * @param allPhrases - All phrases in the notebook (for distractor generation)
 * @param currentPhraseId - ID of current phrase (to exclude from distractors)
 * @param direction - Learning direction
 * @returns Array of token strings (shuffled)
 */
export function generateWordPool(
  correctAnswer: string,
  allPhrases: LearnPhraseDTO[],
  currentPhraseId: string,
  direction: "en_to_pl" | "pl_to_en"
): string[] {
  // Tokenize correct answer (with duplicates preserved)
  const correctTokens = tokenizePhrase(correctAnswer);
  const pool: string[] = [...correctTokens]; // Start with all correct tokens

  // Determine number of distractors needed
  const correctTokenCount = correctTokens.length;
  let targetDistractorCount: number;

  if (correctTokenCount <= 2) {
    // For 1-2 tokens: aim for ~4 additional options total
    targetDistractorCount = Math.max(4 - correctTokenCount, 2);
  } else {
    // For longer answers: 2-3 distractors
    targetDistractorCount = 3;
  }

  // Generate heuristic distractors
  const heuristicDistractors = generateHeuristicDistractors(correctTokens);
  const correctTokensSet = new Set(correctTokens.map((t) => t.toLowerCase()));

  // Filter out distractors that are already in correct answer
  const filteredHeuristic = heuristicDistractors.filter((d) => !correctTokensSet.has(d.toLowerCase()));

  pool.push(...filteredHeuristic);

  // If we need more distractors, get them from other phrases
  if (pool.length - correctTokenCount < targetDistractorCount && allPhrases.length > 1) {
    const notebookTokens = extractTokensFromNotebook(allPhrases, currentPhraseId, direction);
    const correctTokensLower = new Set(correctTokens.map((t) => t.toLowerCase()));

    // Filter out tokens already in pool and correct answer
    const availableDistractors = notebookTokens.filter(
      (token) => !correctTokensLower.has(token.toLowerCase()) && !pool.includes(token)
    );

    // Prefer tokens of similar length
    const avgLength =
      correctTokens.length > 0 ? correctTokens.reduce((sum, t) => sum + t.length, 0) / correctTokens.length : 5;

    const sortedDistractors = availableDistractors.sort((a, b) => {
      const diffA = Math.abs(a.length - avgLength);
      const diffB = Math.abs(b.length - avgLength);
      return diffA - diffB;
    });

    const needed = targetDistractorCount - (pool.length - correctTokenCount);
    pool.push(...sortedDistractors.slice(0, needed));
  }

  // Shuffle the pool
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Compares word bank answer (array of tokens) with correct answer.
 * Joins tokens and normalizes for comparison.
 *
 * @param selectedTokens - Array of tokens selected by user
 * @param correctAnswer - Correct answer text
 * @returns Comparison result
 */
export function compareWordBankAnswer(
  selectedTokens: string[],
  correctAnswer: string
): {
  isCorrect: boolean;
  normalizedUser: string;
  normalizedCorrect: string;
} {
  // Join selected tokens with single space
  const userAnswer = selectedTokens.join(" ");

  // Normalize both answers
  const normalizedUser = normalizeAnswerText(userAnswer);
  const normalizedCorrect = normalizeAnswerText(correctAnswer);

  // Word bank always uses exact match
  const isCorrect = normalizedUser === normalizedCorrect;

  return {
    isCorrect,
    normalizedUser,
    normalizedCorrect,
  };
}
