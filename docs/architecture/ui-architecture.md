# Architektura UI dla Phrase Follower (MVP)

## 1. Przegląd struktury UI

Aplikacja webowa do nauki fraz EN→PL z odtwarzaniem sekwencyjnym, klik-to-seek per słowo oraz konfiguracją TTS. Interfejs oparty o **Astro 5 (islands) + React 19 + Tailwind 4 + shadcn/ui**, z **Supabase Auth (JWT)** do uwierzytelniania. Brak prefetch/retry/cache w MVP; proste fetch’e per widok; odświeżanie tylko dla manifestu w playerze. Wszystkie widoki są prywatne po zalogowaniu, z wyjątkiem logowania. Dark-mode only. Wymogi funkcjonalne i ograniczenia pochodzą z PRD oraz planu API.

**Główne obszary UI:**

- **Topbar** (globalny): logo, nawigacja, ikona „gear” do **/settings** (badge stanu TTS), menu użytkownika (logout).
- **Obszar główny**: widoki routingu (listy notatników, import, notatnik, player, settings).
- **Globalne elementy UI**: toasty statusów, dialogi potwierdzeń, obsługa skrótów klawiaturowych w playerze, aria-live dla ogłoszeń stanu odtwarzania.

## 2. Lista widoków

### Widok: Logowanie

- **Ścieżka widoku**: `/login`
- **Główny cel**: Uwierzytelnienie użytkownika przez Supabase Auth; przekierowanie po sukcesie do `/notebooks`.
- **Kluczowe informacje do wyświetlenia**: Formularz logowania, link do rejestracji/zmiany hasła (wg Supabase), komunikaty błędów.
- **Kluczowe komponenty widoku**: `AuthCard`, `SupabaseAuthForm` (hostowany lub własny), `ErrorBanner`.
- **UX, dostępność i względy bezpieczeństwa**: RLS wymusza prywatność; po wygaśnięciu sesji redirect do login; aria-labels pól, focus management.

### Widok: Lista notatników

- **Ścieżka widoku**: `/notebooks`
- **Główny cel**: Przegląd i zarządzanie notatnikami (kafelki: tylko **nazwa + rename + delete**). Brak statusów build/job.
- **Kluczowe informacje do wyświetlenia**: Nazwa notatnika; akcje; ewentualnie wyszukiwarka po nazwie (q); paginacja kursorem (UI może ładować „Więcej”). Dane z `GET /api/notebooks`.
- **Kluczowe komponenty widoku**: `NotebookTile`, `RenameNotebookDialog`, `DeleteConfirmDialog`, `LoadMore`.
- **UX, dostępność i względy bezpieczeństwa**: Wizualne potwierdzenia rename/delete (toast). Usunięcie kaskadowo usuwa MP3 (komunikat). Brak metadanych użytkowników innych niż bieżący (RLS).

### Widok: Import notatnika

- **Ścieżka widoku**: `/import`
- **Główny cel**: Utworzenie notatnika i zaimportowanie fraz z linii `EN ::: PL` z normalizacją. Po sukcesie podsumowanie accepted/rejected i **„Przejdź do notatnika”**.
- **Kluczowe informacje do wyświetlenia**: Pole tekstowe/textarea, checkbox „Normalizuj”, nazwa notatnika; wynik importu (accepted, rejected, lista błędów); link do `/notebooks/:id`. API: `POST /api/notebooks:import`, `GET /api/notebooks/:id/import-logs`.
- **Kluczowe komponenty widoku**: `ImportForm`, `NormalizeToggle`, `ImportSummary`, `GoToNotebookButton`.
- **UX, dostępność i względy bezpieczeństwa**: Walidacja separatora i limitów (≤200 fraz, ≤2000 znaków/fraza); jasne błędy; aria-describedby dla błędów; body limit.

### Widok: Notatnik (szczegóły)

