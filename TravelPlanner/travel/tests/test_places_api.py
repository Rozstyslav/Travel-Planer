from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

from travel.clients.art_institute import ArtworkData
from travel.exceptions import (
    ArtInstituteUnavailableError,
    ArtworkNotFoundError,
)
from travel.models import ProjectPlace, TravelProject


class ProjectPlaceApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="place_test_user",
            password="test-password-123",
        )

        self.client.force_authenticate(user=self.user)

        self.project = TravelProject.objects.create(
            name="Chicago Trip"
        )

        self.places_url = reverse(
            "travel:project-place-list",
            kwargs={
                "project_id": self.project.pk,
            },
        )

    @patch("travel.services.ArtInstituteClient.get_artwork")
    def test_add_place_to_project(self,mock_get_artwork):

        mock_get_artwork.return_value = ArtworkData(
            external_id=27992,
            title="Test Artwork",
            artist_display="Test Artist",
            image_id="image-id",
        )

        response = self.client.post(
            self.places_url,
            {
                "external_id": 27992,
                "notes": "Visit this artwork",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(self.project.places.count(), 1)

        place = self.project.places.get()

        self.assertEqual(place.external_id, 27992)
        self.assertEqual(place.notes, "Visit this artwork")

    @patch("travel.services.ArtInstituteClient.get_artwork")
    def test_cannot_add_same_place_twice(self,mock_get_artwork):
        artwork = ArtworkData(
            external_id=27992,
            title="Test Artwork",
            artist_display="Artist",
            image_id="image-id",
        )

        mock_get_artwork.return_value = artwork

        ProjectPlace.objects.create(
            project=self.project,
            external_id=27992,
            title="Test Artwork",
        )

        response = self.client.post(
            self.places_url,
            {"external_id": 27992},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(self.project.places.count(), 1)

    @patch("travel.services.ArtInstituteClient.get_artwork")
    def test_cannot_add_more_than_ten_places(self,mock_get_artwork):

        for external_id in range(1, 11):
            ProjectPlace.objects.create(
                project=self.project,
                external_id=external_id,
                title=f"Artwork {external_id}",
            )

        mock_get_artwork.return_value = ArtworkData(
            external_id=11,
            title="Artwork 11",
            artist_display="Artist",
            image_id="image-id",
        )

        response = self.client.post(
            self.places_url,
            {"external_id": 11},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(self.project.places.count(), 10)

    @patch(
        "travel.services.ArtInstituteClient.get_artwork",
        side_effect=ArtworkNotFoundError(
            "Artwork does not exist."
        ),
    )
    def test_cannot_add_nonexistent_artwork(self,mock_get_artwork):

        response = self.client.post(
            self.places_url,
            {"external_id": 999999999},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(self.project.places.count(), 0)
        self.assertIn("external_id", response.data)

    @patch(
        "travel.services.ArtInstituteClient.get_artwork",
        side_effect=ArtInstituteUnavailableError(
            "Art Institute API is unavailable."
        ),
    )
    def test_return_503_when_external_api_is_unavailable(self,mock_get_artwork):

        response = self.client.post(
            self.places_url,
            {"external_id": 27992},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
        self.assertEqual(self.project.places.count(), 0)

    def test_list_project_places(self):

        ProjectPlace.objects.create(
            project=self.project,
            external_id=1,
            title="First Artwork",
        )
        ProjectPlace.objects.create(
            project=self.project,
            external_id=2,
            title="Second Artwork",
        )

        response = self.client.get(self.places_url)

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(len(response.data), 2)

    def test_get_single_place(self):

        place = ProjectPlace.objects.create(
            project=self.project,
            external_id=1,
            title="Artwork",
        )

        url = reverse(
            "travel:project-place-detail",
            kwargs={
                "project_id": self.project.pk,
                "pk": place.pk,
            },
        )

        response = self.client.get(url)

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(response.data["id"], place.pk)

    def test_update_place_notes_and_visited(self):

        place = ProjectPlace.objects.create(
            project=self.project,
            external_id=1,
            title="Artwork",
            notes="Old notes",
            visited=False,
        )

        url = reverse(
            "travel:project-place-detail",
            kwargs={
                "project_id": self.project.pk,
                "pk": place.pk,
            },
        )

        response = self.client.patch(
            url,
            {
                "notes": "Already visited",
                "visited": True,
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )

        place.refresh_from_db()

        self.assertEqual(place.notes, "Already visited")
        self.assertTrue(place.visited)

    def test_place_cannot_be_accessed_through_another_project(self):

        another_project = TravelProject.objects.create(
            name="Another Project"
        )

        place = ProjectPlace.objects.create(
            project=self.project,
            external_id=1,
            title="Artwork",
        )

        url = reverse(
            "travel:project-place-detail",
            kwargs={
                "project_id": another_project.pk,
                "pk": place.pk,
            },
        )

        response = self.client.get(url)

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )