export const DEFAULT_IMAGE_MAX_WIDTH = 240;
export const DEFAULT_IMAGE_MAX_HEIGHT = 180;
export const MAX_IMAGE_URL_LENGTH = 4096;

/** Only direct HTTPS resources; never execute or proxy a supplied URL. */
export function normalizeImageUrl(value: unknown): string | null {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" || value.trim().length > MAX_IMAGE_URL_LENGTH) {
    throw new Error("Image link must be an HTTPS URL of at most 4096 characters.");
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error("Paste a direct HTTPS image link (Copy image address), not a Google search page.");
  }
}

export function isValidImageDimension(value: unknown, dimension: "width" | "height"): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= (dimension === "width" ? 120 : 90) &&
    value <= (dimension === "width" ? 480 : 360)
  );
}
