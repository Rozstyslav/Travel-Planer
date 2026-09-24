from unittest.mock import patch
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from travel.exceptions import PlaceNotFoundError, ProviderUnavailableError
from travel.models import TravelProject, ProjectPlace, SavedPlace
from tests.fixtures import geo_place


class ProjectApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username='projects', password='test-password')

    def setUp(self):
        self.client.force_authenticate(self.user)
        self.project = TravelProject.objects.create(name='Вікенд у Львові', owner=self.user)
        self.project_url = f'/api/projects/{self.project.pk}/'
        self.places_url = self.project_url + 'places/'

    def test_create_empty_project(self):
        response = self.client.post('/api/projects/', {'name': 'Київ', 'start_date': '2026-10-01'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['places'], [])

    @patch('travel.services.get_place_details', return_value=geo_place())
    def test_create_with_verified_place(self, details):
        response = self.client.post('/api/projects/', {'name': 'Львів', 'places': [{'place_id': 'geo-1', 'notes': 'Почати тут'}]}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['places'][0]['name'], 'Львівська ратуша')
        self.assertEqual(response.data['places'][0]['notes'], 'Почати тут')
        self.assertNotIn('external_id', response.data['places'][0])

    def test_duplicate_or_too_many_places_rejected(self):
        for places in ([{'place_id': 'geo-1'}] * 2, [{'place_id': f'geo-{i}'} for i in range(11)]):
            response = self.client.post('/api/projects/', {'name': 'Trip', 'places': places}, format='json')
            self.assertEqual(response.status_code, 400)

    def test_old_contract_and_forged_metadata_rejected(self):
        for payload in ({'external_id': 27992}, {'place_id': 'geo-1', 'name': 'Forged'}):
            response = self.client.post(self.places_url, payload, format='json')
            self.assertEqual(response.status_code, 400)

    def test_list_and_update_project(self):
        self.assertEqual(len(self.client.get('/api/projects/').data), 1)
        self.assertEqual(self.client.get(self.project_url).status_code, 200)
        response = self.client.patch(self.project_url, {'description': 'New'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['description'], 'New')
        self.assertEqual(self.client.patch(self.project_url, {}, format='json').status_code, 400)

    @patch('travel.services.get_place_details', return_value=geo_place())
    def test_add_place_and_reject_duplicate(self, details):
        response = self.client.post(self.places_url, {'place_id': 'geo-1'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['latitude'], 49.8419)
        self.assertEqual(self.client.post(self.places_url, {'place_id': 'geo-1'}, format='json').status_code, 409)

    @patch('travel.services.get_place_details', return_value=geo_place('other-id'))
    def test_source_alias_duplicate_is_rejected(self, details):
        ProjectPlace.objects.create(project=self.project, **geo_place())
        self.assertEqual(self.client.post(self.places_url, {'place_id': 'other-id'}, format='json').status_code, 409)

    @patch('travel.services.get_place_details', side_effect=PlaceNotFoundError('Missing'))
    def test_missing_place(self, details):
        self.assertEqual(self.client.post(self.places_url, {'place_id': 'missing'}, format='json').status_code, 404)
        self.assertEqual(self.project.places.count(), 0)

    @patch('travel.services.get_place_details', side_effect=ProviderUnavailableError('Geoapify'))
    def test_upstream_outage_does_not_create_project(self, details):
        response = self.client.post('/api/projects/', {'name': 'Trip', 'places': [{'place_id': 'geo-1'}]}, format='json')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(TravelProject.objects.count(), 1)

    def test_note_and_visited_updates(self):
        place = ProjectPlace.objects.create(project=self.project, **geo_place())
        url = f'{self.places_url}{place.pk}/'
        response = self.client.patch(url, {'notes': 'Побачено', 'visited': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['visited'])
        self.assertEqual(self.client.get(url).data['notes'], 'Побачено')
        self.assertEqual(self.client.patch(url, {'latitude': 0}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(self.project_url).status_code, 409)
        self.client.patch(url, {'visited': False}, format='json')
        self.assertEqual(self.client.delete(self.project_url).status_code, 204)

    def test_nested_place_cannot_be_read_through_other_project(self):
        place = ProjectPlace.objects.create(project=self.project, **geo_place())
        other = TravelProject.objects.create(name='Other', owner=self.user)
        self.assertEqual(self.client.get(f'/api/projects/{other.pk}/places/{place.pk}/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/projects/{other.pk}/places/{place.pk}/').status_code, 404)
        self.assertTrue(ProjectPlace.objects.filter(pk=place.pk).exists())
        self.assertEqual(self.client.get('/api/projects/999999/places/').status_code, 404)

    def test_remove_place_only_affects_selected_trip(self):
        place = ProjectPlace.objects.create(project=self.project, notes='My note', **geo_place())
        remaining = ProjectPlace.objects.create(project=self.project, **geo_place('geo-2', 'osm:n:2'))
        other = TravelProject.objects.create(name='Other', owner=self.user)
        other_place = ProjectPlace.objects.create(project=other, **geo_place())
        bookmark = SavedPlace.objects.create(owner=self.user, place_id='geo-1', source_id='osm:n:1', details=geo_place())
        url = f'{self.places_url}{place.pk}/'
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(ProjectPlace.objects.filter(pk=place.pk).exists())
        self.assertEqual([p['id'] for p in self.client.get(self.project_url).data['places']], [remaining.pk])
        self.assertTrue(ProjectPlace.objects.filter(pk=other_place.pk).exists())
        self.assertTrue(SavedPlace.objects.filter(pk=bookmark.pk).exists())
        self.assertEqual(self.client.delete(url).status_code, 404)

    def test_remove_last_visited_place_keeps_empty_trip(self):
        place = ProjectPlace.objects.create(project=self.project, visited=True, **geo_place())
        self.assertEqual(self.client.delete(f'{self.places_url}{place.pk}/').status_code, 204)
        response = self.client.get(self.project_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['places'], [])

    @patch('travel.services.get_place_details', return_value=geo_place('replacement', 'osm:n:99'))
    def test_remove_place_frees_capacity(self, details):
        places = [ProjectPlace.objects.create(project=self.project, **geo_place(f'geo-{i}', f'osm:n:{i}'))
                  for i in range(10)]
        self.assertEqual(self.client.delete(f'{self.places_url}{places[0].pk}/').status_code, 204)
        self.assertEqual(self.client.post(self.places_url, {'place_id': 'replacement'}, format='json').status_code, 201)
        self.assertEqual(self.project.places.count(), 10)

    def test_archived_visits_do_not_prevent_deleting_empty_project(self):
        self.project.archived_places = [{'title': 'Old record', 'visited': True}]
        self.project.save()
        response = self.client.get(self.project_url)
        self.assertEqual(response.data['places'], [])
        self.assertEqual(response.data['archived_place_count'], 1)
        self.assertEqual(response.data['archived_visited_count'], 1)
        self.assertNotIn('archived_places', response.data)
        self.assertEqual(self.client.delete(self.project_url).status_code, 204)
        self.assertFalse(TravelProject.objects.filter(pk=self.project.pk).exists())

    def test_only_current_visits_protect_project_with_archive(self):
        self.project.archived_places = [{'title': 'Old record', 'visited': True}]
        self.project.save()
        place = ProjectPlace.objects.create(project=self.project, visited=True, **geo_place())
        self.assertEqual(self.client.delete(self.project_url).status_code, 409)
        self.assertTrue(TravelProject.objects.filter(pk=self.project.pk).exists())
        place.visited = False
        place.save()
        self.assertEqual(self.client.delete(self.project_url).status_code, 204)
        self.assertFalse(ProjectPlace.objects.filter(pk=place.pk).exists())
