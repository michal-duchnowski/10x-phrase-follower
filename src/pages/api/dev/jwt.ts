import type { APIRoute } from "astro";
import { getDevJwt } from "../../../lib/dev-jwt";

export const prerender = false;

export const GET: APIRoute = async () => {
  // Only available in development
  if (import.meta.env.NODE_ENV !== "development") {
    return new Response(
      JSON.stringify({
        error: {
          code: "not_found",
          message: "Endpoint not available in production",
        },
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    const token = await getDevJwt();

    if (!token) {
      return new Response(
        JSON.stringify({
          error: {
            code: "internal",
            message: "Failed to generate DEV_JWT",
          },
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Get TTL from DevJwtGenerator to keep it in sync
    const { DevJwtGenerator } = await import("../../../lib/dev-jwt");
    const expiresIn = DevJwtGenerator.getDefaultTtlSeconds();

    return new Response(
      JSON.stringify({
        token,
        expires_in: expiresIn,
        user_id: "0a1f3212-c55f-4a62-bc0f-4121a7a72283", // DEFAULT_USER_ID
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("DEV_JWT generation error:", error);

    return new Response(
      JSON.stringify({
        error: {
          code: "internal",
          message: "Internal server error",
        },
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};
