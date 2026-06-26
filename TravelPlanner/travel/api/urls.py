from django.urls import include, path
from rest_framework.routers import DefaultRouter

from travel.api.views import (
    ProjectPlaceDetailView,
    ProjectPlaceListCreateView,
    TravelProjectViewSet,
)

app_name = 'travel'

router = DefaultRouter()

router.register('projects', TravelProjectViewSet, basename='project')

urlpatterns = [
    path("projects/<int:project_id>/places/", ProjectPlaceListCreateView.as_view(), name="project-place-list"),
    path("projects/<int:project_id>/places/<int:pk>/", ProjectPlaceDetailView.as_view(), name="project-place-detail"),
    path("", include(router.urls)),
]