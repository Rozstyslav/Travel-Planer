"""Django email backend backed by Resend; importing this module never sends mail."""

import logging

import resend as resend_sdk
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from resend.http_client_requests import RequestsClient

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """A message was not accepted by the email provider."""


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        messages = list(email_messages or [])
        if not messages:
            return 0
        if not settings.RESEND_API_KEY:
            if self.fail_silently:
                return 0
            raise EmailDeliveryError("Email delivery is not configured.")
        resend_sdk.api_key = settings.RESEND_API_KEY
        resend_sdk.default_http_client = RequestsClient(timeout=settings.RESEND_TIMEOUT)
        sent = 0
        for message in messages:
            if not message.recipients():
                continue
            params = {
                "from": message.from_email or settings.DEFAULT_FROM_EMAIL,
                "to": list(message.to),
                "subject": message.subject,
                "text": message.body,
            }
            for key in ("cc", "bcc", "reply_to"):
                values = getattr(message, key, None)
                if values:
                    params[key] = list(values)
            if message.content_subtype == "html":
                params["html"] = params.pop("text")
            for alternative in getattr(message, "alternatives", []):
                if alternative.mimetype == "text/html":
                    params["html"] = alternative.content
            try:
                result = resend_sdk.Emails.send(params)
                if not isinstance(result, dict) or not result.get("id"):
                    raise EmailDeliveryError("Resend did not accept the message.")
            except Exception as error:
                # Do not log API keys, verification tokens or recipient addresses.
                logger.warning("Resend delivery failed (%s)", type(error).__name__)
                if not self.fail_silently:
                    raise EmailDeliveryError("Could not send email. Please try again later.") from error
            else:
                sent += 1
        return sent
