from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase

from travel.clients.art_institute import ArtInstituteClient
from travel.exceptions import (
    ArtInstituteUnavailableError,
    ArtworkNotFoundError,
)


class ArtInstituteClientTests(SimpleTestCase):
    def setUp(self):
        self.client = ArtInstituteClient()

    @patch(
        "travel.clients.art_institute.requests.get"
    )
    def test_get_existing_artwork(self,mock_get):

        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "data": {
                "id": 27992,
                "title": "Test Artwork",
                "artist_display": "Test Artist",
                "image_id": "image-id",
            }
        }
        response.raise_for_status.return_value = None

        mock_get.return_value = response

        artwork = self.client.get_artwork(27992)

        self.assertEqual(artwork.external_id, 27992)
        self.assertEqual(artwork.title, "Test Artwork")
        self.assertEqual(
            artwork.artist_display,
            "Test Artist",
        )
        self.assertEqual(artwork.image_id, "image-id")

        mock_get.assert_called_once()

    @patch("travel.clients.art_institute.requests.get")
    def test_raise_error_when_artwork_not_found(self,mock_get):

        response = Mock()
        response.status_code = 404

        mock_get.return_value = response

        with self.assertRaises(ArtworkNotFoundError):
            self.client.get_artwork(999999999)

    @patch(
        "travel.clients.art_institute.requests.get",
        side_effect=requests.RequestException(
            "Connection error"
        ),
    )
    def test_raise_error_when_api_is_unavailable(self,mock_get):

        with self.assertRaises(
            ArtInstituteUnavailableError
        ):
            self.client.get_artwork(27992)

    @patch("travel.clients.art_institute.requests.get")

    def test_raise_error_for_invalid_api_response(self,mock_get):

        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "unexpected": "response"
        }

        mock_get.return_value = response

        with self.assertRaises(
            ArtInstituteUnavailableError
        ):
            self.client.get_artwork(27992)

    def test_external_id_must_be_positive_integer(self):
        invalid_values = [
            0,
            -1,
            "27992",
            True,
            None,
        ]

        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.client.get_artwork(value)