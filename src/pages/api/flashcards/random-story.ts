/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import { z } from "zod";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

const TOTAL_PHRASE_LIMIT = 20;
const MINIMUM_STORY_PHRASES = 3;

const RandomStorySchema = z.object({
  exclude_phrase_ids: z.array(z.string().uuid()).max(10).default([]),
});

function randomUniqueOffsets(total: number, wanted: number): number[] {
  const offsets = new Set<number>();
  while (offsets.size < Math.min(total, wanted)) offsets.add(Math.floor(Math.random() * total));
  return [...offsets];
}

export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);

  const parsed = RandomStorySchema.safeParse(await context.request.json());
  if (!parsed.success) throw ApiErrors.validationError("Invalid random story request", parsed.error.flatten());
  const excludedIds = parsed.data.exclude_phrase_ids;

  const db: any = getSupabaseClient(context);
  let activeCards = db
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if (excludedIds.length) activeCards = activeCards.not("phrase_id", "in", `(${excludedIds.join(",")})`);
  const { count, error: countError } = await activeCards;
  if (countError) throw ApiErrors.internal("Could not count flashcards for a random story");

  const offsets = randomUniqueOffsets(count ?? 0, TOTAL_PHRASE_LIMIT - excludedIds.length);
  const selectedCards = await Promise.all(
    offsets.map(async (offset) => {
      let query = db.from("flashcards").select("phrase_id").eq("user_id", userId).eq("status", "active");
      if (excludedIds.length) query = query.not("phrase_id", "in", `(${excludedIds.join(",")})`);
      const { data, error } = await query.order("id", { ascending: true }).range(offset, offset).maybeSingle();
      if (error) throw ApiErrors.internal("Could not select flashcards for a random story");
      return data;
    })
  );

  const phraseIds = selectedCards.flatMap((card: { phrase_id: string } | null) => (card ? [card.phrase_id] : []));
  if (phraseIds.length + excludedIds.length < MINIMUM_STORY_PHRASES) {
    throw ApiErrors.validationError("Add at least 3 active flashcards to generate a random story.");
  }

  return Response.json({ phrase_ids: phraseIds });
});
