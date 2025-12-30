import React, { useState } from "react";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import { useApi } from "../lib/hooks/useApi";
import { Download } from "lucide-react";

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ExportZipButtonProps {
  notebookId: string;
  disabled?: boolean;
  disabledReason?: string;
  showLabel?: boolean;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export default function ExportZipButton({
  notebookId,
  disabled = false,
  disabledReason,
  showLabel = false,
  label = "Download ZIP",
  variant = "default",
  size = "sm",
  className,
  query,
}: ExportZipButtonProps) {
  const { addToast } = useToast();
  const { token, isAuthenticated } = useApi();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (disabled || isExporting || !isAuthenticated) return;

    setIsExporting(true);

    try {
      if (!token) {
        throw new Error("Authentication required");
      }

      const qs = new URLSearchParams();
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value === undefined || value === null) continue;
          if (typeof value === "boolean") {
            qs.set(key, value ? "1" : "0");
            continue;
          }
          qs.set(key, String(value));
        }
      }
      const url = `/api/notebooks/${notebookId}/export-zip${qs.size > 0 ? `?${qs.toString()}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/zip",
        },
      });

      if (!response.ok) {
        // Try to parse error message
        let errorMessage = "Failed to export ZIP";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
          } else {
            const text = await response.text();
            if (text) {
              errorMessage = text;
            }
          }
        } catch {
          // Use default error message
        }

        addToast({
          type: "error",
          title: "Export failed",
          description: errorMessage,
        });
        return;
      }

      // Get the blob and trigger download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      let filename = "notebook.zip";
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create temporary link and trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(url);

      addToast({
        type: "success",
        title: "Export completed",
        description: "ZIP file has been downloaded successfully.",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to export ZIP";
      console.error("[ExportZipButton] Export error:", err);

      addToast({
        type: "error",
        title: "Export failed",
        description: errorMessage,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={disabled || isExporting || !isAuthenticated}
      variant={variant}
      size={size}
      title={disabledReason || (isExporting ? "Exporting..." : "Export ZIP file")}
      className={`${showLabel ? "gap-2 px-3" : "p-2"} shrink-0 ${isExporting ? "export-pulsing" : ""} ${className || ""}`}
    >
      <Download className="size-4" />
      {showLabel && <span>{label}</span>}
    </Button>
  );
}
