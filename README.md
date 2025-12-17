# Greatshield Discord Moderation Bot

Greatshield is a local-first Discord moderator that keeps message analysis on your machine. It pairs SQLite for state, Ollama for AI scoring, and a small command-line interface for setup and control.

## Quick Start
- Install Node.js 20+, then install dependencies: `npm install`.
- Build the CLI: `npm run build`.
- Run the setup wizard: `node dist/src/index.js setup`.
- Start the bot after configuration: `node dist/src/index.js start`.
- Serve the REST API for the dashboard: `npm run api` (defaults to http://localhost:4000).
- Frontend (Angular + Ionic): `npm run dashboard` in this repo, then open the served URL.

## Core Commands
- `setup` – interactive configuration for tokens, guilds, and models.
- `start` – launch the bot with the saved configuration.
- `status` – check database, configuration, and Ollama health.
- `models` / `pull <model>` – list or download Ollama models.
- `logs [-f] [-n <lines>]` – view log output without external tools.
- `serve` – start the REST API used by the dashboard.

## Development
- Type checking/build: `npm run build`
- Linting: `npm run lint`
- Tests: `npm test`

The codebase favors small modules, explicit error handling, and ASCII-only output so it behaves consistently across platforms.
