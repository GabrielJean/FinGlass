# SPEC.md — Complete Quebec Retirement Planning Engine (Modules 1–11)

## System Overview & Architecture
This specification defines the complete domain logic, statutory tax/pension rules, optimization algorithms, and UI requirements for a professional-grade retirement planning application tailored to residents of **Quebec, Canada** (Base Tax Year: **2026**).

The calculation engine runs across discrete annual time steps $t \in \{0, 1, \dots, N\}$, where $t = 0$ is the base calendar year (2026) and $N = \text{lifeExpectancyAge} - \text{currentAge}$.

### Engineering Guardrails
1. **Strict Separation of Concerns:** Modules 1–6 and 8–11 must be implemented as a pure, deterministic, strongly-typed calculation library with zero UI dependencies. Module 7 consumes the output of the engine.
2. **Externalized Statutory Config:** All tax brackets, credit amounts, pension ceilings, and RRIF factors must be loaded from `config/tax_constants_qc_2026.json` and indexed dynamically by inflation $i$ each year.
3. **Full Precision Compounding:** Maintain full floating-point precision for multi-year portfolio compounding and Adjusted Cost Base (ACB) tracking; round only at final tax-line and UI display boundaries.

---

## MODULE 1: State, Household Profile & IPF 2026 Macro Assumptions

### 1.1 Household & Demographic State
- `birthYear` (integer) and `currentAge` (integer at $t=0$)
- `retirementAge` (integer, e.g., 60 to 70)
- `lifeExpectancyAge` (integer, default `95`, configurable up to `100` per *Institut de la planification financière* [IPF] standards)
- `maritalStatus`: `"SINGLE" | "COUPLE"`
  - When `"COUPLE"` is active, instantiate two `PersonProfile` objects (`primary`, `spouse`) and unlock:
    1. **Eligible Pension Income Splitting:** Reallocate up to 50% of eligible pension income between spouses (Federal Form T1032 / Quebec Schedule Q).
    2. **Spousal Rollovers & Survivor Rules:** Trigger Module 11 upon the first death.
- `hasPrivateDrugInsurance` (boolean): Controls whether the household pays the mandatory **RAMQ Prescription Drug Insurance Plan** premium on their Quebec TP-1 return.
- `isAutonomousSenior` (boolean, default `true`): Controls the expense ceiling for the Quebec Home-Support Tax Credit at age 70+.

### 1.2 IPF 2026 Default Macro Assumptions (Editable)
All statutory thresholds, tax brackets, and credits in year $t$ scale by general inflation $i$:
$$\text{Threshold}_t = \text{Threshold}_0 \times (1 + i)^t$$

- **General Inflation ($i$):** `0.021` (2.1%)
- **Wage / YMPE Growth ($g_w$):** `0.031` (3.1%)
- **Real Estate Appreciation ($g_{re}$):** `0.031` (3.1%)
- **Expected Gross Asset Class Returns & Standard Deviations ($\mu, \sigma$):**
  - Cash / Short-Term: $\mu = 0.024$, $\sigma = 0.015$
  - Fixed Income (Bonds): $\mu = 0.032$, $\sigma = 0.060$
  - Canadian Equities: $\mu = 0.063$, $\sigma = 0.155$
  - US Equities: $\mu = 0.064$, $\sigma = 0.160$
  - International Equities: $\mu = 0.066$, $\sigma = 0.170$
- **Portfolio Net Return Formula:**
  $$r_{\text{net}} = \left(\sum w_k \cdot \mu_k\right) - \text{MER}$$

---

## MODULE 2: Balance Sheet & Statutory Account Engines

### 2.1 RRSP & RRIF (`REER` & `FERR`)
1. **Accumulation Phase ($\text{Age}_t \le 71$):**
   - Annual contribution room grows by 18% of prior-year earned income up to the indexed annual ceiling (**$33,810** in 2026).
   - Contributions reduce Federal and Quebec Net Income dollar-for-dollar.
2. **Mandatory Conversion at Age 71:**
   - On December 31 of the calendar year the holder turns **71**, the RRSP converts to a RRIF. No further contributions are allowed.
