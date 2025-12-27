# Dokumentacja projektu Phrase Follower

Główny indeks dokumentacji projektu.

## 📋 Spis treści

### [Product Requirements Document](./prd.md)

Główny dokument wymagań produktu (PRD) - opis funkcjonalności, wymagań biznesowych i historyjek użytkownika.

### Architektura

- [Plan API](./architecture/api-plan.md) - Specyfikacja REST API, endpointy, kontrakty
- [Plan bazy danych](./architecture/db-plan.md) - Schemat bazy danych, tabele, RLS, indeksy
- [Specyfikacja autoryzacji](./architecture/auth-spec.md) - Architektura modułu logowania/wylogowania
- [Weryfikacja autoryzacji](./architecture/auth-verification.md) - Status implementacji modułu auth
- [Architektura UI](./architecture/ui-architecture.md) - Struktura interfejsu użytkownika
- [Tech Stack](./architecture/tech-stack.md) - Stos technologiczny projektu

### Implementacja

#### Plany faz

- [Przegląd wszystkich faz](./implementation/phases/phases-plan.md)
- [Phase 0 - Auth/RLS](./implementation/phases/phase0-implementation-plan.md)
- [Phase 0-1 - View Plan](./implementation/phases/phase0-1-view-plan.md)
- [Phase 1 - Notatnik + Import](./implementation/phases/phase1-implementation-plan.md)
- [Phase 2 - Audio loop](./implementation/phases/phase2-implementation-plan.md)
- [Phase 2 - View Implementation Plan](./implementation/phases/phase2-view-implementation-plan.md)
- [Phase 3 - Klik-to-seek + highlight](./implementation/phases/phase3-implementation-plan.md)
- [Phase 3 - View Implementation Plan](./implementation/phases/phase3-view-implementation-plan.md)

#### Zaimplementowane funkcje

- [Phase 2 - Implementacja](./implementation/phase2-implementation.md) - Dokumentacja zaimplementowanego Phase 2
- [Auth DEV Mode Fix](./implementation/auth-dev-fix-summary.md) - Podsumowanie naprawy trybu developerskiego
- [Phrase difficulty (easy/medium/hard)](./implementation/phrase-difficulty.md) - Spec: oznaczanie trudności fraz + filtrowanie (Notebook/Player/Learn)

### Szczegóły techniczne

- [Import](./details/import.md) - Format i walidacja importu plików
- [Player](./details/player.md) - Sekwencja odtwarzania, klik-to-seek, highlight
- [Storage](./details/storage.md) - Zarządzanie plikami audio
- [Security](./details/security.md) - Bezpieczeństwo i szyfrowanie
- [Tokenizacja](./details/tokenization.md) - Tokenizacja tekstu dla highlight
- [TTS Audio Pipeline](./details/tts-audio-pipeline.md) - Pipeline generowania audio
- [Prefetching](./details/prefetching.md) - Strategia prefetchingu (planowane)
- [Export ZIP](./details/export-zip.md) - Eksport ZIP (planowane)

### Przewodniki

- [Migracja do Supabase Cloud](./guides/supabase-cloud-migration.md) - Jak przejść z lokalnego Supabase na cloud
- [Testowanie produkcji auth](./guides/testing-production-auth.md) - Jak testować autoryzację w produkcji
- [Setup DigitalOcean Droplet](./guides/droplet-setup.md) - Konfiguracja dropletu przed pierwszym deployem
- [SSH do DigitalOcean z Windows](./guides/ssh-digital-ocean-windows.md) - Jak połączyć się z dropletem z Windows
- [Sprawdzanie łączności z dropletem](./guides/droplet-connectivity-check.md) - Weryfikacja połączenia z dropletem
- [Troubleshooting dropletu](./guides/droplet-troubleshooting.md) - Rozwiązywanie problemów z dropletem
- [Lokalne testowanie Docker](./guides/local-docker-testing.md) - Testowanie aplikacji w Dockerze lokalnie
- [Pre-deploy Checklist](./guides/pre-deploy-checklist.md) - Checklist przed wdrożeniem

### Lessons Learned

- [Docker Deployment](./lessons-learned/docker-deployment.md) - Wnioski z wdrożenia Docker z Astro + Node.js
- [DigitalOcean - Dlaczego](./lessons-learned/digital-ocean-why.md) - Podsumowanie migracji z Cloudflare na DigitalOcean

### Troubleshooting

- [Auth DEV](./troubleshooting/auth-dev.md) - Rozwiązywanie problemów z autoryzacją w trybie dev
- [TTS](./troubleshooting/tts.md) - Rozwiązywanie problemów z TTS

---

## 📁 Struktura dokumentacji

```
docs/
├── prd.md               # Product Requirements Document
├── architecture/        # Specyfikacje architektoniczne
├── implementation/      # Plany i dokumentacja implementacji
│   └── phases/         # Plany poszczególnych faz
├── details/            # Szczegóły techniczne modułów
├── guides/             # Przewodniki operacyjne
├── lessons-learned/    # Wnioski i doświadczenia z wdrożeń
└── troubleshooting/    # Rozwiązywanie problemów
```

## 🔗 Linki zewnętrzne

- [README główny](../README.md) - Główny plik README projektu
- [Reguły Cursor](../.cursor/rules/) - Reguły dla AI w Cursor
