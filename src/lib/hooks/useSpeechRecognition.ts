import { useEffect, useRef, useState, useCallback } from "react";

interface UseSpeechRecognitionOptions {
  enabled: boolean;
  language: string; // e.g., "pl-PL", "en-US"
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  continuous?: boolean; // If true, keeps listening; if false, stops after result
  autoStart?: boolean; // If true (default), starts/stops automatically when enabled toggles
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
  autoStart = true,
}: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastResultRef = useRef<string>("");
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const enabledRef = useRef(enabled);
  const continuousRef = useRef(continuous);
  const autoStartRef = useRef(autoStart);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    continuousRef.current = continuous;
    if (recognitionRef.current) {
      recognitionRef.current.continuous = continuous;
    }
  }, [continuous]);

  useEffect(() => {
    autoStartRef.current = autoStart;
  }, [autoStart]);

  // Check if Speech Recognition is supported
  useEffect(() => {
    if (typeof window === "undefined") {
      setIsSupported(false);
      return;
    }
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
    } catch {
      setIsSupported(false);
    }
  }, []);

  // Initialize recognition
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSupported) return;
    if (recognitionRef.current) return;

    let SpeechRecognition: (new () => SpeechRecognition) | undefined;
    try {
      SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    } catch {
      return;
    }

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();

    recognition.continuous = continuousRef.current;
    recognition.interimResults = false; // We only want final results
    recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex];
      if (result && result.isFinal) {
        const transcript = result[0]?.transcript?.trim() || "";
        if (transcript && transcript !== lastResultRef.current) {
          lastResultRef.current = transcript;
          onResultRef.current(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errorMessage = event.error || "Unknown error";
      setIsListening(false);
      const handler = onErrorRef.current;
      if (handler) {
        handler(errorMessage);
      }
      // eslint-disable-next-line no-console
      console.error("[SpeechRecognition] Error:", errorMessage);
    };

    recognition.onend = () => {
      setIsListening(false);
      // If enabled and continuous, restart automatically (only when autoStart is enabled)
      if (autoStartRef.current && enabledRef.current && continuousRef.current) {
        // Small delay before restarting to avoid rapid restarts
        setTimeout(() => {
          if (enabledRef.current && recognitionRef.current) {
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
  }, [isSupported, language]);

  // Keep language updated without re-initializing recognition
  useEffect(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.lang = language;
  }, [language]);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSupported || !recognitionRef.current) return;

    if (!autoStartRef.current) {
      // Manual control mode (tap-to-talk): do not auto-start
      if (!enabled && isListening) {
        try {
          recognitionRef.current.stop();
          setIsListening(false);
        } catch {
          // Ignore errors
        }
      }
      return;
    }

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
    if (!enabledRef.current) return;
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
