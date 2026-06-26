from collections.abc import Sequence
from typing import Any

from django.db import IntegrityError, transaction

from travel.clients.art_institute import ArtInstituteClient
from travel.exceptions import (
    DuplicateProjectPlaceError,
    ProjectHasVisitedPlacesError,
    ProjectPlaceLimitError,
)
from travel.models import ProjectPlace, TravelProject


MAX_PLACES_PER_PROJECT = 10


def create_project_with_places(*,project_data: dict[str, Any],places_data: Sequence[dict[str, Any]] | None = None,) -> TravelProject:

    places_data = list(places_data or [])

    if len(places_data) > MAX_PLACES_PER_PROJECT:
        raise ProjectPlaceLimitError(
            f"A project cannot contain more than {MAX_PLACES_PER_PROJECT} places."
        )

    external_ids = [
        place_data["external_id"]
        for place_data in places_data
    ]

    if len(external_ids) != len(set(external_ids)):
        raise DuplicateProjectPlaceError(
            "The same external place cannot be added to one project more than once."
        )

    client = ArtInstituteClient()
    validated_places: list[dict[str, Any]] = []

    for place_data in places_data:
        artwork = client.get_artwork(
            place_data["external_id"]
        )

        validated_places.append(
            {
                "external_id": artwork.external_id,
                "title": artwork.title,
                "artist_display": artwork.artist_display,
                "image_id": artwork.image_id,
                "notes": place_data.get("notes", ""),
                "visited": False,
            }
        )

    with transaction.atomic():
        project = TravelProject.objects.create(**project_data)

        ProjectPlace.objects.bulk_create(
            [
                ProjectPlace(
                    project=project,
                    **place_data,
                )
                for place_data in validated_places
            ]
        )

    return project

def add_place_to_project(*,project: TravelProject,external_id: int,notes: str = "",) -> ProjectPlace:

    client = ArtInstituteClient()

    artwork = client.get_artwork(external_id)

    try:
        with transaction.atomic():
            locked_project = (
                TravelProject.objects
                .select_for_update()
                .get(pk=project.pk)
            )

            if locked_project.places.count() >= MAX_PLACES_PER_PROJECT:
                raise ProjectPlaceLimitError(
                    f"A project cannot contain more than {MAX_PLACES_PER_PROJECT} places."
                )

            if locked_project.places.filter(
                external_id=external_id
            ).exists():
                raise DuplicateProjectPlaceError(
                    "This place is already included in the project."
                )

            return ProjectPlace.objects.create(
                project=locked_project,
                external_id=artwork.external_id,
                title=artwork.title,
                artist_display=artwork.artist_display,
                image_id=artwork.image_id,
                notes=notes,
                visited=False,
            )

    except IntegrityError as exc:
        raise DuplicateProjectPlaceError(
            "This place is already included in the project."
        ) from exc


def update_project_place(*,place: ProjectPlace,notes: str | None = None,visited: bool | None = None,) -> ProjectPlace:

    update_fields: list[str] = []

    if notes is not None:
        place.notes = notes
        update_fields.append("notes")

    if visited is not None:
        place.visited = visited
        update_fields.append("visited")

    if update_fields:
        update_fields.append("updated_at")
        place.save(update_fields=update_fields)

    return place


def delete_project(*,project: TravelProject,) -> None:

    with transaction.atomic():
        locked_project = (
            TravelProject.objects
            .select_for_update()
            .get(pk=project.pk)
        )

        if locked_project.places.filter(
            visited=True
        ).exists():
            raise ProjectHasVisitedPlacesError(
                "A project containing visited places cannot be deleted."
            )

        locked_project.delete()