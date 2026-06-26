from rest_framework import serializers

from travel.exceptions import (
    ArtworkNotFoundError,
    DuplicateProjectPlaceError,
    ProjectPlaceLimitError,
)
from travel.models import ProjectPlace, TravelProject
from travel.services import (
    MAX_PLACES_PER_PROJECT,
    create_project_with_places,
    update_project_place,
)

class PlaceInputSerializer(serializers.Serializer):

    external_id = serializers.IntegerField(min_value=1,)
    notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        default='',
    )

class ProjectPlaceReadSerializer(serializers.ModelSerializer):

    project_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectPlace
        fields = (
            "id",
            "project_id",
            "external_id",
            "title",
            "artist_display",
            "image_id",
            "notes",
            "visited",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

class TravelProjectReadSerializer(serializers.ModelSerializer):

    places = ProjectPlaceReadSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = TravelProject
        fields = (
            "id",
            "name",
            "description",
            "start_date",
            "places",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

class TravelProjectCreateSerializer(serializers.ModelSerializer):

    places = PlaceInputSerializer(
        many=True,
        required=False,
        write_only=True,
    )

    class Meta:
        model = TravelProject
        fields = (
            "id",
            "name",
            "description",
            "start_date",
            "places",
        )
        read_only_fields = ("id",)

        extra_kwargs = {
            "description": {
                "required": False,
                "allow_blank": True,
            },
            "start_date": {
                "required": False,
                "allow_null": True,
            },
        }

    def validate_name(self, value: str) -> str:

        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "Project name cannot be empty."
            )

        return value

    def validate_places(self,places: list[dict],) -> list[dict]:

        if len(places) > MAX_PLACES_PER_PROJECT:
            raise serializers.ValidationError(
                f"A project cannot contain more than {MAX_PLACES_PER_PROJECT} places."
            )

        external_ids = [
            place["external_id"]
            for place in places
        ]

        if len(external_ids) != len(set(external_ids)):
            raise serializers.ValidationError(
                "The same external place cannot be added more than once."
            )

        return places

    def create(self,validated_data: dict,) -> TravelProject:

        places_data = validated_data.pop("places",[],)

        try:
            return create_project_with_places(
                project_data=validated_data,
                places_data=places_data,
            )

        except ProjectPlaceLimitError as exc:
            raise serializers.ValidationError(
                {"places": [str(exc)]}
            ) from exc

        except DuplicateProjectPlaceError as exc:
            raise serializers.ValidationError(
                {"places": [str(exc)]}
            ) from exc

        except ArtworkNotFoundError as exc:
            raise serializers.ValidationError(
                {"places": [str(exc)]}
            ) from exc

    def to_representation(self,instance: TravelProject,) -> dict:

        return TravelProjectReadSerializer(
            instance,
            context=self.context,
        ).data

class TravelProjectUpdateSerializer(serializers.ModelSerializer):

    class Meta:
        model = TravelProject
        fields = (
            "name",
            "description",
            "start_date",
        )
        extra_kwargs = {
            "name": {
                "required": False,
            },
            "description": {
                "required": False,
                "allow_blank": True,
            },
            "start_date": {
                "required": False,
                "allow_null": True,
            },
        }

    def validate_name(self, value: str) -> str:

        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "Project name cannot be empty."
            )

        return value

    def validate(self, attrs: dict) -> dict:

        if not attrs:
            raise serializers.ValidationError(
                "At least one field must be provided."
            )

        return attrs

    def to_representation(self,instance: TravelProject,) -> dict:

        return TravelProjectReadSerializer(
            instance,
            context=self.context,
        ).data

class ProjectPlaceCreateSerializer(serializers.Serializer):

    external_id = serializers.IntegerField(
        min_value=1,
    )
    notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        default="",
    )


class ProjectPlaceUpdateSerializer(serializers.Serializer):

    notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
    )
    visited = serializers.BooleanField(
        required=False,
    )

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError(
                "At least one field must be provided."
            )

        return attrs

    def update(self,instance: ProjectPlace,validated_data: dict,) -> ProjectPlace:

        return update_project_place(
            place=instance,
            notes=validated_data.get("notes"),
            visited=validated_data.get("visited"),
        )

    def create(self, validated_data: dict):

        raise NotImplementedError(
            "Use ProjectPlaceCreateSerializer to create a place."
        )

    def to_representation(self,instance: ProjectPlace,) -> dict:

        return ProjectPlaceReadSerializer(
            instance,
            context=self.context,
        ).data