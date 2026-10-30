# Canadian Tax Shelters Guide (TFSA, RRSP, FHSA)

FinGlass features dedicated tracking, contribution room calculators, and penalty engines for Canada's three primary registered savings accounts:

---

## 1. Tax-Free Savings Account (TFSA / CELI)

### How It Works
- Contributions are made with after-tax dollars; all investment growth and withdrawals are **100% tax-free**.
- Withdrawals are **re-credited** as new contribution room on **January 1st of the following calendar year**.

### FinGlass Engine Logic
- **Annual Limit Table:** Tracks historical CRA limits from 2009 (\$5,000) to 2026 (\$7,000+).
- **Opening Room Calculator:** User sets their starting room or base year.
- **Penalty Detection:** CRA levies a **1% per month tax** on excess contributions. FinGlass alerts if active contributions exceed cumulative room on any trade date.

---

## 2. Registered Retirement Savings Plan (RRSP / REER)

### How It Works
- Contributions are **tax-deductible**, reducing taxable income dollar-for-dollar on your T1/TP-1 tax returns.
- Investment growth compounds tax-deferred until withdrawn, at which point withdrawals are taxed as ordinary income.

### FinGlass Engine Logic
- **Earned Income Generation:** 18% of prior year earned income up to the annual CRA statutory ceiling (\$32,490 in 2025, \$33,810 in 2026).
- **Pension Adjustment (PA):** Deducts employer pension credits.
- **Deduction Optimization:** Calculates immediate tax savings based on the user's marginal combined Federal + Quebec tax bracket.

---

## 3. First Home Savings Account (FHSA / CELIAPP)

### How It Works
- Combines the best features of RRSP and TFSA: contributions are tax-deductible (like an RRSP), and qualifying withdrawals for a first home purchase are tax-free (like a TFSA).

### Statutory Rules & FinGlass Implementation
- **Annual Contribution Ceiling:** \$8,000 per year.
- **Lifetime Contribution Limit:** \$40,000 maximum.
- **Carry-Forward Room:** Up to \$8,000 of unused annual room can be carried forward (maximum room in any single year is \$16,000).
- **15-Year Rule:** Account must be used or transferred to an RRSP/RRIF within 15 years of opening or by the end of the year the account holder turns 71.

