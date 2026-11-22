import React, { useEffect, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { Button } from "./ui/button";
import PhraseImage from "./PhraseImage";
import { normalizeImageUrl, MAX_IMAGE_URL_LENGTH, isStoredImageUrl } from "../lib/phrase-image";
import { parseMarkdownToHtml } from "../lib/utils";

interface PhraseLearningHintModalProps {
  open: boolean;
  phraseLabel: string;
  initialValue: string | null;
  isSaving: boolean;
  error: string | null;
  onSave: (value: string | null) => void;
  onClose: () => void;
  imageUrl?: string | null;
  onSaveImage?: (url: string | File | null) => void;
}

const MAX_HINT_LENGTH = 12000;

export default function PhraseLearningHintModal({
  open,
  phraseLabel,
  initialValue,
  isSaving,
  error,
  onSave,
  onClose,
  imageUrl,
  onSaveImage,
}: PhraseLearningHintModalProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [activePane, setActivePane] = useState<"edit" | "preview" | "image">("edit");

  const [imageValue, setImageValue] = useState(imageUrl ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  useEffect(() => {
    if (!imageFile) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);
  const selectImage = (file: File) => {
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("Choose a JPEG, PNG or WebP image up to 5 MB.");
      return;
    }
    setImageFile(file);
    setImageError(null);
  };
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? "");
      setImageValue(imageUrl ?? "");
      setImageError(null);
      setImageFile(null);
      setActivePane("preview");
    }
  }, [initialValue, imageUrl, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose, open]);

  if (!open) {
    return null;
  }

  const trimmed = value.trim();
  const isTooLong = value.length > MAX_HINT_LENGTH;
  const previewHtml = parseMarkdownToHtml(trimmed);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (activePane === "image") {
      if (imageFile) {
        onSaveImage?.(imageFile);
        return;
      }
      try {
        const url = normalizeImageUrl(imageValue);
        setImageError(null);
        onSaveImage?.(url);
      } catch (error) {
        setImageError(error instanceof Error ? error.message : "Invalid image link");
      }
      return;
    }
    if (isTooLong) return;
    onSave(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 px-0 pt-8 backdrop-blur-sm sm:items-center sm:px-4 sm:py-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-hint-title"
        className="h-[92vh] w-full overflow-hidden rounded-t-lg border border-border bg-card text-card-foreground shadow-lg sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-lg"
      >
        <form
          onPaste={(event) => {
            if (activePane !== "image" || isSaving) return;
            const file = Array.from(event.clipboardData.items)
              .find((item) => item.type.startsWith("image/"))
              ?.getAsFile();
            if (file) {
              event.preventDefault();
              selectImage(file);
            }
          }}
          onSubmit={handleSubmit}
          className="flex h-full min-h-0 flex-col sm:max-h-[90vh]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 id="learning-hint-title" className="text-base font-semibold text-foreground">
                Learning hint
              </h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{phraseLabel}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {error && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <section className={activePane === "preview" ? "block" : "hidden"}>
                <div className="text-sm font-medium text-foreground">Preview</div>
                <div
                  className="markdown-content mt-1.5 min-h-72 rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-foreground"
                  dangerouslySetInnerHTML={{
                    __html: trimmed.length > 0 ? previewHtml : "<p>No learning hint yet.</p>",
                  }}
                />
              </section>

              {activePane === "image" && (
                <section className="space-y-3">
                  <label htmlFor="phrase-image-file" className="block text-sm font-medium">
                    Upload image or paste with Ctrl+V
                  </label>
                  <input
                    id="phrase-image-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isSaving}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) selectImage(file);
                      event.target.value = "";
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG or WebP, up to 5 MB. Uploaded when you save.
                  </p>
                  {filePreview && (
                    <img src={filePreview} alt="Selected memory aid" className="max-h-64 max-w-full rounded-md" />
                  )}
                  {imageFile && (
                    <Button type="button" variant="outline" onClick={() => setImageFile(null)}>
                      Cancel selected file
                    </Button>
                  )}
                  <label htmlFor="phrase-image-url" className="text-sm font-medium">
                    Image link
                  </label>
                  <input
                    id="phrase-image-url"
                    type="text"
                    value={imageValue}
                    onChange={(event) => {
                      setImageValue(event.target.value);
                      setImageFile(null);
                      setImageError(null);
                    }}
                    maxLength={MAX_IMAGE_URL_LENGTH}
                    placeholder="https://example.com/image.jpg"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    In Google Images, open the image and choose &quot;Copy image address&quot;. Paste the direct HTTPS
                    link here. Leave empty to remove. Images appear only after checking your answer.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      setImageFile(null);
                      setImageValue("");
                    }}
                  >
                    Remove image
                  </Button>
                  {imageError && (
                    <p role="alert" className="text-sm text-destructive">
                      {imageError}
                    </p>
                  )}
                  {!imageFile && (imageValue.trim().startsWith("https://") || isStoredImageUrl(imageValue.trim())) && (
                    <PhraseImage url={imageValue.trim()} revealed={true} />
                  )}
                </section>
              )}
              <section className={activePane === "edit" ? "block space-y-1.5" : "hidden"}>
                <label htmlFor="learning-hint-markdown" className="text-sm font-medium text-foreground">
                  Markdown
                </label>
                <textarea
                  id="learning-hint-markdown"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  rows={14}
                  maxLength={MAX_HINT_LENGTH + 1}
                  className="min-h-72 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Usage notes, examples, collocations, false friends..."
                />
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className={isTooLong ? "text-destructive" : "text-muted-foreground"}>
                    {value.length}/{MAX_HINT_LENGTH}
                  </span>
                  {isTooLong && <span className="text-destructive">Hint is too long.</span>}
                </div>
              </section>
            </div>
          </div>

          <div key={activePane} className="flex justify-end gap-2 border-t border-border px-4 py-3">
            {activePane === "preview" ? (
              <>
                <Button type="button" variant="outline" onClick={() => setActivePane("edit")} disabled={isSaving}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                {onSaveImage && (
                  <Button type="button" variant="outline" onClick={() => setActivePane("image")} disabled={isSaving}>
                    Edit image
                  </Button>
                )}
                <Button type="button" onClick={onClose} disabled={isSaving}>
                  OK
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setActivePane("preview")} disabled={isSaving}>
                  <Eye className="size-4" />
                  Preview
                </Button>
                <Button type="submit" disabled={isSaving || (activePane === "edit" && isTooLong)}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
