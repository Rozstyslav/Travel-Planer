from django.conf import settings
from django.db import models


class TravelProject(models.Model):
    # Legacy shared projects have no known owner and remain available in admin.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                              related_name='travel_projects', null=True, blank=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)
    # Original provider records are retained by the migration, never reinterpreted
    # as geographic locations. Not exposed through the new places API.
    archived_places = models.JSONField(default=list, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class ProjectPlace(models.Model):
    project = models.ForeignKey(TravelProject, on_delete=models.CASCADE, related_name='places')
    place_id = models.CharField(max_length=512)
    source_id = models.CharField(max_length=512)
    name = models.CharField(max_length=500)
    address = models.TextField(blank=True)
    country_code = models.CharField(max_length=2, blank=True)
    city = models.CharField(max_length=255, blank=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    categories = models.JSONField(default=list)
    description = models.TextField(blank=True)
    image_url = models.URLField(max_length=2000, blank=True)
    image_source_url = models.URLField(max_length=2000, blank=True)
    image_match = models.CharField(max_length=12, default='none')
    wikipedia_url = models.URLField(max_length=2000, blank=True)
    wikipedia_title = models.CharField(max_length=500, blank=True)
    wikipedia_match = models.CharField(max_length=12, default='none')
    notes = models.TextField(blank=True)
    visited = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(fields=['project', 'place_id'], name='unique_geo_place_per_project'),
            models.UniqueConstraint(fields=['project', 'source_id'], name='unique_source_place_per_project'),
        ]

    def __str__(self):
        return f'{self.project.name}: {self.name}'


class SavedPlace(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_places')
    place_id = models.CharField(max_length=512)
    source_id = models.CharField(max_length=512)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'place_id'], name='unique_saved_place_per_user'),
            models.UniqueConstraint(fields=['owner', 'source_id'], name='unique_saved_source_per_user'),
        ]
