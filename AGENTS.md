# AGENTS.md

## Commit Message Convention
- Use conventional style: `feat: ...`, `fix: ...`, `chore: ...`.
- Prefer French wording aligned with repository history.
- Do not use infinitive verbs in commit subjects (avoid `ajouter`, `corriger`, `mettre`).
- Prefer nominal phrasing used in history, e.g. `feat: ajout de ...`, `fix: correction de ...`, `chore: mise a jour de ...`.

## Public Repository Rules
- Do not commit production-specific infrastructure details to this public repository.
- Keep `README.md` focused on public/local usage.
- Keep local server docs in ignored files only (e.g. `README.server.local.md`).
- Never commit real secrets or deployment environment files.

## Deployment Files
- `.env.production` and `.env.prod` must stay local and untracked.
- `.env.example` remains public and generic.
