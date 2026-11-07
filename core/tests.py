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

    def test_credit_card_single_transaction_edit(self):
        from core.models import CreditCardTransaction, CreditCardAccount
        tx = CreditCardTransaction.objects.create(
            user=self.user,
            provider="rogers_bank",
            card_label="Rogers Mastercard",
            transaction_date="2024-06-01",
            merchant_name="Unknown Store",
            amount=50.25,
            merchant_category="Other",
            is_hidden=False,
        )

        # 1. Update all editable fields via PUT
        update_res = self.client.put(
            f"/api/credit-card/transactions/{tx.id}",
            {
                "merchant_name": "Costco Wholesale",
                "amount": 142.85,
                "card_label": "New Premium Card",
                "transaction_date": "2024-06-15",
                "merchant_category": "Groceries",
                "is_hidden": True,
            },
            content_type="application/json",
        )
        self.assertEqual(update_res.status_code, 200)
        data = update_res.json()
        self.assertEqual(data["updated"], 1)
        self.assertEqual(data["transaction"]["merchant_name"], "Costco Wholesale")
        self.assertEqual(data["transaction"]["amount"], 142.85)
        self.assertEqual(data["transaction"]["card_label"], "New Premium Card")
        self.assertEqual(data["transaction"]["transaction_date"], "2024-06-15")
        self.assertEqual(data["transaction"]["merchant_category"], "Groceries")
        self.assertTrue(data["transaction"]["is_hidden"])

        tx.refresh_from_db()
        self.assertEqual(tx.merchant_name, "Costco Wholesale")
        self.assertEqual(float(tx.amount), 142.85)
        self.assertEqual(tx.card_label, "New Premium Card")
        self.assertEqual(tx.transaction_date.isoformat(), "2024-06-15")
        self.assertEqual(tx.merchant_category, "Groceries")
        self.assertTrue(tx.is_hidden)

        # Check account was auto-created for the new card label
        self.assertTrue(CreditCardAccount.objects.filter(user=self.user, label="New Premium Card").exists())

        # 2. Validation error cases
        # Invalid amount
        bad_amt_res = self.client.put(
            f"/api/credit-card/transactions/{tx.id}",
            {"amount": "not-a-number"},
            content_type="application/json",
        )
        self.assertEqual(bad_amt_res.status_code, 400)

        # Invalid date
        bad_date_res = self.client.put(
            f"/api/credit-card/transactions/{tx.id}",
            {"transaction_date": "15/06/2024"},
            content_type="application/json",
        )
        self.assertEqual(bad_date_res.status_code, 400)

        # Empty merchant name
        bad_name_res = self.client.put(
            f"/api/credit-card/transactions/{tx.id}",
            {"merchant_name": "   "},
            content_type="application/json",
        )
        self.assertEqual(bad_name_res.status_code, 400)

        # Non-existent transaction
        not_found_res = self.client.put(
            "/api/credit-card/transactions/999999",
            {"merchant_name": "Ghost Store"},
            content_type="application/json",
        )
        self.assertEqual(not_found_res.status_code, 404)

    def test_credit_card_batch_transactions_edit(self):
        from core.models import CreditCardTransaction, CreditCardAccount
        t1 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="scotiabank",
            card_label="Scotia Momentum",
            transaction_date="2024-07-01",
            merchant_name="Fast Food 1",
            amount=15.00,
            merchant_category="Restaurants",
            is_hidden=False,
        )
        t2 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="scotiabank",
            card_label="Scotia Momentum",
            transaction_date="2024-07-02",
            merchant_name="Fast Food 2",
            amount=22.50,
            merchant_category="Restaurants",
            is_hidden=False,
        )

        # Batch update: change card_label, merchant_name, merchant_category, is_hidden
        batch_res = self.client.post(
            "/api/credit-card/transactions/update-many",
            {
                "ids": [t1.id, t2.id],
                "card_label": "Shared Visa",
                "merchant_category": "Dining Out",
                "merchant_name": "Unified Diner",
                "is_hidden": True,
            },
            content_type="application/json",
        )
        self.assertEqual(batch_res.status_code, 200)
        self.assertEqual(batch_res.json()["updated"], 2)

        t1.refresh_from_db()
        t2.refresh_from_db()
        self.assertEqual(t1.card_label, "Shared Visa")
        self.assertEqual(t2.card_label, "Shared Visa")
        self.assertEqual(t1.merchant_name, "Unified Diner")
        self.assertEqual(t2.merchant_name, "Unified Diner")
        self.assertEqual(t1.merchant_category, "Dining Out")
        self.assertEqual(t2.merchant_category, "Dining Out")
        self.assertTrue(t1.is_hidden)
        self.assertTrue(t2.is_hidden)
        self.assertTrue(CreditCardAccount.objects.filter(user=self.user, label="Shared Visa").exists())

        # Targeted bulk recategorize
        re_res = self.client.post(
            "/api/credit-card/transactions/recategorize",
            {"ids": [t1.id], "merchant_category": "Fast Food"},
            content_type="application/json",
        )
        self.assertEqual(re_res.status_code, 200)
        self.assertEqual(re_res.json()["updated"], 1)
        t1.refresh_from_db()
        self.assertEqual(t1.merchant_category, "Fast Food")

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

    def test_multi_document_upload_and_deduplication_review(self):
        csv_1 = (
            "date,activity_type,activity_sub_type,symbol,quantity,net_cash_amount,commission\n"
            "2026-01-10,Trade,BUY,XEQT.TO,100,3000.00,0.00\n"
            "2026-03-15,Trade,BUY,VDY.TO,50,2000.00,0.00\n"
        ).encode("utf-8")
        csv_2 = (
            "date,activity_type,activity_sub_type,symbol,quantity,net_cash_amount,commission\n"
            "2026-01-10,Trade,BUY,XEQT.TO,100,3000.00,0.00\n"
            "2026-05-20,Trade,BUY,MSFT,10,4000.00,0.00\n"
        ).encode("utf-8")
        file1 = SimpleUploadedFile("statement_a.csv", csv_1, content_type="text/csv")
        file2 = SimpleUploadedFile("statement_b.csv", csv_2, content_type="text/csv")

        # Upload both documents at once
        res = self.client.post("/api/import/review", {"file": [file1, file2], "import_type": "activities_csv"})
        self.assertEqual(res.status_code, 201)
        batch = res.json()
        self.assertEqual(batch["files_count"], 2)
        self.assertEqual(batch["parsed"], 4)
        self.assertEqual(batch["new_rows"], 3)
        self.assertEqual(batch["duplicate_in_upload"], 1)

        # Check rows annotation
        rows = batch["rows"]
        dup_rows = [r for r in rows if r["is_duplicate"]]
        self.assertEqual(len(dup_rows), 1)
        self.assertEqual(dup_rows[0]["security"], "XEQT.TO")
        self.assertEqual(dup_rows[0]["duplicate_reason"], "duplicate_in_upload")

        # Commit batch
        commit_res = self.client.post("/api/import/review/commit", {"batch_id": batch["batch_id"]}, content_type="application/json")
        self.assertEqual(commit_res.status_code, 200)
        self.assertEqual(commit_res.json()["committed_rows"], 3)
        self.assertEqual(commit_res.json()["skipped_duplicates"], 1)

        from core.models import Transaction
        self.assertEqual(Transaction.objects.filter(security="XEQT.TO", user=self.user).count(), 1)
        self.assertEqual(Transaction.objects.filter(security="VDY.TO", user=self.user).count(), 1)
        self.assertEqual(Transaction.objects.filter(security="MSFT", user=self.user).count(), 1)

    def test_document_uploaded_twice_different_names_deduplicated(self):
        doc_content = (
            "date,activity_type,activity_sub_type,symbol,quantity,net_cash_amount,commission\n"
            "2026-02-01,Trade,BUY,TD.TO,20,1600.00,0.00\n"
            "2026-02-15,Trade,BUY,BMO.TO,10,1200.00,0.00\n"
        ).encode("utf-8")

        # 1. Upload first time with original name
        file1 = SimpleUploadedFile("original_export.csv", doc_content, content_type="text/csv")
        res1 = self.client.post("/api/import/review", {"file": file1, "import_type": "activities_csv"})
        self.assertEqual(res1.status_code, 201)
        batch1 = res1.json()
        self.assertEqual(batch1["new_rows"], 2)
        self.assertEqual(batch1["already_in_ledger"], 0)

        # Commit first batch
        commit1 = self.client.post("/api/import/review/commit", {"batch_id": batch1["batch_id"]}, content_type="application/json")
        self.assertEqual(commit1.status_code, 200)
        self.assertEqual(commit1.json()["committed_rows"], 2)

        from core.models import Transaction
        self.assertEqual(Transaction.objects.filter(security="TD.TO", user=self.user).count(), 1)
        self.assertEqual(Transaction.objects.filter(security="BMO.TO", user=self.user).count(), 1)

        # 2. Upload identical document a second time with a different name
        file2 = SimpleUploadedFile("completely_different_name.csv", doc_content, content_type="text/csv")
        res2 = self.client.post("/api/import/review", {"file": file2, "import_type": "activities_csv"})
        self.assertEqual(res2.status_code, 201)
        batch2 = res2.json()
        self.assertEqual(batch2["new_rows"], 0)
        self.assertEqual(batch2["already_in_ledger"], 2)
        for r in batch2["rows"]:
            self.assertTrue(r["is_duplicate"])
            self.assertEqual(r["duplicate_reason"], "already_in_ledger")

        # Commit second batch: should commit 0 rows, skipping duplicates
        commit2 = self.client.post("/api/import/review/commit", {"batch_id": batch2["batch_id"]}, content_type="application/json")
        self.assertEqual(commit2.status_code, 200)
        self.assertEqual(commit2.json()["committed_rows"], 0)
        self.assertEqual(commit2.json()["skipped_duplicates"], 2)

        # Confirm ledger still only has 1 of each transaction, not duplicated!
        self.assertEqual(Transaction.objects.filter(security="TD.TO", user=self.user).count(), 1)
        self.assertEqual(Transaction.objects.filter(security="BMO.TO", user=self.user).count(), 1)

    def test_credit_card_multi_upload_and_deduplication(self):
        cc_csv = (
            "Transaction Date,Posted Date,Merchant Name,Amount\n"
            "2026-04-01,2026-04-02,Starbucks Coffee,-6.50\n"
            "2026-04-03,2026-04-04,Metro Grocery,-85.20\n"
        ).encode("utf-8")
        file1 = SimpleUploadedFile("scotia_apr_1.csv", cc_csv, content_type="text/csv")
        file2 = SimpleUploadedFile("scotia_apr_duplicate.csv", cc_csv, content_type="text/csv")

        # Upload both at once
        res = self.client.post(
            "/api/import/credit-card/scotiabank-csv",
            {"file": [file1, file2], "provider": "scotiabank", "card_label": "Scotia Passport"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["parsed"], 4)
        self.assertEqual(data["inserted"], 2)
        self.assertEqual(data["skipped"], 2)
        self.assertEqual(data["files"], 2)

        from core.models import CreditCardTransaction
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Starbucks Coffee", user=self.user).count(), 1)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Metro Grocery", user=self.user).count(), 1)

        # Upload a second time with another different filename using alias route
        file3 = SimpleUploadedFile("renamed_again.csv", cc_csv, content_type="text/csv")
        res2 = self.client.post(
            "/api/import/rogers-credit-csv",
            {"file": file3, "provider": "scotiabank", "card_label": "Scotia Passport"},
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["parsed"], 2)
        self.assertEqual(data2["inserted"], 0)
        self.assertEqual(data2["skipped"], 2)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Starbucks Coffee", user=self.user).count(), 1)

        # Upload without specifying provider (auto-detection test)
        scotia_csv2 = (
            "date,posted date,description,amount\n"
            "2026-05-10,2026-05-11,Auto Scotia Store,-45.50\n"
        ).encode("utf-8")
        file_auto_scotia = SimpleUploadedFile("scotia_no_provider.csv", scotia_csv2, content_type="text/csv")
        res3 = self.client.post(
            "/api/import/rogers-credit-csv",
            {"file": file_auto_scotia},
        )
        self.assertEqual(res3.status_code, 200)
        self.assertEqual(res3.json()["inserted"], 1)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Auto Scotia Store", user=self.user).count(), 1)

        # Upload Rogers format CSV with provider="auto"
        rogers_csv = (
            "Date,Posted Date,Reference Number,Activity Type,Status,Transaction Card Number,Merchant Category,Merchant Name,Merchant City,Merchant State/Province,Merchant Country,Merchant Postal Code/Zip,Amount,Rewards,Name on Card\n"
            "2026-06-01,2026-06-02,REF1234,Purchase,Posted,1234,Grocery,Rogers Corner Shop,Toronto,ON,CAN,M1M1M1,25.00,0.50,John Doe\n"
        ).encode("utf-8")
        file_rogers = SimpleUploadedFile("rogers_statement.csv", rogers_csv, content_type="text/csv")
        res4 = self.client.post(
            "/api/import/rogers-credit-csv",
            {"file": file_rogers, "provider": "auto"},
        )
        self.assertEqual(res4.status_code, 200)
        self.assertEqual(res4.json()["inserted"], 1)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Rogers Corner Shop", user=self.user).count(), 1)

    def test_chequing_multi_upload_and_deduplication(self):
        cheq_csv = (
            "date,transaction,description,amount,balance\n"
            "2026-03-01,DEP,Payroll Employer Inc,3500.00,5000.00\n"
            "2026-03-05,WD,Landlord Rent Transfer,-1800.00,3200.00\n"
        ).encode("utf-8")
        file1 = SimpleUploadedFile("chequing_mar_1.csv", cheq_csv, content_type="text/csv")
        file2 = SimpleUploadedFile("chequing_mar_copy.csv", cheq_csv, content_type="text/csv")

        # Upload both at once
        res = self.client.post(
            "/api/import/chequing/courant-csv",
            {"file": [file1, file2], "account_label": "WS Chequing"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["parsed"], 4)
        self.assertEqual(data["inserted"], 2)
        self.assertEqual(data["skipped"], 2)
        self.assertEqual(data["files"], 2)

        from core.models import ChequingTransaction
        self.assertEqual(ChequingTransaction.objects.filter(description="Payroll Employer Inc", user=self.user).count(), 1)
        self.assertEqual(ChequingTransaction.objects.filter(description="Landlord Rent Transfer", user=self.user).count(), 1)

        # Upload a second time with different name using alias route
        file3 = SimpleUploadedFile("chequing_renamed.csv", cheq_csv, content_type="text/csv")
        res2 = self.client.post(
            "/api/import/chequing-courant-csv",
            {"file": file3, "account_label": "WS Chequing"},
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["parsed"], 2)
        self.assertEqual(data2["inserted"], 0)
        self.assertEqual(data2["skipped"], 2)
        self.assertEqual(ChequingTransaction.objects.filter(description="Payroll Employer Inc", user=self.user).count(), 1)

    def test_holdings_multi_upload(self):
        holdings_csv_1 = (
            "as_of,account_name,account_number,symbol,quantity,book_value_cad,market_value,market_price\n"
            "2026-05-01,WS TFSA,WS-1,VFV.TO,100,10000,12000,120\n"
        ).encode("utf-8")
        holdings_csv_2 = (
            "as_of,account_name,account_number,symbol,quantity,book_value_cad,market_value,market_price\n"
            "2026-05-01,WS RRSP,WS-2,XEQT.TO,200,5000,6000,30\n"
        ).encode("utf-8")
        f1 = SimpleUploadedFile("holdings_tfsa.csv", holdings_csv_1, content_type="text/csv")
        f2 = SimpleUploadedFile("holdings_rrsp.csv", holdings_csv_2, content_type="text/csv")

        res = self.client.post("/api/import/holdings-csv", {"file": [f1, f2]})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["files"], 2)
        self.assertEqual(data["parsed"], 2)
        self.assertEqual(data["imported"], 2)

        from core.models import HoldingSnapshot
        self.assertEqual(HoldingSnapshot.objects.filter(symbol="VFV.TO", user=self.user).count(), 1)
        self.assertEqual(HoldingSnapshot.objects.filter(symbol="XEQT.TO", user=self.user).count(), 1)



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

