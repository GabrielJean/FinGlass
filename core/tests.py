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

        # Create second account for rename / merge test
        res = self.client.post(
            "/api/chequing/accounts/create",
            {"label": "Courant", "provider": "WealthSimple"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)

        from core.models import ChequingTransaction
        t = ChequingTransaction.objects.create(
            user=self.user,
            account_label="Courant",
            transaction_date="2024-05-01",
            description="Sample Coffee",
            amount=-5.00,
            category="Dining Out",
        )

        # Merge Courant into WealthSimple Chequing
        merge_res = self.client.post(
            "/api/chequing/accounts/Courant/rename",
            {"new_label": "WealthSimple Chequing"},
            content_type="application/json",
        )
        self.assertEqual(merge_res.status_code, 200)
        self.assertTrue(merge_res.json().get("merged"))
        t.refresh_from_db()
        self.assertEqual(t.account_label, "WealthSimple Chequing")

        # Delete WealthSimple Chequing account
        del_res = self.client.delete("/api/chequing/accounts/WealthSimple%20Chequing")
        self.assertEqual(del_res.status_code, 200)
        self.assertFalse(ChequingTransaction.objects.filter(id=t.id).exists())

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

        # Delete many chequing transactions (supports both ids and transaction_ids)
        t3 = ChequingTransaction.objects.create(
            user=self.user,
            account_label="Main Account",
            transaction_date="2024-05-03",
            description="Book Store",
            amount=-25.00,
            category="Shopping",
        )
        del_res = self.client.post(
            "/api/chequing/transactions/delete-many",
            {"transaction_ids": [t1.id, t2.id, t3.id]},
            content_type="application/json",
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["deleted"], 3)

        # Create credit card transaction
        c1 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="wealthsimple",
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
            provider="wealthsimple",
            card_label="WS Cash",
            transaction_date="2024-07-01",
            merchant_name="Fast Food 1",
            amount=15.00,
            merchant_category="Restaurants",
            is_hidden=False,
        )
        t2 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="wealthsimple",
            card_label="WS Cash",
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

    def test_credit_card_admin_edit_card_label_action(self):
        from core.models import CreditCardTransaction

        tx1 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="wealthsimple",
            card_label="Old Label 1",
            transaction_date="2024-05-10",
            merchant_name="Sample Cafe",
            amount=12.50,
        )
        tx2 = CreditCardTransaction.objects.create(
            user=self.user,
            provider="wealthsimple",
            card_label="Old Label 2",
            transaction_date="2024-05-11",
            merchant_name="Grocery Store",
            amount=45.00,
        )

        admin_url = "/admin/core/creditcardtransaction/"

        # 1. Action intermediate page shows selected count and existing labels
        res_intermediate = self.client.post(
            admin_url,
            {
                "action": "edit_card_label",
                "_selected_action": [tx1.id, tx2.id],
            },
        )
        self.assertEqual(res_intermediate.status_code, 200)
        self.assertContains(res_intermediate, "Edit Credit Card Label")
        self.assertContains(res_intermediate, "You have selected <strong>2</strong> transactions")

        # 2. Applying new card label updates all selected transactions
        res_apply = self.client.post(
            admin_url,
            {
                "action": "edit_card_label",
                "_selected_action": [tx1.id, tx2.id],
                "apply": "1",
                "card_label": "Synthetic Gold Visa",
            },
        )
        self.assertEqual(res_apply.status_code, 302)
        tx1.refresh_from_db()
        tx2.refresh_from_db()
        self.assertEqual(tx1.card_label, "Synthetic Gold Visa")
        self.assertEqual(tx2.card_label, "Synthetic Gold Visa")

        # 3. Applying clear_label sets card_label to None
        res_clear = self.client.post(
            admin_url,
            {
                "action": "edit_card_label",
                "_selected_action": [tx1.id, tx2.id],
                "apply": "1",
                "clear_label": "1",
            },
        )
        self.assertEqual(res_clear.status_code, 302)
        tx1.refresh_from_db()
        tx2.refresh_from_db()
        self.assertIsNone(tx1.card_label)
        self.assertIsNone(tx2.card_label)

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
        ws_custom_csv = (
            "transaction_date,transaction_type,status,merchant,amount,currency,notes,category\n"
            "11/06/2026,Purchase,Completed,Starbucks Coffee,-6.50,CAD,,Coffee\n"
            "11/06/2026,Purchase,Completed,Metro Grocery,-85.20,CAD,,Groceries\n"
        ).encode("utf-8")
        file1 = SimpleUploadedFile("ws_custom_1.csv", ws_custom_csv, content_type="text/csv")
        file2 = SimpleUploadedFile("ws_custom_dup.csv", ws_custom_csv, content_type="text/csv")

        # Upload both at once
        res = self.client.post(
            "/api/import/credit-card/wealthsimple-csv",
            {"file": [file1, file2], "provider": "wealthsimple", "card_label": "WS Cash"},
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
        file3 = SimpleUploadedFile("renamed_again.csv", ws_custom_csv, content_type="text/csv")
        res2 = self.client.post(
            "/api/import/rogers-credit-csv",
            {"file": file3, "provider": "wealthsimple", "card_label": "WS Cash"},
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["parsed"], 2)
        self.assertEqual(data2["inserted"], 0)
        self.assertEqual(data2["skipped"], 2)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Starbucks Coffee", user=self.user).count(), 1)

        # Upload Wealthsimple statement format without specifying provider (auto-detection test)
        ws_statement_csv = (
            "transaction_date,post_date,type,details,amount,currency\n"
            "10/20/2026,10/20/2026,Purchase,Auto WS Store,45.50,CAD\n"
        ).encode("utf-8")
        file_auto_ws = SimpleUploadedFile("ws_statement_no_provider.csv", ws_statement_csv, content_type="text/csv")
        res3 = self.client.post(
            "/api/import/rogers-credit-csv",
            {"file": file_auto_ws},
        )
        self.assertEqual(res3.status_code, 200)
        self.assertEqual(res3.json()["inserted"], 1)
        self.assertEqual(CreditCardTransaction.objects.filter(merchant_name="Auto WS Store", user=self.user).count(), 1)

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

    def test_wealthsimple_chequing_custom_activity_import_and_deduplication(self):
        ws_cheq_csv = (
            "transaction_date,transaction_time,account_number,account_type,transaction_type,transaction_sub_type,status,payee,payee_email,amount,currency,notes\n"
            "4/12/2026,10:00:00,10000001,Chequing,Withdrawal,E Transfer,Completed,Jane Doe,jane.doe@example.com,-150,CAD,\n"
            "4/17/2026,11:30:00,10000001,Chequing,Withdrawal,Aft,Completed,Car Finance Corp,,-250.00,CAD,\n"
            "4/17/2026,12:45:00,10000001,Chequing,P 2 P Payment,Send Received,Completed,,,30.00,CAD,\n"
            "4/18/2026,14:15:00,10000001,Chequing,Deposit,E Transfer,Completed,John Smith,john.smith@example.com,75,CAD,\n"
            "4/21/2026,09:00:00,10000001,Chequing,Deposit,Aft,Completed,CANADA,,2500.00,CAD,\n"
            "4/24/2026,09:30:00,10000001,Chequing,P 2 P Payment,Send,Completed,,,-10.00,CAD,\n"
            "4/27/2026,10:00:00,10000001,Chequing,Withdrawal,Bill Pay,Completed,City Transport,,-120.00,CAD,\n"
            "5/1/2026,00:00:00,10000001,Chequing,Interest,,Completed,,,5.00,CAD,\n"
            "5/5/2026,10:00:00,10000001,Chequing,Internal Transfer,Source,Completed,,,-1000,CAD,\n"
            "6/12/2026,12:00:00,10000001,Chequing,Spend,Prepaid,Completed,,,-25.00,CAD,\n"
            "6/13/2026,09:00:00,10000001,Chequing,Reimbursement,Atm,Completed,,,3.50,CAD,\n"
            "6/25/2026,16:00:00,10000001,Chequing,Promotion,Incentive Bonus,Completed,,,10,CAD,\n"
            "7/4/2026,15:00:00,10000001,Chequing,Internal Transfer,Destination,Completed,,,5000.00,CAD,\n"
            "7/6/2026,10:00:00,10000001,Chequing,Withdrawal,Bill Pay,Cancelled,Car Finance Corp,,-5000.00,CAD,\n"
            "9/28/2026,13:00:00,10000001,Chequing,Credit Card Payment,,Completed,,,-50.00,CAD,\n"
            "10/27/2026,18:00:00,10000001,Chequing,Overdraft Transfer,Destination,Completed,,,200.00,CAD,\n"
        ).encode("utf-8")

        file1 = SimpleUploadedFile("ws_chequing.csv", ws_cheq_csv, content_type="text/csv")
        res = self.client.post("/api/import/chequing/courant-csv", {"file": file1})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # 16 total rows in CSV, 1 is Cancelled -> 15 valid rows parsed and inserted
        self.assertEqual(data["parsed"], 15)
        self.assertEqual(data["inserted"], 15)
        self.assertEqual(data["skipped"], 0)

        from core.models import ChequingTransaction, ChequingAccount
        # Verify account was automatically created from account_type
        self.assertTrue(ChequingAccount.objects.filter(user=self.user, label="Wealthsimple Chequing").exists())

        # Cancelled row was skipped
        self.assertFalse(ChequingTransaction.objects.filter(amount=-5000.00, user=self.user).exists())

        # Check category mappings
        etransfer_out = ChequingTransaction.objects.get(description__startswith="Jane Doe", user=self.user)
        self.assertEqual(etransfer_out.category, "Cash Sent (People)")
        self.assertEqual(float(etransfer_out.amount), -150.0)
        self.assertEqual(etransfer_out.description, "Jane Doe (jane.doe@example.com)")

        pad = ChequingTransaction.objects.get(description="Car Finance Corp", user=self.user)
        self.assertEqual(pad.category, "Pre-Authorized Debit")
        self.assertEqual(float(pad.amount), -250.00)

        direct_dep = ChequingTransaction.objects.get(description="CANADA", user=self.user)
        self.assertEqual(direct_dep.category, "Direct Deposit")
        self.assertEqual(float(direct_dep.amount), 2500.00)

        bill_pay = ChequingTransaction.objects.get(description="City Transport", user=self.user)
        self.assertEqual(bill_pay.category, "Online Bill Payments")
        self.assertEqual(float(bill_pay.amount), -120.00)

        interest = ChequingTransaction.objects.get(transaction_code="INT", user=self.user)
        self.assertEqual(interest.category, "Interest Earned")
        self.assertEqual(float(interest.amount), 5.00)

        transfer_out = ChequingTransaction.objects.get(amount=-1000, user=self.user)
        self.assertEqual(transfer_out.category, "Saving Money")

        transfer_in = ChequingTransaction.objects.get(amount=5000.00, user=self.user)
        self.assertEqual(transfer_in.category, "Drawing from Savings")

        overdraft = ChequingTransaction.objects.get(amount=200.00, user=self.user)
        self.assertEqual(overdraft.category, "Drawing from Savings")

        debit_card = ChequingTransaction.objects.get(amount=-25.0, user=self.user)
        self.assertEqual(debit_card.category, "Debit Card Purchase")

        # Test deduplication on re-upload
        file2 = SimpleUploadedFile("ws_chequing_again.csv", ws_cheq_csv, content_type="text/csv")
        res2 = self.client.post("/api/import/chequing/courant-csv", {"file": file2})
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["parsed"], 15)
        self.assertEqual(data2["inserted"], 0)
        self.assertEqual(data2["skipped"], 15)

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

    def test_wealthsimple_holdings_report_import_and_overwrite(self):
        from core.models import HoldingSnapshot
        # 1. Seed old holding that should be overwritten
        HoldingSnapshot.objects.create(
            user=self.user,
            as_of="2026-01-01",
            account_name="Old Closed Account",
            account_number="OLD999",
            symbol="OLD_TICKER",
            quantity=50,
            market_value=1000,
            book_value_cad=900,
        )
        self.assertEqual(HoldingSnapshot.objects.filter(user=self.user, symbol="OLD_TICKER").count(), 1)

        # 2. Wealthsimple Holdings Report CSV (synthetic sample with emojis & As of footer)
        ws_holdings_csv = (
            'Account Name,Account Type,Account Classification,Account Number,Symbol,Exchange,MIC,Name,Security Type,Quantity,Position Direction,Market Price,Market Price Currency,Book Value (CAD),Book Value Currency (CAD),Book Value (Market),Book Value Currency (Market),Market Value,Market Value Currency,Market Unrealized Returns,Market Unrealized Returns Currency\n'
            '"Trade FHSA","FHSA","Trade","ACT_FHSA_001","XEQT","TSX","XTSE","iShares Core Equity ETF Portfolio","EXCHANGE_TRADED_FUND","100","LONG","40.00","CAD","3800.00","CAD","3800.00","CAD","4000.00","CAD","200.00","CAD"\n'
            '"Trade Non-Registered","Non-registered","Trade","ACT_NONREG_002","VFV","TSX","XTSE","Vanguard S&P 500 Index ETF","EXCHANGE_TRADED_FUND","50","LONG","100.00","CAD","4500.00","CAD","4500.00","CAD","5000.00","CAD","500.00","CAD"\n'
            '"Trade Non-Registered","Non-registered","Trade","ACT_NONREG_002","XEQT","TSX","XTSE","iShares Core Equity ETF Portfolio","EXCHANGE_TRADED_FUND","50","LONG","40.00","CAD","2050.00","CAD","2050.00","CAD","2000.00","CAD","-50.00","CAD"\n'
            '"Trade RRSP","RRSP","Trade","ACT_RRSP_003","XEQT","TSX","XTSE","iShares Core Equity ETF Portfolio","EXCHANGE_TRADED_FUND","100","LONG","40.00","CAD","3900.00","CAD","3900.00","CAD","4000.00","CAD","100.00","CAD"\n'
            '"Trade TFSA","TFSA","Trade","ACT_TFSA_004","BTCC.B","TSX","XTSE","Purpose Bitcoin ETF CAD ETF","EXCHANGE_TRADED_FUND","50","LONG","15.00","CAD","700.00","CAD","700.00","CAD","750.00","CAD","50.00","CAD"\n'
            '"Trade TFSA","TFSA","Trade","ACT_TFSA_004","CAD","","","CAD","CURRENCY","10.00","LONG","1","CAD","10.00","CAD","10.00","CAD","10.00","CAD","0","CAD"\n'
            '"Trade TFSA","TFSA","Trade","ACT_TFSA_004","VFV","TSX","XTSE","Vanguard S&P 500 Index ETF","EXCHANGE_TRADED_FUND","50","LONG","100.00","CAD","4600.00","CAD","4600.00","CAD","5000.00","CAD","400.00","CAD"\n'
            '"Trade TFSA","TFSA","Trade","ACT_TFSA_004","XEQT","TSX","XTSE","iShares Core Equity ETF Portfolio","EXCHANGE_TRADED_FUND","50","LONG","40.00","CAD","1950.00","CAD","1950.00","CAD","2000.00","CAD","50.00","CAD"\n'
            '"✈️ Travel Fund","Non-registered","Trade","ACT_CASH_005","CAD","","","CAD","CURRENCY","1000.00","LONG","1","CAD","1000.00","CAD","1000.00","CAD","1000.00","CAD","0","CAD"\n'
            '"🏠 House Fund","Non-registered","Trade","ACT_CASH_006","CAD","","","CAD","CURRENCY","2000.00","LONG","1","CAD","2000.00","CAD","2000.00","CAD","2000.00","CAD","0","CAD"\n'
            '"💎 Long-Term Savings","Non-registered","Trade","ACT_CASH_007","CAD","","","CAD","CURRENCY","1500.00","LONG","1","CAD","1500.00","CAD","1500.00","CAD","1500.00","CAD","0","CAD"\n'
            '"💲 Buffer Account","Non-registered","Trade","ACT_CASH_008","CAD","","","CAD","CURRENCY","500.00","LONG","1","CAD","500.00","CAD","500.00","CAD","500.00","CAD","0","CAD"\n'
            '\n'
            '"As of 2026-06-01 12:00 GMT-04:00"\n'
        ).encode("utf-8")

        f = SimpleUploadedFile("Wealthsimple_Holdings_Report.csv", ws_holdings_csv, content_type="text/csv")
        res = self.client.post("/api/import/holdings-csv", {"file": f, "overwrite": "true"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["parsed"], 12)
        self.assertEqual(data["imported"], 12)
        self.assertEqual(data["as_of"], "2026-06-01")
        self.assertTrue(data.get("overwritten"))

        # Verify old positions were completely overwritten
        self.assertEqual(HoldingSnapshot.objects.filter(user=self.user, symbol="OLD_TICKER").count(), 0)
        self.assertEqual(HoldingSnapshot.objects.filter(user=self.user).count(), 12)

        # Verify specific accounts & emojis
        fhsa = HoldingSnapshot.objects.get(user=self.user, account_name="Trade FHSA", symbol="XEQT")
        self.assertEqual(float(fhsa.quantity), 100.0)
        self.assertAlmostEqual(float(fhsa.market_value), 4000.0, places=2)

        travel = HoldingSnapshot.objects.get(user=self.user, account_name="✈️ Travel Fund", symbol="CAD")
        self.assertEqual(float(travel.quantity), 1000.0)
        self.assertEqual(float(travel.market_value), 1000.0)

        house = HoldingSnapshot.objects.get(user=self.user, account_name="🏠 House Fund", symbol="CAD")
        self.assertEqual(float(house.quantity), 2000.0)

        # Verify accounts dashboard summary
        dash_res = self.client.get("/api/accounts/dashboard")
        self.assertEqual(dash_res.status_code, 200)
        dash_data = dash_res.json()
        self.assertEqual(dash_data["as_of"], "2026-06-01")
        self.assertEqual(dash_data["summary"]["positions"], 12)
        self.assertTrue(dash_data["summary"]["market_value"] > 20000)

        # Verify refresh-market-values skips CAD without crashing
        refresh_res = self.client.post("/api/holdings/refresh-market-values", {"as_of": "2026-06-01"}, content_type="application/json")
        self.assertEqual(refresh_res.status_code, 200)


    def test_wealthsimple_credit_card_csv_import_and_inference(self):
        ws_csv = (
            "transaction_date,post_date,type,details,amount,currency\n"
            "10/16/2026,10/16/2026,Purchase,FITNESS CLUB,45.00,CAD\n"
            "10/25/2026,10/25/2026,Purchase,CLOUD SOFTWARE INC,10.00,CAD\n"
            "10/26/2026,10/26/2026,Payment,From chequing account,-50.00,CAD\n"
        ).encode("utf-8")

        # 1. Test create card with wealthsimple provider
        card_res = self.client.post(
            "/api/credit-card/cards/create",
            {"label": "WS Visa Infinite", "provider": "wealthsimple"},
            content_type="application/json",
        )
        self.assertEqual(card_res.status_code, 200)

        # 2. Test auto-detection via general import route
        file_ws = SimpleUploadedFile("ws_statement.csv", ws_csv, content_type="text/csv")
        res = self.client.post(
            "/api/import/credit-card/rogers-csv",
            {"file": file_ws, "card_label": "WS Visa Infinite"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["parsed"], 3)
        self.assertEqual(data["inserted"], 3)
        self.assertEqual(data["skipped"], 0)

        # Verify parsed records and inferred categories
        from core.models import CreditCardTransaction
        t1 = CreditCardTransaction.objects.get(merchant_name="FITNESS CLUB", user=self.user)
        self.assertEqual(t1.merchant_category, "Sports & Outdoors")
        self.assertEqual(float(t1.amount), 45.00)
        self.assertEqual(str(t1.transaction_date), "2026-10-16")
        self.assertEqual(t1.card_label, "WS Visa Infinite")
        self.assertEqual(t1.provider, "wealthsimple")

        t2 = CreditCardTransaction.objects.get(merchant_name="CLOUD SOFTWARE INC", user=self.user)
        self.assertEqual(t2.merchant_category, "Software & SaaS")
        self.assertEqual(float(t2.amount), 10.00)

        t3 = CreditCardTransaction.objects.get(merchant_name="From chequing account", user=self.user)
        self.assertEqual(t3.merchant_category, "Transfers & Payments")
        self.assertEqual(float(t3.amount), -50.00)

        # 3. Test dedicated Wealthsimple import route + deduplication
        file_dup = SimpleUploadedFile("ws_dup.csv", ws_csv, content_type="text/csv")
        res_dup = self.client.post(
            "/api/import/credit-card/wealthsimple-csv",
            {"file": file_dup, "card_label": "WS Visa Infinite"},
        )
        self.assertEqual(res_dup.status_code, 200)
        data_dup = res_dup.json()
        self.assertEqual(data_dup["parsed"], 3)
        self.assertEqual(data_dup["inserted"], 0)
        self.assertEqual(data_dup["skipped"], 3)

        # 4. Test Wealthsimple custom document export format + Historical Category Memory
        # Seed an existing transaction from the user's historical transactions
        CreditCardTransaction.objects.create(
            user=self.user,
            provider="rogers_bank",
            card_label="Old Rogers Card",
            transaction_date="2026-01-01",
            merchant_name="Corner Cafe Bistro",
            merchant_category="Dining",
            amount=25.00,
        )

        ws_custom_export = (
            "transaction_date,transaction_type,status,merchant,amount,currency,notes,category\n"
            "11/6/2026,Purchase,Completed,Quick Burger Express,-15.50,CAD,,Restaurants\n"
            "11/6/2026,Purchase,Completed,Family Diner Bistro,-25.00,CAD,,Restaurants\n"
            '11/6/2026,Purchase,Pending,City Parking Meter,-10.00,CAD,,"Gas, parking, and tolls"\n'
            "11/6/2026,Purchase,Completed,Morning Roast Cafe,-4.50,CAD,,Coffee\n"
            "11/5/2026,Purchase,Completed,Snack Vending Machine,-2.50,CAD,,Other food and drink\n"
            "11/5/2026,Refund,Completed,Merchant Refund,12.00,CAD,,Services\n"
            "10/26/2026,Payment,Completed,,50.00,CAD,,Uncategorized\n"
            "9/22/2026,Purchase,Completed,Corner Cafe Bistro,-18.50,CAD,,Uncategorized\n"
            "8/15/2026,Purchase,Completed,Downtown Lounge Bar,-45.00,CAD,,Bars and nightlife\n"
        ).encode("utf-8")

        file_custom = SimpleUploadedFile("ws_custom_doc.csv", ws_custom_export, content_type="text/csv")
        res_custom = self.client.post(
            "/api/import/credit-card/wealthsimple-csv",
            {"file": file_custom, "card_label": "WS Visa Infinite"},
        )
        self.assertEqual(res_custom.status_code, 200)
        c_data = res_custom.json()
        self.assertEqual(c_data["parsed"], 9)
        self.assertEqual(c_data["inserted"], 9)

        # Check positive/negative amounts and categories
        burger = CreditCardTransaction.objects.get(merchant_name="Quick Burger Express", user=self.user)
        self.assertEqual(float(burger.amount), 15.50)
        self.assertEqual(burger.merchant_category, "Dining")

        parking = CreditCardTransaction.objects.get(merchant_name="City Parking Meter", user=self.user)
        self.assertEqual(float(parking.amount), 10.00)
        self.assertEqual(parking.merchant_category, "Parking")

        cafe = CreditCardTransaction.objects.get(merchant_name="Morning Roast Cafe", user=self.user)
        self.assertEqual(float(cafe.amount), 4.50)
        self.assertEqual(cafe.merchant_category, "Coffee & Snacks")

        refund = CreditCardTransaction.objects.get(merchant_name="Merchant Refund", user=self.user)
        self.assertEqual(float(refund.amount), -12.00)
        self.assertEqual(refund.merchant_category, "Personal Services")

        payment = CreditCardTransaction.objects.filter(merchant_name="Payment", user=self.user).first()
        self.assertIsNotNone(payment)
        self.assertEqual(float(payment.amount), -50.00)
        self.assertEqual(payment.merchant_category, "Transfers & Payments")

        # Crucial test: Corner Cafe Bistro had category="Uncategorized" in the CSV,
        # but was matched against the user's historical transactions to inherit "Dining"!
        bistro = CreditCardTransaction.objects.filter(merchant_name="Corner Cafe Bistro", amount=18.50, user=self.user).first()
        self.assertIsNotNone(bistro)
        self.assertEqual(bistro.merchant_category, "Dining")

        bars = CreditCardTransaction.objects.get(merchant_name="Downtown Lounge Bar", user=self.user)
        self.assertEqual(float(bars.amount), 45.00)
        self.assertEqual(bars.merchant_category, "Alcohol & Bars")

    def test_wealthsimple_acb_activities_custom_export_import(self):
        ws_activities_csv = (
            "effective_date,effective_time,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount\n"
            '2026-01-02,10:00:00,2026-01-03,ACT10000001,Non-registered,Trade,BUY,"XEQT: Bought 100 shares at $30 per share",LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,100,30,0,-3000\n'
            '2026-01-05,00:00:00,,ACT10000001,Non-registered,Dividend,-,"XEQT: Cash dividend distribution",,XEQT,iShares Core Equity ETF Portfolio,CAD,50,,,50\n'
            '2026-01-05,00:00:00,,ACT10000001,Non-registered,NonCashDistribution,-,"XEQT: Non-cash Distribution",LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,150,,,150\n'
            '2026-01-05,00:00:00,,ACT10000001,Non-registered,ReturnOfCapital,-,"XEQT: Return of Capital",LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,-10,,,-10\n'
            '2026-01-05,10:23:10,,ACT10000001,Non-registered,MoneyMovement,TRANSFER,"Money transfer out",,,,CAD,-7000,,,-7000\n'
            '2026-03-31,15:47:06,2026-04-01,ACT10000001,Non-registered,Trade,SELL,"XEQT: Sold 50 shares at $35 per share",LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,-50,35,0,1750\n'
            '2026-04-01,12:00:00,2026-04-02,ACT20000002,TFSA,Trade,BUY,"VFV: Bought 10 shares",LONG,VFV,Vanguard S&P 500,CAD,10,100,0,-1000\n'
        ).encode("utf-8")

        # 1. Post to activities-csv endpoint
        file1 = SimpleUploadedFile("activities.csv", ws_activities_csv, content_type="text/csv")
        res = self.client.post("/api/import/activities-csv", {"file": file1})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["parsed"], 4)
        self.assertEqual(data["inserted"], 4)
        self.assertEqual(data["skipped"], 0)

        # 2. Verify transactions in database
        from core.models import Transaction
        txs = list(Transaction.objects.filter(user=self.user, security="XEQT").order_by("trade_date", "id"))
        self.assertEqual(len(txs), 4)

        buy_tx = txs[0]
        self.assertEqual(buy_tx.transaction_type, "Buy")
        self.assertEqual(float(buy_tx.shares), 100.0)
        self.assertEqual(float(buy_tx.amount), 3000.0)

        dist_tx = txs[1]
        self.assertEqual(dist_tx.transaction_type, "Capital Gains Dividend")
        self.assertEqual(float(dist_tx.shares), 0.0)
        self.assertEqual(float(dist_tx.amount), 150.0)

        roc_tx = txs[2]
        self.assertEqual(roc_tx.transaction_type, "Return of Capital")
        self.assertEqual(float(roc_tx.shares), 0.0)
        self.assertEqual(float(roc_tx.amount), 10.0)

        sell_tx = txs[3]
        self.assertEqual(sell_tx.transaction_type, "Sell")
        self.assertEqual(float(sell_tx.shares), 50.0)
        self.assertEqual(float(sell_tx.amount), 1750.0)

        # Registered trade and cash dividend were not imported
        self.assertFalse(Transaction.objects.filter(user=self.user, security="VFV").exists())
        self.assertEqual(Transaction.objects.filter(user=self.user, transaction_type="Dividend").count(), 0)

        # 3. Verify ACB Ledger calculation
        ledger_res = self.client.get("/api/ledger?security=XEQT")
        self.assertEqual(ledger_res.status_code, 200)
        ledger = ledger_res.json()
        self.assertEqual(len(ledger), 4)

        # Row 1: Buy 100 -> shares: 100, ACB: $3000
        self.assertEqual(ledger[0]["share_balance"], 100.0)
        self.assertEqual(ledger[0]["acb"], 3000.0)

        # Row 2: Capital Gains Dividend $150 -> shares: 100, ACB: $3150
        self.assertEqual(ledger[1]["share_balance"], 100.0)
        self.assertEqual(ledger[1]["acb"], 3150.0)

        # Row 3: Return of Capital $10 -> shares: 100, ACB: $3140
        self.assertEqual(ledger[2]["share_balance"], 100.0)
        self.assertEqual(ledger[2]["acb"], 3140.0)

        # Row 4: Sell 50 -> shares: 50, ACB: $1570, Capital Gain: $1750 - $1570 = $180
        self.assertEqual(ledger[3]["share_balance"], 50.0)
        self.assertEqual(ledger[3]["acb"], 1570.0)
        self.assertEqual(ledger[3]["capital_gain"], 180.0)

        # 4. Verify deduplication on re-upload
        file2 = SimpleUploadedFile("activities_dup.csv", ws_activities_csv, content_type="text/csv")
        res_dup = self.client.post("/api/import/trade/wealthsimple-csv", {"file": file2})
        self.assertEqual(res_dup.status_code, 200)
        data_dup = res_dup.json()
        self.assertEqual(data_dup["parsed"], 4)
        self.assertEqual(data_dup["inserted"], 0)
        self.assertEqual(data_dup["skipped"], 4)
        self.assertEqual(Transaction.objects.filter(user=self.user, security="XEQT").count(), 4)

    def test_wealthsimple_acb_reverse_order_and_registered_filtering(self):
        # Test reverse-order input and varied account type labels
        reverse_csv = (
            "effective_date,effective_time,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount\n"
            '2026-04-10,14:00:00,2026-04-11,ACT_SYNTH_001,Non-Registered Investment,Trade,SELL,"TEST_ETF: Sold 20 shares",LONG,TEST_ETF,Test ETF,CAD,-20,50,0,1000\n'
            '2026-03-01,11:00:00,,ACT_SYNTH_001,Non-Registered Investment,ReturnOfCapital,-,"TEST_ETF: Return of Capital",LONG,TEST_ETF,Test ETF,CAD,-5,,,-5\n'
            '2026-02-15,10:30:00,2026-02-16,ACT_SYNTH_002,Tax-Free Savings Account (TFSA),Trade,BUY,"TEST_ETF: TFSA Buy",LONG,TEST_ETF,Test ETF,CAD,50,40,0,-2000\n'
            '2026-02-10,09:15:00,2026-02-11,ACT_SYNTH_003,RRSP Investment Account,Trade,BUY,"TEST_ETF: RRSP Buy",LONG,TEST_ETF,Test ETF,CAD,50,40,0,-2000\n'
            '2026-01-10,09:30:00,2026-01-11,ACT_SYNTH_001,Non-Registered Investment,Trade,BUY,"TEST_ETF: Bought 50 shares",LONG,TEST_ETF,Test ETF,CAD,50,40,0,-2000\n'
        )

        from core.views.imports import parse_activities_csv_text
        parsed = parse_activities_csv_text(reverse_csv)
        self.assertEqual(len(parsed), 3)

        # Chronological order verified: Jan 10 (Buy) -> Mar 01 (ROC) -> Apr 10 (Sell)
        self.assertEqual(parsed[0]["trade_date"], "2026-01-10")
        self.assertEqual(parsed[0]["transaction_type"], "Buy")
        self.assertEqual(parsed[1]["trade_date"], "2026-03-01")
        self.assertEqual(parsed[1]["transaction_type"], "Return of Capital")
        self.assertEqual(parsed[2]["trade_date"], "2026-04-10")
        self.assertEqual(parsed[2]["transaction_type"], "Sell")




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

