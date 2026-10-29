# FinGlass

Simple web app to track securities transactions over time, with Adjusted Cost Base (ACB) calculations.

## Stack
- Python API: Django (Python 3.12)
- Database: SQLite
- Frontend: Vite + React (Node.js 26)
- Containerization: Docker (multi-stage Node 26 + Python 3.12) + Docker Compose

## Architecture
- Django project: `finglass_project/` (settings, urls, WSGI/ASGI).
- Django apps: `accounts/` (custom user + auth endpoints) and `core/` (core models, middleware, API routes).
- Data/persistence: Django ORM models + versioned migrations in `accounts/migrations` and `core/migrations`.
- Frontend: Modern Single Page App in `frontend/` powered by Vite & React, building directly to `static/app.js` and `static/app.css`, served via Django's `templates/index.html`.






## Features
- Portfolio overview dashboard with charts and summaries
- Per-security detail/edit page with full transaction history
- **Intuitive Import Wizard** with guided step-by-step process for:
	- Investment transactions (Activities CSV from your broker)
	- Holdings snapshots (Portfolio positions CSV from your broker)
	- Credit card transactions (Rogers Bank statement CSV)
	- Tax documents (ROC / Reinvested Capital Gains PDFs)
- Preview and review all imports before committing
- Add manual transactions (Buy, Sell, Return of Capital)
- View per-security summary (shares, ACB, ACB/share, realized capital gain)
- View rolling transaction ledger over time for each security
- Overview charts for portfolio allocation and market value
- Investment accounts dashboard with holdings breakdown
- Credit card expense tracking with category breakdowns
- Net worth tracker with historical graphs

## Run locally (without Docker)
```bash
# 1. Setup Python backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate

# 2. Build or run frontend
npm run build     # compiles Vite React frontend into static/
# or: npm run dev # runs Vite hot module reload

# 3. Start server
python manage.py runserver
```

Open: http://localhost:8000

Security env vars:
- Set `SECRET_KEY` in production to use a stable strong session-signing key.
- Optional: set `SESSION_COOKIE_SECURE=true` when serving over HTTPS.
- Optional: set `ALLOWED_HOSTS` (comma-separated) for deployment hostnames.
- Optional: set `DJANGO_DEBUG=1` for local debugging only.

Market data setup:
- Real-time quote search and holdings market value refresh use a free, zero-authentication market data service out of the box with automatic resolution for Canadian (.TO) and US tickers.
- No API key or config file is required.
- Optional fallback: set `ALPHA_VANTAGE_API_KEY` in the environment if desired.

## Using the Import Wizard

The revamped import wizard provides a clear, step-by-step experience for bringing data into FinGlass:

### Getting Started
1. From the dashboard, click **"Launch Import Wizard"**
2. Select the type of data you want to import:
   - **Investment Transactions** - For ACB tracking
   - **Holdings Snapshot** - Current portfolio positions
   - **Credit Card Transactions** - Expense tracking
   - **Tax Documents** - ROC and reinvested gains

### Import Process
1. **Select Type**: Choose what you're importing
2. **Upload File**: Drag & drop or browse for your file
   - See format requirements and download templates
   - File is validated immediately
3. **Review & Edit**: Preview parsed data before importing
   - Edit any fields if needed
   - See warnings about duplicates or issues
4. **Complete**: Data is imported and dashboard updates

### File Format Requirements

**Investment Transactions CSV:**
Required columns: `transaction_date`, `symbol`, `activity_type`, `activity_sub_type`, `quantity`, `net_cash_amount`, `commission`

**Holdings Snapshot CSV:**
Required columns: `Symbol`, `Account Number`, `Account Name`, `Account Type`, `Quantity`, `Market Price`, `Market Value`, `Book Value (CAD)`

**Credit Card CSV:**
Download from Rogers Bank or Scotiabank online banking. Should include: Transaction Date, Posted Date, Description, Amount, Category

**Tax PDFs:**
T3/T5 slips with Return of Capital or reinvested capital gains. Include security symbol in filename (e.g., `VDY-T3-2024.pdf`)

### Template Files
Each import type includes a downloadable template showing the expected format. Click "Download Template File" in the wizard to get a sample.

## Legacy Import (Deprecated)
The old dropdown-based import on the overview page has been replaced with the Import Wizard, which provides:
- Clear descriptions of what each import type does
- Format requirements shown upfront
- Better error messages
- Consistent preview/review flow for all imports

## Run with Docker Compose (Development)
```bash
docker compose up --build
```

Development compose supports iterative reload:
- Python code changes auto-reload via Django `runserver`.
- Templates and static files are served in dev mode (no manifest hashing).
- Browser refresh is required to see frontend JS/CSS updates.

Default development env vars in Compose:
- `APP_ENV=development`
- `DJANGO_DEBUG=1`
- `ALLOWED_HOSTS=localhost,127.0.0.1`
- `SESSION_COOKIE_SECURE=0`
- `SECURE_SSL_REDIRECT=0`

You can override any of these by exporting env vars or using a `.env` file.

Optional environment setup (recommended):
- Create a `.env` file in project root.
- Set `SECRET_KEY` to a strong random value so sessions remain valid across container restarts.

Open: http://localhost:8000

Data is persisted in `./data/finglass.sqlite3`.

## Run Dockerfile image (Production-style)
Build and run the production image directly:

```bash
docker build -t finglass:prod .
docker run --rm -p 8000:8000 -e DJANGO_DEBUG=0 -e ALLOWED_HOSTS=* finglass:prod
```

The container starts Gunicorn via `finglass_project.wsgi:application`.
The Dockerfile defaults are production-oriented (`APP_ENV=production`, `DJANGO_DEBUG=0`).
