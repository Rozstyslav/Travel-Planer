from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

from travel.clients.art_institute import ArtworkData
from travel.exceptions import ArtworkNotFoundError
from travel.models import ProjectPlace, TravelProject


class TravelProjectApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="project_test_user",
            password="test-password-123",
        )

        self.client.force_authenticate(user=self.user)

        self.projects_url = reverse(
            "travel:project-list"
        )

    def test_create_project_without_places(self):
        payload = {
            "name": "Chicago Trip",
            "description": "Visit Chicago artworks",
            "start_date": "2026-08-15",
            "places": [],
        }

        response = self.client.post(
            self.projects_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(TravelProject.objects.count(), 1)

        project = TravelProject.objects.get()

        self.assertEqual(project.name, "Chicago Trip")
        self.assertEqual(project.places.count(), 0)

    @patch("travel.services.ArtInstituteClient.get_artwork")
    def test_create_project_with_places(self,mock_get_artwork):

        mock_get_artwork.return_value = ArtworkData(
            external_id=27992,
            title="Test Artwork",
            artist_display="Test Artist",
            image_id="test-image-id",
        )

        payload = {
            "name": "Art Trip",
            "places": [
                {
                    "external_id": 27992,
                    "notes": "Visit first",
                }
            ],
        }

        response = self.client.post(
            self.projects_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(TravelProject.objects.count(), 1)
        self.assertEqual(ProjectPlace.objects.count(), 1)

        place = ProjectPlace.objects.get()

        self.assertEqual(place.external_id, 27992)
        self.assertEqual(place.title, "Test Artwork")
        self.assertEqual(place.notes, "Visit first")
        self.assertFalse(place.visited)

        mock_get_artwork.assert_called_once_with(27992)

    def test_reject_more_than_ten_places(self):

        payload = {
            "name": "Large Trip",
            "places": [
                {"external_id": external_id}
                for external_id in range(1, 12)
            ],
        }

        response = self.client.post(
            self.projects_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(TravelProject.objects.count(), 0)
        self.assertIn("places", response.data)

    def test_reject_duplicate_places_in_creation_request(self):

        payload = {
            "name": "Duplicate Trip",
            "places": [
                {"external_id": 27992},
                {"external_id": 27992},
            ],
        }

        response = self.client.post(
            self.projects_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(TravelProject.objects.count(), 0)
        self.assertIn("places", response.data)

    @patch(
        "travel.services.ArtInstituteClient.get_artwork",
        side_effect=ArtworkNotFoundError(
            "Artwork was not found."
        ),
    )
    def test_project_is_not_created_if_place_does_not_exist(self,mock_get_artwork):
        payload = {
            "name": "Invalid Trip",
            "places": [
                {"external_id": 999999999}
            ],
        }

        response = self.client.post(
            self.projects_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(TravelProject.objects.count(), 0)
        self.assertEqual(ProjectPlace.objects.count(), 0)

    def test_list_projects(self):

        TravelProject.objects.create(name="First Project")
        TravelProject.objects.create(name="Second Project")

        response = self.client.get(self.projects_url)

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(len(response.data), 2)

    def test_get_single_project(self):

        project = TravelProject.objects.create(
            name="Chicago Trip"
        )

        url = reverse(
            "travel:project-detail",
            kwargs={"pk": project.pk},
        )

        response = self.client.get(url)

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(response.data["id"], project.pk)
        self.assertEqual(response.data["name"], "Chicago Trip")

    def test_update_project(self):

        project = TravelProject.objects.create(
            name="Old Name"
        )

        url = reverse(
            "travel:project-detail",
            kwargs={"pk": project.pk},
        )

        response = self.client.patch(
            url,
            {
                "name": "New Name",
                "description": "Updated description",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )

        project.refresh_from_db()

        self.assertEqual(project.name, "New Name")
        self.assertEqual(
            project.description,
            "Updated description",
        )

    def test_delete_project_without_visited_places(self):

        project = TravelProject.objects.create(
            name="Deletable Project"
        )

        ProjectPlace.objects.create(
            project=project,
            external_id=100,
            title="Artwork",
            visited=False,
        )

        url = reverse(
            "travel:project-detail",
            kwargs={"pk": project.pk},
        )

        response = self.client.delete(url)

        self.assertEqual(
            response.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(
            TravelProject.objects.filter(
                pk=project.pk
            ).exists()
        )

    def test_cannot_delete_project_with_visited_place(self):

        project = TravelProject.objects.create(
            name="Protected Project"
        )

        ProjectPlace.objects.create(
            project=project,
            external_id=100,
            title="Visited Artwork",
            visited=True,
        )

        url = reverse(
            "travel:project-detail",
            kwargs={"pk": project.pk},
        )

        response = self.client.delete(url)

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertTrue(
            TravelProject.objects.filter(
                pk=project.pk
            ).exists()
        )