3. **Mandatory RRIF Minimum Withdrawals:**
   - Starting in the year after conversion (age 72+, or earlier if converted voluntarily), enforce minimum withdrawal $W_{\text{min}, t}$:
     $$W_{\text{min}, t} = \text{Balance}_{\text{Jan 1}, t} \times f_{\text{RRIF}}(\text{Age}_t)$$
   - **Statutory CRA/Revenu Québec Factors $f_{\text{RRIF}}(\text{Age})$:**
     - For $\text{Age} < 71$: $f_{\text{RRIF}}(\text{Age}) = \frac{1}{90 - \text{Age}}$
     - For $\text{Age} \ge 71$:
       `71: 0.0528`, `72: 0.0540`, `73: 0.0553`, `74: 0.0567`, `75: 0.0582`, `76: 0.0598`, `77: 0.0617`, `78: 0.0636`, `79: 0.0658`, `80: 0.0682`, `81: 0.0708`, `82: 0.0738`, `83: 0.0771`, `84: 0.0808`, `85: 0.0851`, `86: 0.0899`, `87: 0.0955`, `88: 0.1021`, `89: 0.1099`, `90: 0.1192`, `91: 0.1306`, `92: 0.1449`, `93: 0.1634`, `94: 0.1879`, `95+: 0.2000`.
   - 100% of RRSP/RRIF withdrawals are included in regular taxable income.

### 2.2 LIRA & LIF (`CRI` & `FRV` — Quebec Jurisdiction)
1. **Conversion & Minimums:** Same age-71 mandatory conversion and minimum withdrawal factors $f_{\text{RRIF}}(\text{Age})$ as a RRIF.
2. **Post-2025 Retraite Québec LIF Reform:**
   - For $\text{Age}_t \ge 55$: **No maximum annual withdrawal limit.** The holder may withdraw up to 100% of the LIF balance in any year (100% taxable as regular income).
   - For $\text{Age}_t < 55$: Apply standard Retraite Québec maximum LIF withdrawal factors.
   - **Transfer Restriction:** LIF withdrawals cannot be transferred tax-deferred into an RRSP or RRIF; any amount withdrawn above the minimum is taxed in year $t$.

### 2.3 TFSA (`CELI`)
1. **Annual Room Indexing:** 2026 annual limit is **$7,000**. Index the underlying unrounded limit by inflation $i$ and round to the nearest **$500** increment.
2. **Tax-Free Treatment & Re-Crediting:**
   - Withdrawals are 0% taxable and excluded from Net World Income (do not trigger OAS clawbacks or reduce GIS/Solidarity/Home-Support credits).
   - Withdrawals $W_{\text{TFSA}, t}$ in year $t$ are restored to available contribution room on January 1 of year $t+1$:
     $$\text{Room}_{t+1} = \text{Room}_t - \text{Contributions}_t + W_{\text{TFSA}, t} + \text{AnnualLimit}_{t+1}$$

### 2.4 Non-Registered Account (Taxable)
Track `marketValue` ($MV_t$) and `adjustedCostBase` ($ACB_t$) separately:
1. **Annual Yield Distributions (Taxed Annually):**
   - `interestYield`: 100% taxable as regular income.
   - `eligibleDividendYield`: Canadian eligible dividends (grossed up by `38%` and eligible for Federal + Quebec dividend tax credits).
   - `capitalGrowthRate`: Unrealized price appreciation (increases $MV_t$ while leaving $ACB_t$ unchanged).
2. **Purchases / Reinvestments ($D_t$):** Increase both $MV_t$ and $ACB_t$ by $D_t$.
3. **Dispositions / Sales ($S_t$):** Selling $S_t$ triggers a realized capital gain:
   $$\text{CapitalGain}_t = S_t - \left(ACB_t \times \frac{S_t}{MV_t}\right)$$
   $$ACB_{t}^{\text{new}} = ACB_t \times \left(1 - \frac{S_t}{MV_t}\right)$$

