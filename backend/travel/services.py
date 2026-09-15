from django.db import IntegrityError, transaction

from travel.clients.geoapify import GeoapifyClient
from travel.clients.wikipedia import WikipediaClient
from travel.exceptions import (
    DuplicateProjectPlaceError, ProjectHasVisitedPlacesError,
    ProjectPlaceLimitError, ProviderError,
)
from travel.models import ProjectPlace, TravelProject

MAX_PLACES_PER_PROJECT = 10


def get_place_details(place_id):
    place = GeoapifyClient().get_place(place_id)
    if not place.get('has_name', True):
        place.update(wikipedia_match='none', wikipedia_status='not_found', image_match='none', image_source_url='')
        return place
    try:
        wiki = WikipediaClient().summary(
            title=place.get('wikipedia_title', ''),
            query=' '.join(dict.fromkeys(filter(None, [place['name'], place['city']]))),
            subject=place['name'],
        )
        place.update(description=wiki['description'], image_url=wiki['image_url'],
                     wikipedia_url=wiki['url'], wikipedia_title=wiki['title'], wikipedia_match=wiki['match'])
        place['wikipedia_status'] = 'found' if wiki['found'] else 'not_found'
    except ProviderError:
        # Descriptive content is optional; a valid geographic place can still
        # be added when Wikipedia is down. The API reports that partial result.
        place.update(wikipedia_match='none', wikipedia_status='unavailable')
    place['image_source_url'] = place['wikipedia_url'] if place['image_url'] else ''
    place['image_match'] = place['wikipedia_match'] if place['image_url'] else 'none'
    if not place['image_url']:
        try:
            place.update(WikipediaClient().linked_image(
                wikipedia_link=place.get('wikipedia_link', ''), wikidata_id=place.get('wikidata_id', '')))
            if place['image_url']:
                place['image_match'] = 'linked'
        except ProviderError:
            pass  # Optional media must not prevent opening or saving a place.
    if not place['image_url'] and place.get('image_search_name'):
        try:
            place.update(WikipediaClient().search_image(place['image_search_name']))
            if place['image_url']:
                place['image_match'] = 'search'
        except ProviderError:
            pass
    return place


def place_fields(place):
    fields = {field.name for field in ProjectPlace._meta.fields} - {'id', 'project', 'created_at', 'updated_at'}
    return {key: value for key, value in place.items() if key in fields}


def create_project_with_places(*, project_data, places_data=None):
    places_data = list(places_data or [])
    if len(places_data) > MAX_PLACES_PER_PROJECT:
        raise ProjectPlaceLimitError('A project cannot contain more than 10 places.')
    ids = [p['place_id'] for p in places_data]
    if len(ids) != len(set(ids)):
        raise DuplicateProjectPlaceError('The same place cannot be added more than once.')
    validated = []
    sources = set()
    for item in places_data:
        place = get_place_details(item['place_id'])
        if place['source_id'] in sources:
            raise DuplicateProjectPlaceError('These identifiers refer to the same place.')
        sources.add(place['source_id'])
        validated.append({**place_fields(place), 'notes': item.get('notes', '')})
    with transaction.atomic():
        project = TravelProject.objects.create(**project_data)
        ProjectPlace.objects.bulk_create([ProjectPlace(project=project, **p) for p in validated])
    return project


def add_place_to_project(*, project, place_id, notes=''):
    # Fast prechecks avoid spending external quota on obvious conflicts.
    if project.places.filter(place_id=place_id).exists():
        raise DuplicateProjectPlaceError('This place is already included in the project.')
    if project.places.count() >= MAX_PLACES_PER_PROJECT:
        raise ProjectPlaceLimitError('A project cannot contain more than 10 places.')
    place = get_place_details(place_id)
    try:
        with transaction.atomic():
            locked = TravelProject.objects.select_for_update().get(pk=project.pk)
            if locked.places.count() >= MAX_PLACES_PER_PROJECT:
                raise ProjectPlaceLimitError('A project cannot contain more than 10 places.')
            if locked.places.filter(source_id=place['source_id']).exists():
                raise DuplicateProjectPlaceError('This place is already included in the project.')
            return ProjectPlace.objects.create(project=locked, notes=notes, **place_fields(place))
    except IntegrityError:
        raise DuplicateProjectPlaceError('This place is already included in the project.') from None


def update_project_place(*, place, notes=None, visited=None):
    fields = []
    if notes is not None:
        place.notes = notes
        fields.append('notes')
    if visited is not None:
        place.visited = visited
        fields.append('visited')
    if fields:
        place.save(update_fields=[*fields, 'updated_at'])
    return place


def delete_project(*, project):
    with transaction.atomic():
        locked = TravelProject.objects.select_for_update().get(pk=project.pk)
        if locked.places.filter(visited=True).exists() or any(p.get('visited') for p in locked.archived_places):
            raise ProjectHasVisitedPlacesError(
                'A project containing visited places cannot be deleted, including archived places.')
        locked.delete()
