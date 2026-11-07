# FinGlass Development & Release Guidelines

## Mandatory Privacy & Data Anonymization Rule (CRITICAL)
- **NEVER** commit, push, or include any real personal or financial data into git, codebase, tests, templates, seed data, fixtures, or documentation.
- Specifically prohibited from commits:
  - Real account IDs (e.g. Wealthsimple account identifiers, broker IDs, or internal tokens).
  - Real bank account numbers, transit numbers, or credit card numbers.
  - Real personal names, email addresses, home addresses, phone numbers.
  - Real confidential transaction descriptions or un-anonymized user data snippets.
- In all unit tests (`core/tests.py`), templates (`core/views/imports.py`), mock fixtures, and seed data, **ALWAYS** use sanitized, clearly synthetic mock identifiers:
  - Synthetic account IDs: `ACT10000001`, `ACT20000002`, `ACT_NONREG_001`, `ACT_TFSA_001`, `ACT_RRSP_001`.
  - Synthetic account numbers: `10000001`, `12345678`.
  - Synthetic names & emails: `Jane Doe`, `family@example.com`, `user@example.com`.
  - Synthetic merchants & payees: `City Parking Meter`, `Sample Cafe`, `Grocery Store`, `Utility Corp`.
- **Pre-commit sanity check**: ALWAYS audit staged changes (`git diff --staged`) before committing to guarantee zero user-uploaded data or real account identifiers are present.

## Mandatory Version Bump Rule (CRITICAL)
- **ALWAYS** bump the version in `VERSION` and `frontend/package.json` whenever modifying code, fixing bugs, or adding features before committing and pushing.
- Follow Semantic Versioning (`MAJOR.MINOR.PATCH`):
  - Increment `PATCH` (e.g. `1.1.0` -> `1.1.1`) for bug fixes, style adjustments, and minor updates.
  - Increment `MINOR` (e.g. `1.1.0` -> `1.2.0`) for new views, features, or significant functional additions.
- **Always recompile the frontend bundle** (`cd frontend && npm run build`) after updating `VERSION` so that `__APP_VERSION__` in `static/app.js` matches the new version.

## Verification Checklist Before Any Push
1. Audit git diff (`git diff --staged`) to verify zero personal information or real account IDs.
2. Bump `VERSION` and `frontend/package.json`.
3. Run `cd frontend && npm run build`.
4. Run test suite: `docker compose exec -T finglass-web python manage.py test`.
5. Rebuild local container: `docker compose up -d --build`.