- **Ścieżka widoku**: `/notebooks/:id`
- **Główny cel**: Przegląd i porządkowanie fraz; uruchomienie generowania audio; przejście do playera. W MVP edycja: **reorder + delete** (bez add/edit).
- **Kluczowe informacje do wyświetlenia**: Tabela **EN | PL | Play** z pełnym zawijaniem; status audio per fraza (complete/failed/missing); licznik agregatów (opcjonalnie) z `/audio-status`; przycisk **Generate audio**. API: `GET /api/notebooks/:id`, `GET /api/notebooks/:id/phrases`, `POST /api/notebooks/:id/phrases:reorder`, `DELETE /api/phrases/:phraseId`, `POST /api/notebooks/:id/jobs:generate-rebuild`, `GET /api/notebooks/:id/audio-status`.
- **Kluczowe komponenty widoku**: `PhraseTable`, `PlayCell` (ikony stanu + przycisk Play), `DragHandle` (D&D), `DeleteConfirmDialog`, `GenerateAudioButton`, `AudioStatusBadge/Bar`.
- **UX, dostępność i względy bezpieczeństwa**: `Play` aktywny tylko jeśli istnieje co najmniej jeden segment complete (wg manifestu/segmentów). Reorder/ delete – optymistycznie z rollbackiem przy błędzie; dialog przed usunięciem. RLS i JWT dla wszystkich operacji.

### Widok: Player

- **Ścieżka widoku**: `/player/:notebookId?start_phrase_id=<uuid>`
- **Główny cel**: Odtwarzanie sekwencji **EN1 → EN2 → EN3 → PL** z pauzami **800 ms** i auto-advance; klik-to-seek per słowo; skróty klawiaturowe. Fallback „Odśwież manifest”.
- **Kluczowe informacje do wyświetlenia**: Aktualna fraza (EN/PL), stan segmentu (grający/paused), pozycja czasu, stan highlight (on/off), przyciski: Play/Pause, Stop, **Restart frazy**, „Odśwież manifest”; komunikat o wygaśnięciu URL-i. API: `GET /api/notebooks/:id/playback-manifest` (+ parametr `phrase_ids` i hinty `speed`, `highlight`).
- **Kluczowe komponenty widoku**: `PlayerControls`, `PhraseViewer` (tokenizacja, highlight, klik-to-seek), `SegmentSequenceBar`, `KeyboardShortcutsHandler`, `RefreshManifestButton`.
- **UX, dostępność i względy bezpieczeństwa**: Skróty: **Space/K**, **S**, **R**, **←/→**, **Shift+←/→**, **P/N**; focus-visible; aria-live dla zmian stanu; klik w pierwsze słowo → początek segmentu; po PL klik w EN startuje od EN1; komunikat na 403/410 i ręczne odświeżenie manifestu.

### Widok: Ustawienia (TTS)

- **Ścieżka widoku**: `/settings`
- **Główny cel**: Konfiguracja klucza Google TTS (test → zapis) oraz definicja slotów **EN1–EN3, PL** bez duplikatów językowych. Status konfiguracji odzwierciedlany badgem w topbarze.
- **Kluczowe informacje do wyświetlenia**: Formularz klucza z przyciskiem **Validate/Test** (odsłuch próbki, bez zapisu), tabela slotów (slot, język, voice_id), stan „skonfigurowano”/„brak”. API: `GET/POST/PUT/DELETE /api/tts-credentials`, `POST /api/tts-credentials:test`, `GET /api/user-voices`, `PUT /api/user-voices/:slot`.
- **Kluczowe komponenty widoku**: `TtsKeyForm` (Test→Save), `VoiceSlotEditor` (EN1–EN3, PL), `ConfigStatusBadge`.
- **UX, dostępność i względy bezpieczeństwa**: Klucz nigdy nie jest ujawniany w kliencie; walidacja duplikatów w obrębie EN; stan testu wymagany przed zapisem; czytelne błędy (`invalid_key`, `quota_exceeded`, `tts_timeout`).

### Widok: Błędy i stany szczególne

- **Ścieżki widoku**: `/_error`, `/_403`, `/_404`
- **Główny cel**: Spójna prezentacja błędów (np. RLS 403/404 bez metadanych), komunikaty z PRD (import/generate), instrukcje akcji (powrót, ponów próbę).
- **Kluczowe informacje do wyświetlenia**: Kod błędu, przyjazna treść, linki nawigacyjne.
- **Kluczowe komponenty widoku**: `ErrorLayout`, `ErrorActions`.
- **UX, dostępność i względy bezpieczeństwa**: Brak wycieków metadanych; odpowiednie role ARIA, kontrast i fokus.

