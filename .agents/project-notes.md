# 10x Phrase Follower Agent Notes

## Repository

- This project is a Git repository.
- The primary branch is `master`, not `main`.
- The push remote is `origin`, configured as `git@github.com:michal-duchnowski/10x-phrase-follower.git`.
- Before committing or pushing, check `git status --short --branch` and avoid including unrelated user changes.
- On this Windows environment, prefer `npm.cmd run ...` over `npm run ...` because PowerShell may block `npm.ps1` via ExecutionPolicy.

## Local Docker Runbook

- Local app testing is done through Rancher/Docker on `http://localhost:3000`, not by starting a separate `npm dev` server.
- Keep the Supabase configuration from `.env`; do not rewrite it to local Supabase unless the user explicitly asks.
- Build the local Docker image with `powershell.exe -ExecutionPolicy Bypass -File .\build-docker.ps1`. This script is required because Astro needs the `PUBLIC_*` Supabase variables at build time.
- After a rebuild, restart the app container with `docker compose up -d --force-recreate app`.
- Verify with `Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing`.
- If Docker/Rancher is not responding, use `rdctl.exe shutdown --wait` then `rdctl.exe start --container-engine.name moby --no-modal-dialogs`, wait for `docker version`, and then rerun the build/recreate commands above.
- Avoid running local `npm dev` in parallel with the Docker container; it can confuse port/process diagnosis.

## Recent Learn Mode Context

- Contains mode answer checking lives in `src/lib/learn.service.ts`.
- Contains mode should treat separators such as commas and semicolons as synonym delimiters, so answers like `porządny` match `porządny, przyzwoity`, and `rozproszyć` matches `rozrzucić, rozproszyć; rozsypać się`.
- Regression tests for this behavior are in `src/lib/learn.service.test.ts`.
