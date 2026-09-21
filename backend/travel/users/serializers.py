from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework.exceptions import APIException, AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import PasswordResetConfirmation
from .services import register_user
from .tokens import password_reset_token_generator

User = get_user_model()


class RegistrationUnavailable(APIException):
    status_code = 503
    default_detail = "Registration is temporarily unavailable. Please try again later."
    default_code = "registration_unavailable"


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, validators=User._meta.get_field("username").validators)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        attrs["email"] = attrs["email"].strip().lower()
        existing_email = User.objects.filter(email__iexact=attrs["email"]).exists()
        if not existing_email and User.objects.filter(username=attrs["username"]).exists():
            raise serializers.ValidationError({"username": "This username is already taken."})
        try:
            validate_password(attrs["password"], user=User(username=attrs["username"], email=attrs["email"]))
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": error.messages}) from error
        return attrs

    def create(self, validated_data):
        try:
            return register_user(validated_data)
        except IntegrityError as error:
            # A failed profile insert or broken foreign key is not a username conflict.
            if User.objects.filter(username=validated_data["username"]).exists():
                raise serializers.ValidationError({"username": "This username is already taken."}) from error
            raise RegistrationUnavailable() from error


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2048)


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetRequestSerializer(ResendVerificationSerializer):
    pass


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(required=False, max_length=254)
    email = serializers.EmailField(required=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if bool(attrs.get("email")) == bool(attrs.get("username")):
            raise serializers.ValidationError("Provide a username or email.")
        credentials = {"email": attrs["email"]} if attrs.get("email") else {"username": attrs["username"]}
        user = authenticate(request=self.context.get("request"), password=attrs["password"], **credentials)
        if user is None or not user.is_active:
            raise AuthenticationFailed("Incorrect username/email or password, or email not yet verified.")
        refresh = RefreshToken.for_user(user)
        return {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {"id": user.pk, "username": user.username, "email": user.email},
        }


class SecureTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        token = self.token_class(attrs["refresh"])
        # SimpleJWT's standard refresh path does not check password revocation.
        JWTAuthentication().get_user(token)
        return super().validate(attrs)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Legacy serializer name; SimpleJWT adds the password-revocation claim."""


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=128)
    token = serializers.CharField(max_length=256)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        try:
            uid = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=uid, is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError, UnicodeError) as error:
            raise serializers.ValidationError("Invalid or expired password reset link.") from error
        if not password_reset_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError("Invalid or expired password reset link.")
        try:
            validate_password(attrs["password"], user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": error.messages}) from error
        attrs["user"] = user
        return attrs

    @transaction.atomic
    def save(self, ip_address=None, user_agent=""):
        user = User.objects.select_for_update().get(pk=self.validated_data["user"].pk)
        if not user.is_active or not password_reset_token_generator.check_token(user, self.validated_data["token"]):
            raise serializers.ValidationError("Invalid or expired password reset link.")
        user.set_password(self.validated_data["password"])
        user.save(update_fields=["password"])
        PasswordResetConfirmation.objects.create(
            user=user, ip_address=ip_address, user_agent=user_agent, success=True,
        )
        return user
