from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


class JwtAuthenticationTests(APITestCase):
    def setUp(self):
        self.username = "jwt_user"
        self.password = "strong-test-password-123"

        self.user = get_user_model().objects.create_user(
            username=self.username,
            password=self.password,
        )

        self.projects_url = reverse("travel:project-list")
        self.token_url = reverse("token_obtain_pair")
        self.refresh_url = reverse("token_refresh")
        self.verify_url = reverse("token_verify")
        self.logout_url = reverse("token_blacklist")

    def obtain_tokens(self) -> dict:
        response = self.client.post(
            self.token_url,
            {
                "username": self.username,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )

        return response.data

    def test_obtain_access_and_refresh_tokens(self):
        tokens = self.obtain_tokens()

        self.assertIn("access", tokens)
        self.assertIn("refresh", tokens)

    def test_request_without_token_is_rejected(self):
        response = self.client.get(self.projects_url)

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_request_with_access_token_is_allowed(self):
        tokens = self.obtain_tokens()

        self.client.credentials(
            HTTP_AUTHORIZATION=(
                f"Bearer {tokens['access']}"
            )
        )

        response = self.client.get(self.projects_url)

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )

    def test_refresh_token_returns_new_access_token(self):
        tokens = self.obtain_tokens()

        response = self.client.post(
            self.refresh_url,
            {
                "refresh": tokens["refresh"],
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertIn("access", response.data)

        # Через ROTATE_REFRESH_TOKENS=True
        self.assertIn("refresh", response.data)

    def test_invalid_password_is_rejected(self):
        response = self.client.post(
            self.token_url,
            {
                "username": self.username,
                "password": "wrong-password",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_blacklisted_refresh_token_cannot_be_used(self):
        tokens = self.obtain_tokens()
        refresh_token = tokens["refresh"]

        logout_response = self.client.post(
            self.logout_url,
            {
                "refresh": refresh_token,
            },
            format="json",
        )

        self.assertEqual(
            logout_response.status_code,
            status.HTTP_200_OK,
        )

        refresh_response = self.client.post(
            self.refresh_url,
            {
                "refresh": refresh_token,
            },
            format="json",
        )

        self.assertEqual(
            refresh_response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )