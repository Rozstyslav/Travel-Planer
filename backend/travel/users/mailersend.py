"""Django email backend for MailerSend; importing this module never sends mail."""

import logging
from email.utils import parseaddr

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from mailersend import EmailBuilder, MailerSendClient

logger = logging.getLogger(__name__)
# SDK errors can contain recipient addresses and message content.
# Report only exception types through the application logger below.
_sdk_logger = logging.Logger(__name__ + ".sdk")
_sdk_logger.disabled = True


class EmailDeliveryError(Exception):
    """A message was not accepted by the email provider."""


def _contact(address):
    name, email = parseaddr(address)
    return {"email": email, **({"name": name} if name else {})}


class MailerSendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        messages = list(email_messages or [])
        if not messages:
            return 0
        if not settings.MAILERSEND_API_KEY:
            if self.fail_silently:
                return 0
            raise EmailDeliveryError("Email delivery is not configured.")

        sent = 0
        for message in messages:
            if not message.recipients():
                continue
            try:
                builder = (
                    EmailBuilder()
                    .from_email(**_contact(message.from_email or settings.DEFAULT_FROM_EMAIL))
                    .to_many([_contact(address) for address in message.to])
                    .subject(message.subject)
                )
                if message.content_subtype == "html":
                    builder.html(message.body)
                else:
                    builder.text(message.body)
                for alternative in getattr(message, "alternatives", []):
                    if alternative.mimetype == "text/html":
                        builder.html(alternative.content)
                for field in ("cc", "bcc"):
                    for address in getattr(message, field):
                        getattr(builder, field)(**_contact(address))
                if len(message.reply_to) > 1:
                    raise EmailDeliveryError("MailerSend supports one reply-to address.")
                if message.reply_to:
                    builder.reply_to(**_contact(message.reply_to[0]))
                email = builder.build()
                client = MailerSendClient(
                    api_key=settings.MAILERSEND_API_KEY,
                    timeout=settings.MAILERSEND_TIMEOUT,
                    # Retrying a POST after a timeout can send duplicate emails.
                    max_retries=0,
                    logger=_sdk_logger,
                )
                client.emails.logger = _sdk_logger
                with client.session:
                    response = client.emails.send(email)
                if not response.get("id"):
                    raise EmailDeliveryError("MailerSend did not accept the message.")
            except Exception as error:
                logger.warning("MailerSend delivery failed (%s)", type(error).__name__)
                if not self.fail_silently:
                    raise EmailDeliveryError("Could not send email. Please try again later.") from error
            else:
                sent += 1
        return sent
