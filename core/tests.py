from django.test import TestCase, TransactionTestCase, Client
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

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
        for route in ["/", "/login", "/holdings", "/credit-card", "/chequing", "/tfsa", "/rrsp", "/fhsa", "/acb", "/net-worth", "/import", "/retirement", "/settings"]:
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

    def test_wealthsimple_import_review(self):
        ws_csv = (
            "date,activity_type,activity_sub_type,symbol,quantity,net_cash_amount,commission\n"
            "2026-03-15,Trade,BUY,XEQT.TO,100,3000.00,0.00\n"
            "2026-06-20,Trade,SELL,XEQT.TO,50,1650.00,0.00\n"
        ).encode("utf-8")
        uploaded = SimpleUploadedFile("wealthsimple_activities.csv", ws_csv, content_type="text/csv")
        res = self.client.post("/api/import/review", {"file": uploaded, "import_type": "activities_csv"})
        self.assertEqual(res.status_code, 201)
        batch = res.json()
        self.assertEqual(len(batch.get("rows", [])), 2)
        batch_id = batch["batch_id"]

        commit_res = self.client.post("/api/import/review/commit", {"batch_id": batch_id}, content_type="application/json")
        self.assertEqual(commit_res.status_code, 200)
        self.assertEqual(commit_res.json()["committed_rows"], 2)

    def test_market_data_quote_endpoint(self):
        res = self.client.get("/api/market-data/quote")
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.json())

        res = self.client.get("/api/market-data/quote?symbol=AAPL")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["symbol"], "AAPL")
        self.assertGreater(data["price"], 0)
        self.assertIn("currency", data)

    def test_retirement_endpoints(self):
        # 1. Config endpoint
        res = self.client.get("/api/retirement/config")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["base_tax_year"], 2026)

        # 2. Plan get / put
        res = self.client.get("/api/retirement/plan")
        self.assertEqual(res.status_code, 200)
        self.assertIn("plan_data", res.json())

        plan_update = {
            "name": "My Quebec Plan",
            "plan_data": {
                "household": {
                    "marital_status": "SINGLE",
                    "primary": {
                        "current_age": 62,
                        "retirement_age": 65,
                        "life_expectancy_age": 92,
                    },
                },
                "spending": {
                    "go_go_spending": 60000,
                },
            },
        }
        res = self.client.put("/api/retirement/plan", plan_update, content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "My Quebec Plan")

        # 3. Simulate endpoint
        sim_res = self.client.post("/api/retirement/simulate", plan_update, content_type="application/json")
        self.assertEqual(sim_res.status_code, 200)
        sim_data = sim_res.json()
        self.assertIn("scorecard", sim_data)
        self.assertIn("cash_flow_series", sim_data)
        self.assertIn("audit_table", sim_data)
        self.assertIn("monte_carlo", sim_data)
        self.assertIn("comparison", sim_data)

        # 4. Export CSV endpoint
        csv_res = self.client.post("/api/retirement/export-csv", plan_update, content_type="application/json")
        self.assertEqual(csv_res.status_code, 200)
        self.assertEqual(csv_res.headers.get("Content-Type"), "text/csv")
        self.assertContains(csv_res, "year,age_primary")

    def test_rrsp_full_workflow(self):
        # 1. Set opening balance
        res = self.client.put(
            "/api/rrsp/opening-balance",
            {"opening_balance": 45000, "base_year": 2024},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        # 2. Create account
        acc_res = self.client.post(
            "/api/rrsp/accounts",
            {"account_name": "Questrade RRSP", "account_number": "Q-RRSP-1"},
            content_type="application/json",
        )
        self.assertIn(acc_res.status_code, (200, 201))
        acc_id = acc_res.json()["id"]

        # 3. Add contribution
        res = self.client.post(
            "/api/rrsp/contributions",
            {
                "rrsp_account_id": acc_id,
                "contribution_date": "2024-03-01",
                "amount": 10000,
                "contribution_type": "Deposit",
                "memo": "Annual RRSP deduction",
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))

        # 4. Check summary
        res = self.client.get("/api/rrsp/summary")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["opening_balance_configured"])

        # 5. Reset
        reset_res = self.client.post("/api/rrsp/reset")
        self.assertEqual(reset_res.status_code, 200)

    def test_fhsa_full_workflow(self):
        # 1. Set opening balance
        res = self.client.put(
            "/api/fhsa/opening-balance",
            {"opening_balance": 8000, "base_year": 2024},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        # 2. Create account
        acc_res = self.client.post(
            "/api/fhsa/accounts",
            {"account_name": "EQ Bank FHSA", "account_number": "EQ-FHSA-1"},
            content_type="application/json",
        )
        self.assertIn(acc_res.status_code, (200, 201))
        acc_id = acc_res.json()["id"]

        # 3. Add contribution
        res = self.client.post(
            "/api/fhsa/contributions",
            {
                "fhsa_account_id": acc_id,
                "contribution_date": "2024-04-10",
                "amount": 8000,
                "contribution_type": "Deposit",
                "memo": "First Year Max",
            },
            content_type="application/json",
        )
        self.assertIn(res.status_code, (200, 201))

        # 4. Check summary
        res = self.client.get("/api/fhsa/summary")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["opening_balance_configured"])

        # 5. Reset
        reset_res = self.client.post("/api/fhsa/reset")
        self.assertEqual(reset_res.status_code, 200)

    def test_net_worth_api(self):
        # Create record
        create_res = self.client.post(
            "/api/net-worth",
            {
                "entry_date": "2024-12-31",
                "amount": 350000,
                "note": "Year end",
            },
            content_type="application/json",
        )
        self.assertIn(create_res.status_code, (200, 201))
        record_id = create_res.json()["id"]

        # List records
        list_res = self.client.get("/api/net-worth")
        self.assertEqual(list_res.status_code, 200)
        self.assertTrue(len(list_res.json()) >= 1)

        # Update record
        update_res = self.client.put(
            f"/api/net-worth/{record_id}",
            {
                "entry_date": "2024-12-31",
                "amount": 380000,
                "note": "Updated",
            },
            content_type="application/json",
        )
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.json()["amount"], 380000.0)

        # Delete record
        del_res = self.client.delete(f"/api/net-worth/{record_id}")
        self.assertEqual(del_res.status_code, 200)

    def test_settings_features_api(self):
        res = self.client.get("/api/settings/features")
        self.assertEqual(res.status_code, 200)
        features = res.json()["features"]
        self.assertIn("retirement_planner", features)

        # Update settings
        features["retirement_planner"] = False
        put_res = self.client.put(
            "/api/settings/features",
            {"features": features},
            content_type="application/json",
        )
        self.assertEqual(put_res.status_code, 200)
        self.assertFalse(put_res.json()["features"]["retirement_planner"])

        # Restore
        features["retirement_planner"] = True
        self.client.put(
            "/api/settings/features",
            {"features": features},
            content_type="application/json",
        )

    def test_banking_transactions_advanced(self):
        from core.models import ChequingTransaction, CreditCardTransaction

        # Create chequing transactions
        t1 = ChequingTransaction.objects.create(
            user=self.user,
            account_label="Main Account",
            transaction_date="2024-05-01",
            description="Grocery Store",
            amount=-120.50,
            category="Groceries",
        )
        t2 = ChequingTransaction.objects.create(
            user=self.user,
            account_label="Main Account",
            transaction_date="2024-05-02",
            description="Coffee Shop",
            amount=-5.75,
            category="Dining Out",
        )

        # Recategorize chequing transactions
        recat_res = self.client.post("/api/chequing/transactions/recategorize")
        self.assertEqual(recat_res.status_code, 200)
        self.assertEqual(recat_res.json()["scanned"], 2)

        # Hide single transaction
        hide_res = self.client.patch(
            f"/api/chequing/transactions/{t1.id}/hidden",
            {"hidden": True},
            content_type="application/json",
        )
        self.assertEqual(hide_res.status_code, 200)
        t1.refresh_from_db()
        self.assertTrue(t1.is_hidden)

        # Delete many chequing transactions
        del_res = self.client.post(
            "/api/chequing/transactions/delete-many",
            {"ids": [t1.id, t2.id]},
            content_type="application/json",
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["deleted"], 2)

        # Create credit card transaction
        c1 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="scotiabank",
            card_label="Visa Card",
            transaction_date="2024-05-05",
            merchant_name="Gas Station",
            amount=65.00,
            merchant_category="Transportation",
        )
        # CC hide
        cc_hide_res = self.client.patch(
            f"/api/credit-card/transactions/{c1.id}/hidden",
            {"hidden": True},
            content_type="application/json",
        )
        self.assertEqual(cc_hide_res.status_code, 200)
        c1.refresh_from_db()
        self.assertTrue(c1.is_hidden)

        # CC delete many
        cc_del_res = self.client.post(
            "/api/credit-card/transactions/delete-many",
            {"ids": [c1.id]},
            content_type="application/json",
        )
        self.assertEqual(cc_del_res.status_code, 200)
        self.assertEqual(cc_del_res.json()["deleted"], 1)

    def test_acb_advanced_edge_cases(self):
        from core.services.acb_service import calculate_ledger_rows

        # 1. Buy 100 shares @ $10 ($1000)
        # 2. Return of Capital (ROC) of $150 -> reduces ACB to $850
        # 3. Capital Gains Dividend of $50 -> increases ACB to $900
        # 4. Partial Sell of 50 shares @ $15 ($750) -> capital gain = 750 - (900/100 * 50) = 750 - 450 = $300, remaining ACB = $450
        # 5. ROC of $500 on $450 ACB -> ACB drops below 0 -> triggers $50 capital gain and resets ACB to $0
        raw_trades = [
            {"id": 1, "security": "XEQT.TO", "memo": "", "source": "", "trade_date": "2024-01-01", "transaction_type": "Buy", "shares": 100, "amount": 1000.0, "commission": 0.0},
            {"id": 2, "security": "XEQT.TO", "memo": "", "source": "", "trade_date": "2024-04-01", "transaction_type": "Return of Capital", "shares": 0, "amount": 150.0, "commission": 0.0},
            {"id": 3, "security": "XEQT.TO", "memo": "", "source": "", "trade_date": "2024-07-01", "transaction_type": "Capital Gains Dividend", "shares": 0, "amount": 50.0, "commission": 0.0},
            {"id": 4, "security": "XEQT.TO", "memo": "", "source": "", "trade_date": "2024-09-01", "transaction_type": "Sell", "shares": 50, "amount": 750.0, "commission": 0.0},
            {"id": 5, "security": "XEQT.TO", "memo": "", "source": "", "trade_date": "2024-11-01", "transaction_type": "Return of Capital", "shares": 0, "amount": 500.0, "commission": 0.0},
        ]
        rows = calculate_ledger_rows(raw_trades)
        self.assertEqual(len(rows), 5)
        # After ROC
        self.assertEqual(rows[1]["acb"], 850.0)
        # After Capital Gains Dividend
        self.assertEqual(rows[2]["acb"], 900.0)
        # After Sell: capital gain is 300, ACB is 450
        self.assertEqual(rows[3]["capital_gain"], 300.0)
        self.assertEqual(rows[3]["acb"], 450.0)
        # After negative ACB ROC: extra 50 is capital gain, ACB resets to 0
        self.assertEqual(rows[4]["capital_gain"], 50.0)
        self.assertEqual(rows[4]["acb"], 0.0)



