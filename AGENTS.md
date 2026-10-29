# FinGlass Development & Release Guidelines

## Mandatory Version Bump Rule (CRITICAL)
- **ALWAYS** bump the version in `VERSION` and `frontend/package.json` whenever modifying code, fixing bugs, or adding features before committing and pushing.
- Follow Semantic Versioning (`MAJOR.MINOR.PATCH`):
  - Increment `PATCH` (e.g. `1.1.0` -> `1.1.1`) for bug fixes, style adjustments, and minor updates.
  - Increment `MINOR` (e.g. `1.1.0` -> `1.2.0`) for new views, features, or significant functional additions.
- **Always recompile the frontend bundle** (`cd frontend && npm run build`) after updating `VERSION` so that `__APP_VERSION__` in `static/app.js` matches the new version.

## Verification Checklist Before Any Push
1. Bump `VERSION` and `frontend/package.json`.
2. Run `cd frontend && npm run build`.
3. Run test suite: `docker compose exec -T finglass-web python manage.py test`.
4. Rebuild local container: `docker compose up -d --build`.
5. Stage files, commit, and push to `origin/main`.
