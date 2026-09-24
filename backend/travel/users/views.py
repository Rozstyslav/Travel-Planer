from ipaddress import ip_address

from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenBlacklistView, TokenObtainPairView

from .email_service import PasswordResetEmailService
from .models import AccountProfile, PasswordResetAttempt, PasswordResetConfirmation
from .serializers import (
    LoginSerializer, PasswordResetConfirmSerializer, PasswordResetRequestSerializer,
    RegisterSerializer, ResendVerificationSerializer, VerifyEmailSerializer,
)
from .services import send_verification_email, verify_email_token, is_resend_verification_throttled
from .tokens import password_reset_token_generator
from .mailersend import EmailDeliveryError

User = get_user_model()
EMAIL_MESSAGE = {
    "detail": "If this email address needs verification, a confirmation link has been sent. "
    "Please check your inbox and spam folder."
}
RESET_MESSAGE = {"detail": "If the email exists, you will receive reset instructions."}
EMAIL_ERROR = {"detail": "We could not send the email. Please try again later.", "code": "email_delivery_failed"}
EMAIL_WAIT = {"detail": "Please wait a minute before requesting another verification email."}


def get_client_ip(request):
    # Forwarded headers are not trusted without an explicitly configured proxy.
    try:
        return str(ip_address(request.META.get("REMOTE_ADDR", "")))
    except ValueError:
        return None


class PublicAuthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]


@extend_schema(request=RegisterSerializer, responses={201: None})
class RegisterView(PublicAuthView):
    throttle_scope = "auth_register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, created, should_send = serializer.save()
        if should_send:
            if is_resend_verification_throttled(email=user.email):
                return Response(EMAIL_WAIT, status=429)
            try:
                send_verification_email(user)
            except EmailDeliveryError:
                return Response(EMAIL_ERROR, status=503)
        return Response(EMAIL_MESSAGE, status=status.HTTP_201_CREATED)


class VerifyEmailView(PublicAuthView):
    throttle_scope = "auth_verify"

    @extend_schema(request=VerifyEmailSerializer)
    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not verify_email_token(serializer.validated_data["token"]):
            return Response({"detail": "Invalid or expired verification link."}, status=400)
        return Response({"detail": "Email verified. You can now sign in."})

    def get(self, request):
        if not verify_email_token(request.query_params.get("token", "")):
            return Response({"detail": "Invalid or expired verification link."}, status=400)
        return Response({"detail": "Email verified. You can now sign in."})


class ResendVerificationView(PublicAuthView):
    throttle_scope = "auth_email"

    @extend_schema(request=ResendVerificationSerializer)
    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        if is_resend_verification_throttled(email=email):
            return Response(EMAIL_WAIT, status=429)
        profile = AccountProfile.objects.select_related("user").filter(
            email=email, verified=False, user__is_active=False,
        ).first()
        if profile and profile.user.email.lower() == email:
            try:
                send_verification_email(profile.user)
            except EmailDeliveryError:
                return Response(EMAIL_ERROR, status=503)
        return Response(EMAIL_MESSAGE)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_login"


class LogoutView(TokenBlacklistView):
    """Revoke the supplied refresh token, even if the access token has expired."""


class PasswordResetRequestView(PublicAuthView):
    throttle_scope = "password_reset"

    @extend_schema(request=PasswordResetRequestSerializer)
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(RESET_MESSAGE)
        email = serializer.validated_data["email"].strip().lower()
        users = list(User.objects.filter(email__iexact=email, is_active=True)[:2])
        user = users[0] if len(users) == 1 else None
        sent = False
        if user:
            try:
                sent = PasswordResetEmailService.send_reset_email(
                    user, password_reset_token_generator.make_token(user),
                )
            except EmailDeliveryError:
                PasswordResetAttempt.objects.create(
                    user=user, email=email, ip_address=get_client_ip(request), token_sent=False,
                )
                return Response(EMAIL_ERROR, status=503)
        PasswordResetAttempt.objects.create(
            user=user, email=email, ip_address=get_client_ip(request), token_sent=sent,
        )
        return Response(RESET_MESSAGE)


class PasswordResetConfirmView(PublicAuthView):
    throttle_scope = "password_reset_confirm"

    @extend_schema(request=PasswordResetConfirmSerializer)
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            PasswordResetConfirmation.objects.create(
                ip_address=get_client_ip(request),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:2000],
                success=False, failure_reason="invalid_reset",
            )
            if "password" in serializer.errors:
                return Response(serializer.errors, status=422)
            return Response({"detail": "Invalid or expired password reset link."}, status=400)
        serializer.save(
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:2000],
        )
        return Response({"detail": "Password changed successfully. Please sign in again."})
