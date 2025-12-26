# Phrase Follower

![Version](https://img.shields.io/badge/version-0.0.1-blue)
![Status](https://img.shields.io/badge/status-MVP_complete-green)
![Node](https://img.shields.io/badge/node-22.14.0-339933?logo=node.js)
![Astro](https://img.shields.io/badge/astro-5.13.7-FF5D01?logo=astro)
![React](https://img.shields.io/badge/react-19-61DAFB?logo=react)
![License](https://img.shields.io/badge/license-MIT-green)

A minimal MVP to help learners practice English phrases via sequential EN→PL playback with multiple English voices and low-cost Google Text-to-Speech.

---

## Table of contents

- [1. Project name](#1-project-name)
- [2. Project description](#2-project-description)
- [3. Screenshots](#3-screenshots)
- [4. Tech stack](#4-tech-stack)
- [5. Getting started locally](#5-getting-started-locally)
- [6. Available scripts](#6-available-scripts)
- [7. Project scope](#7-project-scope)
- [8. Project status](#8-project-status)
- [9. Deployment](#9-deployment)
- [10. License](#10-license)

---

## 1. Project name

Phrase Follower.

## 2. Project description

Phrase Follower is an Astro-based web app that streamlines learning English phrases through an optimized playback loop:

- EN1 → EN2 → EN3 → PL sequence with 800 ms pauses between segments and phrases
- Multiple English voices plus one Polish voice per user
- Import phrases via simple `EN sentence ::: PL sentence` files
- Generate and store MP3 per phrase × voice using Google TTS (cost-conscious settings)

**Note:** Phrase Follower does not generate or translate phrases. You need to prepare your phrase files in a separate tool (e.g., ChatGPT, Claude, or any text editor) using the `EN sentence ::: PL sentence` format, then import them into the application.

### Why it's effective for learning English

Phrase Follower helps learners master English phrases through structured repetition and exposure to multiple pronunciations. By hearing the same phrase spoken by different English voices (EN1, EN2, EN3) followed by the Polish translation, learners build both listening comprehension and pronunciation skills. The sequential playback pattern reinforces memory through spaced repetition, while the ability to import your own phrases ensures you practice vocabulary relevant to your needs - whether it's business English, everyday conversations, or specialized terminology. The adjustable playback speeds allow learners to start slowly and gradually increase difficulty, making it suitable for all proficiency levels.

**Important:** To use audio generation features, you must configure a TTS encryption key from Google Cloud in your account settings. The key is validated on save and never exposed to the client.

See the Product Requirements Document for full details: [docs/prd.md](./docs/prd.md)

## 3. Screenshots

### Notebook List

![Notebook List](./docs/screenshots/notebook-list.png)

### Notebook View

![Notebook View](./docs/screenshots/notebook-view.png)

### Audio Player

![Audio Player](./docs/screenshots/audio-player.png)

### Import Interface

![Import Interface](./docs/screenshots/import-interface.png)

## 4. Tech stack

- Astro 5 (Node adapter)
- TypeScript 5
- React 19
- Tailwind CSS 4
- shadcn/ui
- Node.js 22.14.0
- Supporting deps: `@astrojs/react`, `@astrojs/sitemap`, `lucide-react`, `clsx`, `class-variance-authority`

## 5. Getting started locally

### 5.1. Development mode (Node.js)

Prerequisites:

- Node.js 22.14.0 (see `.nvmrc`)
- Git

Install and run:

```bash
# 1) Use the project Node version
nvm use 22.14.0

# 2) Install dependencies
npm install

# 3) Start the dev server (runs on http://localhost:3000)
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

Quality:

```bash
npm run lint        # report issues
npm run lint:fix    # fix issues where possible
npm run format      # format with Prettier
```

### 5.2. Docker (recommended for production-like testing)

For production-like testing, it's recommended to run the application in Docker. This ensures consistency with the deployment environment.

**Prerequisites:**

- Docker and Docker Compose installed
- `.env` file with required Supabase variables (see below)

**Steps:**

1. Create a `.env` file in the project root with required variables:

   ```
   PUBLIC_SUPABASE_URL=your_supabase_url
   PUBLIC_SUPABASE_KEY=your_public_key
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_anon_key
   ```

2. Build the Docker image using the provided script:

   ```powershell
   .\build-docker.ps1
   ```

   This script validates required environment variables and builds the image as `phrase-follower:local`.

3. Update `docker-compose.yml` to use the local image:

   ```yaml
   image: phrase-follower:local # instead of ghcr.io/...
   ```

4. Start the container:

   ```bash
   docker compose up
   ```

   The application will be available at `http://localhost:3000`.

**Note:** For production deployment, the image is pulled from GitHub Container Registry (GHCR). See [Deployment](#9-deployment) section for details.

### 5.3. TTS setup (for audio generation)

**Important:** Before you can generate audio, you must configure a TTS encryption key from Google Cloud:

1. Obtain a Google Cloud TTS API key
2. Add the key in the app's Settings screen
3. The key is validated on save and never exposed to the client
4. Configure three EN voices (ordered) and one PL voice per your preference
5. Duplicates within a language are disallowed

## 6. Available scripts

- `dev`: Run the Astro dev server.
- `build`: Build the production site.
- `preview`: Preview the production build locally.
- `astro`: Direct access to the Astro CLI.
- `lint`: Lint TypeScript/React/Astro sources.
- `lint:fix`: Lint with autofix enabled.
- `format`: Format the repository with Prettier.

## 7. Project scope

### Core features

- **Authentication & Security:** User login with JWT, per-user data isolation (RLS)
- **Notebooks:** Create, rename, delete notebooks; organize phrases into collections
- **Import:** Import phrases from `EN ::: PL` text files with validation and error reporting
- **Audio Generation:** Generate MP3 audio for phrases using Google TTS (requires API key configuration)
- **Voice Configuration:** Configure 3 English voices and 1 Polish voice per user
- **Playback:** Sequential EN1 → EN2 → EN3 → PL playback with adjustable speeds (0.75x - 1.25x)
- **Learn Mode:** Interactive learning mode for memorization and recall practice
  - Practice phrases in both directions: EN→PL (translate English to Polish) or PL→EN (translate Polish to English)
  - Card-by-card learning with instant feedback (correct/incorrect)
  - Round-based learning: incorrect phrases are repeated in subsequent rounds
  - Two answer modes: exact match (default) or contains mode (accepts partial matches)
  - Session statistics and progress tracking
- **Export ZIP:** Export notebook audio as ZIP file with combined MP3 files (EN1 + 800ms silence + EN2 + 800ms silence + EN3 + 800ms silence + PL per phrase).
- **Keyboard Shortcuts:** Space/K (play/pause), S (stop), R (restart), ←/→ (seek), Shift+←/→ (seek large), P/N (prev/next phrase)
- **Touch Gestures:** Swipe navigation, double-tap play/pause, double-tap left/right for seeking
- **Limits:** Up to 500 notebooks per user, 100 phrases per notebook, 2000 characters per phrase

### Out of scope for MVP

- PWA/offline mode
- Translation features beyond imports
- Public API, SSO, telemetry
- Click-to-seek, word highlighting (planned for post-MVP)

### Planned enhancements (post-MVP)

- Click-to-seek per word, token-based highlighting, audio status indicators
- Rate limiting and improved error handling
- Partial audio regeneration (per phrase)

## 8. Project status

- Version: 0.0.1
- Status: MVP complete (Phase 0-2 implemented)
- Documentation: primary spec in [docs/prd.md](./docs/prd.md)

## 9. Deployment

The application is deployed on **DigitalOcean Droplet** using Docker.

### Deployment history

Previously, the application was deployed to Cloudflare Pages/Workers, but due to platform limitations (CPU time limits, subrequest limits, response size limits, instability for long-running operations), it was migrated to DigitalOcean Droplet.

For detailed migration rationale, see [docs/lessons-learned/digital-ocean-why.md](./docs/lessons-learned/digital-ocean-why.md).

### Production deployment

- **Platform:** DigitalOcean Droplet
- **Deployment method:** Automated via GitHub Actions
- **Container registry:** GitHub Container Registry (GHCR)
- **Image:** `ghcr.io/michal-duchnowski/10x-phrase-follower:latest`

For deployment setup instructions, see [docs/guides/droplet-setup.md](./docs/guides/droplet-setup.md).

## 10. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The MIT License allows others to use, modify, and distribute this software, but requires that the original copyright notice and license be included in all copies or substantial portions of the software.
