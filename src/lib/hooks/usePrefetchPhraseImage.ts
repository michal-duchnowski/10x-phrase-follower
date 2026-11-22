import { useEffect } from "react";
import { useApi } from "./useApi";
import { isStoredImageUrl } from "../phrase-image";
import { fetchCachedPhraseImage } from "../phrase-image-cache";

/** Fetch the current question's image without rendering or revealing it. */
export function usePrefetchPhraseImage(url: string | null | undefined) {
  const { apiFetch, token } = useApi();
  useEffect(() => {
    if (!token || !url || !isStoredImageUrl(url)) return;
    // A failed preload must not interrupt learning; opening the image can retry.
    void fetchCachedPhraseImage(token, url, apiFetch).catch(() => undefined);
  }, [url, token, apiFetch]);
}
