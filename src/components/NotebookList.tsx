import React, { useState, useEffect, useMemo } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";
import type { NotebookDTO, NotebookListResponse } from "../types";
import { VIRTUAL_NOTEBOOK_IDS, isVirtualNotebook } from "../lib/utils";
import { Pin, PinOff } from "lucide-react";

interface NotebookListProps {
  initialItems?: NotebookDTO[];
}

/* eslint-disable react-compiler/react-compiler */
export default function NotebookList({ initialItems = [] }: NotebookListProps) {
  const { apiCall, isAuthenticated } = useApi();
  const [notebooks, setNotebooks] = useState<NotebookDTO[]>(initialItems);
  const [pinnedNotebookIds, setPinnedNotebookIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeLetter, setActiveLetter] = useState<string>("ALL");

  const LETTER_FILTER_ALL = "ALL";
  const LETTER_FILTER_SMART = "SMART";
  const LETTER_FILTER_OTHER = "#";

  const getBucketForName = (notebook: NotebookDTO | VirtualNotebookDTO): string => {
    if (isVirtualNotebook(notebook.id)) {
      return LETTER_FILTER_SMART;
    }

    const name = (notebook.name ?? "").trim();
    if (!name) {
      return LETTER_FILTER_OTHER;
    }

    const firstChar = name[0].toUpperCase();
    if (firstChar >= "A" && firstChar <= "Z") {
      return firstChar;
    }

    return LETTER_FILTER_OTHER;
  };

  // Create virtual notebooks DTOs
  const virtualNotebooks = useMemo((): VirtualNotebookDTO[] => {
    return [
      {
        id: VIRTUAL_NOTEBOOK_IDS.EASY,
        name: "All Easy",
        current_build_id: null,
        last_generate_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: VIRTUAL_NOTEBOOK_IDS.MEDIUM,
        name: "All Medium",
        current_build_id: null,
        last_generate_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: VIRTUAL_NOTEBOOK_IDS.HARD,
        name: "All Hard",
        current_build_id: null,
        last_generate_job_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }, []);

  // Track pinned virtual notebooks in localStorage (they don't exist in DB)
  const [pinnedVirtualNotebookIds, setPinnedVirtualNotebookIds] = useState<Set<string>>(new Set());

  // Load pinned virtual notebooks from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("pinned_virtual_notebooks");
      if (saved) {
        try {
          const ids = JSON.parse(saved) as string[];
          setPinnedVirtualNotebookIds(new Set(ids));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, []);

  // Separate pinned notebooks (regular + virtual)
  const pinnedNotebooks = useMemo(() => {
    const pinned: (NotebookDTO | VirtualNotebookDTO)[] = [];

    // Add pinned regular notebooks
    for (const notebook of notebooks) {
      if (pinnedNotebookIds.has(notebook.id)) {
        pinned.push(notebook);
      }
    }

    // Add pinned virtual notebooks
    for (const virtualNotebook of virtualNotebooks) {
      if (pinnedVirtualNotebookIds.has(virtualNotebook.id)) {
        pinned.push(virtualNotebook);
      }
    }

    // Sort pinned by created_at desc (newest pinned first)
    pinned.sort((a, b) => {
      // We'll need to track pin order, but for now use updated_at
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return pinned;
  }, [notebooks, pinnedNotebookIds, virtualNotebooks, pinnedVirtualNotebookIds]);

  // Combine notebooks based on filter (Variant A: Smart Lists only in Smart filter)
  const allNotebooks = useMemo(() => {
    if (activeLetter === LETTER_FILTER_SMART) {
      // Only show virtual notebooks in Smart filter
      return virtualNotebooks;
    }
    // In "All" or other filters, only show regular notebooks (pinned + unpinned)
    return [...notebooks];
  }, [virtualNotebooks, notebooks, activeLetter]);

  const availableLetterBuckets = useMemo(() => {
    const buckets = new Set<string>();
    // Always include Smart filter since virtual notebooks always exist
    buckets.add(LETTER_FILTER_SMART);
    // Add buckets from regular notebooks
    for (const notebook of notebooks) {
      buckets.add(getBucketForName(notebook));
    }
    return buckets;
  }, [notebooks]);

  const letterFilters = useMemo(() => {
    const letters = Array.from(availableLetterBuckets);

    if (letters.length === 0) {
      return [LETTER_FILTER_ALL];
    }

    const hasSmart = letters.includes(LETTER_FILTER_SMART);
    const hasOther = letters.includes(LETTER_FILTER_OTHER);
    const alphaLetters = letters
      .filter((letter) => letter !== LETTER_FILTER_OTHER && letter !== LETTER_FILTER_SMART)
      .sort();

    return [
      LETTER_FILTER_ALL,
      ...(hasSmart ? [LETTER_FILTER_SMART] : []),
      ...(hasOther ? [LETTER_FILTER_OTHER] : []),
      ...alphaLetters,
    ];
  }, [availableLetterBuckets]);

  const filteredNotebooks = useMemo(() => {
    if (activeLetter === LETTER_FILTER_ALL) {
      return allNotebooks;
    }

    return allNotebooks.filter((notebook) => {
      const bucket = getBucketForName(notebook);
      return bucket === activeLetter;
    });
  }, [activeLetter, allNotebooks]);

  useEffect(() => {
    if (activeLetter === LETTER_FILTER_ALL) {
      return;
    }

    const selectableLetters = letterFilters.filter((letter) => letter !== LETTER_FILTER_ALL);
    if (!selectableLetters.includes(activeLetter)) {
      setActiveLetter(LETTER_FILTER_ALL);
    }
  }, [activeLetter, letterFilters]);

  // Fetch notebooks from API
  const fetchNotebooks = async (cursor?: string, query?: string) => {
    if (!isAuthenticated) {
      setError("Authentication required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (cursor) params.append("cursor", cursor);
      if (query) params.append("q", query);
      params.append("limit", "20");

      const data = await apiCall<NotebookListResponse>(`/api/notebooks?${params.toString()}`, { method: "GET" });

      if (cursor) {
        // Append to existing notebooks (load more)
        setNotebooks((prev) => [...prev, ...data.items]);
      } else {
        // Replace notebooks (new search or initial load)
        setNotebooks(data.items);
      }

      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notebooks");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch pinned notebooks
  const fetchPinnedNotebooks = async () => {
    if (!isAuthenticated) {
      return;
    }

    try {
      const data = await apiCall<{ items: { notebook_id: string; created_at: string }[] }>(`/api/pins`, {
        method: "GET",
      });
      setPinnedNotebookIds(new Set(data.items.map((pin) => pin.notebook_id)));
    } catch (err) {
      // Silently fail - pins are optional
      // eslint-disable-next-line no-console
      console.warn("Failed to fetch pinned notebooks:", err);
    }
  };

  // Load notebooks and pins on mount
  useEffect(() => {
    if (initialItems.length === 0) {
      fetchNotebooks();
    }
    fetchPinnedNotebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchNotebooks(undefined, searchQuery);
  };

  // Handle load more
  const handleLoadMore = () => {
    if (nextCursor) {
      fetchNotebooks(nextCursor, searchQuery);
    }
  };

  // Handle notebook actions
  const handleRename = async (id: string, newName: string) => {
    if (!isAuthenticated) {
      setError("Authentication required");
      return;
    }

    try {
      await apiCall(`/api/notebooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newName }),
      });

      // Update local state
      setNotebooks((prev) =>
        prev.map((notebook) =>
          notebook.id === id ? { ...notebook, name: newName, updated_at: new Date().toISOString() } : notebook
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename notebook");
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAuthenticated) {
      setError("Authentication required");
      return;
    }

    try {
      await apiCall(`/api/notebooks/${id}`, {
        method: "DELETE",
      });

      // Remove from local state
      setNotebooks((prev) => prev.filter((notebook) => notebook.id !== id));
      // Also remove from pinned set if it was pinned
      setPinnedNotebookIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete notebook");
    }
  };

  const handleTogglePin = async (id: string, isPinned: boolean) => {
    const isVirtual = isVirtualNotebook(id);

    if (isVirtual) {
      // Handle virtual notebooks with localStorage
      if (isPinned) {
        // Unpin virtual notebook
        setPinnedVirtualNotebookIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          // Save to localStorage
          if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
            localStorage.setItem("pinned_virtual_notebooks", JSON.stringify(Array.from(next)));
          }
          return next;
        });
      } else {
        // Pin virtual notebook
        setPinnedVirtualNotebookIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          // Save to localStorage
          if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
            localStorage.setItem("pinned_virtual_notebooks", JSON.stringify(Array.from(next)));
          }
          return next;
        });
      }
      return;
    }

    // Handle regular notebooks with API
    if (!isAuthenticated) {
      setError("Authentication required");
      return;
    }

    try {
      if (isPinned) {
        // Unpin
        await apiCall(`/api/pins/${id}`, {
          method: "DELETE",
        });
        setPinnedNotebookIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        // Pin
        await apiCall(`/api/pins`, {
          method: "POST",
          body: JSON.stringify({ notebook_id: id }),
        });
        setPinnedNotebookIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle pin");
    }
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notebooks..."
          className="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        />
        <Button type="submit" variant="default">
          Search
        </Button>
      </form>

      {/* Error display */}
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Letter filter */}
      {allNotebooks.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {letterFilters.map((letter) => (
            <Button
              key={letter}
              type="button"
              variant={activeLetter === letter ? "default" : "outline"}
              size="sm"
              className={`h-7 px-2 text-xs ${
                activeLetter === letter ? "" : "bg-background text-muted-foreground hover:bg-muted/60"
              }`}
              onClick={() => setActiveLetter(letter)}
              aria-pressed={activeLetter === letter}
            >
              {letter === LETTER_FILTER_ALL ? "All" : letter === LETTER_FILTER_SMART ? "Smart" : letter}
            </Button>
          ))}
        </div>
      )}

      {/* Pinned section (only show in "All" view) */}
      {activeLetter === LETTER_FILTER_ALL && pinnedNotebooks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Pinned</h2>
            </div>
            <span className="text-xs bg-muted px-2 py-1 rounded text-foreground">{pinnedNotebooks.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pinnedNotebooks.map((notebook) => (
              <NotebookTile
                key={notebook.id}
                notebook={notebook}
                onRename={handleRename}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
                isPinned={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty pinned state (only show in "All" view when no pins) */}
      {activeLetter === LETTER_FILTER_ALL && pinnedNotebooks.length === 0 && notebooks.length > 0 && (
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <p className="text-sm text-foreground/80">
            <strong className="text-foreground">Pin notebooks for quick access.</strong> Pinned notebooks always appear
            at the top of your list.
          </p>
        </div>
      )}

      {/* Notebooks grid */}
      {allNotebooks.length === 0 && !isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No notebooks found.</p>
          <a
            href="/import"
            className="inline-flex items-center mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Create your first notebook
          </a>
        </div>
      ) : filteredNotebooks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No notebooks for selected filter.</p>
        </div>
      ) : (
        <>
          {/* Section header for non-pinned notebooks in "All" view */}
          {activeLetter === LETTER_FILTER_ALL && pinnedNotebooks.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3 text-foreground">All notebooks</h2>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNotebooks
              .filter((notebook) => !isVirtualNotebook(notebook.id) || activeLetter === LETTER_FILTER_SMART)
              .filter((notebook) => !isVirtualNotebook(notebook.id) || activeLetter !== LETTER_FILTER_ALL)
              .filter((notebook) => {
                // In "All" view, exclude pinned notebooks from main list (they're shown in pinned section)
                if (activeLetter === LETTER_FILTER_ALL) {
                  if (isVirtualNotebook(notebook.id)) {
                    // Exclude pinned virtual notebooks
                    return !pinnedVirtualNotebookIds.has(notebook.id);
                  } else {
                    // Exclude pinned regular notebooks
                    return !pinnedNotebookIds.has(notebook.id);
                  }
                }
                return true;
              })
              .map((notebook) => {
                const isVirtual = isVirtualNotebook(notebook.id);
                const isPinned = isVirtual
                  ? pinnedVirtualNotebookIds.has(notebook.id)
                  : pinnedNotebookIds.has(notebook.id);
                return (
                  <NotebookTile
                    key={notebook.id}
                    notebook={notebook}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onTogglePin={handleTogglePin}
                    isPinned={isPinned}
                  />
                );
              })}
          </div>
        </>
      )}

      {/* Load more */}
      {nextCursor && (
        <div className="text-center">
          <Button onClick={handleLoadMore} disabled={isLoading} variant="outline">
            {isLoading ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && allNotebooks.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading notebooks...</p>
        </div>
      )}
    </div>
  );
}

// Type for virtual notebooks (compatible with NotebookDTO)
interface VirtualNotebookDTO extends NotebookDTO {
  id: string;
  name: string;
}

interface NotebookTileProps {
  notebook: NotebookDTO | VirtualNotebookDTO;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  isPinned?: boolean;
}

function NotebookTile({ notebook, onRename, onDelete, onTogglePin, isPinned = false }: NotebookTileProps) {
  const isVirtual = isVirtualNotebook(notebook.id);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(notebook.name);

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isVirtual && newName.trim() && newName !== notebook.name) {
      onRename(notebook.id, newName.trim());
    }
    setIsRenaming(false);
  };

  const handleDelete = () => {
    if (!isVirtual && confirm(`Are you sure you want to delete "${notebook.name}"?`)) {
      onDelete(notebook.id);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        {isRenaming && !isVirtual ? (
          <form onSubmit={handleRename} className="flex-1 mr-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-input rounded bg-background"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onBlur={() => setIsRenaming(false)}
            />
          </form>
        ) : (
          <a
            href={`/notebooks/${notebook.id}`}
            className="flex-1 text-lg font-semibold text-foreground hover:text-primary transition-colors"
          >
            {notebook.name}
          </a>
        )}

        <div className="flex items-center gap-1">
          {isVirtual ? (
            <>
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Smart List</span>
              {onTogglePin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePin(notebook.id, isPinned);
                  }}
                  className="p-1 h-auto min-w-[44px] min-h-[44px] text-foreground hover:text-foreground"
                  aria-label={isPinned ? "Unpin notebook" : "Pin notebook"}
                  aria-pressed={isPinned}
                  title={isPinned ? "Unpin notebook" : "Pin notebook"}
                >
                  {isPinned ? (
                    <Pin className="h-4 w-4 fill-foreground text-foreground" />
                  ) : (
                    <PinOff className="h-4 w-4 text-foreground" />
                  )}
                </Button>
              )}
            </>
          ) : (
            <>
              {onTogglePin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePin(notebook.id, isPinned);
                  }}
                  className="p-1 h-auto min-w-[44px] min-h-[44px] text-foreground hover:text-foreground"
                  aria-label={isPinned ? "Unpin notebook" : "Pin notebook"}
                  aria-pressed={isPinned}
                  title={isPinned ? "Unpin notebook" : "Pin notebook"}
                >
                  {isPinned ? (
                    <Pin className="h-4 w-4 fill-foreground text-foreground" />
                  ) : (
                    <PinOff className="h-4 w-4 text-foreground" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsRenaming(true)}
                className="p-1 h-auto text-foreground hover:text-foreground"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="p-1 h-auto text-destructive hover:text-destructive"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </Button>
            </>
          )}
        </div>
      </div>

      {!isVirtual && (
        <p className="text-sm text-muted-foreground">Updated {new Date(notebook.updated_at).toLocaleDateString()}</p>
      )}
    </div>
  );
}
