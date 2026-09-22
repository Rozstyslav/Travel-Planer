from django.shortcuts import get_object_or_404
from rest_framework import generics, status, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from travel.api.serializers import (
    CitySearchSerializer, CountryCodeSerializer, PlaceInputSerializer, PlacesSearchSerializer,
    ProjectPlaceReadSerializer, ProjectPlaceUpdateSerializer, TravelProjectCreateSerializer,
    TravelProjectReadSerializer, TravelProjectUpdateSerializer, WikipediaQuerySerializer,
)
from travel.clients.countries import CountriesClient
from travel.clients.geoapify import GeoapifyClient
from travel.clients.wikipedia import WikipediaClient
from travel.exceptions import (
    CountryNotFoundError, PlaceNotFoundError, ProviderError, ProviderConfigurationError,
    DuplicateProjectPlaceError, ProjectHasVisitedPlacesError, ProjectPlaceLimitError,
)
from travel.models import ProjectPlace, SavedPlace, TravelProject
from travel.place_identity import unique_places
from travel.services import add_place_to_project, delete_project, get_place_details


class ProviderErrorsMixin:
    def handle_exception(self, exc):
        if isinstance(exc, ProviderError):
            return Response({'detail': str(exc), 'provider': exc.provider,
                             'code': 'provider_configuration' if isinstance(exc,
                                                                            ProviderConfigurationError) else 'provider_unavailable'},
                            status=503)
        if isinstance(exc, (CountryNotFoundError, PlaceNotFoundError)):
            return Response({'detail': str(exc), 'code': 'not_found'}, status=404)
        if isinstance(exc, (DuplicateProjectPlaceError, ProjectHasVisitedPlacesError, ProjectPlaceLimitError)):
            return Response({'detail': str(exc), 'code': 'conflict'}, status=409)
        return super().handle_exception(exc)


class DiscoveryThrottle(AnonRateThrottle):
    rate = '60/min'


class DiscoveryView(ProviderErrorsMixin, APIView):
    # Discovery is available to guests; project writes still require JWT.
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [DiscoveryThrottle]

    def query(self, serializer_class):
        serializer = serializer_class(data=self.request.query_params)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class CountryListView(DiscoveryView):
    def get(self, request):
        return Response({'results': CountriesClient().list_countries(), 'source': 'Countries GraphQL'})


class CountryDetailView(DiscoveryView):
    def get(self, request, code):
        serializer = CountryCodeSerializer(data={'code': code})
        serializer.is_valid(raise_exception=True)
        return Response(CountriesClient().get_country(serializer.validated_data['code']))


class CitySearchView(DiscoveryView):
    def get(self, request):
        data = self.query(CitySearchSerializer)
        return Response({'results': GeoapifyClient().search_cities(data['q'], data['country'], data['limit']),
                         'source': 'Geoapify / OpenStreetMap'})


class PlaceSearchView(DiscoveryView):
    def get(self, request):
        data = self.query(PlacesSearchSerializer)
        highlights = data['categories'] == 'tourism.sights' and data['sort'] == 'highlights'
        results = GeoapifyClient().search_places(**{**data, 'limit': data['limit'] + int(highlights)})
        has_more = len(results) > data['limit'] if highlights else len(results) == data['limit']
        if highlights:
            results = results[:data['limit']]
        return Response({'results': unique_places([p for p in results if p.get('has_name', True)]),
                         'offset': data['offset'], 'limit': data['limit'],
                         'has_more': has_more and data['offset'] + data['limit'] <= PlacesSearchSerializer.offset_limit(data),
                         'sort': data['sort'], 'source': 'Geoapify / OpenStreetMap'})


class PlaceDetailView(DiscoveryView):
    def get(self, request, place_id):
        serializer = PlaceInputSerializer(data={'place_id': place_id})
        serializer.is_valid(raise_exception=True)
        return Response(get_place_details(serializer.validated_data['place_id']))


class WikipediaSummaryView(DiscoveryView):
    def get(self, request):
        data = self.query(WikipediaQuerySerializer)
        return Response(WikipediaClient().summary(title=data.get('title', ''), query=data.get('q', '')))


class TravelProjectViewSet(ProviderErrorsMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = TravelProject.objects.prefetch_related('places').all()

    def get_queryset(self):
        return super().get_queryset().filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def get_serializer_class(self):
        if self.action == 'create':
            return TravelProjectCreateSerializer
        if self.action in ('update', 'partial_update'):
            return TravelProjectUpdateSerializer
        return TravelProjectReadSerializer

    def destroy(self, request, *args, **kwargs):
        delete_project(project=self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectPlaceListCreateView(ProviderErrorsMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        project = get_object_or_404(TravelProject, pk=self.kwargs['project_id'], owner=self.request.user)
        return project.places.all()

    def get_serializer_class(self):
        return PlaceInputSerializer if self.request.method == 'POST' else ProjectPlaceReadSerializer

    def create(self, request, *args, **kwargs):
        project = get_object_or_404(TravelProject, pk=self.kwargs['project_id'], owner=request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        place = add_place_to_project(project=project, **serializer.validated_data)
        return Response(ProjectPlaceReadSerializer(place).data, status=201)


class ProjectPlaceDetailView(ProviderErrorsMixin, generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ProjectPlace.objects.filter(project_id=self.kwargs['project_id'],
                                           project__owner=self.request.user).select_related('project')

    def get_serializer_class(self):
        return ProjectPlaceReadSerializer if self.request.method == 'GET' else ProjectPlaceUpdateSerializer


class SavedPlaceListCreateView(ProviderErrorsMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([place.details for place in SavedPlace.objects.filter(owner=request.user)])

    def post(self, request):
        serializer = PlaceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        details = get_place_details(serializer.validated_data['place_id'])
        # Aliases of the same provider record are one bookmark. Repeated saves are idempotent.
        saved, created = SavedPlace.objects.get_or_create(
            owner=request.user, source_id=details['source_id'],
            defaults={'place_id': details['place_id'], 'details': details},
        )
        return Response(saved.details, status=201 if created else 200)


class SavedPlaceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, place_id):
        SavedPlace.objects.filter(owner=request.user, place_id=place_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
