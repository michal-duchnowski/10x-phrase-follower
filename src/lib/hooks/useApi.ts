import { useAuth } from "./useAuth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient } from "../../db/supabase.client";

interface ApiOptions extends RequestInit {
  requireAuth?: boolean;
}

/**
 * Hook for making authenticated API calls
 * Automatically adds Authorization header with JWT token
 */
export function useApi() {
  const { token, isAuthenticated, userId } = useAuth();
  const [supabaseAccessToken, setSupabaseAccessToken] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Fallback: try to get DEV_JWT from localStorage if useAuth doesn't have it yet
  const getTokenFromStorage = () => {
    if (typeof window === "undefined") return null;

    // Check for DEV_JWT token (development)
    const storedToken = localStorage.getItem("dev_jwt_token");
    const storedExpiry = localStorage.getItem("dev_jwt_expiry");

    if (storedToken && storedExpiry) {
      const now = Date.now();
      const expiry = parseInt(storedExpiry, 10);

      if (now < expiry) {
        return storedToken;
      } else {
        // Token expired, clear storage
        localStorage.removeItem("dev_jwt_token");
        localStorage.removeItem("dev_user_id");
        localStorage.removeItem("dev_jwt_expiry");
      }
    }

    return null;
  };

  useEffect(() => {
    isMountedRef.current = true;

    if (typeof window === "undefined") {
      return () => {
        isMountedRef.current = false;
      };
    }

    // In development, DEV_JWT is the primary flow, so don't couple API auth to Supabase session.
    if (import.meta.env.NODE_ENV === "development") {
      return () => {
        isMountedRef.current = false;
      };
    }

    const init = async () => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (!isMountedRef.current) return;
      if (!error && data.session?.access_token) {
        setSupabaseAccessToken(data.session.access_token);
      } else {
        setSupabaseAccessToken(null);
      }
    };

    init().catch(() => {
      // Ignore – will be handled as unauthenticated
    });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!isMountedRef.current) return;
      setSupabaseAccessToken(session?.access_token ?? null);
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  // Use token from useAuth, or Supabase persisted session, or (dev-only) localStorage fallback
  const effectiveToken = token || supabaseAccessToken || getTokenFromStorage();
  const effectiveIsAuthenticated = isAuthenticated || !!effectiveToken;

  const apiCall = useCallback(
    async <T>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
      const { requireAuth = true, headers = {}, ...restOptions } = options;

      // Check authentication requirement
      if (requireAuth && !effectiveIsAuthenticated) {
        // One more chance: ask Supabase for the persisted session (auto-refresh capable).
        const { data, error } = await supabaseClient.auth.getSession();
        if (error || !data.session) {
          throw new Error("Authentication required");
        }
      }

      // Prepare headers
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(headers as Record<string, string>),
      };

      // Add authorization header if token is available
      if (effectiveToken) {
        requestHeaders["Authorization"] = `Bearer ${effectiveToken}`;
      } else if (requireAuth) {
        const { data, error } = await supabaseClient.auth.getSession();
        if (!error && data.session?.access_token) {
          requestHeaders["Authorization"] = `Bearer ${data.session.access_token}`;
        }
      }

      // Make the request
      const response = await fetch(endpoint, {
        ...restOptions,
        headers: requestHeaders,
      });

      // Handle response
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;

        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          // If not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }

        throw new Error(errorMessage);
      }

      // Parse JSON response
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return response.json();
      }

      // Return text for non-JSON responses
      return response.text() as unknown as T;
    },
    [effectiveToken, effectiveIsAuthenticated]
  );

  return useMemo(
    () => ({ apiCall, isAuthenticated: effectiveIsAuthenticated, token: effectiveToken, userId }),
    [apiCall, effectiveIsAuthenticated, effectiveToken, userId]
  );
}
