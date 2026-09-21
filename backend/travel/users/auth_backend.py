from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """Accept existing usernames as well as unique, case-insensitive emails."""

    def authenticate(self, request, username=None, password=None, email=None, **kwargs):
        User = get_user_model()
        identifier = (email or username or "").strip()
        if not identifier or password is None:
            return None
        candidates = User.objects.filter(email__iexact=identifier) if email else User.objects.filter(username=identifier)
        if not email and not candidates.exists():
            candidates = User.objects.filter(email__iexact=identifier)
        users = list(candidates[:2])
        if len(users) != 1:
            User().set_password(password)
            return None
        user = users[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
