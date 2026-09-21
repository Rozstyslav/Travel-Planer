from django.contrib.auth.tokens import PasswordResetTokenGenerator

# Password changes invalidate links; Django enforces PASSWORD_RESET_TIMEOUT.
password_reset_token_generator = PasswordResetTokenGenerator()