### 2.5 Real Estate, Mortgages & Downsizing Events
1. **Primary Residence:** Tracks `marketValue`, `mortgageBalance`, `mortgageRate`, and `annualPayment`. 100% exempt from capital gains tax via the **Principal Residence Exemption (PRE)**.
2. **Secondary Property (Cottage / Chalet / Plex):** Tracks `marketValue` and `ACB`. Sale or deemed disposition at death triggers a taxable capital gain on $(MV_t - ACB_t - \text{SellingCosts}_t)$.
3. **Downsizing Event:** At optional `downsizeAge`, sell the primary residence, deduct `transactionCostPct` (default `5%`), pay off remaining mortgage, deposit net proceeds into TFSA (up to available room) then Non-Registered, and replace homeowner expenses with indexed `postDownsizeAnnualRent`.

---

## MODULE 3: Government & Employer Pensions Engine

### 3.1 Quebec Pension Plan (`QPP` / `RRQ`)
- **Base Input:** Expected monthly QPP at age 65 in 2026 dollars (`qppAt65`, up to the 2026 maximum of **$1,507.65/month** or **$18,091.80/year**).
- **Start Age Bounds:** `60` to `72`. Let $m = (\text{startAge} - 65) \times 12$:
  - **Early Start ($m < 0$, ages 60–64):** Reduce benefit by `0.5%` to `0.6%` per month ($0.006 \times \vert{}m\vert{}$ at maximum pension, up to **`-36%`** at age 60 / `$964.90/mo` max).
  - **Deferred Start ($m > 0$, ages 65–72):** Increase benefit by **`0.7%` per month** ($0.007 \times m$, up to **`+42%`** at age 70 or **`+58.8%`** at age 72 / `$2,394.15/mo` max).
- **Post-Retirement Benefit (`Supplément à la rente`):** If the user earns employment income while collecting QPP, add `0.5%` of pensionable earnings (up to MPE) to the following year's QPP benefit.

### 3.2 Old Age Security (`OAS` / `SV`) & GIS (`SRG`)
- **Base Input:** 2026 annualized maximum OAS at age 65 (**$9,041.00/year**, scaled by residency fraction $\min(1, \frac{\text{yearsInCanada}}{40})$).
- **Deferral Bonus (Ages 65–70):** Increase benefit by **`0.6%` per month** delayed past 65 (up to **`+36%`** at age 70).
- **Mandatory Age 75+ Step-Up:** Starting the year the user turns **75**, multiply gross OAS by **`1.10`** (+10% permanent increase).
- **Guaranteed Income Supplement (`GIS` / `SRG`):** For low-income seniors aged 65+ whose Net World Income (excluding OAS) falls below the federal threshold (**$22,272** single in 2026, indexed), calculate the non-taxable GIS benefit (clawed back at 50 cents per dollar of non-OAS income).

### 3.3 Defined Benefit (DB) Employer Pension (e.g., `RREGOP`)
- `baseAnnualBenefit`: Lifetime pension payable from retirement age.
- `bridgeBenefit` (`prestation de raccordement`): Paid ONLY while $\text{retirementAge} \le \text{Age}_t < 65$; drops to `$0` at age 65.
- `indexationFormula`: Supports `NONE`, `FULL_CPI`, or `PARTIAL_CPI` (e.g., $\max(0, i - 0.03)$ or $0.50 \times i$).

---

## MODULE 4: Dual Tax & Clawback Solver (CRA + Revenu Québec — 2026 Base Year)

Run an independent Federal (T1) and Quebec (TP-1) tax calculation every year $t$. Index all dollar thresholds by $(1 + i)^t$.

### 4.1 Total, Net & Taxable Income
$$\text{TotalIncome}_t = \text{Earned}_t + \text{QPP}_t + \text{OAS}_{\text{gross}, t} + \text{DB}_t + \text{RRIF}_t + \text{LIF}_t + \text{Interest}_t + (1.38 \times \text{EligDiv}_t) + \text{TaxableCapGains}_t$$
- **Capital Gains Inclusion Rate:** `50%` ($0.50$) of realized net capital gains (with a configurable toggle for `66.67%` above `$250,000` for estate stress tests).
- **Net World Income (Line 23400):** $\text{TotalIncome}_t - \text{RRSPContributions}_t$.

### 4.2 OAS Recovery Tax (Clawback)
- **2026 Clawback Threshold:** **$95,323** (indexed by $i$).
$$\text{OAS}_{\text{clawback}, t} = \min\Big(\text{OAS}_{\text{gross}, t},\; \max\big(0,\; 0.15 \times (\text{NetWorldIncome}_t - \text{Threshold}_{\text{OAS}, t})\big)\Big)$$
- **Taxable Income (Line 26000):** $\text{NetWorldIncome}_t - \text{OAS}_{\text{clawback}, t}$.

