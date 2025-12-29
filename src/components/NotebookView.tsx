import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";
import { ToastProvider, useToast } from "./ui/toast";
import GenerateAudioButton from "./GenerateAudioButton";
import ExportZipButton from "./ExportZipButton";
import MobileActionMenu from "./MobileActionMenu";
import { Trash2 } from "lucide-react";
import DifficultyBadge from "./DifficultyBadge";
import type {
  PhraseDTO,
  PhraseListResponse,
  NotebookDTO,
  JobDTO,
  PhraseDifficultyOrUnset,
  PhraseDifficulty,
  BulkUpdatePhrasesCommand,
} from "../types";
import { parseMarkdownToHtml, isVirtualNotebook } from "../lib/utils";

interface NotebookViewProps {
  notebookId: string;
}

interface NotebookState {
  notebook: NotebookDTO | null;
  phrases: PhraseDTO[];
  isLoading: boolean;
  error: string | null;
  activeJob: JobDTO | null;
}

// Internal component that uses toast
function NotebookViewContent({ notebookId }: NotebookViewProps) {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const [state, setState] = useState<NotebookState>({
    notebook: null,
    phrases: [],
    isLoading: true,
    error: null,
    activeJob: null,
  });
  const [difficultyFilter, setDifficultyFilter] = useState<PhraseDifficultyOrUnset | "all">("all");
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<string>>(new Set());
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<Set<string>>(new Set());
  const [allNotebooks, setAllNotebooks] = useState<NotebookDTO[]>([]);

  // Check if this is a virtual notebook (Smart List)
  const isVirtual = isVirtualNotebook(notebookId);

  // Load difficulty filter and pinned filter from localStorage/URL
  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const savedFilter = localStorage.getItem(`notebook-difficulty-filter-${notebookId}`);
      if (
        savedFilter &&
        (savedFilter === "all" ||
          savedFilter === "unset" ||
          savedFilter === "easy" ||
          savedFilter === "medium" ||
          savedFilter === "hard")
      ) {
        setDifficultyFilter(savedFilter as PhraseDifficultyOrUnset | "all");
      }

      // Load pinned filter for Smart Lists
      if (isVirtual) {
        const urlParams = new URLSearchParams(window.location.search);
        const pinnedParam = urlParams.get("pinned");
        const savedPinned = localStorage.getItem(`notebook-pinned-filter-${notebookId}`);
        const shouldBePinned = pinnedParam === "1" || savedPinned === "1";
        setOnlyPinned(shouldBePinned);

        // Load selected notebook IDs from URL or localStorage
        const notebookIdsParam = urlParams.get("notebooks");
        const savedNotebookIds = localStorage.getItem(`notebook-selected-notebooks-${notebookId}`);
        if (notebookIdsParam) {
          const ids = notebookIdsParam.split(",").filter((id) => id.length > 0);
          setSelectedNotebookIds(new Set(ids));
        } else if (savedNotebookIds) {
          try {
            const ids = JSON.parse(savedNotebookIds);
            if (Array.isArray(ids)) {
              setSelectedNotebookIds(new Set(ids));
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }, [notebookId, isVirtual]);

  // Save difficulty filter to localStorage
  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(`notebook-difficulty-filter-${notebookId}`, difficultyFilter);
    }
  }, [difficultyFilter, notebookId]);

  // Save pinned filter to localStorage and update URL
  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined" && isVirtual) {
      localStorage.setItem(`notebook-pinned-filter-${notebookId}`, onlyPinned ? "1" : "0");

      // Update URL without page reload
      const url = new URL(window.location.href);
      if (onlyPinned) {
        url.searchParams.set("pinned", "1");
      } else {
        url.searchParams.delete("pinned");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, [onlyPinned, notebookId, isVirtual]);

  // Save selected notebook IDs to localStorage and update URL
  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined" && isVirtual) {
      const idsArray = Array.from(selectedNotebookIds);
      localStorage.setItem(`notebook-selected-notebooks-${notebookId}`, JSON.stringify(idsArray));

      // Update URL without page reload
      const url = new URL(window.location.href);
      if (idsArray.length > 0) {
        url.searchParams.set("notebooks", idsArray.join(","));
      } else {
        url.searchParams.delete("notebooks");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedNotebookIds, notebookId, isVirtual]);

  // Load all notebooks for virtual notebook filtering
  useEffect(() => {
    if (!isAuthenticated || !isVirtual) return;

    const loadNotebooks = async () => {
      try {
        const data = await apiCall<{ items: NotebookDTO[]; next_cursor: string | null }>(`/api/notebooks?limit=100`, {
          method: "GET",
        });
        setAllNotebooks(data.items || []);
      } catch (err) {
        // Silently fail - notebooks filter is optional
        // eslint-disable-next-line no-console
        console.warn("Failed to load notebooks for filtering:", err);
      }
    };

    loadNotebooks();
  }, [isAuthenticated, isVirtual, apiCall]);

  // Load notebook and phrases
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadData = async () => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const isVirtual = isVirtualNotebook(notebookId);

        // Build phrases URL - for virtual notebooks, use created_at DESC, for regular use position ASC
        let phrasesUrl = `/api/notebooks/${notebookId}/phrases?sort=${isVirtual ? "created_at" : "position"}&order=${isVirtual ? "desc" : "asc"}&limit=100`;
        // Don't apply difficulty filter for virtual notebooks (they already filter by difficulty)
        if (!isVirtual && difficultyFilter !== "all") {
          phrasesUrl += `&difficulty=${difficultyFilter}`;
        }
        // Add pinned filter for Smart Lists
        if (isVirtual && onlyPinned) {
          phrasesUrl += `&pinned=1`;
        }
        // Add notebook filter for Smart Lists (OR logic - multiple notebooks)
        if (isVirtual && selectedNotebookIds.size > 0) {
          phrasesUrl += `&notebook_ids=${Array.from(selectedNotebookIds).join(",")}`;
        }

        // Load notebook and phrases
        // For virtual notebooks, skip notebook fetch (it doesn't exist in DB)
        const [notebookData, phrasesData] = await Promise.all([
          isVirtual
            ? Promise.resolve({
                id: notebookId,
                name:
                  notebookId === "difficulty-easy"
                    ? "All Easy"
                    : notebookId === "difficulty-medium"
                      ? "All Medium"
                      : "All Hard",
                current_build_id: null,
                last_generate_job_id: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as NotebookDTO)
            : apiCall<NotebookDTO>(`/api/notebooks/${notebookId}`, { method: "GET" }),
          apiCall<PhraseListResponse>(phrasesUrl, {
            method: "GET",
          }),
        ]);

        // Check if there's an active job
        // Use jobs list endpoint to find active jobs (more reliable than direct job fetch)
        let activeJob: JobDTO | null = null;
        try {
          // Get all recent jobs for this notebook and find the most recent active one
          const jobsResponse = await apiCall<{ items: JobDTO[] }>(`/api/notebooks/${notebookId}/jobs?limit=25`, {
            method: "GET",
          });
          const jobs = jobsResponse.items || [];

          // Find the most recent active job (queued or running)
          const activeJobs = jobs.filter((job) => job.state === "queued" || job.state === "running");
          if (activeJobs.length > 0) {
            // Sort by created_at descending and take the most recent
            activeJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            activeJob = activeJobs[0];
          }
        } catch {
          // If jobs list endpoint fails, try fallback to direct job fetch
          if (notebookData.last_generate_job_id) {
            try {
              const job = await apiCall<JobDTO>(`/api/jobs/${notebookData.last_generate_job_id}`, {
                method: "GET",
              });
              if (job.state === "queued" || job.state === "running") {
                activeJob = job;
              }
            } catch {
              // Job might not exist or be inaccessible, ignore
            }
          }
        }

        setState((prev) => ({
          ...prev,
          notebook: notebookData,
          phrases: phrasesData.items,
          activeJob,
          isLoading: false,
        }));
        // Clear selection when filter changes
        setSelectedPhraseIds(new Set());
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to load notebook",
        }));
      }
    };

    loadData();
  }, [notebookId, isAuthenticated, apiCall, difficultyFilter, onlyPinned, selectedNotebookIds, isVirtual]);

  // Handle bulk difficulty update
  const handleBulkUpdateDifficulty = async (difficulty: PhraseDifficulty | null) => {
    if (selectedPhraseIds.size === 0) {
      addToast({
        type: "error",
        title: "No phrases selected",
        description: "Please select at least one phrase to update.",
      });
      return;
    }

    try {
      const command: BulkUpdatePhrasesCommand = {
        phrase_ids: Array.from(selectedPhraseIds),
        difficulty,
      };

      await apiCall(`/api/notebooks/${notebookId}/phrases/bulk-update`, {
        method: "POST",
        body: JSON.stringify(command),
      });

      // Reload phrases to reflect changes
      const isVirtual = isVirtualNotebook(notebookId);
      const phrasesUrl = `/api/notebooks/${notebookId}/phrases?sort=${isVirtual ? "created_at" : "position"}&order=${isVirtual ? "desc" : "asc"}&limit=100${
        !isVirtual && difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : ""
      }${isVirtual && onlyPinned ? `&pinned=1` : ""}${isVirtual && selectedNotebookIds.size > 0 ? `&notebook_ids=${Array.from(selectedNotebookIds).join(",")}` : ""}`;
      const phrasesData = await apiCall<PhraseListResponse>(phrasesUrl, {
        method: "GET",
      });

      setState((prev) => ({
        ...prev,
        phrases: phrasesData.items,
      }));

      // Save count before clearing selection
      const updatedCount = selectedPhraseIds.size;

      // Clear selection
      setSelectedPhraseIds(new Set());

      const difficultyLabel = difficulty || "unset";
      addToast({
        type: "success",
        title: "Difficulty updated",
        description: `Updated ${updatedCount} phrase(s) to ${difficultyLabel}.`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to update phrases";
      addToast({
        type: "error",
        title: "Update failed",
        description: errorMessage,
      });
    }
  };

  // Handle phrase deletion
  const handleDeletePhrase = async (phraseId: string) => {
    if (!confirm("Are you sure you want to delete this phrase?")) return;

    try {
      await apiCall(`/api/phrases/${phraseId}`, {
        method: "DELETE",
      });

      // Remove from local state
      setState((prev) => ({
        ...prev,
        phrases: prev.phrases.filter((p) => p.id !== phraseId),
      }));

      // Show success toast
      addToast({
        type: "success",
        title: "Phrase deleted",
        description: "The phrase has been successfully removed.",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete phrase";

      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));

      // Show error toast
      addToast({
        type: "error",
        title: "Delete failed",
        description: errorMessage,
      });
    }
  };

  // Handle job creation
  const handleJobCreated = (job: JobDTO) => {
    setState((prev) => ({
      ...prev,
      activeJob: job,
    }));
  };

  // Handle job update during polling
  const handleJobUpdated = (job: JobDTO) => {
    setState((prev) => ({
      ...prev,
      activeJob: job,
    }));
  };

  // Handle job completion
  const handleJobCompleted = (job: JobDTO | null) => {
    setState((prev) => ({
      ...prev,
      activeJob: null,
    }));

    // Only reload data if job completed successfully (not null)
    if (job) {
      // Reload notebook data to reflect new audio status
      const loadData = async () => {
        try {
          const [notebookData, phrasesData] = await Promise.all([
            apiCall<NotebookDTO>(`/api/notebooks/${notebookId}`, { method: "GET" }),
            apiCall<PhraseListResponse>(`/api/notebooks/${notebookId}/phrases?sort=position&order=asc&limit=100`, {
              method: "GET",
            }),
          ]);

          setState((prev) => ({
            ...prev,
            notebook: notebookData,
            phrases: phrasesData.items,
          }));
        } catch {
          // Silently fail - user can refresh manually if needed
        }
      };

      loadData();
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Authentication required</p>
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-muted animate-pulse rounded w-48"></div>
          <a href="/notebooks" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Notebooks
          </a>
        </div>
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Notebook</h1>
          <a href="/notebooks" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Notebooks
          </a>
        </div>
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{state.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{state.notebook?.name || "Notebook"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{state.phrases.length} phrases</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/notebooks" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Notebooks
          </a>
        </div>
      </div>

      {/* Error display */}
      {state.error && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{state.error}</p>
        </div>
      )}

      {/* Active job status */}
      {state.activeJob && (
        <div className="p-3 rounded-md bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <div className="flex flex-col">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Audio generation {state.activeJob.state === "queued" ? "queued" : "in progress"}... This may take a few
                minutes.
              </p>
              <p className="text-xs text-blue-800/80 dark:text-blue-200/80">
                Job state: <span className="font-mono">{state.activeJob.state}</span>{" "}
                <span className="opacity-80">(id: {state.activeJob.id})</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Phrases table */}
      <div className="bg-card border border-border rounded-lg">
        <div className="p-3 sm:p-4 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold">Phrases</h2>
              {/* Desktop actions */}
              <div className="hidden md:flex items-center gap-2 flex-wrap">
                <Button asChild size="sm" variant="default" className="shrink-0">
                  <a
                    href={`/player/${notebookId}${difficultyFilter !== "all" ? `?difficulty=${difficultyFilter}` : ""}`}
                    title="Open Player"
                  >
                    Player
                  </a>
                </Button>
                <Button asChild size="sm" variant="default" className="shrink-0">
                  <a
                    href={`/notebooks/${notebookId}/learn${difficultyFilter !== "all" ? `?difficulty=${difficultyFilter}` : ""}`}
                    title="Open Learn Mode"
                  >
                    Learn
                  </a>
                </Button>
                {!isVirtualNotebook(notebookId) && (
                  <>
                    <GenerateAudioButton
                      notebookId={notebookId}
                      onJobCreated={handleJobCreated}
                      onJobCompleted={handleJobCompleted}
                      onJobUpdated={handleJobUpdated}
                      activeJobId={state.activeJob?.id || null}
                    />
                    <ExportZipButton
                      notebookId={notebookId}
                      disabled={!state.notebook?.current_build_id}
                      disabledReason={
                        !state.notebook?.current_build_id ? "Generate audio first to enable export" : undefined
                      }
                    />
                  </>
                )}
              </div>
            </div>

            {/* Mobile actions */}
            <div className="md:hidden">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-stretch">
                <Button asChild size="lg" variant="default" className="w-full">
                  <a
                    href={`/player/${notebookId}${difficultyFilter !== "all" ? `?difficulty=${difficultyFilter}` : ""}`}
                    title="Open Player"
                  >
                    Player
                  </a>
                </Button>
                <Button asChild size="lg" variant="default" className="w-full">
                  <a
                    href={`/notebooks/${notebookId}/learn${difficultyFilter !== "all" ? `?difficulty=${difficultyFilter}` : ""}`}
                    title="Open Learn Mode"
                  >
                    Learn
                  </a>
                </Button>

                {!isVirtualNotebook(notebookId) && (
                  <MobileActionMenu triggerLabel="Actions" triggerIcon triggerVariant="outline" triggerSize="icon">
                    {() => (
                      <div className="space-y-2">
                        <GenerateAudioButton
                          notebookId={notebookId}
                          onJobCreated={handleJobCreated}
                          onJobCompleted={handleJobCompleted}
                          onJobUpdated={handleJobUpdated}
                          activeJobId={state.activeJob?.id || null}
                          containerClassName="w-full"
                          buttonClassName="w-full"
                        />
                        <ExportZipButton
                          notebookId={notebookId}
                          disabled={!state.notebook?.current_build_id}
                          disabledReason={
                            !state.notebook?.current_build_id ? "Generate audio first to enable export" : undefined
                          }
                          showLabel
                          size="default"
                          variant="default"
                          className="w-full justify-start"
                        />
                      </div>
                    )}
                  </MobileActionMenu>
                )}
              </div>
            </div>
            {/* Only pinned filter and notebook filters - only for Smart Lists */}
            {isVirtual && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <div className="hidden md:flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">Filter:</span>
                    <Button
                      variant={onlyPinned ? "default" : "ghost"}
                      size="sm"
                      className={!onlyPinned ? "text-primary" : ""}
                      onClick={() => setOnlyPinned(!onlyPinned)}
                    >
                      Only pinned
                    </Button>
                  </div>

                  <div className="md:hidden w-full space-y-2">
                    <div className="text-sm text-muted-foreground">Filter</div>
                    <Button
                      variant={onlyPinned ? "default" : "ghost"}
                      size="sm"
                      className={!onlyPinned ? "w-full text-primary" : "w-full"}
                      onClick={() => setOnlyPinned(!onlyPinned)}
                    >
                      Only pinned
                    </Button>
                  </div>
                </div>

                {/* Notebook filters */}
                {allNotebooks.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-sm text-muted-foreground">Notebooks:</div>
                    <div className="hidden md:flex items-center gap-2 flex-wrap">
                      {allNotebooks.map((notebook) => {
                        const isSelected = selectedNotebookIds.has(notebook.id);
                        return (
                          <Button
                            key={notebook.id}
                            variant={isSelected ? "default" : "ghost"}
                            size="sm"
                            className={!isSelected ? "text-primary" : ""}
                            onClick={() => {
                              const newSelection = new Set(selectedNotebookIds);
                              if (isSelected) {
                                newSelection.delete(notebook.id);
                              } else {
                                newSelection.add(notebook.id);
                              }
                              setSelectedNotebookIds(newSelection);
                            }}
                          >
                            {notebook.name || "Unnamed"}
                          </Button>
                        );
                      })}
                      {selectedNotebookIds.size > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setSelectedNotebookIds(new Set())}>
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="md:hidden space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {allNotebooks.map((notebook) => {
                          const isSelected = selectedNotebookIds.has(notebook.id);
                          return (
                            <Button
                              key={notebook.id}
                              variant={isSelected ? "default" : "ghost"}
                              size="sm"
                              className={!isSelected ? "text-primary" : ""}
                              onClick={() => {
                                const newSelection = new Set(selectedNotebookIds);
                                if (isSelected) {
                                  newSelection.delete(notebook.id);
                                } else {
                                  newSelection.add(notebook.id);
                                }
                                setSelectedNotebookIds(newSelection);
                              }}
                            >
                              {notebook.name || "Unnamed"}
                            </Button>
                          );
                        })}
                      </div>
                      {selectedNotebookIds.size > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setSelectedNotebookIds(new Set())}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Difficulty filter and bulk actions - only for regular notebooks */}
            {!isVirtualNotebook(notebookId) && (
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="hidden md:flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Filter:</span>
                  <Button
                    variant={difficultyFilter === "all" ? "default" : "ghost"}
                    size="sm"
                    className={difficultyFilter !== "all" ? "text-primary" : ""}
                    onClick={() => setDifficultyFilter("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={difficultyFilter === "unset" ? "default" : "ghost"}
                    size="sm"
                    className={difficultyFilter !== "unset" ? "text-primary" : ""}
                    onClick={() => setDifficultyFilter("unset")}
                  >
                    Unset
                  </Button>
                  <Button
                    variant={difficultyFilter === "easy" ? "default" : "ghost"}
                    size="sm"
                    className={difficultyFilter !== "easy" ? "text-primary" : ""}
                    onClick={() => setDifficultyFilter("easy")}
                  >
                    Easy
                  </Button>
                  <Button
                    variant={difficultyFilter === "medium" ? "default" : "ghost"}
                    size="sm"
                    className={difficultyFilter !== "medium" ? "text-primary" : ""}
                    onClick={() => setDifficultyFilter("medium")}
                  >
                    Medium
                  </Button>
                  <Button
                    variant={difficultyFilter === "hard" ? "default" : "ghost"}
                    size="sm"
                    className={difficultyFilter !== "hard" ? "text-primary" : ""}
                    onClick={() => setDifficultyFilter("hard")}
                  >
                    Hard
                  </Button>
                </div>

                <div className="md:hidden w-full space-y-2">
                  <div className="text-sm text-muted-foreground">Filter</div>
                  <select
                    value={difficultyFilter}
                    onChange={(e) => setDifficultyFilter(e.target.value as PhraseDifficultyOrUnset | "all")}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="Difficulty filter"
                  >
                    <option value="all">All</option>
                    <option value="unset">Unset</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
            )}

            {/* Bulk actions - for both regular and virtual notebooks */}
            {selectedPhraseIds.size > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="hidden md:flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">{selectedPhraseIds.size} selected:</span>
                  <Button
                    asChild
                    variant="default"
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <a
                      href={`/player/${notebookId}?phrase_ids=${Array.from(selectedPhraseIds).join(",")}${difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : ""}`}
                      title="Open Player with selected phrases"
                    >
                      Player
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="default"
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <a
                      href={`/notebooks/${notebookId}/learn?phrase_ids=${Array.from(selectedPhraseIds).join(",")}${difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : ""}`}
                      title="Open Learn Mode with selected phrases"
                    >
                      Learn
                    </a>
                  </Button>
                  <Button variant="default" size="sm" onClick={() => handleBulkUpdateDifficulty("easy")}>
                    Mark Easy
                  </Button>
                  <Button variant="default" size="sm" onClick={() => handleBulkUpdateDifficulty("medium")}>
                    Mark Medium
                  </Button>
                  <Button variant="default" size="sm" onClick={() => handleBulkUpdateDifficulty("hard")}>
                    Mark Hard
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleBulkUpdateDifficulty(null)}>
                    Clear
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPhraseIds(new Set())}>
                    Deselect All
                  </Button>
                </div>

                <div className="md:hidden w-full space-y-2">
                  <div className="text-sm text-muted-foreground">{selectedPhraseIds.size} selected</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      asChild
                      variant="default"
                      size="sm"
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <a
                        href={`/player/${notebookId}?phrase_ids=${Array.from(selectedPhraseIds).join(",")}${difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : ""}`}
                        title="Open Player with selected phrases"
                      >
                        Player
                      </a>
                    </Button>
                    <Button
                      asChild
                      variant="default"
                      size="sm"
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <a
                        href={`/notebooks/${notebookId}/learn?phrase_ids=${Array.from(selectedPhraseIds).join(",")}${difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : ""}`}
                        title="Open Learn Mode with selected phrases"
                      >
                        Learn
                      </a>
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full"
                      onClick={() => handleBulkUpdateDifficulty("easy")}
                    >
                      Easy
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full"
                      onClick={() => handleBulkUpdateDifficulty("medium")}
                    >
                      Medium
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full"
                      onClick={() => handleBulkUpdateDifficulty("hard")}
                    >
                      Hard
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleBulkUpdateDifficulty(null)}
                    >
                      Clear
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelectedPhraseIds(new Set())}>
                    Deselect All
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {state.phrases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">No phrases found in this notebook.</p>
            <a
              href="/import"
              className="inline-flex items-center mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Import Phrases
            </a>
          </div>
        ) : (
          <>
            {/* Desktop table view */}
            <PhraseTable
              phrases={state.phrases}
              notebookId={notebookId}
              onDelete={handleDeletePhrase}
              selectedPhraseIds={selectedPhraseIds}
              onSelectionChange={setSelectedPhraseIds}
              difficultyFilter={difficultyFilter}
              isVirtual={isVirtualNotebook(notebookId)}
              className="hidden md:block"
            />
            {/* Mobile card view */}
            <PhraseList
              phrases={state.phrases}
              notebookId={notebookId}
              onDelete={handleDeletePhrase}
              selectedPhraseIds={selectedPhraseIds}
              onSelectionChange={setSelectedPhraseIds}
              difficultyFilter={difficultyFilter}
              isVirtual={isVirtualNotebook(notebookId)}
              className="md:hidden"
            />
          </>
        )}
      </div>
    </div>
  );
}