class DatabaseBackupTests(TransactionTestCase):
    def test_admin_database_export_and_restore(self):
        client = Client()
        user = User.objects.create_superuser(username="adminuser2", password="adminpassword123")

        # 1. Non-admin gets 403
        non_admin = User.objects.create_user(username="standarduser2", password="standardpassword123")
        client.force_login(non_admin)
        res = client.get("/api/auth/admin/database")
        self.assertEqual(res.status_code, 403)

        # 2. Superadmin can export database
        client.force_login(user)
        export_res = client.get("/api/auth/admin/database")
        self.assertEqual(export_res.status_code, 200)
        self.assertEqual(export_res.headers.get("Content-Type"), "application/vnd.sqlite3")
        db_content = b"".join(export_res.streaming_content)
        self.assertTrue(len(db_content) > 0)

        # 3. Restoring corrupt file fails validation
        corrupt_file = SimpleUploadedFile("corrupt.sqlite3", b"not-a-valid-sqlite-db")
        res = client.post("/api/auth/admin/database", {"file": corrupt_file})
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.json())

        # 4. Restoring valid exported snapshot succeeds
        valid_file = SimpleUploadedFile("backup.sqlite3", db_content)
        res = client.post("/api/auth/admin/database", {"file": valid_file})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("ok"))

