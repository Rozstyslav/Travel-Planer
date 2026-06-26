from django.db import models

class TravelProject(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name

class ProjectPlace(models.Model):
    project = models.ForeignKey(
        TravelProject,
        on_delete=models.CASCADE,
        related_name="places",
    )

    external_id = models.PositiveBigIntegerField()

    title = models.CharField(max_length=500)
    artist_display = models.TextField(blank=True)
    image_id = models.CharField(
        max_length=255,
        blank=True,
    )

    notes = models.TextField(blank=True)
    visited = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

        constraints = [
            models.UniqueConstraint(
                fields=["project", "external_id"],
                name="unique_external_place_per_project",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name}: {self.title}"