### 4.3 Federal Tax (CRA — 2026 Constants)
1. **Progressive Brackets:**
   - `$0` to `$58,523`: **`14.0%`**
   - `$58,523` to `$117,045`: **`20.5%`**
   - `$117,045` to `$181,440`: **`26.0%`**
   - `$181,440` to `$258,482`: **`29.0%`**
   - Over `$258,482`: **`33.0%`**
2. **Non-Refundable Credits (Credited at `14.0%`, except Dividend Credit):**
   - **Basic Personal Amount (BPA):** **$16,452** (phased down to **$14,829** between `$181,440` and `$258,482`).
   - **Age Amount (Age 65+):** **$9,028**, clawed back at `15%` of Net Income exceeding **$45,522**.
   - **Pension Income Amount:** $\min(\text{EligiblePensionIncome}_t, \$2,000)$ (unindexed).
   - **Medical Expense Tax Credit (METC):** Eligible medical expenses minus $\min(\$2,833,\; 0.03 \times \text{NetIncome}_t)$.
   - **Federal Eligible Dividend Tax Credit:** **`15.0198%`** of grossed-up (`1.38x`) dividends.
3. **16.5% Quebec Federal Abatement:**
   $$\text{NetFederalTax}_t = \max(0, \text{BasicFederalTax}_t) \times (1 - 0.165)$$

### 4.4 Quebec Provincial Tax (Revenu Québec — 2026 Constants)
1. **Progressive Brackets:**
   - `$0` to `$54,345`: **`14.0%`**
   - `$54,345` to `$108,680`: **`19.0%`**
   - `$108,680` to `$132,245`: **`24.0%`**
   - Over `$132,245`: **`25.75%`**
2. **Non-Refundable Credits (Credited at `14.0%`, except Dividend Credit):**
   - **Quebec Basic Personal Amount:** **$18,952**.
   - **Age / Retirement Income Amount (Line 361):** Age 65+ base (**$3,906**) + Retirement Income base (**$3,470** max), reduced by **`18.75%`** of family net income exceeding **$42,090**.
   - **Quebec Medical Expense Credit:** Eligible medical expenses minus $0.03 \times \text{FamilyNetIncome}_t$.
   - **Quebec Eligible Dividend Tax Credit:** **`11.70%`** of grossed-up (`1.38x`) dividends.
3. **RAMQ Prescription Drug Insurance Premium:**
   - If `hasPrivateDrugInsurance == false`, add the income-tested annual RAMQ premium (up to **$789.00/person** in 2026, indexed by $i$).
4. **Refundable Quebec Credits:** Subtract the **Quebec Solidarity Tax Credit** and the **Age 70+ Home-Support Credit** (Module 9) from net provincial tax owing (allowing negative provincial tax / cash refund).

### 4.5 Eligible Pension Income Splitting Optimizer (Couples Only)
When `maritalStatus == "COUPLE"`, run a 1D grid search over the split fraction $s \in [0, 0.50]$ (in `0.05` increments) of eligible pension income (`DB` at any age; `RRIF`/`LIF` at age $\ge 65$) and select $s^*$ that minimizes combined household `TotalTaxAndClawback`.

---

## MODULE 5: Multi-Phase Spending & RRSP Meltdown Optimizer

### 5.1 Three-Phase Retirement Spending Curve
Allow the user to configure real (base-year dollar) annual lifestyle spending across three age bands, plus irregular cash flows from Module 8 and healthcare costs from Module 9:
- **Go-Go Phase ($\text{retirementAge} \le \text{Age}_t \le 74$):** `baseSpending + goGoTravelAddOn`
- **Slow-Go Phase ($75 \le \text{Age}_t \le 84$):** `baseSpending + slowGoAddOn` (typically 10%–15% lower real discretionary spending)
- **No-Go Phase ($\text{Age}_t \ge 85$):** `baseSpending + lateLifeCareOverride`
$$\text{TargetAfterTaxSpending}_t = (\text{PhaseSpending}_t + \text{NetLumpyOutflow}_t + \text{HealthcareOutflow}_t) \times (1 + i)^t$$

