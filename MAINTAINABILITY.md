# GYMSTAT Maintenance Guide

## Module boundaries

- `server.js` owns application wiring, middleware registration, public routes, protected route mounting, and startup.
- `src/routes` defines HTTP paths and access middleware only.
- `src/controllers` contains request handling and business workflows.
- `src/middleware` contains reusable request validation, authentication, authorization, and security auditing.
- `src/models` defines MongoDB schemas and indexes. Existing collection names and field compatibility must be preserved.
- `src/config` contains environment-backed configuration such as database, CORS, logging, passwords, rate limits, and uploads.

Keep new business logic in controllers or a focused service rather than duplicating it in route files. Keep responses compatible with the existing frontend service functions in `frontend/src/services/api.js`.

## Configuration

Copy `backend/.env.example` to a local `.env` and replace the placeholders. Never commit `.env`, database URIs, JWT secrets, passwords, tokens, or uploaded user data.

## Validation commands

Run these before merging a change:

```powershell
Set-Location backend
npm test -- --runInBand

Set-Location ..\frontend
npm run build
```

For frontend changes, run `npm run lint` for the touched files when repository-wide lint contains unrelated legacy findings. For database or authorization changes, add or update a focused backend test before changing adjacent modules.

## Logging

Use the backend logger behavior already installed by `src/config/logger.js`. Logs must contain operation context only and must never include passwords, tokens, authorization headers, uploaded file contents, or full request bodies.