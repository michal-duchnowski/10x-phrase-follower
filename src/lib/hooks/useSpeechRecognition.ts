import { useEffect, useRef, useState, useCallback } from "react";

interface UseSpeechRecognitionOptions {
  enabled: boolean;
  language: string; // e.g., "pl-PL", "en-US"
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  continuous?: boolean; // If true, keeps listening; if false, stops after result
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

/**
 * Hook for Web Speech API speech recognition.
 * Supports Chrome/Edge (SpeechRecognition) and Safari (webkitSpeechRecognition).
 */
export function useSpeechRecognition({
  enabled,
  language,
  onResult,
  onError,
  continuous = false,
}: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastResultRef = useRef<string>("");

  // Check if Speech Recognition is supported
  useEffect(() => {
    if (typeof window === "undefined") {
      setIsSupported(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  // Initialize recognition
  useEffect(() => {
    if (!isSupported) return;
    if (typeof window === "undefined") return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();

    recognition.continuous = continuous;
    recognition.interimResults = false; // We only want final results
    recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex];
      if (result && result.isFinal) {
        const transcript = result[0]?.transcript?.trim() || "";
        if (transcript && transcript !== lastResultRef.current) {
          lastResultRef.current = transcript;
          onResult(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errorMessage = event.error || "Unknown error";
      setIsListening(false);
      if (onError) {
        onError(errorMessage);
      }
      // eslint-disable-next-line no-console
      console.error("[SpeechRecognition] Error:", errorMessage);
    };

    recognition.onend = () => {
      setIsListening(false);
      // If enabled and continuous, restart automatically
      if (enabled && continuous) {
        // Small delay before restarting to avoid rapid restarts
        setTimeout(() => {
          if (enabled && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              setIsListening(true);
            } catch {
              // Already started or other error - ignore
            }
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
          recognitionRef.current.abort();
        } catch {
          // Ignore errors during cleanup
        }
        recognitionRef.current = null;
      }
      setIsListening(false);
    };
  }, [isSupported, language, continuous, enabled, onResult, onError]);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSupported || !recognitionRef.current) return;

    if (enabled && !isListening) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        lastResultRef.current = ""; // Reset last result when starting
      } catch (err) {
        // Already started or other error
        // eslint-disable-next-line no-console
        console.warn("[SpeechRecognition] Failed to start:", err);
      }
    } else if (!enabled && isListening) {
      try {
        recognitionRef.current.stop();
        setIsListening(false);
      } catch {
        // Ignore errors
      }
    }
  }, [enabled, isListening, isSupported]);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!isSupported || !recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      lastResultRef.current = "";
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[SpeechRecognition] Failed to start:", err);
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!isSupported || !recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
      setIsListening(false);
    } catch {
      // Ignore errors
    }
  }, [isSupported]);

  return {
    isSupported,
    isListening,
    start,
    stop,
  };
}
