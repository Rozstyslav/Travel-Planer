from unittest.mock import patch
from django.test import TestCase
from travel.exceptions import DuplicateProjectPlaceError, PlaceNotFoundError, ProviderUnavailableError, ProjectPlaceLimitError
from travel.models import TravelProject, ProjectPlace
from travel.services import create_project_with_places, get_place_details, add_place_to_project, update_project_place
from tests.fixtures import geo_place


class TravelServiceTests(TestCase):
    @patch('travel.services.WikipediaClient')
    @patch('travel.services.GeoapifyClient.get_place')
    def test_unnamed_place_never_searches_for_city_photos(self, geo, wiki):
        geo.return_value = {**geo_place(), 'name': 'Unnamed park', 'has_name': False, 'city': 'Lviv'}
        result = get_place_details('geo-1')
        self.assertEqual(result['image_url'], '')
        self.assertEqual(result['wikipedia_status'], 'not_found')
        wiki.assert_not_called()

    @patch('travel.services.get_place_details')
    def test_project_creation_is_atomic(self, details):
        details.side_effect = [geo_place(), PlaceNotFoundError('Missing')]
        with self.assertRaises(PlaceNotFoundError):
            create_project_with_places(project_data={'name': 'Trip'}, places_data=[{'place_id': 'geo-1'}, {'place_id': 'geo-2'}])
        self.assertEqual(TravelProject.objects.count(), 0)
        self.assertEqual(ProjectPlace.objects.count(), 0)

    @patch('travel.services.get_place_details')
    def test_alias_ids_cannot_duplicate_same_source(self, details):
        details.side_effect = [geo_place('geo-1'), geo_place('geo-2')]
        with self.assertRaises(DuplicateProjectPlaceError):
            create_project_with_places(project_data={'name': 'Trip'}, places_data=[{'place_id': 'geo-1'}, {'place_id': 'geo-2'}])
        self.assertEqual(TravelProject.objects.count(), 0)

    @patch('travel.services.WikipediaClient.place_summary', side_effect=ProviderUnavailableError('Wikipedia'))
    @patch('travel.services.GeoapifyClient.get_place', return_value=geo_place())
    def test_wikipedia_outage_does_not_discard_place(self, geo, wiki):
        result = get_place_details('geo-1')
        self.assertEqual(result['name'], 'Львівська ратуша')
        self.assertEqual(result['wikipedia_status'], 'unavailable')

    @patch('travel.services.get_place_details')
    def test_duplicate_precheck_avoids_provider_calls(self, details):
        project = TravelProject.objects.create(name='Trip')
        ProjectPlace.objects.create(project=project, **geo_place())
        with self.assertRaises(DuplicateProjectPlaceError):
            add_place_to_project(project=project, place_id='geo-1')
        details.assert_not_called()

    @patch('travel.services.get_place_details')
    def test_limit_precheck_avoids_provider_calls(self, details):
        project = TravelProject.objects.create(name='Trip')
        for i in range(10):
            ProjectPlace.objects.create(project=project, **geo_place(f'geo-{i}', f'osm:n:{i}'))
        with self.assertRaises(ProjectPlaceLimitError):
            add_place_to_project(project=project, place_id='new')
        details.assert_not_called()

    def test_notes_update_preserves_visited(self):
        project = TravelProject.objects.create(name='Trip')
        place = ProjectPlace.objects.create(project=project, visited=True, **geo_place())
        update_project_place(place=place, notes='New')
        place.refresh_from_db()
        self.assertEqual(place.notes, 'New')
        self.assertTrue(place.visited)
        update_project_place(place=place, visited=False)
        place.refresh_from_db()
        self.assertFalse(place.visited)

    @patch('travel.services.WikipediaClient.linked_image', return_value={
        'image_url': 'https://upload.wikimedia.org/statue.jpg',
        'image_source_url': 'https://commons.wikimedia.org/wiki/File:Statue.jpg'})
    @patch('travel.services.WikipediaClient.place_summary', side_effect=ProviderUnavailableError('Wikipedia'))
    @patch('travel.services.GeoapifyClient.get_place')
    def test_photo_fallback_survives_uk_wikipedia_outage_and_is_saved(self, geo, wiki, image):
        geo.return_value = {**geo_place(), 'wikidata_id': 'Q123', 'wikipedia_link': ''}
        project = create_project_with_places(project_data={'name': 'Photo trip'}, places_data=[{'place_id': 'geo-1'}])
        place = project.places.get()
        self.assertEqual(place.image_url, 'https://upload.wikimedia.org/statue.jpg')
        self.assertEqual(place.image_source_url, 'https://commons.wikimedia.org/wiki/File:Statue.jpg')
        image.assert_called_once_with(wikipedia_link='', wikidata_id='Q123')

    @patch('travel.services.WikipediaClient.search_image', return_value={
        'image_url': 'https://thumb.wikimedia.org/statue.jpg',
        'image_source_url': 'https://commons.wikimedia.org/wiki/File:Statue.jpg'})
    @patch('travel.services.WikipediaClient.place_summary', side_effect=ProviderUnavailableError('Wikipedia'))
    @patch('travel.services.GeoapifyClient.get_place')
    def test_commons_suggestion_is_labelled_and_persisted(self, geo, wiki, image):
        geo.return_value = {**geo_place(), 'image_search_name': 'Mikhail Damiralis'}
        project = create_project_with_places(project_data={'name': 'Photo trip'}, places_data=[{'place_id': 'geo-1'}])
        self.assertEqual(project.places.get().image_match, 'search')
