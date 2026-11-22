import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ApiErrors } from "./errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const storedImage = new RegExp(`^/api/phrase-images/(${uuid})/(${uuid}\\.webp)$`, "i");

function filePath(userId: string, url: string) {
  if (process.env.NODE_ENV === "production" && !process.env.UPLOADS_DIR) {
    throw ApiErrors.internal("Image storage is not configured. Set UPLOADS_DIR and mount a persistent directory.");
  }
  const match = storedImage.exec(url);
  if (!match || !new RegExp(`^${uuid}$`, "i").test(userId)) throw ApiErrors.validationError("Invalid image path");
  return path.join(process.env.UPLOADS_DIR || path.resolve("storage/uploads"), userId, match[1], match[2]);
}

export async function savePhraseImage(userId: string, phraseId: string, bytes: Buffer) {
  let output: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "")) throw new Error("Unsupported format");
    output = await image
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw ApiErrors.validationError("Choose a valid JPEG, PNG or WebP image (maximum 25 megapixels).");
  }
  const url = `/api/phrase-images/${phraseId}/${randomUUID()}.webp`;
  const destination = filePath(userId, url);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, output, { flag: "wx", mode: 0o600 });
  return url;
}

export const readPhraseImage = (userId: string, url: string) => readFile(filePath(userId, url));

// Cleanup must never turn a committed database update into an API error.
export async function removePhraseImage(userId: string, url: string | null | undefined) {
  if (!url || !storedImage.test(url)) return;
  try {
    await unlink(filePath(userId, url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.error("Image cleanup failed", error);
    }
  }
}

export async function readUpload(request: Request) {
  if (!request.body) throw ApiErrors.validationError("Missing image");
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES)
    throw ApiErrors.limitExceeded("Image must be at most 5 MB");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw ApiErrors.limitExceeded("Image must be at most 5 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