// Phrase Table Component (Desktop)
interface PhraseTableProps {
  phrases: PhraseDTO[];
  notebookId: string;
  onDelete: (phraseId: string) => void;
  selectedPhraseIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  difficultyFilter: PhraseDifficultyOrUnset | "all";
  isVirtual?: boolean;
  className?: string;
}

function PhraseTable({
  phrases,
  notebookId,
  onDelete,
  selectedPhraseIds,
  onSelectionChange,
  difficultyFilter,
  isVirtual = false,
  className,
}: PhraseTableProps) {
  const handleRowClick = (phraseId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    // Don't navigate if clicking on checkbox
    if ((e.target as HTMLElement).closest("input[type='checkbox']")) {
      return;
    }
    e.preventDefault();
    const link = document.createElement("a");
    const difficultyParam = difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : "";
    link.href = `/player/${notebookId}?start_phrase_id=${phraseId}${difficultyParam}`;
    link.click();
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      onSelectionChange(new Set(phrases.map((p) => p.id)));
    } else {
      onSelectionChange(new Set());
    }
  };

  const allSelected = phrases.length > 0 && phrases.every((p) => selectedPhraseIds.has(p.id));
  const someSelected = phrases.some((p) => selectedPhraseIds.has(p.id));

  return (
    <div className={`overflow-x-auto ${className || ""}`}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-4 font-medium text-muted-foreground w-12">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(input) => {
                  if (input) input.indeterminate = someSelected && !allSelected;
                }}
                onChange={handleSelectAll}
                className="cursor-pointer"
                aria-label="Select all phrases"
              />
            </th>
            <th className="text-left p-4 font-medium text-muted-foreground w-14">#</th>
            {isVirtual && <th className="text-left p-4 font-medium text-muted-foreground">Notebook</th>}
            <th className="text-left p-4 font-medium text-muted-foreground">English</th>
            <th className="text-left p-4 font-medium text-muted-foreground">Polish</th>
            <th className="text-left p-4 font-medium text-muted-foreground w-24">Difficulty</th>
            <th className="text-left p-4 font-medium text-muted-foreground w-16">Actions</th>
          </tr>
        </thead>
        <tbody>
          {phrases.map((phrase, index) => (
            <PhraseRow
              key={phrase.id}
              phrase={phrase}
              index={index}
              onDelete={onDelete}
              onRowClick={handleRowClick}
              selectedPhraseIds={selectedPhraseIds}
              onSelectionChange={onSelectionChange}
              isVirtual={isVirtual}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Phrase Row Component (Desktop)
interface PhraseRowProps {
  phrase: PhraseDTO;
  index: number;
  onDelete: (phraseId: string) => void;
  onRowClick: PhraseRowClickHandler;
  selectedPhraseIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  isVirtual?: boolean;
}

function PhraseRow({
  phrase,
  index,
  onDelete,
  onRowClick,
  selectedPhraseIds,
  onSelectionChange,
  isVirtual = false,
}: PhraseRowProps) {
  const isSelected = selectedPhraseIds.has(phrase.id);

  const handleCellClick = (e: React.MouseEvent) => {
    // Don't trigger row click if clicking on buttons or checkbox
    if ((e.target as HTMLElement).closest("button, a, input[type='checkbox']")) {
      return;
    }
    onRowClick(phrase.id, e);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(phrase.id, e);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(phrase.id);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newSelection = new Set(selectedPhraseIds);
    if (e.target.checked) {
      newSelection.add(phrase.id);
    } else {
      newSelection.delete(phrase.id);
    }
    onSelectionChange(newSelection);
  };

  return (
    <tr
      className={`group hover:bg-muted/50 transition-colors ${isSelected ? "bg-muted/30" : ""}`}
      aria-label={`Phrase ${index + 1}: ${phrase.en_text}`}
    >
      <td className="p-4 w-12">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer"
          aria-label={`Select phrase ${index + 1}`}
        />
      </td>
      <td className="p-4 w-14">
        <span className="text-xs font-medium text-muted-foreground">{index + 1}</span>
      </td>
      {isVirtual && (
        <td className="p-4">
          {phrase.notebook_name && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded">
              {phrase.notebook_name}
            </span>
          )}
        </td>
      )}
      <td
        className="p-4 cursor-pointer"
        onClick={handleCellClick}
        onKeyDown={handleCellKeyDown}
        role="button"
        tabIndex={0}
      >
        <div
          className="text-sm text-foreground"
          dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(phrase.en_text) }}
        />
      </td>
      <td
        className="p-4 cursor-pointer"
        onClick={handleCellClick}
        onKeyDown={handleCellKeyDown}
        role="button"
        tabIndex={0}
      >
        <div
          className="text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(phrase.pl_text) }}
        />
      </td>
      <td className="p-4 w-24">
        <DifficultyBadge difficulty={phrase.difficulty} />
      </td>
      <td className="p-4 w-16 text-right">
        {!isVirtual && (
          <Button
            variant="ghost"
            size="sm"
            className="p-1 h-auto text-destructive hover:text-destructive"
            onClick={handleDeleteClick}
            aria-label="Usuń frazę"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}

// Phrase List Component (Mobile)
interface PhraseListProps {
  phrases: PhraseDTO[];
  notebookId: string;
  onDelete: (phraseId: string) => void;
  selectedPhraseIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  difficultyFilter: PhraseDifficultyOrUnset | "all";
  isVirtual?: boolean;
  className?: string;
}

type PhraseRowClickHandler = (phraseId: string, e: React.MouseEvent | React.KeyboardEvent) => void;

function PhraseList({
  phrases,
  notebookId,
  onDelete,
  selectedPhraseIds,
  onSelectionChange,
  difficultyFilter,
  isVirtual = false,
  className,
}: PhraseListProps) {
  const handleRowClick = (phraseId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    // Don't navigate if clicking on checkbox
    if ((e.target as HTMLElement).closest("input[type='checkbox']")) {
      return;
    }
    e.preventDefault();
    const link = document.createElement("a");
    const difficultyParam = difficultyFilter !== "all" ? `&difficulty=${difficultyFilter}` : "";
    link.href = `/player/${notebookId}?start_phrase_id=${phraseId}${difficultyParam}`;
    link.click();
  };

  return (
    <div className={className || ""}>
      {phrases.map((phrase, index) => (
        <PhraseCard
          key={phrase.id}
          phrase={phrase}
          index={index}
          onDelete={onDelete}
          onRowClick={handleRowClick}
          selectedPhraseIds={selectedPhraseIds}
          onSelectionChange={onSelectionChange}
          isVirtual={isVirtual}
        />
      ))}
    </div>
  );
}

// Phrase Card Component (Mobile)
interface PhraseCardProps {
  phrase: PhraseDTO;
  index: number;
  onDelete: (phraseId: string) => void;
  onRowClick: PhraseRowClickHandler;
  selectedPhraseIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  isVirtual?: boolean;
}

function PhraseCard({
  phrase,
  index,
  onDelete,
  onRowClick,
  selectedPhraseIds,
  onSelectionChange,
  isVirtual = false,
}: PhraseCardProps) {
  const isSelected = selectedPhraseIds.has(phrase.id);

  const handleTextClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input[type='checkbox']")) {
      return;
    }
    onRowClick(phrase.id, e);
  };

  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(phrase.id, e);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(phrase.id);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newSelection = new Set(selectedPhraseIds);
    if (e.target.checked) {
      newSelection.add(phrase.id);
    } else {
      newSelection.delete(phrase.id);
    }
    onSelectionChange(newSelection);
  };

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors ${
        isSelected ? "bg-muted/30" : ""
      }`}
      aria-label={`Phrase ${index + 1}: ${phrase.en_text}`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer mt-1"
          aria-label={`Select phrase ${index + 1}`}
        />
        <span className="size-6 rounded-full bg-muted text-[11px] flex items-center justify-center font-medium text-muted-foreground">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {isVirtual && phrase.notebook_name && (
            <div className="mb-1">
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                {phrase.notebook_name}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 mb-1">
            <div
              className="text-[15px] text-foreground truncate font-medium cursor-pointer"
              onClick={handleTextClick}
              onKeyDown={handleTextKeyDown}
              role="button"
              tabIndex={0}
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(phrase.en_text) }}
            />
            <DifficultyBadge difficulty={phrase.difficulty} />
          </div>
          <div
            className="text-xs text-muted-foreground truncate cursor-pointer"
            onClick={handleTextClick}
            onKeyDown={handleTextKeyDown}
            role="button"
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(phrase.pl_text) }}
          />
        </div>
      </div>
      {!isVirtual && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="p-1 h-auto text-destructive hover:text-destructive"
            onClick={handleDeleteClick}
            aria-label="Usuń"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// Main export with ToastProvider wrapper
export default function NotebookView(props: NotebookViewProps) {
  return (
    <ToastProvider>
      <NotebookViewContent {...props} />
    </ToastProvider>
  );
}
