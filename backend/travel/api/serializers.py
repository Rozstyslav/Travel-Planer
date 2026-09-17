import math
from rest_framework import serializers

from travel.clients.geoapify import GeoapifyClient
from travel.models import ProjectPlace, TravelProject
from travel.services import MAX_PLACES_PER_PROJECT, create_project_with_places, update_project_place


class StrictSerializerMixin:
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: ['Unknown field.'] for key in sorted(unknown)})
        return super().to_internal_value(data)


class PlaceInputSerializer(StrictSerializerMixin, serializers.Serializer):
    place_id = serializers.RegexField(r'^[A-Za-z0-9_-]+$', max_length=512)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000, default='')


class ProjectPlaceReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectPlace
        fields = ('id', 'project_id', 'place_id', 'source_id', 'name', 'address', 'country_code', 'city',
                  'latitude', 'longitude', 'categories', 'description', 'image_url', 'image_source_url', 'image_match', 'wikipedia_url',
                  'wikipedia_title', 'wikipedia_match', 'notes', 'visited', 'created_at', 'updated_at')
        read_only_fields = fields


class TravelProjectReadSerializer(serializers.ModelSerializer):
    places = ProjectPlaceReadSerializer(many=True, read_only=True)
    archived_place_count = serializers.SerializerMethodField()
    archived_visited_count = serializers.SerializerMethodField()

    def get_archived_place_count(self, obj):
        return len(obj.archived_places)

    def get_archived_visited_count(self, obj):
        return sum(bool(p.get('visited')) for p in obj.archived_places)

    class Meta:
        model = TravelProject
        fields = ('id', 'name', 'description', 'start_date', 'places', 'archived_place_count',
                  'archived_visited_count', 'created_at', 'updated_at')
        read_only_fields = fields


class ProjectWriteBase(StrictSerializerMixin, serializers.ModelSerializer):
    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Project name cannot be empty.')
        return value.strip()

    def to_representation(self, instance):
        return TravelProjectReadSerializer(instance, context=self.context).data


class TravelProjectCreateSerializer(ProjectWriteBase):
    places = PlaceInputSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = TravelProject
        fields = ('name', 'description', 'start_date', 'places')

    def validate_places(self, places):
        if len(places) > MAX_PLACES_PER_PROJECT:
            raise serializers.ValidationError('A project cannot contain more than 10 places.')
        ids = [p['place_id'] for p in places]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('The same place cannot be added more than once.')
        return places

    def create(self, validated_data):
        places = validated_data.pop('places', [])
        return create_project_with_places(project_data=validated_data, places_data=places)


class TravelProjectUpdateSerializer(ProjectWriteBase):
    class Meta:
        model = TravelProject
        fields = ('name', 'description', 'start_date')
        extra_kwargs = {'name': {'required': False}}

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('At least one field must be provided.')
        return attrs


class ProjectPlaceUpdateSerializer(StrictSerializerMixin, serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    visited = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('At least one field must be provided.')
        return attrs

    def update(self, instance, validated_data):
        return update_project_place(place=instance, **validated_data)

    def to_representation(self, instance):
        return ProjectPlaceReadSerializer(instance).data


class CountryCodeSerializer(serializers.Serializer):
    code = serializers.RegexField(r'^[A-Za-z]{2}$')


class CitySearchSerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=150)
    country = serializers.RegexField(r'^[A-Za-z]{2}$', required=False, default='')
    limit = serializers.IntegerField(min_value=1, max_value=10, default=6)


class PlacesSearchSerializer(serializers.Serializer):
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    categories = serializers.ChoiceField(choices=[
        'tourism.sights', 'tourism.attraction', 'entertainment.museum',
        'leisure.park', 'catering.cafe', 'catering.restaurant',
    ], default='tourism.sights')
    radius = serializers.IntegerField(min_value=100, max_value=50000, default=5000)
    limit = serializers.IntegerField(min_value=1, max_value=20, default=12)
    offset = serializers.IntegerField(min_value=0, max_value=GeoapifyClient.HIGHLIGHT_MAX_RESULTS, default=0)
    sort = serializers.ChoiceField(choices=['distance', 'highlights'], default='distance')

    @staticmethod
    def offset_limit(attrs):
        if attrs['categories'] == 'tourism.sights' and attrs['sort'] == 'highlights':
            return GeoapifyClient.HIGHLIGHT_MAX_RESULTS
        return 500

    def validate(self, attrs):
        if not all(math.isfinite(attrs[k]) for k in ('latitude', 'longitude')):
            raise serializers.ValidationError('Coordinates must be finite.')
        if attrs['offset'] > self.offset_limit(attrs):
            raise serializers.ValidationError({'offset': 'Offset must not exceed 500 for nearest searches.'})
        return attrs


class WikipediaQuerySerializer(serializers.Serializer):
    title = serializers.CharField(max_length=250, required=False)
    q = serializers.CharField(min_length=2, max_length=250, required=False)

    def validate(self, attrs):
        if ('title' in attrs) == ('q' in attrs):
            raise serializers.ValidationError('Provide exactly one of title or q.')
        return attrs