### 5.2 Annual Cash-Flow Solver & RRSP Meltdown Algorithm
Because withdrawing from an RRSP/RRIF/LIF or Non-Registered account increases taxable income (which increases taxes and OAS clawback), the engine must use an **iterative fixed-point loop** each year $t$ so that `AfterTaxCashFlow == TargetAfterTaxSpending`.

```text
ALGORITHM: SolveAnnualCashFlow(Year t, StrategyMode)
1. Compute Forced Inflows:
   - Employment_t, QPP_t, OAS_gross_t, DB_t
   - NonReg_Interest_t, NonReg_Dividends_t
   - Mandatory RRIF_Min_t and LIF_Min_t
   - Tax-Free Lumpy Inflows (Inheritances, Downsizing Proceeds)

2. Apply Strategy Overlays (if StrategyMode == "RRSP_MELTDOWN"):
   - Determine TargetTaxableCeiling_t:
     a) Bottom of 2nd combined Fed/QC bracket ($54,345 indexed), OR
     b) OAS Clawback Threshold ($95,323 indexed).
   - If ForcedTaxableIncome_t < TargetTaxableCeiling_t:
     - TopUpRoom = TargetTaxableCeiling_t - ForcedTaxableIncome_t
     - ExtraRegisteredWithdrawal = min(Available_RRSP_RRIF_LIF_Balance, TopUpRoom)
     - Add ExtraRegisteredWithdrawal to RegisteredWithdrawals_t.

3. Iterative Tax & Deficit Convergence Loop (max 15 iterations, tolerance = $1.00):
   Loop:
     a) Run MODULE 4 (Dual Tax & Clawback Solver) on current income & withdrawals.
     b) NetCashAvailable = TotalGrossCashInflows - TotalTaxAndClawback_t
     c) CashGap = TargetAfterTaxSpending_t - NetCashAvailable
     d) If abs(CashGap) <= $1.00: BREAK (Converged)
     e) If CashGap > 0 (Deficit):
        Pull additional CashGap (grossed up by current marginal tax rate) in priority order:
        - Order A (Standard): Non-Registered -> Registered (RRSP/RRIF/LIF) -> TFSA
        - Order B (Clawback Shield): Non-Registered -> Registered (up to OAS Clawback Threshold) -> TFSA -> Registered (above threshold)
     f) If CashGap < 0 (Surplus Cash from Forced Inflows or RRSP Meltdown):
        Sweep surplus cash into:
        1. TFSA (up to available Room_t)
        2. Non-Registered Account (increases MV_t and ACB_t)
        BREAK
```

---

## MODULE 6: Final Estate, Deemed Disposition & Liquidity Engine

In the final year of the projection ($\text{Age}_t = \text{lifeExpectancyAge}$, or second death for a couple), compute the **Terminal Estate Tax Return**:
1. **100% Registered Deemed Disposition:**
   - The entire remaining balance of all **RRSP, RRIF, and LIF** accounts is added to final-year regular taxable income (`Line 12900 / 13000`), pushing the excess above `$258,482` (indexed) into the top combined Federal + Quebec marginal rate (**`53.31%`**).
2. **Unrealized Capital Gains Deemed Disposition:**
   - Trigger a deemed sale at Fair Market Value ($MV_N$) for the **Non-Registered Account** and any **Secondary Property (Cottage / Plex)**:
     $$\text{TerminalCapGain} = (MV_{\text{NonReg}, N} - ACB_{\text{NonReg}, N}) + (MV_{\text{Cottage}, N} - ACB_{\text{Cottage}, N})$$
   - Include `50%` (or `66.67%` above `$250k` if toggled) in final taxable income.
3. **Tax-Free Estate Inflows:**
   - **Primary Residence** equity ($MV_{\text{Home}, N} - \text{Mortgage}_N$) passes at `0%` tax via PRE.
   - **TFSA** balance passes at `0%` tax.
   - **Life Insurance Death Benefit:** Any active Term (if $\text{Age}_N < \text{policyExpiryAge}$) or Permanent Whole/Universal Life policy pays out `100%` tax-free into the estate.
