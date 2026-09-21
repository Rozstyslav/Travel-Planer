from django.conf import settings
from django.db import models


class AccountProfile(models.Model):
    """Verification metadata; existing auth.User records stay intact."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_profile",
    )
    email = models.EmailField(unique=True)
    verified = models.BooleanField(default=False)
    email_verification_nonce = models.CharField(max_length=64, blank=True, default="")


class PasswordResetAttempt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    email = models.EmailField()
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    token_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class PasswordResetConfirmation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    success = models.BooleanField(default=True)
    failure_reason = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
