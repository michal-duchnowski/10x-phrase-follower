import { useState, useEffect, useCallback, useRef } from "react";
import { supabaseClient } from "../../db/supabase.client";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  userId: string | null;
  logout: () => void;
}

interface DevJwtResponse {
  token: string;
  expires_in: number;
  user_id: string;
}

/**
 * Hook for managing authentication state
 * In development, automatically provides DEV_JWT (prioritized)
 * In production, integrates with Supabase Auth
 */
export function useAuth(): AuthState {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const logout = useCallback(async () => {
    // Clear DEV JWT from localStorage
    localStorage.removeItem("dev_jwt_token");
    localStorage.removeItem("dev_user_id");
    localStorage.removeItem("dev_jwt_expiry");

    // Clear legacy Supabase session keys (older app versions)
    localStorage.removeItem("sb_access_token");
    localStorage.removeItem("sb_refresh_token");
    localStorage.removeItem("sb_expires_at");
    localStorage.removeItem("sb_user_id");

    // Sign out from Supabase (in production)
    try {
      await supabaseClient.auth.signOut();
    } catch (error) {
      // Ignore signOut errors - we're clearing state anyway (especially in dev with dummy client)
      // eslint-disable-next-line no-console
      console.warn("Sign out error (ignored):", error);
    }

    // Reset auth state
    if (isMountedRef.current) {
      setIsAuthenticated(false);
      setIsLoading(false);
      setToken(null);
      setUserId(null);
    }

    // Redirect to login
    // eslint-disable-next-line react-compiler/react-compiler
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check if we're in browser environment
        if (typeof window === "undefined") {
          if (isMountedRef.current) {
            setIsAuthenticated(false);
            setIsLoading(false);
            setToken(null);
            setUserId(null);
          }
          return;
        }

        // DEV_JWT flow is development-only; never probe dev endpoints in production.
        if (import.meta.env.NODE_ENV === "development") {
          // PRIORITIZE DEV MODE: Check for DEV_JWT first
          const storedToken = localStorage.getItem("dev_jwt_token");
          const storedUserId = localStorage.getItem("dev_user_id");
          const storedExpiry = localStorage.getItem("dev_jwt_expiry");

          // Check if stored DEV_JWT token is still valid (not expired)
          if (storedToken && storedUserId && storedExpiry) {
            const now = Date.now();
            const expiry = parseInt(storedExpiry, 10);

            if (now < expiry) {
              // Token is still valid
              if (isMountedRef.current) {
                setIsAuthenticated(true);
                setIsLoading(false);
                setToken(storedToken);
                setUserId(storedUserId);
              }
              return;
            } else {
              // Token expired, clear storage
              localStorage.removeItem("dev_jwt_token");
              localStorage.removeItem("dev_user_id");
              localStorage.removeItem("dev_jwt_expiry");
            }
          }

          // Try to get new DEV_JWT from API
          try {
            const devResponse = await fetch("/api/dev/jwt", {
              headers: { Accept: "application/json" },
            });

            if (devResponse.ok) {
              const data: DevJwtResponse = await devResponse.json();

              // Store token in localStorage with expiry
              const expiry = Date.now() + data.expires_in * 1000;
              localStorage.setItem("dev_jwt_token", data.token);
              localStorage.setItem("dev_user_id", data.user_id);
              localStorage.setItem("dev_jwt_expiry", expiry.toString());

              if (isMountedRef.current) {
                setIsAuthenticated(true);
                setIsLoading(false);
                setToken(data.token);
                setUserId(data.user_id);
              }
              return;
            }
          } catch {
            // Continue to check Supabase session as fallback
          }
        }

        // DEV_JWT not available - use Supabase Auth session (production mode)
        // Prefer Supabase-managed persistence + auto refresh.
        // Also migrate legacy `sb_*` localStorage keys once (from older app versions).
        if (supabaseClient) {
          const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

          if (!sessionError && sessionData.session) {
            if (isMountedRef.current) {
              setIsAuthenticated(true);
              setIsLoading(false);
              setToken(sessionData.session.access_token);
              setUserId(sessionData.session.user.id);
            }
            return;
          }

          const legacyAccessToken = localStorage.getItem("sb_access_token");
          const legacyRefreshToken = localStorage.getItem("sb_refresh_token");

          if (legacyAccessToken && legacyRefreshToken) {
            const { data: setData, error: setError } = await supabaseClient.auth.setSession({
              access_token: legacyAccessToken,
              refresh_token: legacyRefreshToken,
            });

            if (!setError && setData.session) {
              // Legacy keys are no longer needed once Supabase storage is seeded.
              localStorage.removeItem("sb_access_token");
              localStorage.removeItem("sb_refresh_token");
              localStorage.removeItem("sb_expires_at");
              localStorage.removeItem("sb_user_id");

              if (isMountedRef.current) {
                setIsAuthenticated(true);
                setIsLoading(false);
                setToken(setData.session.access_token);
                setUserId(setData.session.user.id);
              }
              return;
            }
          }
        }

        // No valid session found
        if (isMountedRef.current) {
          setIsAuthenticated(false);
          setIsLoading(false);
          setToken(null);
          setUserId(null);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Auth initialization failed:", error);
        if (isMountedRef.current) {
          setIsAuthenticated(false);
          setIsLoading(false);
          setToken(null);
          setUserId(null);
        }
      }
    };

    initAuth();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // DEV_JWT mode is handled above; avoid fighting it in development.
    if (import.meta.env.NODE_ENV === "development") return;

    // If a valid DEV_JWT is present (e.g. some environments), do not subscribe.
    const storedToken = localStorage.getItem("dev_jwt_token");
    const storedExpiry = localStorage.getItem("dev_jwt_expiry");
    if (storedToken && storedExpiry) {
      const now = Date.now();
      const expiry = parseInt(storedExpiry, 10);
      if (Number.isFinite(expiry) && now < expiry) return;
    }

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!isMountedRef.current) return;

      if (session) {
        setIsAuthenticated(true);
        setIsLoading(false);
        setToken(session.access_token);
        setUserId(session.user.id);
        return;
      }

      setIsAuthenticated(false);
      setIsLoading(false);
      setToken(null);
      setUserId(null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return {
    isAuthenticated,
    isLoading,
    token,
    userId,
    logout,
  };
}
