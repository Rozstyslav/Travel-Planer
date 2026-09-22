from hashlib import sha256
import json

from django.conf import settings
from django.shortcuts import render
from django.templatetags.static import static
from django.views.decorators.cache import never_cache


@never_cache
def home(request):
    """The public travel planner; authenticated operations use the existing API."""
    # Version every module as well as the entry script to avoid mixed cached code.
    # Read on each render so runserver also picks up changes to static files.
    revision = sha256()
    assets = settings.FRONTEND_DIR / "static" / "travel"
    modules = sorted((assets / "js").rglob("*.js"))
    for path in [assets / "app.css", assets / "app.js", assets / "favicon.svg", *modules]:
        revision.update(path.relative_to(assets).as_posix().encode())
        revision.update(path.read_bytes())
    version = revision.hexdigest()[:16]
    imports = {
        f"travel/{path.relative_to(assets / 'js').as_posix()}":
            f"{static('travel/' + path.relative_to(assets).as_posix())}?v={version}"
        for path in modules
    }
    return render(request, "travel/index.html", {
        "frontend_version": version,
        "frontend_importmap": json.dumps({"imports": imports}).replace("<", "\\u003c"),
    })
