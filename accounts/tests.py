from django.contrib.auth import get_user_model
from django.test import Client, TestCase

User = get_user_model()


class AccountsAuthTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_first_launch_check(self):
        # Empty DB has no users
        res = self.client.get("/api/auth/check-setup")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["has_users"])

        # Setup first superuser
        setup_res = self.client.post(
            "/api/auth/setup-superuser",
            {"username": "initial_admin", "password": "securepassword123"},
            content_type="application/json",
        )
        self.assertEqual(setup_res.status_code, 200)
        self.assertTrue(setup_res.json()["is_superuser"])

        # Now has_users is true
        res2 = self.client.get("/api/auth/check-setup")
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(res2.json()["has_users"])

        # Cannot setup second superuser via setup-superuser endpoint
        res3 = self.client.post(
            "/api/auth/setup-superuser",
            {"username": "second_admin", "password": "anotherpassword123"},
            content_type="application/json",
        )
        self.assertEqual(res3.status_code, 409)

    def test_login_logout_and_session(self):
        user = User.objects.create_user(username="testuser", password="testpassword123")

        # Wrong password
        bad_res = self.client.post(
            "/api/auth/login",
            {"username": "testuser", "password": "wrongpassword"},
            content_type="application/json",
        )
        self.assertEqual(bad_res.status_code, 401)

        # Successful login
        login_res = self.client.post(
            "/api/auth/login",
            {"username": "testuser", "password": "testpassword123"},
            content_type="application/json",
        )
        self.assertEqual(login_res.status_code, 200)
        self.assertEqual(login_res.json()["username"], "testuser")

        # Check me
        me_res = self.client.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()["id"], user.id)

        # Logout
        logout_res = self.client.post("/api/auth/logout")
        self.assertEqual(logout_res.status_code, 200)

        # Me fails after logout
        me_res2 = self.client.get("/api/auth/me")
        self.assertEqual(me_res2.status_code, 401)

    def test_admin_user_management_and_rbac(self):
        admin = User.objects.create_superuser(username="rootadmin", password="rootpassword123")
        standard = User.objects.create_user(username="standarduser", password="standardpassword123")

        # 1. Non-superuser gets 403 on admin endpoints
        self.client.force_login(standard)
        res = self.client.get("/api/auth/admin/users")
        self.assertEqual(res.status_code, 403)

        # 2. Superuser lists users
        self.client.force_login(admin)
        res = self.client.get("/api/auth/admin/users")
        self.assertEqual(res.status_code, 200)
        users = res.json()["users"]
        self.assertEqual(len(users), 2)

        # 3. Create a new user via register
        create_res = self.client.post(
            "/api/auth/register",
            {
                "username": "newmember",
                "password": "newmemberpassword123",
            },
            content_type="application/json",
        )
        self.assertEqual(create_res.status_code, 200)
        new_id = create_res.json()["id"]

        # Log back in as admin
        self.client.force_login(admin)

        # 4. Superuser toggles superuser
        patch_res = self.client.post(
            f"/api/auth/admin/users/{new_id}/superuser",
            {"is_superuser": True},
            content_type="application/json",
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertTrue(patch_res.json()["user"]["is_superuser"])

        # 5. Superuser toggles active
        active_res = self.client.post(
            f"/api/auth/admin/users/{new_id}/active",
            {"is_active": False},
            content_type="application/json",
        )
        self.assertEqual(active_res.status_code, 200)
        self.assertFalse(active_res.json()["user"]["is_active"])

        # 6. Check audit logs recorded
        logs_res = self.client.get("/api/auth/admin/audit-logs")
        self.assertEqual(logs_res.status_code, 200)
        self.assertTrue(len(logs_res.json()["logs"]) >= 1)

        # 7. Delete user (requires confirm_username match)
        del_res = self.client.delete(
            f"/api/auth/admin/users/{new_id}",
            {"confirm_username": "newmember"},
            content_type="application/json",
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertFalse(User.objects.filter(id=new_id).exists())
