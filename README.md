# FinGlass

[![FinGlass Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](VERSION)
[![Python](https://img.shields.io/badge/python-3.12-brightgreen.svg)](https://www.python.org/)
[![Django](https://img.shields.io/badge/django-5.2%20LTS-green.svg)](https://www.djangoproject.com/)
[![React](https://img.shields.io/badge/react-19-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/vite-6-purple.svg)](https://vitejs.dev/)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](Dockerfile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**FinGlass** is a modern, privacy-first personal wealth intelligence and retirement planning platform built specifically for Canadian investors and retirees, with specialized support for Quebec statutory tax, pension, and estate optimization.

---

## 🌟 Key Capabilities

### 1. 📈 Capital Gains & Adjusted Cost Base (ACB) Tracker
- **Strict CRA Compliance:** Implements Canada Revenue Agency weighted-average cost rules.
- **Transaction Ledger:** Real-time rolling share balance, total ACB, ACB per share, and realized capital gains.
- **Corporate Actions & Distributions:** Handles Return of Capital (ROC) ACB reductions and Reinvested Capital Gains phantom distributions with negative ACB protection.

### 2. 🍁 Quebec Statutory Retirement & Estate Optimizer
- **Dual CRA & Revenu Québec Engine:** Progressive bracket solver (2026 base year) with Quebec Abatement (16.5%), Age Credits, Pension Income Tax Credits, and RAMQ drug insurance.
- **Pensions:** Exact actuarial adjustment factors for QPP/RRQ (ages 60–72), OAS residency ratios and clawback thresholds (\$90,997), and Guaranteed Income Supplement (GIS).
- **RRSP Meltdown Sandbox:** Compares systematic early RRSP/RRIF withdrawals against standard ad-hoc decumulation to prevent tax spikes and protect OAS from clawbacks.
- **Monte Carlo Sequence-of-Returns Simulator:** 1,000 stochastic trials using Box-Muller transforms across cash, bond, and equity asset allocations.
- **Senior / Retiree Mode:** Switch between comprehensive quantitative audits and a simplified, large-print, jargon-free mode with plain-English health status and 3 actionable steps.
- **Terminal Estate & Rollovers:** Deemed disposition at death, spousal rollovers, terminal tax liability, and liquidity solvency checks.

### 3. 🛡️ Canadian Registered Tax Shelters
- **TFSA (Tax-Free Savings Account):** Cumulative statutory room schedules, contribution and withdrawal tracking, room re-crediting rules, and CRA 1%/mo excess contribution warnings.
- **RRSP (Registered Retirement Savings Plan):** CRA deduction limits, earned income room generation (18%), unused contributions, and marginal tax refund projections.
- **FHSA (First Home Savings Account):** Annual (\$8k) and lifetime (\$40k) limits, carry-forward room tracking, and qualifying withdrawal status.

### 4. 💳 Banking & Cash Flow Intelligence
- **Chequing & Cash Flow:** Account balances, monthly cash burn rates, categorized transactions, and runway indicators.
- **Credit Card Expenses:** Statement tracking, category breakdowns, and transaction visibility toggles for discretionary spend.

### 5. 🧙‍♂️ Smart Import Wizard & Backup Engine
- **Guided Importer:** Drag-and-drop CSV and PDF import wizard with immediate validation and pre-commit staging review.
- **Supported Formats:** Broker activity statements, holdings snapshots, Rogers Bank / Scotiabank credit card statements, and T3/T5 tax slips.
- **Zero Lock-In:** Complete single-click JSON backup export and restore.

---

## 🏗️ System Architecture

FinGlass follows a clean, decoupled architecture:
- **Frontend:** React 19 Single Page App powered by Vite 6, packaged into `static/app.js` and `static/app.css`.
- **Backend:** Django 5.2 LTS (Python 3.12) running under Gunicorn with modular views, domain services, and zero external runtime telemetry.
- **Database:** Persistent SQLite database stored in `./data/finglass.sqlite3`.

```
FinGlass/
├── accounts/          # User authentication & RBAC
├── config/            # Externalized tax & statutory constants (QC 2026)
├── core/              # Main business application
│   ├── management/    # Management CLI commands (seed_demo_data)
│   ├── migrations/    # Schema migrations
│   ├── retirement/    # Quebec statutory retirement engine (Modules 1–11)
│   ├── services/      # Business logic, ACB math, and CSV parsers
│   └── views/         # Modular API view endpoints
├── data/              # SQLite database storage
├── docs/              # In-depth architectural & domain documentation
├── finglass_project/  # Django settings, WSGI, ASGI
├── frontend/          # React 19 frontend source code
├── static/            # Compiled static bundle (JS, CSS)
└── templates/         # Base SPA template
```

---

## 🚀 Quickstart

### Running with Docker Compose (Recommended)

The easiest way to start FinGlass:

```bash
docker compose up -d --build
```

Access the application in your browser:
- **URL:** [http://localhost:8000](http://localhost:8000)
- On first launch, the setup wizard will prompt you to create your secure admin account.

### Local Development (Without Docker)

```bash
# 1. Setup Python Virtual Environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate

# 2. Build Frontend Bundle
cd frontend
npm ci
npm run build
cd ..

# 3. Seed Demo Data (Optional)
python manage.py seed_demo_data

# 4. Start Development Server
python manage.py runserver
```

---

## ⚙️ Configuration & Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `APP_ENV` | `production` | Set to `development` for local debugging |
| `DJANGO_DEBUG` | `0` | Enable Django debug mode (disable in production) |
| `SECRET_KEY` | *(generated)* | Cryptographic key for session cookie signing |
| `ALLOWED_HOSTS` | `*` | Comma-separated list of valid hostnames |
| `SESSION_COOKIE_SECURE` | `0` | Set to `1` when serving behind an HTTPS reverse proxy |
| `SEED_DEMO_DATA` | `0` | Set to `1` to automatically populate sample accounts |

---

## 📚 Documentation Index

For in-depth guides and technical details, consult the documentation suite in [`docs/`](docs/):

- 📐 [**System Architecture (`docs/ARCHITECTURE.md`)**](docs/ARCHITECTURE.md) — Technical topology, security model, and directory structure.
- 🔌 [**REST API Reference (`docs/API.md`)**](docs/API.md) — Complete endpoint reference with request/response schemas.
- 🍁 [**Retirement Engine Manual (`docs/RETIREMENT_ENGINE.md`)**](docs/RETIREMENT_ENGINE.md) — Detailed statutory rules, QPP/OAS formulas, dual-tax engine, and Monte Carlo specs.
- 🛡️ [**Tax Shelters Guide (`docs/TAX_SHELTERS.md`)**](docs/TAX_SHELTERS.md) — TFSA, RRSP, and FHSA contribution room rules and CRA penalty logic.
- 📥 [**Import Guide (`docs/IMPORT_GUIDE.md`)**](docs/IMPORT_GUIDE.md) — Broker activity CSVs, holdings exports, and statement templates.
- 📑 [**IPF 2026 Engine Specification (`docs/SPEC.md`)**](docs/SPEC.md) — Complete mathematical equations and statutory source references.

---

## 🧪 Testing & Verification

Run the full automated test suite inside Docker:

```bash
docker compose exec -T finglass-web python manage.py test
```

Per project release guidelines ([`AGENTS.md`](AGENTS.md)), all code changes must bump versions in `VERSION` and `frontend/package.json`, recompile the frontend bundle (`npm run build`), pass all unit tests, and rebuild the container.
