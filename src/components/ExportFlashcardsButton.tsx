import { useState } from "react";
import { Download } from "lucide-react";
import { useApi } from "../lib/hooks/useApi";
import { useToast } from "./ui/toast";
import { Button } from "./ui/button";

export default function ExportFlashcardsButton({ showLabel = false }: { showLabel?: boolean }) {
  const { token, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const exportMarkdown = async () => {
    if (!token || !isAuthenticated || isExporting) return;
    setIsExporting(true);
    try {
      const response = await fetch("/api/flashcards/export", {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/markdown" },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Could not export flashcards");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "flashcards.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      addToast({ type: "success", title: "Export completed", description: "Markdown file has been downloaded." });
    } catch (error) {
      addToast({
        type: "error",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Could not export flashcards",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size={showLabel ? "default" : "icon"}
      type="button"
      onClick={() => void exportMarkdown()}
      disabled={!isAuthenticated || isExporting}
      title={isExporting ? "Exporting flashcards..." : "Export all flashcards to Markdown"}
      aria-label="Export all flashcards to Markdown"
    >
      <Download className={isExporting ? "animate-pulse" : undefined} />
      {showLabel && "Export Markdown"}
    </Button>
  );
}
