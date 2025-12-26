import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { createClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import type { Database } from "../db/database.types";
import { ApiErrors } from "./errors";
import { DEFAULT_USER_ID } from "../db/supabase.client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a UUID using the appropriate crypto API for the environment.
 * Works in both browser (Web Crypto API) and Node.js (node:crypto).
 * For Node.js, use randomUUID from node:crypto directly instead.
 */
export function generateUUID(): string {
  // In browser, use Web Crypto API
  if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // In Node.js, this should not be used - use randomUUID from node:crypto directly
  // This is a fallback for SSR or edge cases
  // Fallback: generate a simple UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Reads Supabase environment variables from multiple sources (Cloudflare runtime, import.meta.env, etc.)
 * Similar to readEnvWithTrace in tts-encryption.ts, but specifically for Supabase config
 * @param context - Astro API context (optional, for Cloudflare runtime env access)
 * @returns Object with supabaseUrl and supabaseServiceKey
 */
export function getSupabaseEnvVars(context?: APIContext): {
  supabaseUrl: string | undefined;
  supabaseServiceKey: string | undefined;
} {
  // 1) Try Cloudflare runtime env from context.locals.runtime.env (preferred on CF Pages)
  // This is where Cloudflare adapter puts runtime bindings (secrets/variables)
  if (context) {
    const localsAny = context.locals as unknown as {
      runtime?: { env?: Record<string, string | undefined> };
    };
    if (localsAny.runtime?.env) {
      const runtimeUrl = localsAny.runtime.env.SUPABASE_URL;
      const runtimeKey = localsAny.runtime.env.SUPABASE_SERVICE_ROLE_KEY;
      if (runtimeUrl && runtimeKey) {
        return { supabaseUrl: runtimeUrl, supabaseServiceKey: runtimeKey };
      }
    }
  }

  // 2) Try import.meta.env (works in both build and runtime, but may not have secrets in CF)
  const importMetaUrl = import.meta.env.SUPABASE_URL;
  const importMetaKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (importMetaUrl && importMetaKey) {
    return { supabaseUrl: importMetaUrl, supabaseServiceKey: importMetaKey };
  }

  // 3) Try process.env (fallback for Node.js runtime)
  if (typeof process !== "undefined" && process.env) {
    const processUrl = process.env.SUPABASE_URL;
    const processKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (processUrl && processKey) {
      return { supabaseUrl: processUrl, supabaseServiceKey: processKey };
    }
  }

  return { supabaseUrl: undefined, supabaseServiceKey: undefined };
}

/**
 * Gets the appropriate Supabase client for the current request context.
 * In development with DEFAULT_USER_ID, uses service role key to bypass RLS.
 * In production, creates an authenticated client with the user's JWT token.
 * This is required for RLS policies to work (they check auth.uid()).
 *
 * @param context - Astro API context
 * @returns Supabase client instance
 */
export function getSupabaseClient(context: APIContext): ReturnType<typeof createClient<Database>> {
  const userId = context.locals.userId;

  // In development mode with DEFAULT_USER_ID, use service role key to bypass RLS
  if (import.meta.env.NODE_ENV === "development" && userId === DEFAULT_USER_ID) {
    const supabaseUrl = import.meta.env.SUPABASE_URL || (typeof process !== "undefined" && process.env.SUPABASE_URL);
    const supabaseServiceKey =
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
      (typeof process !== "undefined" && process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (supabaseServiceKey) {
      return createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }
  }

  // For authenticated users, create a client with their token for RLS
  // This is required for RLS policies to work (they check auth.uid())
  if (userId) {
    const authHeader = context.request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const supabaseUrl =
        import.meta.env.PUBLIC_SUPABASE_URL ||
        import.meta.env.SUPABASE_URL ||
        (typeof process !== "undefined" && process.env.PUBLIC_SUPABASE_URL) ||
        (typeof process !== "undefined" && process.env.SUPABASE_URL);
      const supabaseAnonKey =
        import.meta.env.PUBLIC_SUPABASE_KEY ||
        import.meta.env.SUPABASE_KEY ||
        (typeof process !== "undefined" && process.env.PUBLIC_SUPABASE_KEY) ||
        (typeof process !== "undefined" && process.env.SUPABASE_KEY);

      if (supabaseUrl && supabaseAnonKey) {
        // Create an authenticated client with the user's token
        // The Authorization header in global.headers allows PostgREST to extract the JWT
        // and make auth.uid() available to RLS policies
        const client = createClient(supabaseUrl, supabaseAnonKey, {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        // Also set the token directly in the auth state for RLS
        // This ensures the client is properly authenticated
        client.auth
          .setSession({
            access_token: token,
            refresh_token: "",
          })
          .catch(() => {
            // Ignore errors - the global header should still work
          });

        return client;
      }
    }
  }

  // Fallback to the regular client from context
  return context.locals.supabase;
}

/**
 * Ensures a user exists in the users table.
 * This is needed because users are created in auth.users by Supabase Auth,
 * but we need a corresponding row in the public.users table for foreign key constraints.
 *
 * @param supabase - Supabase client instance
 * @param userId - The user ID to ensure exists
 * @throws {ApiError} If there's an error checking or creating the user
 */
export async function ensureUserExists(
  supabase: ReturnType<typeof createClient<Database>>,
  userId: string
): Promise<void> {
  // Check if user exists
  const { data: existingUser, error: selectError } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  // If user exists, we're done
  if (existingUser) {
    return;
  }

  // If error is not "not found", something else went wrong
  if (selectError && selectError.code !== "PGRST116") {
    // eslint-disable-next-line no-console
    console.error("Error checking user existence:", selectError);
    throw ApiErrors.internal("Failed to verify user existence");
  }

  // User doesn't exist, create them
  // The created_at column has a default value, so we only need to provide id
  const { error: insertError } = await supabase.from("users").insert({
    id: userId,
  });

  if (insertError) {
    // If it's a unique constraint violation, the user was created between our check and insert
    // This is fine, we can ignore it
    if (insertError.code === "23505") {
      return;
    }
    // eslint-disable-next-line no-console
    console.error("Error creating user:", insertError);
    throw ApiErrors.internal(`Failed to create user record: ${insertError.message}`);
  }
}

/**
 * Normalizes single underscores to double underscores for formatting.
 * Converts _text_ to __text__ but preserves existing __text__
 * Only matches if underscore is at word boundary and content is actual words
 */
function normalizeUnderscores(text: string): string {
  // First, protect existing double underscores by temporarily replacing them
  const placeholder = "___DOUBLE_UNDERSCORE_PLACEHOLDER___";
  let normalized = text.replace(/__/g, placeholder);

  // Now replace single underscores that are at word boundaries
  // Pattern: (start of string or non-word char) then _text_ then (end of string or non-word char)
  // We need to be careful to preserve the prefix/suffix
  normalized = normalized.replace(/(?:^|[^\w_])_([^_]+?)_(?=[^\w_]|$)/g, (match, content, offset, string) => {
    // Get the prefix (non-word char before _)
    const prefix = offset > 0 && /[\w]/.test(string[offset - 1]) ? "" : match[0] === "_" ? "" : match[0];
    return prefix + "__" + content + "__";
  });

  // Restore double underscores
  normalized = normalized.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "__");

  return normalized;
}

/**
 * Parses markdown formatting (**bold**, __italic__) and converts to HTML.
 * Supports:
 * - **text** for bold
 * - __text__ or _text_ for italic (single _ is treated as __, only at word boundaries)
 * - Can be nested: **bold __italic__ text**
 *
 * @param text - Text with markdown formatting
 * @returns HTML string with <strong> and <em> tags
 */
export function parseMarkdownToHtml(text: string): string {
  if (!text) return "";

  // Escape HTML to prevent XSS
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Normalize single underscores to double underscores (only at word boundaries)
  html = normalizeUnderscores(html);

  // Process bold (**text**)
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");

  // Process italic (__text__) - render as <em> tag, only at word boundaries
  html = html.replace(/(?:^|[^\w_])__([^_]+?)__(?=[^\w_]|$)/g, (match, content, offset, string) => {
    // Get the prefix (non-word char before __)
    // If match starts with _, check if there's a space before the match in original string
    let prefix = "";
    if (offset > 0 && !/[\w]/.test(string[offset - 1])) {
      // There's a non-word char before, preserve it (could be space)
      prefix = string[offset - 1];
    } else if (match[0] !== "_") {
      // Match doesn't start with _, so first char is the prefix (e.g., space)
      prefix = match[0];
    }
    // Get the suffix (non-word char after __)
    const suffix =
      offset + match.length < string.length && /[\w]/.test(string[offset + match.length])
        ? ""
        : match.endsWith("_")
          ? ""
          : match[match.length - 1];
    return prefix + "<em>" + content + "</em>" + suffix;
  });

  return html;
}

/**
 * Cleans markdown formatting from text before sending to TTS.
 * Removes **, __, and _ but preserves other punctuation like:
 * - Hyphens and dashes (-, –, —)
 * - Apostrophes (')
 * - Dots (.)
 * - Commas (,)
 * - Other punctuation marks
 *
 * @param text - Text with markdown formatting
 * @returns Cleaned text without markdown markers
 */
export function cleanMarkdownForTts(text: string): string {
  if (!text) return "";

  // Remove bold markers (**)
  let cleaned = text.replace(/\*\*/g, "");

  // Remove double underline markers (__)
  cleaned = cleaned.replace(/__/g, "");

  // Remove single italic markers (_) but be careful not to remove underscores that are part of words
  // Only remove if at word boundaries
  cleaned = cleaned.replace(/(?:^|[^\w_])_([^_]+?)_(?=[^\w_]|$)/g, (match, content, offset, string) => {
    // Get the prefix (non-word char before _)
    const prefix = offset > 0 && /[\w]/.test(string[offset - 1]) ? "" : match[0] === "_" ? "" : match[0];
    return prefix + content;
  });

  // Trim any extra whitespace that might have been created
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}
