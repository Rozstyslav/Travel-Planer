from django.contrib import admin

from travel.models import ProjectPlace, TravelProject

class ProjectPlaceInline(admin.TabularInline):
    model = ProjectPlace
    extra = 0
    readonly_fields = (
        "external_id",
        "title",
        "artist_display",
        "image_id",
        "created_at",
        "updated_at",
    )

@admin.register(TravelProject)
class TravelProjectAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "start_date",
        "created_at",
    )
    search_fields = ("name", "description")
    inlines = (ProjectPlaceInline,)

@admin.register(ProjectPlace)
class ProjectPlaceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "project",
        "external_id",
        "title",
        "visited",
    )
    list_filter = ("visited",)
    search_fields = (
        "title",
        "artist_display",
        "project__name",
    )