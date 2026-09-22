from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from tests.fixtures import geo_place
from travel.models import ProjectPlace, SavedPlace, TravelProject


class PersonalWorkspaceTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user(username='owner')
        cls.other = get_user_model().objects.create_user(username='other')
        cls.project = TravelProject.objects.create(name='Private trip', owner=cls.owner)
        cls.place = ProjectPlace.objects.create(project=cls.project, **geo_place())
        cls.legacy = TravelProject.objects.create(name='Legacy shared trip')

    def test_guest_cannot_read_or_write_personal_data(self):
        project = f'/api/projects/{self.project.pk}/'
        places = project + 'places/'
        for method, url, data in [
            ('get', '/api/projects/', None), ('post', '/api/projects/', {'name': 'Guest'}),
            ('get', project, None), ('patch', project, {'name': 'Guest'}),
            ('put', project, {'name': 'Guest'}), ('delete', project, None),
            ('get', places, None), ('post', places, {'place_id': 'geo-1'}),
            ('get', f'{places}{self.place.pk}/', None),
            ('patch', f'{places}{self.place.pk}/', {'visited': True}),
            ('put', f'{places}{self.place.pk}/', {'notes': 'Guest'}),
            ('get', '/api/saved/', None), ('post', '/api/saved/', {'place_id': 'geo-1'}),
            ('delete', '/api/saved/geo-1/', None),
        ]:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format='json')
                self.assertEqual(response.status_code, 401)
        self.project.refresh_from_db()
        self.place.refresh_from_db()
        self.assertEqual(self.project.name, 'Private trip')
        self.assertFalse(self.place.visited)
        self.assertFalse(SavedPlace.objects.exists())

    def test_other_users_cannot_access_project_or_nested_places(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/projects/').data, [])
        for project in (self.project, self.legacy):
            url = f'/api/projects/{project.pk}/'
            for method, path, data in [
                ('get', url, None), ('patch', url, {'name': 'Stolen'}),
                ('put', url, {'name': 'Stolen'}), ('delete', url, None),
                ('get', url + 'places/', None),
                ('post', url + 'places/', {'place_id': 'geo-2'}),
                ('get', f'{url}places/{self.place.pk}/', None),
                ('patch', f'{url}places/{self.place.pk}/', {'visited': True}),
            ]:
                with self.subTest(method=method, path=path):
                    self.assertEqual(getattr(self.client, method)(path, data, format='json').status_code, 404)

    def test_create_assigns_current_user_and_rejects_forged_owner(self):
        self.client.force_authenticate(self.other)
        response = self.client.post('/api/projects/', {'name': 'Mine'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(TravelProject.objects.get(pk=response.data['id']).owner, self.other)
        self.assertEqual(self.client.post('/api/projects/', {
            'name': 'Forged', 'owner': self.owner.pk,
        }, format='json').status_code, 400)

    @patch('travel.api.views.get_place_details', return_value=geo_place())
    def test_saved_places_are_verified_persistent_and_personal(self, details):
        self.client.force_authenticate(self.owner)
        response = self.client.post('/api/saved/', {'place_id': 'geo-1'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['name'], geo_place()['name'])
        self.assertEqual(self.client.post('/api/saved/', {'place_id': 'geo-1'}, format='json').status_code, 200)
        details.return_value = geo_place('alias-id')
        self.assertEqual(self.client.post('/api/saved/', {'place_id': 'alias-id'}, format='json').status_code, 200)
        self.assertEqual(SavedPlace.objects.count(), 1)
        self.assertEqual(len(self.client.get('/api/saved/').data), 1)
        self.assertEqual(self.client.post('/api/saved/', {'place_id': 'geo-1', 'name': 'Forged'}, format='json').status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/saved/').data, [])
        self.assertEqual(self.client.delete('/api/saved/geo-1/').status_code, 204)
        self.assertEqual(SavedPlace.objects.count(), 1)
        self.assertEqual(self.client.post('/api/saved/', {'place_id': 'alias-id'}, format='json').status_code, 201)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete('/api/saved/geo-1/').status_code, 204)
        self.assertEqual(self.client.get('/api/saved/').data, [])
        self.assertEqual(SavedPlace.objects.get().owner, self.other)
