import { useAuth } from "./useAuth";
import { useCallback, useMemo } from "react";
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

  // Use token from useAuth or fallback to localStorage
  const effectiveToken = token || getTokenFromStorage();
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
