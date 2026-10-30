# FinGlass REST API Reference

All API endpoints return JSON responses. Protected endpoints return HTTP `401 Unauthorized` if no active session exists.

---

## 1. Authentication & System (`/api/auth`)

### `GET /api/auth/check-setup`
Checks whether the application has any registered superusers.
- **Response:**
  ```json
  { "needs_setup": false }
  ```

### `POST /api/auth/setup-superuser`
Initial setup endpoint to register the first superuser (disabled once users exist).
- **Body:** `{ "username": "admin", "password": "...", "confirm_password": "..." }`
- **Response:** `{ "ok": true, "user": { "id": 1, "username": "admin", "is_superuser": true } }`

### `POST /api/auth/login`
Authenticates a user and starts a session.
- **Body:** `{ "username": "user", "password": "..." }`
- **Response:** `{ "ok": true, "user": { "id": 1, "username": "user", "is_superuser": true } }`

### `POST /api/auth/logout`
Terminates the active session and clears session cookies.
- **Response:** `{ "ok": true }`

### `GET /api/auth/me`
Returns the currently authenticated user profile.
- **Response:**
  ```json
  {
    "id": 1,
    "username": "gabriel",
    "email": "",
    "is_staff": true,
    "is_superuser": true
  }
  ```

---

## 2. Capital Gains & ACB Transactions (`/api/transactions`)

### `GET /api/transactions`
List transactions for the authenticated user.
- **Query Params:** `security` (optional filter, uppercase).
- **Response:**
  ```json
  [
    {
      "id": 101,
      "security": "VFV.TO",
      "trade_date": "2024-01-15",
      "transaction_type": "BUY",
      "shares": 50.0,
      "amount": 5500.0,
      "commission": 9.99
    }
  ]
  ```

### `POST /api/transactions`
Create a manual investment transaction.
- **Body:**
  ```json
  {
    "security": "XEQT.TO",
    "trade_date": "2024-03-01",
    "transaction_type": "BUY",
    "shares": 100,
    "amount": 3100.0,
    "commission": 0.0
  }
  ```

### `PUT /api/transactions/<id>`
Update an existing transaction.

### `DELETE /api/transactions/<id>`
Delete a single transaction.

### `POST /api/transactions/delete-many`
Bulk delete transactions by ID list: `{ "ids": [101, 102] }`.

### `GET /api/ledger`
Calculates and returns the full Adjusted Cost Base (ACB) ledger and capital gains summary.
- **Query Params:** `security` (required).
- **Response:**
  ```json
  {
    "security": "VFV.TO",
    "rows": [
      {
        "id": 101,
        "trade_date": "2024-01-15",
        "type": "BUY",
        "shares": 50.0,
        "amount": 5500.0,
        "commission": 9.99,
        "share_balance": 50.0,
        "acb": 5509.99,
        "acb_per_share": 110.20,
        "capital_gain": 0.0
      }
    ],
    "summary": {
      "shares": 50.0,
      "acb": 5509.99,
      "acb_per_share": 110.20,
      "realized_gain": 0.0
    }
  }
  ```

---

## 3. Holdings & Market Quotes (`/api/holdings`)

### `GET /api/holdings`
Retrieve current investment portfolio holdings positions.

### `POST /api/holdings`
Upsert a holding snapshot record.

### `GET /api/accounts/dashboard`
Aggregates holdings across accounts, asset classifications, and institutions.

### `POST /api/accounts/cash`
Set or update synthetic cash account balances (`__CASH__`).

### `GET /api/market-data/quote?symbol=VFV.TO`
Fetch live market quotes with automatic Canadian `.TO` symbol resolution.
- **Response:**
  ```json
  {
    "symbol": "VFV.TO",
    "price": 142.50,
    "currency": "CAD",
    "as_of": "2026-10-29T21:00:00Z"
  }
  ```

### `POST /api/holdings/refresh-market-values`
Refreshes market prices and market values for all existing holdings from real-time market data.

---

## 4. Banking & Cash Flow (`/api/chequing` & `/api/credit-card`)

### `GET /api/chequing/dashboard`
Returns total cash balance, monthly cash in/out, burn rate, and 30-day runway KPI metrics.

### `GET /api/chequing/transactions`
Search and filter chequing transactions by account, category, date range, or search string.

### `GET /api/credit-card/dashboard`
Returns total credit card balance, current statement spend, and category breakdown.

### `GET /api/credit-card/transactions`
List credit card transactions with support for category filters, hide/unhide flags, and exclusion from burn rate calculations.

---

## 5. CRA Tax Shelters (`/api/tfsa`, `/api/rrsp`, `/api/fhsa`)

### `GET /api/tfsa/summary`
Returns statutory TFSA room, cumulative contributions, withdrawals, and year-by-year room schedule.

### `GET /api/rrsp/summary`
Returns CRA deduction limit, unused contributions, earned income generation, and tax-refund projections.

### `GET /api/fhsa/summary`
Returns First Home Savings Account lifetime limit ($40,000 ceiling), annual limit ($8,000/year), and unused carry-forward room.

---

## 6. Quebec Statutory Retirement & Estate Engine (`/api/retirement`)

### `GET /api/retirement/plan`
Loads the authenticated user's saved retirement plan parameters.

### `POST /api/retirement/plan`
Saves or updates retirement plan parameters.

### `POST /api/retirement/simulate`
Executes the full multi-year deterministic simulation and Monte Carlo sequence of returns stress test.
- **Body:** Complete `HouseholdProfile`, `AssetAllocation`, `MacroAssumptions`, `StrategyConfig`.
- **Response:**
  ```json
  {
    "executive_scorecard": {
      "solvency_status": "SOLVENT",
      "portfolio_depletion_age": null,
      "avg_monthly_after_tax_income": 6158.30,
      "lifetime_tax_and_clawback_paid": 348145.53,
      "net_terminal_estate": 1945992.70,
      "total_terminal_taxes": 2380.12
    },
    "strategy_comparison": {
      "lifetime_tax_savings": 15956.94,
      "estate_preservation_delta": 42100.00,
      "oas_clawback_avoided": 8200.00
    },
    "audit_rows": [ ... ],
    "monte_carlo": {
      "probability_of_success": 96.4,
      "median_terminal_wealth": 1980000.0,
      "percentile_trajectories": { "p10": [ ... ], "p50": [ ... ], "p90": [ ... ] }
    }
  }
  ```

### `POST /api/retirement/export-csv`
Generates a downloadable, CPA-ready year-by-year audit CSV containing over 40 statutory accounting columns.

---

## 7. Data Import & Backup (`/api/import`)

### `POST /api/import/review`
Uploads a CSV or PDF file and creates a staged review batch.

### `GET /api/import/review/<batch_id>`
Inspects staged rows and validation warnings before committing to the live database.

### `POST /api/import/review/<batch_id>/commit`
Applies valid rows into permanent transactions, holdings, or accounts.

### `GET /api/import/export-all`
Generates a complete JSON backup of all user data across all tables.

### `POST /api/import/full-backup`
Restores user data from a previously exported JSON backup file.
