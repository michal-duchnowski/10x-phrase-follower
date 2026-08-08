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
    // Remove markdown-like emphasis markers so "**Affair**" matches "affair"
    .replace(/[*_]+/g, " ")
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

function getContainsModeWords(text: string): string[] {
  return normalizeAnswerText(text)
    .replace(/[.,;:()[\]{}"“”'`!?…/\\]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Compares user answer with correct answer using normalized comparison.
 *
 * @param userAnswer - User's input answer
 * @param correctAnswer - Expected correct answer
 * @param useContainsMode - If true, user answer is correct if it matches any word in correct answer
 * @returns Object with comparison result and normalized texts
 */
export function compareAnswers(
  userAnswer: string,
  correctAnswer: string,
  useContainsMode = false
): {
  isCorrect: boolean;
  normalizedUser: string;
  normalizedCorrect: string;
} {
  const normalizedUser = normalizeAnswerText(userAnswer);
  const normalizedCorrect = normalizeAnswerText(correctAnswer);

  let isCorrect: boolean;

  if (useContainsMode) {
    // In contains mode, separators such as commas and semicolons often delimit synonyms.
    const userWords = getContainsModeWords(userAnswer);
    const correctWords = getContainsModeWords(correctAnswer);
    isCorrect = userWords.some((userWord) => correctWords.some((correctWord) => userWord === correctWord));
  } else {
    // Exact match mode: full string comparison
    isCorrect = normalizedUser === normalizedCorrect;
  }

  return {
    isCorrect,
    normalizedUser,
    normalizedCorrect,
  };
}