4. **Quebec Estate Settlement Costs (*Liquidation*):**
   - If `hasNotarizedWill == true` (*Testament notarié*), probate fee = **`$0`** (apply only flat legal/notary liquidation allowance, default `$3,500` indexed).
   - If `hasNotarizedWill == false` (Holograph or Witness will), add court verification (*vérification de testament*) fees (`$2,500` indexed).
5. **Final Output Metrics:**
   - `GrossEstateValue`, `TerminalIncomeTaxBill`, `NetAfterTaxEstateForHeirs`, and an **`EstateLiquidityWarning`** flag if `TerminalIncomeTaxBill > (LiquidAssets + LifeInsurancePayout)` (indicating the heirs would be forced to sell the cottage/real estate to pay Revenu Québec and the CRA).

---

## MODULE 7: Interactive UI Dashboard & Audit Deliverables

Build a clean, accessible dashboard with four core views:
1. **Executive Scorecard Header:**
   - Displays: **Plan Success Status** (`Funded to Age 95` vs. `Shortfall at Age X`), **Average Monthly After-Tax Retirement Income**, **Total Lifetime Taxes Paid (CRA + Revenu Québec)**, **Total OAS Clawed Back**, and **Net After-Tax Estate**.
2. **Annual Cash-Flow Stacked Bar Chart (Current Age $\rightarrow$ 95):**
   - X-Axis: Age / Year.
   - Stacked Bars (Inflows): `QPP`, `OAS/GIS`, `DB Pension`, `RRSP/RRIF/LIF Withdrawals`, `Non-Registered Withdrawals`, `TFSA Withdrawals`.
   - Overlay Lines: Solid line for `Target After-Tax Spending` and dashed line for `Annual Total Taxes + Clawbacks`.
3. **Strategy Comparison Sandbox (Side-by-Side Delta Cards):**
   - Compare **Baseline Plan** vs. **Optimized Plan** (e.g., QPP at 60 vs. 70 + RRSP Meltdown ON/OFF), showing the exact dollar difference in *Lifetime Taxes Saved* and *Final Net Estate Value*.
4. **Year-by-Year Audit Spreadsheet Table:**
   - Full scrollable/CSV-exportable table where each row is year $t$ and columns show every account's Jan 1 balance, growth, deposits, withdrawals, ACB, QPP, OAS, Federal tax, Quebec tax, OAS clawback, Home-Support credit, and Dec 31 net worth.

---

## MODULE 8: Lumpy "One-Off" Cash-Flow Ledger

Support an array of irregular cash-flow events (`LumpyEvent[]`) that feed into Module 5:
- **Schema per Event:**
  - `id`, `label` (e.g., `"Roof Replacement"`, `"New Vehicle"`, `"Inheritance"`, `"Early Gift to Kids (Don entre vifs)"`)
  - `type`: `"INFLOW_TAX_FREE" | "INFLOW_TAXABLE" | "OUTFLOW_EXPENSE" | "OUTFLOW_GIFT"`
  - `amount` (in base-year 2026 dollars, indexed by $i$)
  - `recurrence`: `"ONE_TIME"` (at `targetAge`) or `"RECURRING_INTERVAL"` (every `k` years from `startAge` to `endAge`, e.g., `$40,000` vehicle replacement every `8` years until age `82`).

---

## MODULE 9: Late-Life Healthcare, RPA Transition & Quebec Senior Home-Support Credit

### 9.1 RPA (Résidence privée pour aînés) Transition
- Allow an optional `rpaTransitionAge` (e.g., age `83`).
- At `rpaTransitionAge`, trigger the Primary Residence sale/downsize (if still owned) and replace housing/food expenses with `monthlyRpaRent` (e.g., `$4,500/month` in 2026 dollars, indexed by $i$).

### 9.2 Quebec Refundable Tax Credit for Home-Support Services for Seniors (*Maintien à domicile des aînés* — 2026 Rules)
For every year where $\text{Age}_t \ge 70$, compute the refundable Revenu Québec credit:
1. **Eligible Expense Cap (2026 Constants):**
   - Single Autonomous Senior: **$19,500/year** (Couple: **$39,000/year**).
   - Single Non-Autonomous Senior: **$25,500/year** (Couple: **$51,000/year**).
   - *(If living in an RPA, estimate eligible care/nursing/meal portion as `35%` to `50%` of annual RPA rent up to the statutory cap).*
