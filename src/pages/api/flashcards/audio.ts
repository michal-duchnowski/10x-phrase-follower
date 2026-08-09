/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;
export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const phraseId = new URL(context.request.url).searchParams.get("phrase_id");
  if (!phraseId) throw ApiErrors.validationError("phrase_id is required");
  const db: any = getSupabaseClient(context);
  const { data: phrase, error: phraseError } = await db
    .from("phrases")
    .select("id, notebooks!inner(user_id)")
    .eq("id", phraseId)
    .eq("notebooks.user_id", userId)
    .single();
  if (phraseError || !phrase) throw ApiErrors.notFound("Phrase not found");
  const { data: segments, error } = await db
    .from("audio_segments")
    .select("path, voice_slot")
    .eq("phrase_id", phraseId)
    .eq("status", "complete")
    .eq("is_active", true)
    .in("voice_slot", ["EN1", "EN2", "EN3"]);
  if (error) throw ApiErrors.internal("Failed to fetch audio");
  const segment = (segments ?? []).sort(
    (a: any, b: any) => ["EN1", "EN2", "EN3"].indexOf(a.voice_slot) - ["EN1", "EN2", "EN3"].indexOf(b.voice_slot)
  )[0];
  if (!segment) return Response.json({ url: null });
  const { data: signed, error: signError } = await db.storage.from("audio").createSignedUrl(segment.path, 3600);
  if (signError || !signed?.signedUrl) throw ApiErrors.internal("Failed to prepare audio");
  return Response.json({ url: signed.signedUrl });
});
