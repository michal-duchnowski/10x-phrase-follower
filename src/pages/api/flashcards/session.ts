/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";
import { getFlashcardsDay, spaceDirections } from "../../../lib/flashcards.service";

export const prerender = false;
export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  const body = await context.request.json().catch(() => ({}));
  const completed = new Set(Array.isArray(body.completed_direction_ids) ? body.completed_direction_ids : []);
  const includeMoreNew = body.include_more_new === true;
  const now = new Date().toISOString();
  const today = getFlashcardsDay();
  const { data: settings } = await db.from("flashcard_settings").select("*").eq("user_id", userId).maybeSingle();
  const config = settings ?? { new_phrases_per_batch: 5, review_cards_per_batch: 50 };
  const { data: flashcards, error } = await db
    .from("flashcards")
    .select("id, phrase_id, phrases!inner(id,en_text,pl_text,learning_hint_markdown,tokens)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw ApiErrors.internal("Failed to build session");
  const cards = flashcards ?? [];
  const ids = cards.map((card: any) => card.id);
  if (!ids.length) return Response.json({ cards: [] });
  const { data: introductions, error: introductionError } = await db
    .from("flashcard_phrase_introductions")
    .select("phrase_id,introduced_on")
    .eq("user_id", userId);
  if (introductionError) throw ApiErrors.internal("Failed to read introduced phrases");
  const { data: directions, error: directionError } = await db
    .from("flashcard_directions")
    .select("*")
    .in("flashcard_id", ids)
    .order("due_at");
  if (directionError) throw ApiErrors.internal("Failed to build session");
  const byFlashcard = new Map(cards.map((card: any) => [card.id, card]));
  const makeCard = (direction: any) => {
    const card = byFlashcard.get(direction.flashcard_id);
    const phrase = Array.isArray(card.phrases) ? card.phrases[0] : card.phrases;
    return {
      direction_id: direction.id,
      flashcard_id: card.id,
      phrase_id: card.phrase_id,
      direction: direction.direction,
      prompt_text: direction.direction === "en_to_pl" ? phrase.en_text : phrase.pl_text,
      expected_answer: direction.direction === "en_to_pl" ? phrase.pl_text : phrase.en_text,
      en_text: phrase.en_text,
      pl_text: phrase.pl_text,
      learning_hint_markdown: phrase.learning_hint_markdown,
      fsrs_card: direction,
    };
  };
  const available = (directions ?? []).filter((d: any) => !completed.has(d.id));
  const reviews = available
    .filter((d: any) => d.fsrs_state !== "New" && d.due_at <= now)
    .slice(0, config.review_cards_per_batch);
  const overdue = available.filter(
    (d: any) => d.fsrs_state !== "New" && d.due_at < new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
  ).length;
  const selected = [...reviews];
  const introducedByPhrase = new Map((introductions ?? []).map((item: any) => [item.phrase_id, item.introduced_on]));
  const newByPhrase = new Map<string, any[]>();
  available
    .filter((d: any) => d.fsrs_state === "New" && d.reps === 0)
    .forEach((d: any) => {
      const card = byFlashcard.get(d.flashcard_id);
      const list = newByPhrase.get(card.phrase_id) ?? [];
      list.push(d);
      newByPhrase.set(card.phrase_id, list);
    });
  const pendingGroups = Array.from(newByPhrase.entries()).filter(
    ([phraseId]) => introducedByPhrase.has(phraseId) && introducedByPhrase.get(phraseId) !== today
  );
  const canAddNew = reviews.length < config.review_cards_per_batch && overdue <= config.review_cards_per_batch * 2;
  if (pendingGroups.length && canAddNew) {
    pendingGroups.slice(0, config.new_phrases_per_batch).forEach(([, group]) => selected.push(...group));
  } else if (canAddNew) {
    const introducedToday = Array.from(introducedByPhrase.values()).filter((date) => date === today).length;
    const canIntroduceAutomatically = introducedToday === 0;
    if (canIntroduceAutomatically || includeMoreNew) {
      const groups = Array.from(newByPhrase.entries())
        .filter(([phraseId]) => !introducedByPhrase.has(phraseId))
        .slice(0, config.new_phrases_per_batch);
      if (groups.length) {
        const { error: insertError } = await db
          .from("flashcard_phrase_introductions")
          .insert(groups.map(([phraseId]) => ({ user_id: userId, phrase_id: phraseId, introduced_on: today })));
        if (insertError) throw ApiErrors.internal("Failed to introduce new phrases");
        groups.forEach(([, group]) => selected.push(...group));
      }
    }
  }
  return Response.json({ cards: spaceDirections(selected.map(makeCard)) });
});