## 3. Mapa podróży użytkownika

### Główny przypadek użycia: „Od zera do odtwarzania”

```
/login → /notebooks → /settings → (Test TTS → Save) → /import → (Import OK) → /notebooks/:id → (Generate audio) → /player/:notebookId?start_phrase_id=first
```

**Kroki:**

1. **Logowanie** (Supabase) → przekierowanie do listy notatników. UC-01.
2. **Ustawienia TTS**: test klucza → zapis; konfiguracja slotów (bez duplikatów EN). UC-02, UC-03.
3. **Import**: wklejenie linii `EN ::: PL`, normalizacja, podsumowanie, link do nowo utworzonego notatnika. UC-04.
4. **Notatnik**: weryfikacja fraz; opcjonalnie reorder/delete; `Generate audio` (pełny rebuild). UC-05, UC-06.
5. **Player**: odtwarzanie EN1→EN3→PL, pauzy 800 ms, auto-advance, klik-to-seek i skróty. UC-07, UC-08, UC-09.

### Przypadki alternatywne

- **Powrót do odtwarzania**: z `/notebooks/:id` → `/player/:notebookId?start_phrase_id=current`.
- **Błędy TTS/generowania**: komunikat globalny + możliwość ponownego wywołania generowania; w playerze ręczne „Odśwież manifest”.

## 4. Układ i struktura nawigacji

- **Topbar (stały)**: logo → `/notebooks`; link „Import”; ikona „gear” → `/settings` (badge: skonfigurowano/nie); menu użytkownika (logout).
- **Routing (Astro islands + React):**
  - Public: `/login`
  - Private (wymaga JWT): `/notebooks`, `/import`, `/notebooks/:id`, `/player/:notebookId`, `/settings`

- **Nawigacja kontekstowa:**
  - Z podsumowania importu: przycisk **„Przejdź do notatnika”** → `/notebooks/:id`.
  - Z `PhraseTable`: klik `Play` lub tekst frazy → `/player/:notebookId?start_phrase_id=<id>`.
  - Z playera: link „Wróć do notatnika”.

- **Ochrona tras**: sprawdzanie stanu sesji; 403/404 dla zasobów cudzych; brak ujawniania identyfikatorów innych użytkowników.

## 5. Kluczowe komponenty

- **Topbar**: nawigacja, gear z badgem stanu TTS (`GET /api/tts-credentials` → `is_configured`).
- **NotebookTile (lista)**: nazwa + akcje (rename, delete); integracja z `PATCH/DELETE /api/notebooks/:id`.
- **ImportForm**: textarea + normalizacja; integracja z `POST /api/notebooks:import`; `ImportSummary` pokazuje accepted/rejected i listę odrzuceń (`GET /import-logs`).
- **PhraseTable**: kolumny **EN | PL | Play**; pełne zawijanie; status audio (complete/failed/missing); D&D reorder (`POST :reorder`); delete (`DELETE /api/phrases/:id`).
- **GenerateAudioButton**: uruchamia `POST /jobs:generate-rebuild`; kontrola blokady, gdy brak konfiguracji TTS/głosów (sprawdzenie `/tts-credentials`, `/user-voices`).
- **PlayerControls**: Play/Pause, Stop, **Restart frazy**, „Odśwież manifest”; skróty klawiszowe; integracja z `GET /playback-manifest`.
- **PhraseViewer**: render tokenów (EN/PL), highlight on/off, klik-to-seek z regułami (pierwsze słowo → początek segmentu; gdy gra PL, klik w EN → start od EN1).
- **KeyboardShortcutsHandler**: Space/K, S, R, ←/→, Shift+←/→, P/N; wyłączone w polach input.
- **RefreshManifestButton**: prosty mechanizm odświeżania przy wygaśnięciu URL-i (komunikat + ręczne odświeżenie).
- **Toasts & ErrorBanner**: spójne komunikaty (import, generate, odtwarzanie), zgodne z katalogiem błędów API.
