import { SignJWT } from "jose";
import { DEFAULT_USER_ID } from "../db/supabase.client";

/**
 * Development-only JWT token generator for local development.
 * Generates short-lived tokens signed with SUPABASE_JWT_SECRET.
 * Only available when NODE_ENV=development.
 */
export class DevJwtGenerator {
  private readonly secret: string;
  private readonly ttlSeconds: number = 3600; // 1 hour (can be increased up to 604800 = 1 week)

  /**
   * Get the TTL (time to live) in seconds for DEV_JWT tokens
   */
  getTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /**
   * Get the default TTL in seconds (static method for convenience)
   */
  static getDefaultTtlSeconds(): number {
    return 3600; // 1 hour (can be increased up to 604800 = 1 week)
  }

  constructor() {
    if (import.meta.env.NODE_ENV !== "development") {
      throw new Error("DevJwtGenerator is only available in development mode");
    }

    const secret =
      import.meta.env.SUPABASE_JWT_SECRET || (typeof process !== "undefined" && process.env.SUPABASE_JWT_SECRET);
    if (!secret) {
      throw new Error("SUPABASE_JWT_SECRET is required for DEV_JWT generation");
    }

    this.secret = secret;
  }

  /**
   * Generate a new DEV_JWT token for the default user
   */
  async generateToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({
      sub: DEFAULT_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + this.ttlSeconds,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .setSubject(DEFAULT_USER_ID)
      .setAudience("authenticated")
      .sign(new TextEncoder().encode(this.secret));

    return `dev_${token}`;
  }

  /**
   * Check if a token is a valid DEV_JWT
   */
  static isDevToken(token: string): boolean {
    return token.startsWith("dev_");
  }

  /**
   * Extract the actual JWT from a DEV_JWT token
   */
  static extractJwt(devToken: string): string {
    if (!this.isDevToken(devToken)) {
      throw new Error("Not a DEV_JWT token");
    }
    return devToken.substring(4); // Remove "dev_" prefix
  }
}

/**
 * Development helper to get a fresh DEV_JWT token
 * Only works in development environment
 */
export async function getDevJwt(): Promise<string | null> {
  if (import.meta.env.NODE_ENV !== "development") {
    // eslint-disable-next-line no-console
    console.warn("getDevJwt() is only available in development mode");
    return null;
  }

  try {
    const generator = new DevJwtGenerator();
    return await generator.generateToken();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to generate DEV_JWT:", error);
    return null;
  }
}
