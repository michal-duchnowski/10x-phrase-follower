import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { DEFAULT_IMAGE_MAX_HEIGHT, DEFAULT_IMAGE_MAX_WIDTH, isStoredImageUrl } from "../lib/phrase-image";
import { fetchCachedPhraseImage, phraseImageCache } from "../lib/phrase-image-cache";

import { useApi } from "../lib/hooks/useApi";

interface PhraseImageProps {
  url: string | null | undefined;
  revealed: boolean;
  maxWidth?: number;
  maxHeight?: number;
  compactMobile?: boolean;
}

export default function PhraseImage({
  url,
  revealed,
  maxWidth = DEFAULT_IMAGE_MAX_WIDTH,
  maxHeight = DEFAULT_IMAGE_MAX_HEIGHT,
  compactMobile = false,
}: PhraseImageProps) {
  const { apiFetch, token } = useApi();
  const [localImage, setLocalImage] = useState<{ source: string; scope: string; blob: string } | null>(null);
  const [failedImage, setFailedImage] = useState<{ source: string; scope: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!token || !url || !isStoredImageUrl(url)) return;
    let active = true;
    let blobUrl: string | undefined;
    fetchCachedPhraseImage(token, url, apiFetch)
      .then((blob) => {
        if (!active) return;
        blobUrl = URL.createObjectURL(blob);
        setLocalImage({ source: url, scope: token, blob: blobUrl });
        setFailedImage((previous) => (previous?.source === url && previous.scope === token ? null : previous));
      })
      .catch(() => {
        if (active) setFailedImage({ source: url, scope: token });
      });
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, apiFetch, token, retry]);
  const displayUrl =
    url && isStoredImageUrl(url)
      ? localImage?.source === url && localImage.scope === token
        ? localImage.blob
        : null
      : url;
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const closePreview = useCallback(() => setExpandedUrl(null), []);
  if (!revealed || !url) return null;
  if (failedImage?.source === url && failedImage.scope === token)
    return (
      <div className="space-y-1 text-xs text-muted-foreground" role="status">
        <p>Image unavailable. You can replace its link in Description.</p>
        <button
          type="button"
          onClick={() => {
            phraseImageCache.invalidate(token, url);
            setFailedImage(null);
            setRetry((value) => value + 1);
          }}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Retry image
        </button>
      </div>
    );
  if (!displayUrl)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading image...
      </p>
    );
  return (
    <>
      <button
        type="button"
        aria-label="Enlarge image"
        aria-haspopup="dialog"
        onClick={() => setExpandedUrl(url)}
        className="block max-w-full cursor-zoom-in rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <img
          key={url}
          src={displayUrl}
          alt="Memory aid"
          referrerPolicy="no-referrer"
          decoding="async"
          className={`block h-auto w-auto max-w-full rounded-md object-contain ${compactMobile ? "[--phrase-image-viewport-limit:30dvh] sm:[--phrase-image-viewport-limit:100000px]" : ""}`}
          style={{
            maxWidth: `min(100%, ${maxWidth}px)`,
            maxHeight: compactMobile
              ? `min(var(--phrase-image-viewport-limit, 100000px), ${maxHeight}px)`
              : `${maxHeight}px`,
          }}
          onError={() => setFailedImage({ source: url, scope: token })}
        />
      </button>
      {expandedUrl === url && <ImagePreview url={displayUrl} onClose={closePreview} />}
    </>
  );
}

function ImagePreview({ url, onClose }: { url: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    // Prevent flashcard ratings and Description shortcuts while the preview is open.
    const handleKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label="Image preview"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black/95 p-0 text-white backdrop:bg-black/80"
    >
      <button
        type="button"
        aria-label="Close image preview"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-full bg-black/70 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="size-6" />
      </button>
      <div className="flex h-full w-full items-center justify-center p-4 pt-20 sm:p-12 sm:pt-20">
        {failed ? (
          <p role="status">Image unavailable. Close the preview to return.</p>
        ) : (
          <img
            src={url}
            alt="Memory aid, enlarged"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </dialog>,
    document.body
  );
}
