from django.contrib.staticfiles import finders
from pathlib import Path
from tempfile import TemporaryDirectory
from django.test import SimpleTestCase
from django.urls import reverse


class FrontendTests(SimpleTestCase):
    def test_home_is_public_and_renders_the_planner(self):
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "travel/index.html")
        self.assertContains(response, 'lang="en"')
        self.assertContains(response, 'id="trips-view"')
        self.assertContains(response, "/static/travel/app.js")

    def test_frontend_assets_are_discoverable(self):
        assets = [
            "app.css", "app.js", "favicon.svg", "image-placeholder.svg",
            "fonts/manrope.woff2", "fonts/manrope-cyrillic.woff2", "fonts/country-flags.woff2",
            "images/chicago.jpg",
        ]
        for asset in assets:
            with self.subTest(asset=asset):
                self.assertIsNotNone(finders.find(f"travel/{asset}"))

    def test_home_refreshes_assets_when_css_or_javascript_changes(self):
        with TemporaryDirectory() as directory:
            frontend = Path(directory)
            assets = frontend / "static" / "travel"
            assets.mkdir(parents=True)
            for name in ("app.css", "app.js"):
                (assets / name).write_text("original", encoding="utf-8")
            with self.settings(FRONTEND_DIR=frontend):
                response = self.client.get('/')
                version = response.context['frontend_version']
                self.assertEqual(self.client.get('/').context['frontend_version'], version)
                self.assertIn('no-store', response.headers['Cache-Control'])
                for name in ("app.css", "app.js"):
                    (assets / name).write_text("updated", encoding="utf-8")
                    response = self.client.get('/')
                    next_version = response.context['frontend_version']
                    self.assertNotEqual(next_version, version)
                    self.assertContains(response, f'/static/travel/app.css?v={next_version}')
                    self.assertContains(response, f'/static/travel/app.js?v={next_version}')
                    version = next_version

    def test_home_uses_geographic_discovery(self):
        response = self.client.get('/')
        self.assertContains(response, 'id="country-select"')
        self.assertContains(response, 'id="city-query"')
        self.assertNotContains(response, 'artic.edu')

    def test_interface_copy_is_english(self):
        response = self.client.get('/')
        self.assertContains(response, 'Plan a trip')
        self.assertContains(response, 'Main navigation')
        self.assertNotRegex(response.content.decode(), r'[\u0400-\u04ff]')
        for asset in ('app.js', 'image-placeholder.svg'):
            self.assertNotRegex(Path(finders.find(f'travel/{asset}')).read_text(encoding='utf-8'), r'[\u0400-\u04ff]')
