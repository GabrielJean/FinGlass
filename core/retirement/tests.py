from django.test import TestCase
from core.retirement import (
    load_raw_tax_constants,
    TaxConstantsIndexed,
    PersonProfile,
    HouseholdProfile,
    AccountBalances,
    SpendingProfile,
    StrategyConfig,
    SimulationParameters,
    calculate_qpp_annual,
    calculate_oas_gross_annual,
    calculate_db_pension_annual,
    calculate_individual_tax,
    optimize_pension_income_splitting,
    run_retirement_simulation,
    export_audit_csv_string,
)


class RetirementEngineTests(TestCase):
    def setUp(self):
        self.raw_constants = load_raw_tax_constants()
        self.constants_0 = TaxConstantsIndexed(self.raw_constants, 0.021, 0)
        self.constants_10 = TaxConstantsIndexed(self.raw_constants, 0.021, 10)

    def test_tax_constants_loading_and_indexing(self):
        self.assertEqual(self.raw_constants["base_tax_year"], 2026)
        # Year 0 federal bracket 1
        b0_fed = self.constants_0.federal_brackets[0][0]
        self.assertEqual(b0_fed, 58523.0)
        # Year 10 federal bracket 1 scaled by (1 + 0.021)^10
        expected_scaled = 58523.0 * ((1.0 + 0.021) ** 10)
        self.assertAlmostEqual(self.constants_10.federal_brackets[0][0], expected_scaled, places=2)

    def test_qpp_early_and_deferred_calculation(self):
        # QPP at age 65
        p65 = PersonProfile(current_age=65, qpp_start_age=65, qpp_monthly_at_65=1507.65)
        qpp_65 = calculate_qpp_annual(p65, 65, 0, self.constants_0)
        self.assertAlmostEqual(qpp_65, 18091.80, places=1)

        # Early QPP at age 60: -36% (0.6% * 60 months)
        p60 = PersonProfile(current_age=60, qpp_start_age=60, qpp_monthly_at_65=1507.65)
        qpp_60 = calculate_qpp_annual(p60, 60, 0, self.constants_0)
        expected_60 = 18091.80 * (1.0 - 0.36)
        self.assertAlmostEqual(qpp_60, expected_60, places=1)

        # Deferred QPP at age 70: +42% (0.7% * 60 months)
        p70 = PersonProfile(current_age=70, qpp_start_age=70, qpp_monthly_at_65=1507.65)
        qpp_70 = calculate_qpp_annual(p70, 70, 0, self.constants_0)
        expected_70 = 18091.80 * (1.0 + 0.42)
        self.assertAlmostEqual(qpp_70, expected_70, places=1)

    def test_oas_and_deferral_bonus(self):
        # Base OAS at 65
        p65 = PersonProfile(current_age=65, oas_start_age=65, years_in_canada=40)
        oas_65 = calculate_oas_gross_annual(p65, 65, 0, self.constants_0)
        self.assertAlmostEqual(oas_65, 9041.00, places=1)

        # Age 75+ 10% step-up
        oas_75 = calculate_oas_gross_annual(p65, 75, 0, self.constants_0)
        self.assertAlmostEqual(oas_75, 9041.00 * 1.10, places=1)

        # Partial residency (20/40 years)
        p20 = PersonProfile(current_age=65, oas_start_age=65, years_in_canada=20)
        oas_20 = calculate_oas_gross_annual(p20, 65, 0, self.constants_0)
        self.assertAlmostEqual(oas_20, 9041.00 * 0.50, places=1)

    def test_db_pension_and_bridge_drop(self):
        p_db = PersonProfile(
            retirement_age=60,
            db_pension_annual=40000.0,
            db_bridge_annual=10000.0,
            db_indexation="NONE",
        )
        # Age 62: gets base + bridge
        pen_62 = calculate_db_pension_annual(p_db, 62, 2, self.constants_0)
        self.assertEqual(pen_62, 50000.0)

        # Age 65: bridge drops to $0
        pen_65 = calculate_db_pension_annual(p_db, 65, 5, self.constants_0)
        self.assertEqual(pen_65, 40000.0)

    def test_dual_tax_calculator_quebec_and_federal(self):
        # Single senior age 68 with $75,000 eligible pension income
        tax_res = calculate_individual_tax(
            age=68,
            earned_income=0.0,
            qpp=15000.0,
            oas_gross=9041.0,
            db_pension=50000.0,
            rrif_lif_withdrawals=0.0,
            interest=0.0,
            eligible_dividends=0.0,
            taxable_capital_gains=0.0,
            rrsp_deduction=0.0,
            medical_expenses=0.0,
            has_private_drug_insurance=True,
            family_net_income=74041.0,
            is_autonomous_senior=True,
            is_couple=False,
            home_care_expenses=0.0,
            constants=self.constants_0,
        )
        self.assertGreater(tax_res.net_federal_tax, 0)
        self.assertGreater(tax_res.net_quebec_tax, 0)
        self.assertEqual(tax_res.oas_clawback, 0)  # Income below $95,323 threshold
        # Total tax should be reasonable for ~74k income in QC (~20-25%)
        effective_rate = tax_res.total_tax_and_clawback / tax_res.total_income
        self.assertTrue(0.15 <= effective_rate <= 0.35)

    def test_oas_clawback_calculation(self):
        # Income above OAS clawback threshold ($95,323)
        tax_res = calculate_individual_tax(
            age=68,
            earned_income=120000.0,
            qpp=15000.0,
            oas_gross=9041.0,
            db_pension=0.0,
            rrif_lif_withdrawals=0.0,
            interest=0.0,
            eligible_dividends=0.0,
            taxable_capital_gains=0.0,
            rrsp_deduction=0.0,
            medical_expenses=0.0,
            has_private_drug_insurance=True,
            family_net_income=144041.0,
            is_autonomous_senior=True,
            is_couple=False,
            home_care_expenses=0.0,
            constants=self.constants_0,
        )
        self.assertGreater(tax_res.oas_clawback, 0.0)
        # 15% of (144041 - 95323) = 15% * 48718 = 7307.70
        expected_clawback = min(9041.0, (144041.0 - 95323.0) * 0.15)
        self.assertAlmostEqual(tax_res.oas_clawback, expected_clawback, places=1)

    def test_pension_income_splitting_optimizer(self):
        # Couple where primary has $60k DB pension and spouse has $0
        p_data = {
            "age": 66,
            "earned_income": 0.0,
            "qpp": 12000.0,
            "oas_gross": 9041.0,
            "db_pension": 60000.0,
            "rrif_lif_withdrawals": 0.0,
            "interest": 0.0,
            "eligible_dividends": 0.0,
            "taxable_capital_gains": 0.0,
            "rrsp_deduction": 0.0,
            "medical_expenses": 0.0,
            "has_private_drug_insurance": True,
            "is_autonomous_senior": True,
            "home_care_expenses": 0.0,
        }
        s_data = {
            "age": 64,
            "earned_income": 0.0,
            "qpp": 0.0,
            "oas_gross": 0.0,
            "db_pension": 0.0,
            "rrif_lif_withdrawals": 0.0,
            "interest": 0.0,
            "eligible_dividends": 0.0,
            "taxable_capital_gains": 0.0,
            "rrsp_deduction": 0.0,
            "medical_expenses": 0.0,
            "has_private_drug_insurance": True,
            "is_autonomous_senior": True,
            "home_care_expenses": 0.0,
        }
        best_s, res_p, res_s = optimize_pension_income_splitting(p_data, s_data, self.constants_0)
        # Should split non-zero amount to spouse in lower tax bracket
        self.assertGreater(best_s, 0.0)

    def test_full_retirement_simulation(self):
        params = SimulationParameters(
            household=HouseholdProfile(
                marital_status="SINGLE",
                primary=PersonProfile(
                    current_age=60,
                    retirement_age=65,
                    life_expectancy_age=90,
                    earned_income_current=85000.0,
                    qpp_monthly_at_65=1400.0,
                    qpp_start_age=65,
                    oas_start_age=65,
                    db_pension_annual=25000.0,
                ),
            ),
            accounts=AccountBalances(
                rrsp=300000.0,
                tfsa=80000.0,
                non_reg_market_value=100000.0,
                non_reg_acb=70000.0,
                primary_residence_value=500000.0,
                mortgage_balance=50000.0,
            ),
            spending=SpendingProfile(
                go_go_spending=55000.0,
                slow_go_spending=48000.0,
                no_go_spending=42000.0,
            ),
            strategy=StrategyConfig(
                mode="RRSP_MELTDOWN",
                target_taxable_ceiling_type="BRACKET_2",
            ),
        )

        res = run_retirement_simulation(params, include_comparison=True, include_monte_carlo=True)

        self.assertIn("scorecard", res)
        self.assertIn("cash_flow_series", res)
        self.assertIn("audit_table", res)
        self.assertIn("comparison", res)
        self.assertIn("monte_carlo", res)

        scorecard = res["scorecard"]
        self.assertIn("plan_success", scorecard)
        self.assertIn("net_after_tax_estate", scorecard)

        # Audit table CSV export
        csv_str = export_audit_csv_string(res["audit_table"])
        self.assertTrue(len(csv_str) > 0)
        self.assertIn("year,age_primary", csv_str)

