import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";
import { useToast } from "./ui/toast";
import { cn, generateUUID } from "../lib/utils";
import type { TtsCredentialsStateDTO, UserVoicesListResponse, JobDTO } from "../types";

interface GenerateAudioButtonProps {
  notebookId: string;
  onJobCreated?: (job: JobDTO) => void;
  onJobCompleted?: (job: JobDTO | null) => void;
  onJobUpdated?: (job: JobDTO) => void;
  activeJobId?: string | null;
  containerClassName?: string;
  buttonClassName?: string;
}

interface GenerationState {
  isGenerating: boolean;
  canGenerate: boolean;
  ttsConfigured: boolean;
  voicesConfigured: boolean;
  error: string | null;
  isChecking: boolean;
}

export default function GenerateAudioButton({
  notebookId,
  onJobCreated,
  onJobCompleted,
  onJobUpdated,
  activeJobId,
  containerClassName,
  buttonClassName,
}: GenerateAudioButtonProps) {
  const { apiCall } = useApi();
  const { addToast } = useToast();
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    canGenerate: false,
    ttsConfigured: false,
    voicesConfigured: false,
    error: null,
    isChecking: true,
  });

  const hasCheckedPrerequisites = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [jobId, setJobId] = useState<string | null>(activeJobId ?? null);

  // Keep local jobId in sync when parent provides an active job
  useEffect(() => {
    if (activeJobId) {
      setJobId(activeJobId);
    }
  }, [activeJobId]);

  // Memoize the checkPrerequisites function to prevent infinite loops
  const checkPrerequisites = useCallback(async () => {
    if (hasCheckedPrerequisites.current) {
      return;
    }

    hasCheckedPrerequisites.current = true;

    try {
      // Check TTS credentials
      const ttsResponse = await apiCall<TtsCredentialsStateDTO>("/api/tts-credentials", {
        method: "GET",
      });

      // Check user voices
      const voicesResponse = await apiCall<UserVoicesListResponse>("/api/user-voices", {
        method: "GET",
      });

      const ttsConfigured = ttsResponse.is_configured;
      const voicesConfigured = voicesResponse.slots && voicesResponse.slots.length > 0;

      setState((prev) => ({
        ...prev,
        ttsConfigured,
        voicesConfigured,
        canGenerate: ttsConfigured && voicesConfigured,
        isChecking: false,
        error: null,
      }));
    } catch (err) {
      console.error("Failed to check prerequisites:", err);
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Failed to check prerequisites",
        isChecking: false,
      }));
      hasCheckedPrerequisites.current = false; // Allow retry on error
    }
  }, [apiCall]);

  // Check prerequisites for audio generation
  useEffect(() => {
    checkPrerequisites();
  }, [checkPrerequisites]);

  // Poll job status when there's an active job
  useEffect(() => {
    if (!jobId) {
      // Clear polling if no active job
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Start polling for job status
    const pollJobStatus = async () => {
      try {
        const job = await apiCall<JobDTO>(`/api/jobs/${jobId}`, {
          method: "GET",
        });

        // Check if job is in a terminal state
        const isTerminal =
          job.state === "succeeded" || job.state === "failed" || job.state === "canceled" || job.state === "timeout";

        if (isTerminal) {
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          setState((prev) => ({ ...prev, isGenerating: false }));
          setJobId(null);

          if (onJobCompleted) {
            onJobCompleted(job);
          }

          // Show completion toast
          if (job.state === "succeeded") {
            addToast({
              type: "success",
              title: "Audio generation completed",
              description: "Your audio has been successfully generated.",
            });
          } else if (job.state === "failed") {
            addToast({
              type: "error",
              title: "Audio generation failed",
              description: job.error || "An error occurred during audio generation.",
            });
          }
        } else {
          // Job is still running, keep button disabled
          setState((prev) => ({ ...prev, isGenerating: true }));
          // Update active job in parent component to reflect current state
          if (onJobUpdated) {
            onJobUpdated(job);
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Failed to poll job status:", err);

        // If job not found (404), stop polling - job may have been deleted or doesn't exist
        const isNotFound =
          errorMessage.includes("Job not found") ||
          errorMessage.includes("404") ||
          errorMessage.toLowerCase().includes("not found");

        if (isNotFound) {
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setState((prev) => ({ ...prev, isGenerating: false }));
          setJobId(null);
          // Clear active job in parent component since job doesn't exist
          if (onJobCompleted) {
            onJobCompleted(null);
          }
        }
        // For other errors, continue polling (network issues, etc.)
      }
    };

    // Poll immediately, then every 3 seconds
    pollJobStatus();
    pollingIntervalRef.current = setInterval(pollJobStatus, 3000);

    // Cleanup on unmount or when activeJobId changes
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [jobId, apiCall, onJobCompleted, onJobUpdated, addToast]);

  const handleGenerateAudio = async () => {
    if (!state.canGenerate || state.isGenerating || state.isChecking) return;

    setState((prev) => ({ ...prev, isGenerating: true, error: null }));

    try {
      // Generate idempotency key
      const idempotencyKey = generateUUID();

      const job = await apiCall<JobDTO>(`/api/notebooks/${notebookId}/jobs/generate-rebuild`, {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          timeout_sec: 1800, // 30 minutes
        }),
      });

      // Keep button disabled - polling will handle re-enabling when job completes
      setState((prev) => ({ ...prev, isGenerating: true }));
      setJobId(job.id);

      addToast({
        type: "success",
        title: "Audio generation started",
        description: "Your audio is being generated. This may take a few minutes.",
      });

      if (onJobCreated) {
        onJobCreated(job);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start audio generation";

      setState((prev) => ({
        ...prev,
        isGenerating: false,
        error: errorMessage,
      }));
      setJobId(null);

      addToast({
        type: "error",
        title: "Generation failed",
        description: errorMessage,
      });
    }
  };

  const getButtonText = () => {
    if (state.isChecking) return "Checking configuration...";
    // Treat any tracked job as "generating" to keep UX consistent
    if (state.isGenerating || jobId) return "Generating...";
    if (!state.ttsConfigured) return "Configure TTS First";
    if (!state.voicesConfigured) return "Configure Voices First";
    return "Generate Audio";
  };

  const getButtonVariant = () => {
    if (state.isGenerating || jobId) return "secondary";
    if (!state.canGenerate) return "outline";
    return "default";
  };

  const getButtonDisabled = () => {
    // Button must be disabled while:
    // - a generation job is in progress (local state)
    // - we are tracking a jobId that hasn't reached a terminal state yet
    // - prerequisites are not met
    // - we're still checking prerequisites
    return state.isGenerating || !!jobId || !state.canGenerate || state.isChecking;
  };

  const getTooltipText = () => {
    if (state.isChecking) return "Checking audio generation prerequisites...";
    if (state.isGenerating || jobId) return "Audio generation in progress...";
    if (!state.ttsConfigured) return "Please configure TTS credentials in Settings first";
    if (!state.voicesConfigured) return "Please configure voice slots in Settings first";
    return "Generate audio for all phrases in this notebook";
  };

  return (
    <div className={cn("flex flex-col gap-2", containerClassName)}>
      <Button
        onClick={handleGenerateAudio}
        disabled={getButtonDisabled()}
        variant={getButtonVariant()}
        title={getTooltipText()}
        className={cn("min-w-[140px]", buttonClassName)}
      >
        {getButtonText()}
      </Button>

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}

      {!state.canGenerate && !state.isGenerating && !state.isChecking && (
        <div className="text-xs text-muted-foreground">
          {!state.ttsConfigured && <p>• Configure TTS credentials in Settings</p>}
          {!state.voicesConfigured && <p>• Configure voice slots in Settings</p>}
        </div>
      )}
    </div>
  );
}
