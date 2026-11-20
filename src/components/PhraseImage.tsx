import { useState } from "react";
import { DEFAULT_IMAGE_MAX_HEIGHT, DEFAULT_IMAGE_MAX_WIDTH } from "../lib/phrase-image";

interface PhraseImageProps {
  url: string | null | undefined;
  revealed: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

export default function PhraseImage({
  url,
  revealed,
  maxWidth = DEFAULT_IMAGE_MAX_WIDTH,
  maxHeight = DEFAULT_IMAGE_MAX_HEIGHT,
}: PhraseImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!revealed || !url) return null;
  if (failedUrl === url)
    return (
      <div className="space-y-1 text-xs text-muted-foreground" role="status">
        <p>Image unavailable. You can replace its link in Description.</p>
        <button
          type="button"
          onClick={() => setFailedUrl(null)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Retry image
        </button>
      </div>
    );
  return (
    <img
      key={url}
      src={url}
      alt="Memory aid"
      referrerPolicy="no-referrer"
      decoding="async"
      className="block h-auto w-auto max-w-full rounded-md object-contain"
      style={{ maxWidth: `min(100%, ${maxWidth}px)`, maxHeight: `${maxHeight}px` }}
      onError={() => setFailedUrl(url)}
    />
  );
}
