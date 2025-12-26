/**
 * Learn mode text normalization and answer comparison utilities.
 * Based on learn-mode.md specification section 4.2.
 */

/**
 * Normalizes text for answer comparison in learn mode.
 * According to spec: trim, lowercase, remove trailing punctuation, reduce spaces.
 *
 * @param text - Text to normalize
 * @returns Normalized text ready for comparison
 */
export function normalizeAnswerText(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  const normalized = text
    // Remove zero-width and control characters (similar to import normalization)
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
    // Trim beginning and end
    .trim()
    // Reduce multiple spaces to single space
    .replace(/\s+/g, " ")
    // Convert to lowercase (ignore case)
    .toLowerCase()
    // Remove trailing punctuation: . ? ! … (if occurring at the end)
    .replace(/[.?!…]+$/, "")
    // Final trim in case punctuation removal left trailing spaces
    .trim();

  return normalized;
}

/**
 * Compares user answer with correct answer using normalized comparison.
 *
 * @param userAnswer - User's input answer
 * @param correctAnswer - Expected correct answer
 * @returns Object with comparison result and normalized texts
 */
export function compareAnswers(
  userAnswer: string,
  correctAnswer: string
): {
  isCorrect: boolean;
  normalizedUser: string;
  normalizedCorrect: string;
} {
  const normalizedUser = normalizeAnswerText(userAnswer);
  const normalizedCorrect = normalizeAnswerText(correctAnswer);

  return {
    isCorrect: normalizedUser === normalizedCorrect,
    normalizedUser,
    normalizedCorrect,
  };
}
