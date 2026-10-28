from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from core.models import (
    HoldingSnapshot,
    ChequingAccount,
    CreditCardAccount,
    TfsaAccount,
    TfsaContribution,
    Transaction,
)

User = get_user_model()


class FinGlassComprehensiveTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_superuser(username="adminuser", password="adminpassword123")
        self.client.force_login(self.user)

    def test_health_endpoint(self):
        response = self.client.get("/__django__/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "service": "django", "status": "healthy"})

    def test_spa_index_and_routes(self):
        for route in ["/", "/login", "/holdings", "/credit-card", "/chequing", "/tfsa", "/rrsp", "/fhsa", "/acb", "/net-worth", "/import", "/settings"]:
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, '<div id="root">')
            self.assertContains(response, 'app.js')
            self.assertContains(response, 'app.css')

    def test_auth_me_and_setup(self):
        res = self.client.get("/api/auth/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["username"], "adminuser")
        self.assertTrue(res.json()["is_superuser"])

    def test_holdings_api(self):
        # Create holding returns 201 Created
        res = self.client.post(
            "/api/holdings",
            {
                "as_of": "2026-10-28",
                "account_name": "Questrade TFSA",
                "account_type": "TFSA",
                "account_classification": "Registered",
                "symbol": "VFV.TO",
                "security_name": "Vanguard S&P 500 ETF",
                "quantity": 100,
                "book_value_cad": 11000,
                "market_value": 13500,
                "market_price": 135,
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))
        holding_id = res.json()["id"]

        # List holdings
        res = self.client.get("/api/holdings")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(len(res.json()) >= 1)

        # Accounts dashboard
        res = self.client.get("/api/accounts-dashboard")
        self.assertEqual(res.status_code, 200)
        summary = res.json()["summary"]
        self.assertTrue(summary["positions"] >= 1)

        # Delete holding
        res = self.client.delete(f"/api/holdings/{holding_id}")
        self.assertEqual(res.status_code, 200)

    def test_chequing_api(self):
        # Create account
        res = self.client.post(
            "/api/chequing/accounts/create",
            {"label": "WealthSimple Chequing", "provider": "WealthSimple"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        # List accounts
        res = self.client.get("/api/chequing/accounts")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)

        # Chequing dashboard
        res = self.client.get("/api/chequing/dashboard")
        self.assertEqual(res.status_code, 200)

    def test_credit_card_api(self):
        # Create card
        res = self.client.post(
            "/api/credit-card/cards/create",
            {"label": "Rogers World Elite", "provider": "rogers_bank"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        # List cards
        res = self.client.get("/api/credit-card/cards")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)

        # CC Dashboard
        res = self.client.get("/api/credit-card/dashboard")
        self.assertEqual(res.status_code, 200)

    def test_tfsa_summary_and_room(self):
        # Set opening room with PUT
        res = self.client.put(
            "/api/tfsa/opening-balance",
            {"opening_balance": 35000, "base_year": 2024},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        # Create account
        acc_res = self.client.post(
            "/api/tfsa/accounts",
            {"account_name": "Tangerine TFSA", "account_number": "TANG-1"},
            content_type="application/json",
        )
        self.assertIn(acc_res.status_code, (200, 201))
        acc_id = acc_res.json()["id"]

        # Add contribution
        res = self.client.post(
            "/api/tfsa/contributions",
            {
                "tfsa_account_id": acc_id,
                "contribution_date": "2024-05-15",
                "amount": 5000,
                "contribution_type": "Deposit",
                "memo": "Savings",
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))

        # Check summary
        res = self.client.get("/api/tfsa/summary")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["opening_balance_configured"])

    def test_acb_ledger_and_trades(self):
        # Create Buy trade
        res = self.client.post(
            "/api/transactions",
            {
                "security": "XEQT.TO",
                "trade_date": "2024-01-10",
                "transaction_type": "Buy",
                "shares": 100,
                "amount": 2500,
                "commission": 0,
                "memo": "Initial Buy",
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))

        # Create Sell trade
        res = self.client.post(
            "/api/transactions",
            {
                "security": "XEQT.TO",
                "trade_date": "2024-06-15",
                "transaction_type": "Sell",
                "shares": 50,
                "amount": 1500,
                "commission": 5,
                "memo": "Partial Sell",
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))

        # Ledger check returns a list of rows
        res = self.client.get("/api/ledger?security=XEQT.TO")
        self.assertEqual(res.status_code, 200)
        ledger = res.json()
        self.assertEqual(len(ledger), 2)
        last_row = ledger[-1]
        self.assertEqual(last_row["share_balance"], 50)
        self.assertAlmostEqual(last_row["capital_gain"], 245.0)
