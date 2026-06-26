from django.shortcuts import get_object_or_404
from rest_framework import generics, status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from travel.api.serializers import (
    ProjectPlaceCreateSerializer,
    ProjectPlaceReadSerializer,
    ProjectPlaceUpdateSerializer,
    TravelProjectCreateSerializer,
    TravelProjectReadSerializer,
    TravelProjectUpdateSerializer,
)
from travel.exceptions import (
    ArtInstituteUnavailableError,
    ArtworkNotFoundError,
    DuplicateProjectPlaceError,
    ProjectHasVisitedPlacesError,
    ProjectPlaceLimitError,
)
from travel.models import ProjectPlace, TravelProject
from travel.services import (
    add_place_to_project,
    delete_project,
)


class TravelProjectViewSet(viewsets.ModelViewSet):

    queryset = (
        TravelProject.objects
        .prefetch_related("places")
        .all()
    )

    def get_serializer_class(self):

        if self.action == "create":
            return TravelProjectCreateSerializer

        if self.action in ("update", "partial_update"):
            return TravelProjectUpdateSerializer

        return TravelProjectReadSerializer

    def create(self,request: Request,*args,**kwargs,) -> Response:

        serializer = self.get_serializer(
            data=request.data,
        )
        serializer.is_valid(raise_exception=True)

        try:
            project = serializer.save()
        except ArtInstituteUnavailableError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        output_serializer = TravelProjectReadSerializer(
            project,
            context=self.get_serializer_context(),
        )

        return Response(
            output_serializer.data,
            status=status.HTTP_201_CREATED,
        )

    def destroy(self,request: Request,*args,**kwargs,) -> Response:

        project = self.get_object()

        try:
            delete_project(project=project)
        except ProjectHasVisitedPlacesError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            status=status.HTTP_204_NO_CONTENT,
        )


class ProjectPlaceListCreateView(generics.ListCreateAPIView):

    def get_queryset(self):
        return (
            ProjectPlace.objects
            .filter(
                project_id=self.kwargs["project_id"]
            )
            .select_related("project")
        )

    def get_serializer_class(self):
        if self.request.method == "POST":
            return ProjectPlaceCreateSerializer

        return ProjectPlaceReadSerializer

    def create(self,request: Request,*args,**kwargs,) -> Response:

        project = get_object_or_404(
            TravelProject,
            pk=self.kwargs["project_id"],
        )

        serializer = self.get_serializer(
            data=request.data,
        )
        serializer.is_valid(raise_exception=True)

        try:
            place = add_place_to_project(
                project=project,
                external_id=serializer.validated_data[
                    "external_id"
                ],
                notes=serializer.validated_data.get(
                    "notes",
                    "",
                ),
            )

        except ArtworkNotFoundError as exc:
            return Response(
                {
                    "external_id": [
                        str(exc),
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        except DuplicateProjectPlaceError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )

        except ProjectPlaceLimitError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )

        except ArtInstituteUnavailableError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        output_serializer = ProjectPlaceReadSerializer(
            place,
            context=self.get_serializer_context(),
        )

        return Response(
            output_serializer.data,
            status=status.HTTP_201_CREATED,
        )

class ProjectPlaceDetailView(generics.RetrieveUpdateAPIView):

    def get_queryset(self):
        return (
            ProjectPlace.objects
            .filter(
                project_id=self.kwargs["project_id"]
            )
            .select_related("project")
        )

    def get_serializer_class(self):
        if self.request.method == "GET":
            return ProjectPlaceReadSerializer

        return ProjectPlaceUpdateSerializer