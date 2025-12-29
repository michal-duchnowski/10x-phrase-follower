import React, { useState } from "react";
import { Button } from "./ui/button";
import { supabaseClient } from "../db/supabase.client";

interface ValidationError {
  field: string;
  message: string;
}

export default function AuthCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

  // Client-side validation
  const validateForm = (): boolean => {
    const errors: ValidationError[] = [];

    // Email validation
    if (!email.trim()) {
      errors.push({ field: "email", message: "Email is required" });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ field: "email", message: "Invalid email format" });
    }

    // Password validation
    if (!password) {
      errors.push({ field: "password", message: "Password is required" });
    } else if (password.length < 8) {
      errors.push({ field: "password", message: "Password must be at least 8 characters" });
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors([]);

    // Client-side validation
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Try development mode first - check if DEV_JWT endpoint is available
      const devResponse = await fetch("/api/dev/jwt", {
        headers: { Accept: "application/json" },
      });

      if (devResponse.ok) {
        // DEV_JWT endpoint is available - we're in development mode
        const data = await devResponse.json();

        // Store token in localStorage with expiry
        const expiry = Date.now() + data.expires_in * 1000;
        localStorage.setItem("dev_jwt_token", data.token);
        localStorage.setItem("dev_user_id", data.user_id);
        localStorage.setItem("dev_jwt_expiry", expiry.toString());

        // Redirect to notebooks
        window.location.href = "/notebooks";
        return;
      }

      // DEV_JWT endpoint not available (>= 400) - fallback to Supabase Auth
      if (!supabaseClient) {
        setError("Konfiguracja autentykacji nie jest dostępna. Skontaktuj się z administratorem.");
        setIsLoading(false);
        return;
      }

      // Try to authenticate - if Supabase is not configured, this will return an error
      const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (authError) {
        // eslint-disable-next-line no-console
        console.error("Supabase auth error:", authError);

        // Handle Supabase auth errors
        if (authError.status === 429) {
          setError("Zbyt wiele prób. Spróbuj ponownie później.");
        } else if (authError.status === 400 || authError.status === 401) {
          setError("Nieprawidłowe dane logowania.");
        } else {
          // Show more specific error message if available
          const errorMessage = authError.message || "Wystąpił błąd serwera. Spróbuj ponownie.";
          setError(errorMessage);
        }
        setIsLoading(false);
        return;
      }

      if (!authData.session || !authData.user) {
        // eslint-disable-next-line no-console
        console.error("Supabase auth succeeded but no session/user returned", { authData });
        setError("Wystąpił błąd serwera. Spróbuj ponownie.");
        setIsLoading(false);
        return;
      }

      // Redirect to notebooks
      window.location.href = "/notebooks";
    } catch (err) {
      // Network or unexpected errors
      // eslint-disable-next-line no-console
      console.error("Login error:", err);

      if (err instanceof Error) {
        // Check for specific error types
        if (
          err.message.includes("fetch") ||
          err.message.includes("network") ||
          err.message.includes("Failed to fetch")
        ) {
          // Check if it's a placeholder URL error
          if (err.message.includes("placeholder") || err.message.includes("ERR_NAME_NOT_RESOLVED")) {
            setError(
              "Supabase nie jest skonfigurowany. Ustaw PUBLIC_SUPABASE_URL i PUBLIC_SUPABASE_KEY w zmiennych środowiskowych i zbuduj aplikację ponownie (npm run build)."
            );
          } else {
            setError("Błąd połączenia z serwerem. Sprawdź połączenie internetowe.");
          }
        } else if (err.message.includes("Supabase")) {
          setError("Błąd konfiguracji autentykacji. Skontaktuj się z administratorem.");
        } else {
          setError(err.message || "Wystąpił błąd serwera. Spróbuj ponownie.");
        }
      } else {
        setError("Wystąpił błąd serwera. Spróbuj ponownie.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Sign In</h1>
        <p className="text-muted-foreground mt-2">Enter your credentials to access your notebooks</p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setValidationErrors(validationErrors.filter((err) => err.field !== "email"));
              }}
              required
              autoComplete="email"
              className={`w-full px-3 py-2 border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent ${
                validationErrors.some((err) => err.field === "email") ? "border-destructive" : "border-input"
              }`}
              placeholder="Enter your email"
            />
            {validationErrors
              .filter((err) => err.field === "email")
              .map((err, idx) => (
                <p key={idx} className="text-sm text-destructive">
                  {err.message}
                </p>
              ))}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setValidationErrors(validationErrors.filter((err) => err.field !== "password"));
              }}
              required
              minLength={8}
              autoComplete="current-password"
              className={`w-full px-3 py-2 border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent ${
                validationErrors.some((err) => err.field === "password") ? "border-destructive" : "border-input"
              }`}
              placeholder="Enter your password"
            />
            {validationErrors
              .filter((err) => err.field === "password")
              .map((err, idx) => (
                <p key={idx} className="text-sm text-destructive">
                  {err.message}
                </p>
              ))}
          </div>

          <Button type="submit" disabled={isLoading || !email || !password} className="w-full">
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        {import.meta.env.NODE_ENV === "development" && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">Development mode: Any credentials will work</p>
          </div>
        )}
      </div>
    </div>
  );
}
