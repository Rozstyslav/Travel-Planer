from unittest.mock import patch

from django.test import TestCase

from travel.clients.art_institute import ArtworkData
from travel.exceptions import ArtworkNotFoundError
from travel.models import ProjectPlace, TravelProject
from travel.services import (
    create_project_with_places,
    update_project_place,
)


class TravelServiceTests(TestCase):
    @patch("travel.services.ArtInstituteClient.get_artwork")

    def test_project_is_not_partially_created(self,mock_get_artwork):

        mock_get_artwork.side_effect = [
            ArtworkData(
                external_id=1,
                title="Valid Artwork",
                artist_display="Artist",
                image_id="image-id",
            ),
            ArtworkNotFoundError(
                "Second artwork does not exist."
            ),
        ]

        with self.assertRaises(ArtworkNotFoundError):
            create_project_with_places(
                project_data={
                    "name": "Invalid Project"
                },
                places_data=[
                    {"external_id": 1},
                    {"external_id": 999999},
                ],
            )

        self.assertEqual(TravelProject.objects.count(), 0)
        self.assertEqual(ProjectPlace.objects.count(), 0)

    def test_update_only_notes(self):

        project = TravelProject.objects.create(
            name="Project"
        )
        place = ProjectPlace.objects.create(
            project=project,
            external_id=1,
            title="Artwork",
            notes="Old notes",
            visited=True,
        )

        update_project_place(
            place=place,
            notes="New notes",
        )

        place.refresh_from_db()

        self.assertEqual(place.notes, "New notes")
        self.assertTrue(place.visited)

    def test_update_visited_to_false(self):

        project = TravelProject.objects.create(
            name="Project"
        )
        place = ProjectPlace.objects.create(
            project=project,
            external_id=1,
            title="Artwork",
            visited=True,
        )

        update_project_place(
            place=place,
            visited=False,
        )

        place.refresh_from_db()

        self.assertFalse(place.visited)