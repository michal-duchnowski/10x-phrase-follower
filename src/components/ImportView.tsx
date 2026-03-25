import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";
import { ToastProvider, useToast } from "./ui/toast";
import { generateUUID } from "../lib/utils";
import type { ImportNotebookCommand, ImportNotebookResultDTO, NotebookDTO } from "../types";

interface ImportState {
  step: "form" | "summary";
  isLoading: boolean;
  error: string | null;
}

// Internal component that uses toast
function ImportViewContent() {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const [state, setState] = useState<ImportState>({
    step: "form",
    isLoading: false,
    error: null,
  });

  // Form state
  const [notebookName, setNotebookName] = useState("");
  const [linesText, setLinesText] = useState("");
  const [normalize, setNormalize] = useState(false);
  const [lockedNotebookId, setLockedNotebookId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const notebookId = url.searchParams.get("notebookId");
    if (!notebookId) return;

    setLockedNotebookId(notebookId);

    const loadNotebookName = async () => {
      try {
        const notebook = await apiCall<NotebookDTO>(`/api/notebooks/${notebookId}`, { method: "GET" });
        setNotebookName(notebook.name ?? "");
      } catch (err) {
        setLockedNotebookId(null);
        addToast({
          type: "error",
          title: "Notebook not found",
          description: err instanceof Error ? err.message : "Failed to load notebook",
        });
      }
    };

    loadNotebookName();
  }, [apiCall, addToast]);

  // Import result
  const [importResult, setImportResult] = useState<ImportNotebookResultDTO | null>(null);

  // Validate form data
  const validateForm = (): string | null => {
    if (!notebookName.trim()) {
      return "Notebook name is required";
    }

    if (notebookName.length < 1 || notebookName.length > 100) {
      return "Notebook name must be between 1 and 100 characters";
    }

    if (!linesText.trim()) {
      return "Import content is required";
    }

    const lines = linesText.split("\n").filter((line) => line.trim());

    if (lines.length === 0) {
      return "No valid lines found";
    }

    if (lines.length > 100) {
      return "Import exceeds 100 phrases limit";
    }

    // Basic format validation
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.includes(":::")) {
        return `Line ${i + 1}: Missing separator (:::) between EN and PL parts`;
      }
    }

    return null;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setState((prev) => ({ ...prev, error: "Authentication required" }));
      return;
    }

    // Validate form
    const validationError = validateForm();
    if (validationError) {
      setState((prev) => ({ ...prev, error: validationError }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Prepare lines array
      const lines = linesText.split("\n").filter((line) => line.trim());

      // Prepare import command
      const command: ImportNotebookCommand = {
        name: notebookName.trim(),
        lines,
        normalize,
        notebook_id: lockedNotebookId ?? undefined,
      };

      // Generate idempotency key
      const idempotencyKey = generateUUID();

      // Call import API
      const result = await apiCall<ImportNotebookResultDTO>("/api/notebooks/import", {
        method: "POST",
        body: JSON.stringify(command),
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      });

      setImportResult(result);
      setState((prev) => ({ ...prev, step: "summary", isLoading: false }));

      // Show success toast
      addToast({
        type: "success",
        title: "Import completed",
        description: `Successfully imported ${result.import.accepted} phrases.`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Import failed";

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));

      // Show error toast
      addToast({
        type: "error",
        title: "Import failed",
        description: errorMessage,
      });
    }
  };

  // Reset form to start over
  const handleStartOver = () => {
    setState({ step: "form", isLoading: false, error: null });
    setNotebookName("");
    setLinesText("");
    setNormalize(false);
    setImportResult(null);
  };

  // Render import summary
  if (state.step === "summary" && importResult) {
    return <ImportSummary result={importResult} onStartOver={handleStartOver} />;
  }

  // Render import form
  return (
    <div className="space-y-6">
      <ImportForm
        notebookName={notebookName}
        setNotebookName={setNotebookName}
        isNotebookLocked={Boolean(lockedNotebookId)}
        linesText={linesText}
        setLinesText={setLinesText}
        normalize={normalize}
        setNormalize={setNormalize}
        onSubmit={handleSubmit}
        isLoading={state.isLoading}
        error={state.error}
      />
    </div>
  );
}

