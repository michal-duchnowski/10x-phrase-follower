import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";
import {
  compressIllustration,
  DEFAULT_ILLUSTRATION_STYLE,
  illustrationPrompt,
  parseIllustrationMapping,
  readIllustrationZip,
  uniqueIllustrationPhrases,
  type IllustrationPhrase,
} from "../lib/illustration-import";

interface Draft {
  phrases: IllustrationPhrase[];
  style: string;
}
interface Preview {
  phrase: IllustrationPhrase;
  image?: Blob;
  url?: string;
  error?: string;
  changed?: boolean;
  saved?: boolean;
}

export default function IllustrationWizard({
  phrases,
  onImported,
}: {
  phrases: IllustrationPhrase[];
  onImported?: (id: string, imageUrl: string) => void;
}) {
  const { apiCall, userId, isAuthenticated } = useApi();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Preview[]>([]);
  const [replace, setReplace] = useState(false);
  const [acceptChanges, setAcceptChanges] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const urls = useRef<string[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const key = userId ? `illustration-draft-v1:${userId}` : null;
  useEffect(() => {
    setSavedDraft(null);
    if (!key) return;
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if (
        value &&
        Array.isArray(value.phrases) &&
        value.phrases.length > 0 &&
        value.phrases.length <= 200 &&
        value.phrases.every((p: IllustrationPhrase) => typeof p.id === "string" && typeof p.en_text === "string")
      )
        setSavedDraft({
          phrases: value.phrases,
          style: typeof value.style === "string" ? value.style : DEFAULT_ILLUSTRATION_STYLE,
        });
    } catch {
      /* Storage is optional. */
    }
  }, [key]);
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  const clearImages = () => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    setRows([]);
  };
  const start = (resume: boolean) => {
    const next = resume
      ? savedDraft
      : { phrases: uniqueIllustrationPhrases(phrases), style: DEFAULT_ILLUSTRATION_STYLE };
    if (!next) return;
    clearImages();
    setDraft(next);
    setStep(resume ? 2 : 1);
    setMessage("");
    setReplace(false);
    setAcceptChanges(false);
    setManualCopy(false);
    setDragging(false);
    dragDepth.current = 0;
    setOpen(true);
  };
  const copyPrompt = async () => {
    if (!draft || !draft.phrases.length || draft.phrases.length > 200) return;
    try {
      if (key) localStorage.setItem(key, JSON.stringify(draft));
      setSavedDraft(draft);
    } catch {
      setMessage("Browser storage is unavailable. Keep the wizard open until import.");
    }
    try {
      await navigator.clipboard.writeText(illustrationPrompt(draft.phrases, draft.style));
      setStep(2);
    } catch {
      setManualCopy(true);
    }
  };
  const inspectZip = async (file: File) => {
    if (!draft || busy) return;
    setBusy(true);
    setMessage("Reading ZIP locally…");
    clearImages();
    try {
      const archive = await readIllustrationZip(file);
      const entries = new Map(
        parseIllustrationMapping(archive.mapping, new Set(draft.phrases.map((p) => p.id))).map((item) => [
          item.id,
          item.file,
        ])
      );
      const current = await apiCall<{ items: IllustrationPhrase[] }>("/api/phrases/image-import", {
        method: "POST",
        body: JSON.stringify({ ids: draft.phrases.map((p) => p.id) }),
      });
      const byId = new Map(current.items.map((p) => [p.id, p]));
      const preview: Preview[] = [];
      for (const original of draft.phrases) {
        setMessage(`Compressing ${preview.length + 1}/${draft.phrases.length}…`);
        const phrase = byId.get(original.id);
        const name = entries.get(original.id);
        const bytes = name ? archive.files.get(name) : undefined;
        if (!phrase || !name || !bytes) {
          preview.push({
            phrase: phrase ?? original,
            error: !phrase ? "Phrase deleted or unavailable" : "Missing image or mapping entry",
          });
          continue;
        }
        try {
          const image = await compressIllustration(bytes, name);
          const url = URL.createObjectURL(image);
          urls.current.push(url);
          preview.push({
            phrase,
            image,
            url,
            changed: phrase.en_text !== original.en_text || phrase.pl_text !== original.pl_text,
          });
        } catch (error) {
          preview.push({ phrase, error: error instanceof Error ? error.message : "Invalid image" });
        }
        archive.files.delete(name);
      }
      setRows(preview);
      setStep(3);
      setMessage("");
    } catch (error) {
      clearImages();
      setMessage(error instanceof Error ? error.message : "Could not read ZIP.");
    } finally {
      setBusy(false);
    }
  };
  const selectZip = (files: File[]) => {
    if (busyRef.current) return;
    if (files.length !== 1 || !/\.zip$/i.test(files[0].name)) {
      setMessage("Choose or drop exactly one ZIP file.");
      return;
    }
    void inspectZip(files[0]);
  };
  const eligible = (row: Preview) =>
    !!row.image && !row.error && !row.saved && (!row.phrase.image_url || replace) && (!row.changed || acceptChanges);
  const importImages = async () => {
    if (busy) return;
    setBusy(true);
    let successful = 0;
    const updated = [...rows];
    for (let index = 0; index < updated.length; index++) {
      const row = updated[index];
      if (!eligible(row) || !row.image || !row.phrase.updated_at) continue;
      setMessage(`Saving ${index + 1}/${rows.length}…`);
      try {
        const result = await apiCall<{ image_url: string }>(`/api/phrases/${row.phrase.id}/image`, {
          method: "POST",
          headers: { "Content-Type": row.image.type, "X-Phrase-Version": row.phrase.updated_at },
          body: row.image,
        });
        updated[index] = { ...row, saved: true };
        successful++;
        onImported?.(row.phrase.id, result.image_url);
      } catch (error) {
        updated[index] = { ...row, error: error instanceof Error ? error.message : "Upload failed" };
      }
      setRows([...updated]);
    }
    setMessage(
      `Saved ${successful} image(s). Failed or skipped images remain listed. Choose the ZIP again to retry errors.`
    );
    setBusy(false);
    if (updated.every((row) => row.saved)) {
      try {
        if (key) localStorage.removeItem(key);
      } catch {
        /* Optional persistence. */
      }
      setSavedDraft(null);
    }
  };
  return (
    <>
      {phrases.length > 0 && (
        <Button size="sm" disabled={!isAuthenticated} onClick={() => start(false)}>
          Add illustrations
        </Button>
      )}
      {savedDraft && (
        <Button size="sm" variant="secondary" onClick={() => start(true)}>
          Resume illustrations
        </Button>
      )}
      {open && draft && (
        <dialog
          ref={dialogRef}
          aria-modal="true"
          aria-labelledby="illustration-title"
          className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-3xl overflow-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/60"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="illustration-title" className="text-lg font-semibold">
              Add illustrations · {step}/3
            </h2>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                clearImages();
              }}
            >
              Close
            </Button>
          </div>
          {step === 1 && (
            <div className="mt-4 space-y-4">
              <p>
                One illustration per phrase, shared by both learning directions. Remove any phrases you do not want.
                Maximum 200.
              </p>
              <label className="block">
                Illustration style
                <textarea
                  className="mt-1 w-full rounded border border-input bg-background p-2"
                  value={draft.style}
                  onChange={(event) => setDraft({ ...draft, style: event.target.value })}
                />
              </label>
              <div className="max-h-60 space-y-2 overflow-auto">
                {draft.phrases.map((phrase) => (
                  <div key={phrase.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{phrase.en_text}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft({ ...draft, phrases: draft.phrases.filter((p) => p.id !== phrase.id) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button disabled={!draft.phrases.length || draft.phrases.length > 200} onClick={() => void copyPrompt()}>
                Copy prompt · {draft.phrases.length} phrases
              </Button>
              {manualCopy && (
                <>
                  <label className="block">
                    Copy the prompt manually
                    <textarea
                      readOnly
                      className="mt-2 h-48 w-full border bg-background p-2"
                      value={illustrationPrompt(draft.phrases, draft.style)}
                    />
                  </label>
                  <Button onClick={() => setStep(2)}>I copied the prompt</Button>
                </>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="mt-4 space-y-4">
              <p>
                Paste the prompt into ChatGPT and generate the ZIP. Return here to choose it. You can close the wizard
                and use “Resume illustrations” later in this browser.
              </p>
              <p className="text-sm text-muted-foreground">
                ZIP up to 100 MiB. Images are unpacked locally, resized to 1600 × 1600 and compressed before upload. The
                ZIP itself is never sent to the server.
              </p>
              <label
                className={`flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring ${
                  busy
                    ? "cursor-wait border-border opacity-60"
                    : dragging
                      ? "cursor-copy border-primary bg-primary/10"
                      : "cursor-pointer border-muted-foreground/50 bg-muted/20 hover:border-primary hover:bg-primary/5"
                }`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  dragDepth.current++;
                  if (!busyRef.current) setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = busyRef.current ? "none" : "copy";
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (!dragDepth.current) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dragDepth.current = 0;
                  setDragging(false);
                  selectZip(Array.from(event.dataTransfer.files));
                }}
              >
                <Upload aria-hidden="true" className="size-9 text-muted-foreground" />
                <span className="font-medium">
                  {busy ? "Processing ZIP…" : dragging ? "Drop your ZIP here" : "Drag and drop your ZIP here"}
                </span>
                <span className="text-sm text-muted-foreground">or click to choose a file · ZIP up to 100 MiB</span>
                <input
                  aria-label="Generated ZIP"
                  type="file"
                  accept=".zip,application/zip"
                  disabled={busy}
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length) selectZip(files);
                    event.target.value = "";
                  }}
                />
              </label>
              <Button variant="secondary" disabled={busy} onClick={() => setStep(1)}>
                Back to prompt
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={replace}
                  disabled={busy}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                Replace existing images (otherwise skip)
              </label>
              {rows.some((row) => row.changed) && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={acceptChanges}
                    disabled={busy}
                    onChange={(event) => setAcceptChanges(event.target.checked)}
                  />
                  Also import for phrases whose text changed since export
                </label>
              )}
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.phrase.id} className="flex items-center gap-4 rounded border border-border p-3">
                    {row.url && (
                      <img src={row.url} alt="Illustration preview" className="h-24 w-24 shrink-0 object-contain" />
                    )}
                    <div className="min-w-0 whitespace-pre-wrap break-words">
                      <p>{row.phrase.en_text}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.saved
                          ? "Saved"
                          : (row.error ??
                            (row.changed && !acceptChanges
                              ? "Text changed — skipped"
                              : row.phrase.image_url && !replace
                                ? "Existing image — skipped"
                                : `Ready · ${Math.ceil((row.image?.size ?? 0) / 1024)} KiB`))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button disabled={busy || !rows.some(eligible)} onClick={() => void importImages()}>
                  Import {rows.filter(eligible).length} images
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    clearImages();
                    setStep(2);
                  }}
                >
                  Choose ZIP again
                </Button>
              </div>
            </div>
          )}
          {message && (
            <p role="status" className="mt-4 whitespace-pre-wrap text-sm">
              {message}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
