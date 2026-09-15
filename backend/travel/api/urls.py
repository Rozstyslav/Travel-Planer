from django.urls import include, path
from rest_framework.routers import DefaultRouter

from travel.api.views import (
    ProjectPlaceDetailView,
    ProjectPlaceListCreateView,
    TravelProjectViewSet,
    CountryListView, CountryDetailView, CitySearchView,
    PlaceSearchView, PlaceDetailView, WikipediaSummaryView,
)

app_name = 'travel'

router = DefaultRouter()

router.register('projects', TravelProjectViewSet, basename='project')

urlpatterns = [
    path('countries/', CountryListView.as_view(), name='country-list'),
    path('countries/<str:code>/', CountryDetailView.as_view(), name='country-detail'),
    path('cities/', CitySearchView.as_view(), name='city-search'),
    path('places/', PlaceSearchView.as_view(), name='place-search'),
    path('places/<str:place_id>/', PlaceDetailView.as_view(), name='place-detail'),
    path('wikipedia/', WikipediaSummaryView.as_view(), name='wikipedia-summary'),
    path("projects/<int:project_id>/places/", ProjectPlaceListCreateView.as_view(), name="project-place-list"),
    path("projects/<int:project_id>/places/<int:pk>/", ProjectPlaceDetailView.as_view(), name="project-place-detail"),
    path("", include(router.urls)),
]
