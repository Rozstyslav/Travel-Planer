from django.contrib import admin
from travel.models import ProjectPlace, TravelProject


class ProjectPlaceInline(admin.TabularInline):
    model = ProjectPlace
    extra = 0
    fields = ('name', 'city', 'country_code', 'notes', 'visited')
    readonly_fields = ('name', 'city', 'country_code')

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(TravelProject)
class TravelProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'owner', 'start_date', 'created_at')
    list_filter = ('owner',)
    search_fields = ('name', 'description')
    readonly_fields = ('archived_places',)
    inlines = (ProjectPlaceInline,)


@admin.register(ProjectPlace)
class ProjectPlaceAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'name', 'city', 'country_code', 'visited')
    list_filter = ('visited', 'country_code')
    search_fields = ('name', 'address', 'city', 'project__name')
    readonly_fields = ('place_id', 'source_id', 'latitude', 'longitude')

    def has_add_permission(self, request):
        return False
