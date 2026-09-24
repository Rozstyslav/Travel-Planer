import logging
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from .mailersend import EmailDeliveryError

logger = logging.getLogger(__name__)


class PasswordResetEmailService:
    @staticmethod
    def send_reset_email(user, token, request=None):
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        link = f"{settings.APP_BASE_URL}/#reset-password?{urlencode({'uid': uid, 'token': token})}"
        try:
            sent = send_mail(
                "Reset your password — Travel Planner",
                f"Choose a new password using this link (valid for one hour):\n{link}\n\n"
                "If you did not request this, you can ignore this email.",
                settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False,
                html_message=render_to_string("travel/emails/reset_password.html", {"action_url": link}),
            )
            if sent != 1:
                raise EmailDeliveryError("The email was not accepted for sending.")
            return True
        except Exception as error:
            logger.warning("Password reset email failed (%s)", type(error).__name__)
            raise EmailDeliveryError("Could not send email. Please try again later.") from error
