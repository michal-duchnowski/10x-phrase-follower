import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
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
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const closePreview = useCallback(() => setExpandedUrl(null), []);
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
          src={url}
          alt="Memory aid"
          referrerPolicy="no-referrer"
          decoding="async"
          className="block h-auto w-auto max-w-full rounded-md object-contain"
          style={{ maxWidth: `min(100%, ${maxWidth}px)`, maxHeight: `${maxHeight}px` }}
          onError={() => setFailedUrl(url)}
        />
      </button>
      {expandedUrl === url && <ImagePreview url={url} onClose={closePreview} />}
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
