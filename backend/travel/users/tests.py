from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from requests import Response
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AccountProfile, PasswordResetAttempt, PasswordResetConfirmation
from .mailersend import EmailDeliveryError
from .services import build_email_verification_token
from .tokens import password_reset_token_generator

User = get_user_model()


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class AccountFlowTests(APITestCase):
    password = "test-Strong!9284"

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("existing-user", "existing@example.com", self.password)

    def post(self, path, payload):
        return self.client.post(f"/api/auth/{path}/", payload, format="json")

    def login(self, **credentials):
        return self.post("login", {"password": self.password, **credentials})

    def register(self, **changes):
        payload = {"username": "new-user", "email": "new@example.com", "password": self.password, **changes}
        return self.post("register", payload)

    def reset_payload(self, user=None):
        user = user or self.user
        return {
            "uid": urlsafe_base64_encode(force_bytes(user.pk)),
            "token": password_reset_token_generator.make_token(user),
            "password": "New-Strong!72854",
        }

    def test_existing_username_and_case_insensitive_email_login(self):
        for credentials in (
            {"username": "existing-user"}, {"email": "EXISTING@example.com"},
            {"username": "existing@example.com"},
        ):
            with self.subTest(credentials=credentials):
                response = self.login(**credentials)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["user"]["id"], self.user.pk)
                self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
                self.assertEqual(self.client.get("/api/projects/").status_code, 200)
                self.client.credentials()

    def test_invalid_and_inactive_credentials_are_rejected(self):
        self.assertEqual(self.login(username="missing").status_code, 401)
        self.assertEqual(self.login(username="existing-user", password="wrong").status_code, 401)
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.assertEqual(self.login(username="existing-user").status_code, 401)

    def test_password_whitespace_is_not_trimmed(self):
        self.user.set_password("  " + self.password + "  ")
        self.user.save()
        self.assertEqual(self.login(username=self.user.username, password="  " + self.password + "  ").status_code, 200)
        self.assertEqual(self.login(username=self.user.username).status_code, 401)

    def test_ambiguous_email_fails_without_server_error(self):
        User.objects.create_user("duplicate-email", "EXISTING@example.com", self.password)
        self.assertEqual(self.login(email="existing@example.com").status_code, 401)
        self.assertEqual(self.login(username="existing-user").status_code, 200)

    def test_public_login_ignores_expired_authorization_header(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer expired-token")
        self.assertEqual(self.login(username="existing-user").status_code, 200)

    def test_login_rate_limit_is_configured_and_enforced(self):
        for _ in range(10):
            self.assertEqual(self.login(username="existing-user", password="wrong").status_code, 401)
        self.assertEqual(self.login(username="existing-user").status_code, 429)

    def test_registration_verification_login_and_logout(self):
        self.assertEqual(self.register(email="NEW@example.com").status_code, 201)
        user = User.objects.get(username="new-user")
        self.assertFalse(user.is_active)
        self.assertTrue(user.check_password(self.password))
        self.assertEqual(self.login(email=user.email).status_code, 401)
        self.assertEqual(len(mail.outbox), 1)
        link = mail.outbox[0].body.splitlines()[1]
        token = parse_qs(urlsplit(link).fragment.split("?", 1)[1])["token"][0]
        self.assertEqual(self.post("verify-email", {"token": token}).status_code, 200)
        self.assertEqual(self.post("verify-email", {"token": token}).status_code, 400)
        self.assertTrue(AccountProfile.objects.get(user=user).verified)
        tokens = self.login(email=user.email).data
        self.client.credentials(HTTP_AUTHORIZATION="Bearer expired-token")
        self.assertEqual(self.post("logout", {"refresh": tokens["refresh"]}).status_code, 200)
        self.assertEqual(self.post("token/refresh", {"refresh": tokens["refresh"]}).status_code, 401)

    def test_duplicate_registration_never_changes_existing_account(self):
        response = self.register(email=self.user.email, username="different", password="Other-Strong!324")
        self.assertEqual(response.status_code, 201)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.password))
        self.assertEqual(User.objects.filter(email=self.user.email).count(), 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_weak_password_and_duplicate_username_are_rejected(self):
        self.assertEqual(self.register(password="123").status_code, 400)
        self.assertEqual(self.register(username="existing-user").status_code, 400)
        self.assertEqual(User.objects.count(), 1)

    def test_profile_conflict_does_not_claim_username_is_taken(self):
        AccountProfile.objects.create(user=self.user, email="new@example.com")
        response = self.register()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["detail"].code, "registration_unavailable")
        self.assertNotIn("username", response.data)
        self.assertFalse(User.objects.filter(username="new-user").exists())
        self.assertEqual(AccountProfile.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_deleted_account_can_register_again_with_same_username_and_email(self):
        self.assertEqual(self.register().status_code, 201)
        old_user = User.objects.get(username="new-user")
        old_token = build_email_verification_token(old_user)
        old_user.delete()
        self.assertEqual(AccountProfile.objects.count(), 0)
        cache.clear()
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(User.objects.filter(username="new-user").count(), 1)
        self.assertEqual(AccountProfile.objects.count(), 1)
        self.assertEqual(self.post("verify-email", {"token": old_token}).status_code, 400)
        link = mail.outbox[-1].body.splitlines()[1]
        new_token = parse_qs(urlsplit(link).fragment.split("?", 1)[1])["token"][0]
        self.assertEqual(self.post("verify-email", {"token": new_token}).status_code, 200)

    def test_resend_replaces_token_and_cannot_reactivate_disabled_verified_user(self):
        self.register()
        user = User.objects.get(username="new-user")
        old_token = build_email_verification_token(user)
        cache.clear()
        self.assertEqual(self.post("resend-verification", {"email": user.email}).status_code, 200)
        self.assertEqual(self.post("verify-email", {"token": old_token}).status_code, 400)
        token = build_email_verification_token(user)
        self.assertEqual(self.post("verify-email", {"token": token}).status_code, 200)
        user.refresh_from_db()
        user.is_active = False
        user.save()
        cache.clear()
        before = len(mail.outbox)
        self.post("resend-verification", {"email": user.email})
        self.assertEqual(len(mail.outbox), before)
        self.assertEqual(self.post("verify-email", {"token": token}).status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def test_expired_verification_link_is_rejected(self):
        self.register()
        token = build_email_verification_token(User.objects.get(username="new-user"))
        with patch("django.core.signing.time.time", return_value=10**12):
            self.assertEqual(self.post("verify-email", {"token": token}).status_code, 400)

    def test_reset_request_has_generic_response_and_usable_email_link(self):
        known = self.post("password-reset", {"email": "EXISTING@example.com"})
        unknown = self.post("password-reset", {"email": "unknown@example.com"})
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(len(mail.outbox), 1)
        link = mail.outbox[0].body.splitlines()[1]
        params = parse_qs(urlsplit(link).fragment.split("?", 1)[1])
        response = self.post("password-reset/confirm", {
            "uid": params["uid"][0], "token": params["token"][0], "password": "New-Strong!72854",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PasswordResetAttempt.objects.filter(token_sent=True).count(), 1)

    def test_reset_revokes_both_access_and_refresh_and_link_is_single_use(self):
        tokens = self.login(username=self.user.username).data
        payload = self.reset_payload()
        self.assertEqual(self.post("password-reset/confirm", payload).status_code, 200)
        self.assertEqual(self.post("password-reset/confirm", payload).status_code, 400)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get("/api/projects/").status_code, 401)
        self.assertEqual(self.post("token/refresh", {"refresh": tokens["refresh"]}).status_code, 401)
        self.client.credentials()
        self.assertEqual(self.login(username=self.user.username).status_code, 401)
        self.assertEqual(self.login(username=self.user.username, password=payload["password"]).status_code, 200)
        self.assertEqual(PasswordResetConfirmation.objects.filter(success=True).count(), 1)

    def test_password_change_outside_reset_also_revokes_refresh(self):
        refresh = str(RefreshToken.for_user(self.user))
        self.user.set_password("Changed-Strong!8324")
        self.user.save()
        self.assertEqual(self.post("token/refresh", {"refresh": refresh}).status_code, 401)

    def test_reset_expiry_invalid_uid_weak_password_and_forwarded_ip(self):
        payload = self.reset_payload()
        with patch.object(password_reset_token_generator, "_num_seconds", return_value=10**12):
            self.assertEqual(self.post("password-reset/confirm", payload).status_code, 400)
        self.assertEqual(self.post("password-reset/confirm", {**payload, "uid": "invalid"}).status_code, 400)
        self.assertEqual(self.post("password-reset/confirm", {**payload, "password": "123"}).status_code, 422)
        response = self.client.post("/api/auth/password-reset/", {"email": self.user.email},
                                    format="json", HTTP_X_FORWARDED_FOR="8.8.8.8", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PasswordResetAttempt.objects.last().ip_address, "127.0.0.1")

    def test_deleted_user_refresh_returns_401_instead_of_500(self):
        refresh = str(RefreshToken.for_user(self.user))
        self.user.delete()
        self.assertEqual(self.post("token/refresh", {"refresh": refresh}).status_code, 401)

    def test_refresh_rotation_blacklists_previous_refresh(self):
        tokens = self.login(username=self.user.username).data
        rotated = self.post("token/refresh", {"refresh": tokens["refresh"]})
        self.assertEqual(rotated.status_code, 200)
        self.assertNotEqual(rotated.data["refresh"], tokens["refresh"])
        self.assertEqual(self.post("token/refresh", {"refresh": tokens["refresh"]}).status_code, 401)


@override_settings(
    EMAIL_BACKEND="travel.users.mailersend.MailerSendEmailBackend",
    MAILERSEND_API_KEY="mlsn-test-only",
    DEFAULT_FROM_EMAIL="Travel Planner <verify@example.com>",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class MailerSendDeliveryTests(APITestCase):
    def setUp(self):
        cache.clear()
        response = Response()
        response.status_code = 202
        response.headers["x-message-id"] = "email-123"
        response._content = b""
        self.sender = patch("mailersend.client.requests.Session.request", return_value=response).start()
        self.addCleanup(patch.stopall)
        self.payload = {"username": "traveller", "email": "traveller@example.com", "password": "Strong-New!8234"}

    def register(self):
        return self.client.post("/api/auth/register/", self.payload, format="json")

    def sent_token(self):
        link = self.sender.call_args.kwargs["json"]["text"].splitlines()[1]
        return parse_qs(urlsplit(link).fragment.split("?", 1)[1])["token"][0]

    def test_signup_sends_real_unique_link_to_registered_address(self):
        self.assertEqual(self.register().status_code, 201)
        params = self.sender.call_args.kwargs["json"]
        self.assertEqual(self.sender.call_args.kwargs["url"], "https://api.mailersend.com/v1/email")
        self.assertEqual(self.sender.call_args.kwargs["timeout"], 12)
        self.assertEqual(params["from"], {"name": "Travel Planner", "email": "verify@example.com"})
        self.assertEqual(params["to"], [{"email": self.payload["email"]}])
        self.assertIn("Confirm my email", params["html"])
        self.assertNotIn("123456", params["text"])
        user = User.objects.get(username="traveller")
        self.assertFalse(user.is_active)
        token = self.sent_token()
        self.assertEqual(self.client.post("/api/auth/verify-email/", {"token": token}).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/verify-email/", {"token": token}).status_code, 400)
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    @override_settings(MAILERSEND_API_KEY="")
    def test_missing_key_returns_error_without_console_fallback(self):
        response = self.register()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["code"], "email_delivery_failed")
        self.sender.assert_not_called()
        profile = AccountProfile.objects.get(email=self.payload["email"])
        self.assertEqual(profile.email_verification_nonce, "")
        self.assertFalse(profile.user.is_active)

    def test_rejected_email_does_not_report_success_and_can_be_retried(self):
        self.sender.side_effect = RuntimeError("Provider rejected request; secret detail")
        response = self.register()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret detail", str(response.data))
        self.assertFalse(User.objects.get(username="traveller").is_active)
        self.sender.side_effect = None
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(User.objects.filter(username="traveller").count(), 1)

    def test_failed_resend_preserves_previously_sent_link(self):
        self.register()
        token = self.sent_token()
        cache.clear()
        self.sender.side_effect = TimeoutError("timeout")
        response = self.client.post("/api/auth/resend-verification/", {"email": self.payload["email"]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.post("/api/auth/verify-email/", {"token": token}).status_code, 200)

    def test_successful_resend_replaces_link_and_cooldown_reports_429(self):
        self.register()
        token = self.sent_token()
        self.assertEqual(self.client.post("/api/auth/resend-verification/", {"email": self.payload["email"]}).status_code, 429)
        cache.clear()
        self.assertEqual(self.client.post("/api/auth/resend-verification/", {"email": self.payload["email"]}).status_code, 200)
        self.assertNotEqual(self.sent_token(), token)
        self.assertEqual(self.client.post("/api/auth/verify-email/", {"token": token}).status_code, 400)

    def test_missing_provider_message_id_is_not_success(self):
        self.sender.return_value.headers.clear()
        self.assertEqual(self.register().status_code, 503)

    @override_settings(DEFAULT_FROM_EMAIL="")
    def test_missing_sender_does_not_call_provider(self):
        self.assertEqual(self.register().status_code, 503)
        self.sender.assert_not_called()

    def test_provider_http_errors_are_reported_without_private_details(self):
        for status in (401, 422, 429, 500):
            with self.subTest(status=status):
                cache.clear()
                self.sender.return_value.status_code = status
                self.sender.return_value._content = b'{"message": "secret provider detail"}'
                with self.assertLogs("travel.users.mailersend", level="WARNING") as logs:
                    response = self.register()
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("secret provider detail", str(response.data))
                self.assertNotIn("secret provider detail", str(logs.output))

    def test_password_reset_uses_mailersend_and_reports_failures(self):
        User.objects.create_user("existing", "existing@example.com", self.payload["password"])
        response = self.client.post("/api/auth/password-reset/", {"email": "existing@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sender.call_args.kwargs["json"]["to"], [{"email": "existing@example.com"}])
        self.assertIn("#reset-password?", self.sender.call_args.kwargs["json"]["text"])
        self.sender.side_effect = RuntimeError("MailerSend unavailable")
        response = self.client.post("/api/auth/password-reset/", {"email": "existing@example.com"})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(PasswordResetAttempt.objects.last().token_sent)

    def test_unknown_recipient_does_not_trigger_test_email(self):
        response = self.client.post("/api/auth/resend-verification/", {"email": "unknown@example.com"})
        self.assertEqual(response.status_code, 200)
        self.sender.assert_not_called()


@override_settings(
    EMAIL_BACKEND="travel.users.mailersend.MailerSendEmailBackend",
    MAILERSEND_API_KEY="mlsn-test-only",
    DEFAULT_FROM_EMAIL="Travel Planner <verify@example.com>",
)
class MailerSendBackendTests(SimpleTestCase):
    def setUp(self):
        response = Response()
        response.status_code = 202
        response.headers["x-message-id"] = "email-123"
        response._content = b""
        transport = patch("mailersend.client.requests.Session.request", return_value=response)
        self.sender = transport.start()
        self.addCleanup(transport.stop)

    def test_html_and_named_recipients_are_preserved(self):
        message = mail.EmailMessage(
            "Subject", "<p>Hello</p>", to=["Traveller <traveller@example.com>"],
            cc=["Copy <copy@example.com>"], bcc=["hidden@example.com"],
            reply_to=["Support <support@example.com>"],
        )
        message.content_subtype = "html"
        self.assertEqual(message.send(), 1)
        payload = self.sender.call_args.kwargs["json"]
        self.assertEqual(payload["html"], "<p>Hello</p>")
        self.assertNotIn("text", payload)
        self.assertEqual(payload["to"], [{"name": "Traveller", "email": "traveller@example.com"}])
        self.assertEqual(payload["cc"], [{"name": "Copy", "email": "copy@example.com"}])
        self.assertEqual(payload["bcc"], [{"email": "hidden@example.com"}])
        self.assertEqual(payload["reply_to"], {"name": "Support", "email": "support@example.com"})

    def test_empty_messages_and_recipients_do_not_call_provider(self):
        connection = mail.get_connection()
        self.assertEqual(connection.send_messages([]), 0)
        self.assertEqual(connection.send_messages([mail.EmailMessage("Subject", "Body")]), 0)
        self.sender.assert_not_called()

    def test_silent_failure_counts_only_accepted_messages(self):
        accepted = self.sender.return_value
        self.sender.side_effect = [TimeoutError("timeout"), accepted]
        messages = [mail.EmailMessage("Subject", "Body", to=["user@example.com"]) for _ in range(2)]
        self.assertEqual(mail.get_connection(fail_silently=True).send_messages(messages), 1)

    @override_settings(MAILERSEND_API_KEY="")
    def test_missing_key_respects_fail_silently(self):
        message = mail.EmailMessage("Subject", "Body", to=["user@example.com"])
        with self.assertLogs("travel.users.mailersend", level="WARNING") as logs:
            self.assertEqual(message.send(fail_silently=True), 0)
        self.assertIn("MAILERSEND_API_KEY is missing", str(logs.output))
        with self.assertRaises(EmailDeliveryError):
            mail.get_connection(fail_silently=False).send_messages([message])
        self.sender.assert_not_called()

    @override_settings(DEFAULT_FROM_EMAIL="")
    def test_missing_sender_is_identified_in_logs(self):
        message = mail.EmailMessage("Subject", "Body", to=["user@example.com"])
        with self.assertLogs("travel.users.mailersend", level="WARNING") as logs:
            self.assertEqual(message.send(fail_silently=True), 0)
        self.assertIn("MAILERSEND_FROM_EMAIL is missing", str(logs.output))
        self.sender.assert_not_called()

    def test_http_failure_logs_status_without_provider_details(self):
        message = mail.EmailMessage("Subject", "Body", to=["user@example.com"])
        for status in (401, 403, 422, 429, 500):
            with self.subTest(status=status):
                self.sender.return_value.status_code = status
                self.sender.return_value._content = b'{"message": "private recipient or token"}'
                with self.assertLogs("travel.users.mailersend", level="WARNING") as logs:
                    self.assertEqual(message.send(fail_silently=True), 0)
                self.assertIn(f"HTTP status={status}", str(logs.output))
                self.assertNotIn("private recipient or token", str(logs.output))

    def test_multiple_reply_to_addresses_are_not_silently_dropped(self):
        message = mail.EmailMessage(
            "Subject", "Body", to=["user@example.com"],
            reply_to=["one@example.com", "two@example.com"],
        )
        with self.assertRaises(EmailDeliveryError):
            message.send()
        self.sender.assert_not_called()
