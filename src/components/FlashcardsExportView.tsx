import { useState } from "react";
import { ArrowLeft, Copy, Download, LoaderCircle } from "lucide-react";
import { useApi } from "../lib/hooks/useApi";
import { Button } from "./ui/button";

export default function FlashcardsExportView() {
  const { token, isAuthenticated } = useApi();
  const [limit, setLimit] = useState("20");
  const [direction, setDirection] = useState("all");
  const [period, setPeriod] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const validLimit = /^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 1000;

  const exportMarkdown = async (mode: "all" | "difficult", action: "download" | "copy") => {
    if (!token || !isAuthenticated || busy || (mode === "difficult" && !validLimit)) return;
    setBusy(`${mode}-${action}`);
    setMessage(null);
    setPreview(null);
    try {
      const params = new URLSearchParams({ mode });
      if (mode === "difficult") {
        params.set("limit", limit);
        params.set("direction", direction);
        params.set("period", period);
      }
      const response = await fetch(`/api/flashcards/export?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/markdown" },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Could not export flashcards");
      }
      const markdown = await response.text();
      const count = Number(response.headers.get("X-Flashcard-Count"));
      if (count === 0) {
        setMessage({
          error: false,
          text:
            mode === "difficult"
              ? "No active flashcards with an Again or Hard review match the selected direction and period."
              : "No flashcards to export yet.",
        });
        return;
      }
      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(markdown);
        } catch {
          setPreview(markdown);
          setMessage({
            error: false,
            text: "Select and copy the Markdown below. Your browser could not copy it automatically.",
          });
          return;
        }
      } else {
        const blobUrl = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = mode === "difficult" ? "flashcards-difficult.md" : "flashcards.md";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
      setMessage({
        error: false,
        text: `${count} flashcards ${action === "copy" ? "copied to clipboard" : "downloaded"}.${mode === "difficult" && count < Number(limit) ? " All matching flashcards were included." : ""}`,
      });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Could not export flashcards" });
    } finally {
      setBusy(null);
    }
  };

  const actions = (mode: "all" | "difficult") => (
    <div className="mt-5 flex flex-wrap gap-2">
      <Button
        disabled={!isAuthenticated || !!busy || (mode === "difficult" && !validLimit)}
        onClick={() => void exportMarkdown(mode, "download")}
      >
        {busy === `${mode}-download` ? <LoaderCircle className="animate-spin" /> : <Download />}
        Download Markdown
      </Button>
      <Button
        variant="secondary"
        disabled={!isAuthenticated || !!busy || (mode === "difficult" && !validLimit)}
        onClick={() => void exportMarkdown(mode, "copy")}
      >
        {busy === `${mode}-copy` ? <LoaderCircle className="animate-spin" /> : <Copy />}
        Copy Markdown
      </Button>
    </div>
  );

  return (
    <section className="mx-auto max-w-3xl py-8">
      <a
        href="/flashcards"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Flashcards
      </a>
      <h1 className="text-3xl font-bold">Export flashcards</h1>
      <p className="mt-2 text-muted-foreground">
        Download a Markdown file or copy it for your English practice. Each learning direction counts as a separate
        flashcard.
      </p>
      <div className="mt-8 space-y-6">
        <section className="rounded-lg border border-border bg-card p-6" aria-labelledby="all-export-title">
          <h2 id="all-export-title" className="text-xl font-semibold">
            All flashcards · full details
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            All flashcards, including archived ones, with the same information as the previous export: front, back,
            direction, score, state, reviews, lapses, stability, review dates, and status.
          </p>
          {actions("all")}
        </section>
        <section className="rounded-lg border border-border bg-card p-6" aria-labelledby="difficult-export-title">
          <h2 id="difficult-export-title" className="text-xl font-semibold">
            Difficult flashcards · Again / Hard
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Active flashcards rated Again or Hard in the selected period, ranked by difficulty score (highest first).
            The score considers the full review history, recent difficulties, lapses, and stability.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Only: Front, Back, Kierunek, Score, Powtórki, Błędy, Stabilność.
          </p>
          <label htmlFor="export-limit" className="mt-5 block text-sm font-medium">
            Number of flashcards
          </label>
          <input
            id="export-limit"
            type="number"
            min="1"
            max="1000"
            step="1"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            aria-invalid={!validLimit}
            aria-describedby="export-limit-help"
            className="mt-2 w-32 rounded-md border border-input bg-background p-2"
          />
          <p id="export-limit-help" className="mt-2 text-sm text-muted-foreground">
            Choose 1–1000 (default 20). If fewer match, all matching flashcards are exported.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium" htmlFor="export-direction">
              Learning direction
              <select
                id="export-direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                className="mt-2 block w-full rounded-md border border-input bg-background p-2"
              >
                <option value="all">Both directions</option>
                <option value="pl_to_en">PL → EN</option>
                <option value="en_to_pl">EN → PL</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="export-period">
              Again / Hard reviews from
              <select
                id="export-period"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                aria-describedby="export-period-help"
                className="mt-2 block w-full rounded-md border border-input bg-background p-2"
              >
                <option value="all">All history</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
          </div>
          <p id="export-period-help" className="mt-2 text-sm text-muted-foreground">
            The period applies to Again / Hard ratings, even if a later review was Good or Easy. Filters apply before
            the flashcard limit.
          </p>
          {actions("difficult")}
        </section>
        <p className="text-sm text-muted-foreground">
          For voice practice, paste the difficult flashcards and add: „Ćwicz ze mną głosowo. Podawaj po jednym pytaniu
          zgodnie z kierunkiem fiszki, czekaj na odpowiedź, poprawiaj błędy i wracaj do trudnych zwrotów w nowych
          zdaniach.”
        </p>
      </div>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={`mt-6 text-sm ${message.error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message.text}
        </p>
      )}
      {preview && (
        <textarea
          aria-label="Markdown to copy"
          readOnly
          value={preview}
          onFocus={(event) => event.target.select()}
          className="mt-4 h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
        />
      )}
    </section>
  );
}
