# Storage i porządkowanie

## Struktura katalogów (lokalnie, single-tenant)

- `storage/audio/{notebookId}/{phraseId}/{voice}.mp3`
- `storage/audio_tmp/...`
- `storage/exports/{notebookId}/{exportId}.zip`
- `storage/meta/...`

## Zasady

- Hard delete:
  - usunięcie frazy → usuń wszystkie jej MP3,
  - usunięcie notatnika → usuń audio i eksporty powiązane.
- Po udanym rebuildzie notatnika: usuń poprzednie MP3 (brak duplikatów).
- ZIP-y (future): kasuj po pobraniu oraz cron „auto-clean" > 24 h.

## Sanity checks

- Po rebuildzie: skan katalogu notatnika → brak plików starszych generacji.
- Przy imporcie: liczba fraz ≤ 200, każda fraza ≤ 2000 znaków.
