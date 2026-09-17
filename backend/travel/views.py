from hashlib import sha256

from django.conf import settings
from django.shortcuts import render
from django.views.decorators.cache import never_cache


@never_cache
def home(request):
    """The public travel planner; authenticated operations use the existing API."""
    # Keep CSS and JS on the same revision, even in browsers with old assets cached.
    # Read on each render so runserver also picks up changes to static files.
    revision = sha256()
    for name in ("app.css", "app.js"):
        revision.update((settings.FRONTEND_DIR / "static" / "travel" / name).read_bytes())
    return render(request, "travel/index.html", {"frontend_version": revision.hexdigest()[:16]})
