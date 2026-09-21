import logging
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils.crypto import constant_time_compare
from django.template.loader import render_to_string

from .models import AccountProfile
from .resend import EmailDeliveryError

logger = logging.getLogger(__name__)


def register_user(validated_data, user_model=None):
    User = user_model or get_user_model()
    email = validated_data["email"].strip().lower()
    existing = User.objects.filter(email__iexact=email).first()
    if existing:
        profile = AccountProfile.objects.filter(user=existing, verified=False, email=email).first()
        return existing, False, profile is not None
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data["username"], email=email,
                password=validated_data["password"], is_active=False,
            )
            AccountProfile.objects.create(user=user, email=email)
    except IntegrityError:
        existing = User.objects.filter(email__iexact=email).first()
        if existing:
            return existing, False, False
        raise
    return user, True, True


def build_email_verification_token(user):
    nonce = secrets.token_hex(32)
    AccountProfile.objects.filter(user=user, verified=False).update(email_verification_nonce=nonce)
    return signing.dumps({"uid": user.pk, "email": user.email.lower(), "nonce": nonce}, salt="users.email.verify")


def build_email_verification_url(token):
    return f"{settings.APP_BASE_URL}/#verify-email?{urlencode({'token': token})}"


def send_verification_email(user):
    previous_nonce = AccountProfile.objects.get(user=user).email_verification_nonce
    token = build_email_verification_token(user)
    current_nonce = signing.loads(token, salt="users.email.verify")["nonce"]
    url = build_email_verification_url(token)
    try:
        sent = send_mail(
            "Verify your email — Travel Planner",
            f"Confirm your email to start planning:\n{url}\n\nThis link expires in 24 hours and can only be used once.",
            settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False,
            html_message=render_to_string("travel/emails/verify_email.html", {"action_url": url}),
        )
        if sent != 1:
            raise EmailDeliveryError("The email was not accepted for sending.")
        return True
    except Exception:
        # A failed resend must not invalidate a link that was delivered earlier.
        AccountProfile.objects.filter(user=user, verified=False, email_verification_nonce=current_nonce).update(
            email_verification_nonce=previous_nonce,
        )
        cache.delete(f"auth:resend:email:{user.email.strip().lower()}")
        raise


@transaction.atomic
def verify_email_token(token):
    try:
        data = signing.loads(token, salt="users.email.verify", max_age=86400)
        if not isinstance(data, dict):
            return None
        profile = AccountProfile.objects.select_related("user").filter(
            user_id=data.get("uid"), email=data.get("email"), verified=False,
        ).first()
    except (signing.BadSignature, ValueError, TypeError, OverflowError):
        return None
    if not profile or profile.user.email.lower() != profile.email:
        return None
    nonce = data.get("nonce")
    if not isinstance(nonce, str) or not nonce or not constant_time_compare(profile.email_verification_nonce, nonce):
        return None
    if not AccountProfile.objects.filter(pk=profile.pk, verified=False, email_verification_nonce=nonce).update(
        verified=True, email_verification_nonce="",
    ):
        return None
    profile.user.is_active = True
    profile.user.save(update_fields=["is_active"])
    return profile.user


def is_resend_verification_throttled(email="", ip=""):
    for kind, value in (("email", email.strip().lower()), ("ip", ip)):
        if value and not cache.add(f"auth:resend:{kind}:{value}", True, timeout=60):
            return True
    return False
