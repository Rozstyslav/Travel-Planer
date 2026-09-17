from unittest.mock import patch
from django.core.cache import cache
from rest_framework.test import APITestCase
from travel.exceptions import ProviderConfigurationError, ProviderUnavailableError, CountryNotFoundError
from tests.fixtures import geo_place


class DiscoveryApiTests(APITestCase):
    def setUp(self):
        cache.clear()

    @patch('travel.api.views.CountriesClient.list_countries', return_value=[{'code': 'UA', 'name': 'Ukraine'}])
    def test_guest_can_list_countries(self, client):
        response = self.client.get('/api/countries/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['code'], 'UA')

    @patch('travel.api.views.CountriesClient.get_country', return_value={'code': 'BR', 'name': 'Brazil'})
    def test_country_detail(self, client):
        self.assertEqual(self.client.get('/api/countries/BR/').data['name'], 'Brazil')

    @patch('travel.api.views.CountriesClient.get_country', side_effect=CountryNotFoundError('Missing'))
    def test_unknown_country(self, client):
        self.assertEqual(self.client.get('/api/countries/ZZ/').status_code, 404)

    @patch('travel.api.views.GeoapifyClient.search_cities', return_value=[geo_place()])
    def test_city_query(self, client):
        response = self.client.get('/api/cities/', {'q': 'Львів', 'country': 'UA'})
        self.assertEqual(response.status_code, 200)
        client.assert_called_once_with('Львів', 'UA', 6)
        self.assertNotIn('apiKey', str(response.data))

    @patch('travel.api.views.GeoapifyClient.search_places', return_value=[geo_place()])
    def test_place_search(self, client):
        response = self.client.get('/api/places/', {'latitude': 49, 'longitude': 24})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['name'], 'Львівська ратуша')
        self.assertFalse(response.data['has_more'])

    @patch('travel.api.views.GeoapifyClient.search_places')
    def test_highlights_pagination_uses_lookahead(self, client):
        client.return_value = [geo_place('one', 'osm:n:1'), {**geo_place('two', 'osm:n:2'), 'name': 'Other'}]
        response = self.client.get('/api/places/', {'latitude': 49, 'longitude': 24, 'sort': 'highlights', 'limit': 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        self.assertTrue(response.data['has_more'])
        self.assertEqual(client.call_args.kwargs['limit'], 2)
        client.return_value = [geo_place()]
        response = self.client.get('/api/places/', {'latitude': 49, 'longitude': 24, 'sort': 'highlights', 'limit': 1})
        self.assertFalse(response.data['has_more'])

    def test_invalid_sort_is_rejected(self):
        self.assertEqual(self.client.get('/api/places/', {'latitude': 49, 'longitude': 24, 'sort': 'random'}).status_code, 400)

    @patch('travel.api.views.GeoapifyClient.search_places')
    def test_highlights_can_page_past_500_without_extending_nearest_search(self, client):
        client.return_value = [geo_place('one', 'osm:n:1'), {**geo_place('two', 'osm:n:2'), 'name': 'Other'}]
        params = {'latitude': 49, 'longitude': 24, 'sort': 'highlights', 'limit': 1, 'offset': 500}
        response = self.client.get('/api/places/', params)
        self.assertTrue(response.data['has_more'])
        response = self.client.get('/api/places/', {**params, 'offset': 501})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.call_args.kwargs['offset'], 501)
        self.assertEqual(self.client.get('/api/places/', {**params, 'offset': 1001}).status_code, 400)
        for override in ({'sort': 'distance'}, {'categories': 'entertainment.museum'}):
            response = self.client.get('/api/places/', {**params, 'offset': 501, **override})
            self.assertEqual(response.status_code, 400)

    @patch('travel.api.views.GeoapifyClient.search_places')
    def test_deduplication_does_not_end_pagination_early(self, client):
        client.return_value = [geo_place('a'), geo_place('b')]
        response = self.client.get('/api/places/', {'latitude': 49, 'longitude': 24, 'limit': 2})
        self.assertEqual(len(response.data['results']), 1)
        self.assertTrue(response.data['has_more'])
        self.assertEqual(response.data['limit'], 2)

    @patch('travel.api.views.GeoapifyClient.search_places')
    def test_unnamed_features_are_hidden_without_breaking_pagination(self, client):
        client.return_value = [{**geo_place('a'), 'has_name': False}, geo_place('b')]
        response = self.client.get('/api/places/', {'latitude': 49, 'longitude': 24, 'limit': 2})
        self.assertEqual([p['place_id'] for p in response.data['results']], ['b'])
        self.assertTrue(response.data['has_more'])

    @patch('travel.api.views.GeoapifyClient.search_places')
    def test_invalid_coordinates_and_bounds_never_reach_provider(self, client):
        invalid = [{}, {'latitude': 91, 'longitude': 24}, {'latitude': 'NaN', 'longitude': 24},
                   {'latitude': 49, 'longitude': 'inf'}, {'latitude': 49, 'longitude': 24, 'radius': 1},
                   {'latitude': 49, 'longitude': 24, 'limit': 100}, {'latitude': 49, 'longitude': 24, 'categories': 'invalid'}]
        for data in invalid:
            with self.subTest(data=data):
                self.assertEqual(self.client.get('/api/places/', data).status_code, 400)
        client.assert_not_called()

    def test_invalid_queries(self):
        for url in ('/api/countries/BRA/', '/api/cities/?q=a', '/api/cities/?q=Lviv&country=BAD',
                    '/api/wikipedia/', '/api/wikipedia/?q=Lviv&title=Lviv'):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 400)

    @patch('travel.api.views.get_place_details', return_value={**geo_place(), 'wikipedia_status': 'unavailable'})
    def test_partial_place_detail(self, client):
        response = self.client.get('/api/places/geo-1/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['wikipedia_status'], 'unavailable')

    @patch('travel.api.views.WikipediaClient.summary', return_value={'found': False})
    def test_missing_wikipedia_article_is_valid_empty_result(self, client):
        response = self.client.get('/api/wikipedia/', {'title': 'Unknown'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['found'])

    @patch('travel.api.views.GeoapifyClient.search_cities', side_effect=ProviderConfigurationError('Geoapify', 'Check server key.'))
    def test_configuration_error_is_actionable(self, client):
        response = self.client.get('/api/cities/?q=Lviv')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['code'], 'provider_configuration')

    @patch('travel.api.views.CountriesClient.list_countries', side_effect=ProviderUnavailableError('Countries'))
    def test_provider_outage(self, client):
        response = self.client.get('/api/countries/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['provider'], 'Countries')