2. **2026 Gross Credit Rate:**
   $$\text{GrossHomeSupportCredit}_t = 0.40 \times \min(\text{EligibleHomeCareExpenses}_t,\; \text{ExpenseCap}_t)$$
   *(Yields up to **$7,800/year** autonomous or **$10,200/year** non-autonomous).*
3. **Family Income Reduction (2026 Thresholds, Indexed by $i$):**
   - **First Threshold:** **$72,465**.
   - **Second Threshold:** **$117,590**.
   - **Reduction Formula:**
     - Reduce gross credit by **`3%`** of Family Net Income between `$72,465` and `$117,590`.
     - For autonomous seniors, reduce further by **`7%`** of Family Net Income exceeding `$117,590` (non-autonomous seniors are exempt from the 7% second-tier reduction).

---

## MODULE 10: Sequence-of-Returns Stress Tester (Monte Carlo & Crash Replay)

### 10.1 Monte Carlo Simulation Engine
- Run $M = 1,000$ full lifecycle trials ($t = 0 \dots N$).
- In each year $t$ of trial $m$, draw portfolio return $R_{m,t} \sim \mathcal{N}(\mu_{\text{port}}, \sigma_{\text{port}}^2)$ using Box-Muller transform.
- Output:
  - **`probabilityOfSuccess`**: Percentage of trials where liquid portfolio balance at `lifeExpectancyAge` is $> \$0$.
  - **Percentile Trajectories:** 10th (poor markets), 50th (median), and 90th (strong markets) net worth curves for UI charting.

### 10.2 Historical Crash Replay & Cash Wedge Buffer
- **Crash Preset Toggle:** Allow overriding portfolio returns in the first 3 years of retirement ($t_{\text{ret}}, t_{\text{ret}}+1, t_{\text{ret}}+2$) with a 2008-style sequence (`-22%`, `-8%`, `+12%`) to test sequence-of-returns resilience.
- **Cash Wedge (Bucket Buffer):** Allow holding $K$ years (e.g., `2` years) of net portfolio withdrawals in a dedicated Cash Bucket earning the short-term rate (`2.4%`). In any year where the equity/balanced portfolio return is negative ($R_t < 0$), draw lifestyle funding from the Cash Wedge instead of selling depressed equities, and replenish the Cash Wedge in subsequent positive-return years.

---

## MODULE 11: Spousal "Widow’s Penalty" & Survivor Stress Test

When `maritalStatus == "COUPLE"` and a `firstDeathAge` is triggered (either at the older spouse's life expectancy or an earlier user-selected stress-test age):
1. **Tax-Free Spousal Account Rollover:**
   - Transfer 100% of the deceased spouse's **RRSP, RRIF, and LIF** balances into the surviving spouse's RRIF/LIF at `0%` immediate tax.
   - Transfer 100% of the deceased spouse's **TFSA** into the surviving spouse's TFSA as an exempt rollover without consuming new TFSA room.
   - Roll over Non-Registered assets and Secondary Property at their existing **ACB** (unless the executor elects otherwise).
2. **OAS Termination:**
   - The deceased spouse's OAS stops immediately ($0$ in year $t+1$).
3. **QPP Combined Survivor + Retirement Pension Cap (Crucial Retraite Québec Rule):**
   - Upon death, pay the one-time taxable **QPP Death Benefit ($2,500)**.
   - Calculate the **Combined QPP Pension** for the surviving spouse (Age 65+):
     - A surviving spouse receiving their own QPP retirement pension cannot simply add the deceased's pension on top. The combined total is strictly capped at the **maximum QPP retirement pension payable at age 65** (**$1,507.65/month** or **$18,091.80/year** in 2026, indexed by $i$, adjusted if the survivor took their own QPP early or late).
4. **Shift to Single Tax Filing ("Widow's Penalty"):**
   - Starting in the year after the first death, disable **Eligible Pension Income Splitting**, switch the household to `"SINGLE"`, and run the surviving spouse's enlarged combined RRIF/LIF minimum withdrawals through a single set of CRA and Revenu Québec tax brackets and a single OAS clawback threshold.