// Import Form Component
interface ImportFormProps {
  notebookName: string;
  setNotebookName: (value: string) => void;
  isNotebookLocked: boolean;
  linesText: string;
  setLinesText: (value: string) => void;
  normalize: boolean;
  setNormalize: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

function ImportForm({
  notebookName,
  setNotebookName,
  isNotebookLocked,
  linesText,
  setLinesText,
  normalize,
  setNormalize,
  onSubmit,
  isLoading,
  error,
}: ImportFormProps) {
  const lineCount = linesText.split("\n").filter((line) => line.trim()).length;
  const effectiveLineCount = Math.min(lineCount, 100);

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <form onSubmit={onSubmit} className="space-y-6">
        {/* Error display */}
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Notebook name */}
        <div className="space-y-2">
          <label htmlFor="notebook-name" className="text-sm font-medium text-foreground">
            Notebook Name *
          </label>
          <input
            id="notebook-name"
            type="text"
            value={notebookName}
            onChange={(e) => setNotebookName(e.target.value)}
            placeholder="Enter notebook name (1-100 characters)"
            maxLength={100}
            required
            disabled={isNotebookLocked}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground">
            {isNotebookLocked ? "Importing into an existing notebook." : `${notebookName.length}/100 characters`}
          </p>
        </div>

        {/* Import content */}
        <div className="space-y-2">
          <label htmlFor="import-content" className="text-sm font-medium text-foreground">
            Import Content *
          </label>
          <textarea
            id="import-content"
            value={linesText}
            onChange={(e) => setLinesText(e.target.value)}
            placeholder="Enter phrases in format: EN text ::: PL text (one per line)"
            rows={12}
            required
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent font-mono text-sm"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{lineCount} lines (max 100)</span>
            <span className={lineCount > 100 ? "text-destructive" : ""}>{lineCount > 100 ? "Exceeds limit!" : ""}</span>
          </div>
        </div>

        {/* Normalize option */}
        <div className="flex items-center space-x-2">
          <input
            id="normalize"
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
            className="rounded border-input"
          />
          <label htmlFor="normalize" className="text-sm text-foreground">
            Normalize text (remove extra spaces, convert quotes)
          </label>
        </div>

        {/* Format help */}
        <div className="p-4 bg-muted/50 rounded-md">
          <h4 className="text-sm font-medium text-foreground mb-2">Format Requirements:</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              • Each line: <code>EN text ::: PL text</code>
            </li>
            <li>
              • Exactly one separator <code>:::</code> per line
            </li>
            <li>• Both EN and PL parts must be non-empty</li>
            <li>• Maximum 2000 characters per part</li>
            <li>• Maximum 100 lines per import</li>
          </ul>
          <div className="mt-2">
            <p className="text-xs text-muted-foreground font-medium">Example:</p>
            <code className="text-xs bg-background px-2 py-1 rounded">Hello world ::: Witaj świecie</code>
          </div>
        </div>

        {/* Submit button */}
        <Button type="submit" disabled={isLoading || lineCount > 100} className="w-full">
          {isLoading ? "Importing..." : `Import ${effectiveLineCount} phrase(s)`}
        </Button>
      </form>
    </div>
  );
}

// Import Summary Component
interface ImportSummaryProps {
  result: ImportNotebookResultDTO;
  onStartOver: () => void;
}

function ImportSummary({ result, onStartOver }: ImportSummaryProps) {
  const { notebook, import: importData } = result;
  const { accepted, rejected, logs } = importData;

  return (
    <div className="space-y-6">
      {/* Success message */}
      <div className="p-4 rounded-md bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center">
          <svg
            className="h-5 w-5 text-green-600 dark:text-green-400 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <h3 className="text-sm font-medium text-green-800 dark:text-green-200">Import completed successfully!</h3>
        </div>
        <p className="text-sm text-green-700 dark:text-green-300 mt-1">
          Imported {accepted} phrase(s) into &quot;{notebook.name}&quot;.
        </p>
      </div>

      {/* Import statistics */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Import Summary</h3>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{accepted}</div>
            <div className="text-sm text-green-700 dark:text-green-300">Accepted</div>
          </div>
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{rejected}</div>
            <div className="text-sm text-red-700 dark:text-red-300">Rejected</div>
          </div>
        </div>

        {/* Rejected lines details */}
        {rejected > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground">Rejected Lines:</h4>
            <div className="max-h-60 overflow-y-auto space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md"
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-medium text-red-700 dark:text-red-300">Line {log.line_no}</span>
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400 font-mono bg-background px-2 py-1 rounded mb-2">
                    {log.raw_text}
                  </div>
                  <div className="text-xs text-red-700 dark:text-red-300">{log.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-6">
          <Button asChild className="flex-1">
            <a href={`/notebooks/${notebook.id}`}>View Notebook</a>
          </Button>
          <Button variant="outline" onClick={onStartOver} className="flex-1">
            Import Another
          </Button>
        </div>
      </div>
    </div>
  );
}

// Main export with ToastProvider wrapper
export default function ImportView(props: ImportViewProps) {
  return (
    <ToastProvider>
      <ImportViewContent {...props} />
    </ToastProvider>
  );
}
