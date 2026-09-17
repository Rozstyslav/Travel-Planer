from unittest.mock import Mock, patch
from copy import deepcopy
import requests
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from travel.clients.countries import CountriesClient
from travel.clients.geoapify import GeoapifyClient
from travel.clients.wikipedia import WikipediaClient
from travel.clients.base import request_json
from travel.exceptions import CountryNotFoundError, PlaceNotFoundError, ProviderConfigurationError, ProviderUnavailableError
from tests.fixtures import geo_feature


@override_settings(GEOAPIFY_API_KEY='test-secret')
class ClientTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        patcher = patch('travel.clients.base.requests.request')
        self.http = patcher.start()
        self.addCleanup(patcher.stop)
        self.response = Mock(status_code=200)
        self.response.raise_for_status.return_value = None
        self.http.return_value = self.response

    def test_country_graphql_uses_variables(self):
        self.response.json.return_value = {'data': {'country': {'code': 'BR', 'name': 'Brazil', 'native': 'Brasil'}}}
        self.assertEqual(CountriesClient().get_country('br')['native'], 'Brasil')
        kwargs = self.http.call_args.kwargs
        self.assertEqual(kwargs['json']['variables'], {'code': 'BR'})
        self.assertIn('$code', kwargs['json']['query'])
        CountriesClient().get_country('BR')
        self.assertEqual(self.http.call_count, 1)

    def test_countries_list(self):
        self.response.json.return_value = {'data': {'countries': [{'code': 'UA', 'name': 'Ukraine'}]}}
        self.assertEqual(CountriesClient().list_countries()[0]['code'], 'UA')

    def test_graphql_error_is_not_empty_country(self):
        self.response.json.return_value = {'errors': [{'message': 'Failed'}], 'data': {'country': None}}
        with self.assertRaises(ProviderUnavailableError):
            CountriesClient().get_country('UA')

    def test_nonexistent_country(self):
        self.response.json.return_value = {'data': {'country': None}}
        with self.assertRaises(CountryNotFoundError):
            CountriesClient().get_country('ZZ')

    def test_invalid_country_list(self):
        self.response.json.return_value = {'data': {'countries': [None]}}
        with self.assertRaises(ProviderUnavailableError):
            CountriesClient().list_countries()

    def test_city_search_uses_geocoding_and_country_filter(self):
        self.response.json.return_value = {'features': [geo_feature()]}
        result = GeoapifyClient().search_cities('Львів', 'UA')
        self.assertEqual(result[0]['country_code'], 'UA')
        self.assertEqual(self.http.call_args.args[1], GeoapifyClient.GEOCODING_URL)
        self.assertEqual(self.http.call_args.kwargs['params']['filter'], 'countrycode:ua')
        self.assertEqual(self.http.call_args.kwargs['params']['type'], 'city')
        self.assertEqual(self.http.call_args.kwargs['params']['lang'], 'en')

    def test_place_search_coordinate_order_and_cache(self):
        self.response.json.return_value = {'features': [geo_feature()]}
        params = dict(latitude=49, longitude=24, categories='tourism.sights', radius=2000, limit=12, offset=12)
        GeoapifyClient().search_places(**params)
        GeoapifyClient().search_places(**params)
        self.assertEqual(self.http.call_count, 1)
        query = self.http.call_args.kwargs['params']
        self.assertEqual(query['filter'], 'circle:24,49,2000')
        self.assertEqual(query['offset'], 12)
        self.assertEqual(query['apiKey'], 'test-secret')
        self.assertEqual(query['lang'], 'en')
        self.assertEqual(query['conditions'], 'named')
        self.assertEqual(query['categories'], GeoapifyClient.SIGHT_CATEGORIES)
        for category in ('tourism.sights', 'tourism.attraction', 'entertainment.culture',
                         'entertainment.museum', 'heritage', 'building.historic'):
            self.assertIn(category, query['categories'].split(','))

    def test_highlights_include_distant_landmark_deduplicate_and_page_stably(self):
        def feature(place_id, latitude, name, raw=None):
            item = geo_feature(place_id)
            p = item['properties']
            p.update(name=name, lat=latitude, lon=2.35)
            p['datasource']['raw'] = {'osm_id': place_id, 'osm_type': 'n', **(raw or {})}
            return item

        plaque = feature('plaque', 48.8501, 'Nearby plaque')
        tower = feature('tower', 48.885, 'Tower', {'importance': 'international', 'landmark': 'yes',
                                                'name:en': 'Tower', 'wikidata': 'Q123'})
        outside = feature('outside', 49.1, 'Outside radius', {'importance': 'international'})
        unknown = feature('unnamed', 48.85, None)
        duplicate = deepcopy(tower)
        duplicate['properties']['place_id'] = 'tower-alias'

        def fetch(url, params):
            self.assertEqual(params['filter'], 'circle:2.35,48.85,5000')
            if params['categories'] == GeoapifyClient.TOURISM_CATEGORIES:
                self.assertIn('bias', params)
                return [plaque, duplicate, unknown]
            self.assertNotIn('bias', params)
            return [tower, outside]

        with patch.object(GeoapifyClient, '_get', side_effect=fetch) as provider:
            client = GeoapifyClient()
            params = dict(latitude=48.85, longitude=2.35, categories='tourism.sights', sort='highlights', limit=1)
            first = client.search_places(**params)
            second = client.search_places(**params, offset=1)
            self.assertEqual(first[0]['name'], 'Tower', 'Distance must not hide an important landmark')
            self.assertEqual(second[0]['name'], 'Nearby plaque')
            self.assertEqual(client.search_places(**params, offset=2), [])
            self.assertEqual(provider.call_count, 5, 'Pagination reuses the ranked candidate set')

    def test_highlights_find_cultural_and_historic_places_outside_full_tourism_feed(self):
        def feature(place_id, name, categories, raw=None):
            item = geo_feature(place_id)
            item['properties'].update(name=name, categories=categories)
            item['properties']['datasource']['raw'] = {
                'osm_id': place_id, 'osm_type': 'w', **(raw or {})}
            return item

        # A full feed of nearby plaques previously excluded every other family.
        plaques = [feature(f'plaque-{i}', f'Plaque {i}', ['tourism.sights']) for i in range(200)]
        theatre = feature('theatre', 'Opera and Ballet Theatre', ['entertainment.culture.theatre'],
                          {'wikipedia': 'uk:Opera', 'wikidata': 'Q123', 'name:en': 'Opera and Ballet Theatre'})
        arts_centre = feature('arts-centre', 'Opera House', ['entertainment.culture.arts_centre', 'heritage.unesco'],
                              {'landmark': 1, 'wikidata': 'Q456'})
        museum = feature('museum', 'City Museum', ['entertainment.museum'], {'wikipedia': 'en:City Museum'})
        historic = feature('historic', 'Historic Hall', ['building.historic'], {'wikidata': 'Q789'})

        def fetch(url, params):
            return {
                GeoapifyClient.TOURISM_CATEGORIES: plaques,
                GeoapifyClient.LANDMARK_CATEGORIES: [],
                'entertainment.culture': [theatre, arts_centre],
                'entertainment.museum': [museum],
                'heritage,building.historic': [arts_centre, historic],
            }[params['categories']]

        with patch.object(GeoapifyClient, '_get', side_effect=fetch):
            rows = GeoapifyClient().search_places(latitude=49.8419, longitude=24.0316,
                categories='tourism.sights', sort='highlights')
        self.assertEqual([p['place_id'] for p in rows[:4]], ['arts-centre', 'theatre', 'museum', 'historic'])
        self.assertEqual(len({p['place_id'] for p in rows}), len(rows))

    def test_highlights_do_not_change_restaurant_search(self):
        self.response.json.return_value = {'features': [geo_feature()]}
        GeoapifyClient().search_places(latitude=49, longitude=24, categories='catering.restaurant', sort='highlights')
        self.assertEqual(self.http.call_args.kwargs['params']['categories'], 'catering.restaurant')
        self.assertIn('bias', self.http.call_args.kwargs['params'])

    def test_unnamed_park_is_not_named_after_the_city(self):
        feature = geo_feature()
        props = feature['properties']
        props.pop('name', None)
        props['city'] = 'Lviv'
        props['categories'] = ['leisure', 'leisure.park']
        props['datasource'] = {'raw': {'leisure': 'park'}}
        result = GeoapifyClient.normalize(feature)
        self.assertEqual(result['name'], 'Unnamed park')
        self.assertFalse(result['has_name'])
        self.assertEqual(result['image_search_name'], '')

    def test_city_result_keeps_city_name_and_region(self):
        feature = geo_feature()
        feature['properties'].pop('name', None)
        feature['properties']['city'] = 'Lviv'
        feature['properties']['state'] = 'Lviv Oblast'
        feature['properties']['datasource'] = {}
        result = GeoapifyClient.normalize(feature, city_result=True)
        self.assertEqual(result['name'], 'Lviv')
        self.assertEqual(result['region'], 'Lviv Oblast')
        self.assertTrue(result['has_name'])

    def test_place_details_uses_stable_source_when_centroid_changes(self):
        self.response.json.return_value = {'features': [geo_feature('changed-centroid')]}
        result = GeoapifyClient().get_place('original-centroid')
        self.assertEqual(result['place_id'], 'original-centroid')
        self.assertEqual(result['source_id'], 'osm:n:1')
        self.assertEqual(result['wikipedia_title'], 'Львівська ратуша')

    def test_empty_place_details(self):
        self.response.json.return_value = {'features': []}
        with self.assertRaises(PlaceNotFoundError):
            GeoapifyClient().get_place('missing')

    def test_invalid_place_identifier_from_provider_is_not_a_service_outage(self):
        self.response.status_code = 400
        with self.assertRaises(PlaceNotFoundError):
            GeoapifyClient().get_place('invalid')

    def test_malformed_wikipedia_nested_objects(self):
        for payload in ({'query': None}, {'query': {'pages': [{'thumbnail': None}]}},
                        {'query': {'pages': [{'extract': None}]}}):
            with self.subTest(payload=payload), self.assertRaises(ProviderUnavailableError):
                self.response.json.return_value = payload
                WikipediaClient().summary(title='Lviv')

    def test_malformed_geo_response(self):
        for data in ({}, {'features': None}, {'features': [{}]}, {'features': [None]}):
            with self.subTest(data=data), self.assertRaises(ProviderUnavailableError):
                cache.clear()
                self.response.json.return_value = data
                GeoapifyClient().search_cities('Львів')

    def test_nonfinite_coordinates_from_provider(self):
        f = geo_feature()
        f['properties']['lat'] = float('nan')
        with self.assertRaises(ProviderUnavailableError):
            GeoapifyClient.normalize(f)

    @override_settings(GEOAPIFY_API_KEY='')
    def test_missing_key_never_calls_provider(self):
        with self.assertRaises(ProviderConfigurationError):
            GeoapifyClient().search_cities('Львів')
        self.http.assert_not_called()

    def test_rejected_key_is_sanitized(self):
        self.response.status_code = 401
        with self.assertRaises(ProviderConfigurationError) as error:
            GeoapifyClient().search_cities('Львів')
        self.assertNotIn('test-secret', str(error.exception))

    def test_timeout_is_sanitized(self):
        self.http.side_effect = requests.Timeout('https://provider/?apiKey=test-secret')
        with self.assertRaises(ProviderUnavailableError) as error:
            GeoapifyClient().search_cities('Львів')
        self.assertNotIn('test-secret', str(error.exception))
        self.assertTrue(error.exception.__suppress_context__)

    def test_rate_limit_and_http_errors(self):
        self.response.status_code = 429
        self.response.raise_for_status.side_effect = requests.HTTPError('private-url')
        with self.assertRaises(ProviderUnavailableError):
            GeoapifyClient().search_cities('Львів')

    def test_invalid_json(self):
        self.response.json.side_effect = ValueError('not JSON')
        with self.assertRaises(ProviderUnavailableError):
            request_json('Wikipedia', 'GET', WikipediaClient.URL)

    def test_wikipedia_linked_summary_and_photo(self):
        self.response.json.return_value = {'query': {'pages': [{'title': 'Львів', 'extract': 'Місто в Україні.',
            'fullurl': 'https://en.wikipedia.org/wiki/Lviv', 'thumbnail': {'source': 'https://upload.wikimedia.org/test.jpg'}}]}}
        result = WikipediaClient().summary(title='Львів')
        self.assertTrue(result['found'])
        self.assertEqual(result['match'], 'linked')
        self.assertTrue(result['image_url'].startswith('https://upload.wikimedia.org/'))
        self.assertEqual(self.http.call_args.kwargs['params']['explaintext'], 1)
        self.assertEqual(self.http.call_args.args[1], 'https://en.wikipedia.org/w/api.php')

    def test_foreign_place_resolves_linked_english_article(self):
        self.response.json.side_effect = [
            {'entities': {'Q973118': {'sitelinks': {'enwiki': {'title': 'Coronation of Napoleon'}},
                                     'descriptions': {'en': {'value': 'French royal event'}}}}},
            {'query': {'pages': [{'title': 'Coronation of Napoleon', 'extract': 'The coronation took place in Paris.',
                                 'fullurl': 'https://en.wikipedia.org/wiki/Coronation_of_Napoleon'}]}},
        ]
        result = WikipediaClient().place_summary(subject='Site of the Coronation of Napoleon',
            wikidata_id='Q973118', wikipedia_link='fr:Sacre de Napoléon Ier')
        self.assertEqual(result['description'], 'The coronation took place in Paris.')
        self.assertEqual(result['match'], 'linked')
        self.assertEqual(result['description_source'], 'Wikipedia')
        self.assertEqual(self.http.call_args.kwargs['params']['titles'], 'Coronation of Napoleon')

    def test_park_without_english_article_uses_verified_short_description(self):
        self.response.json.return_value = {'entities': {'Q3494657': {
            'descriptions': {'en': {'value': 'urban park in Paris, France'}}, 'sitelinks': {}}}}
        result = WikipediaClient().place_summary(subject='Square Jean XXIII', wikidata_id='Q3494657')
        self.assertEqual(result['description'], 'urban park in Paris, France')
        self.assertEqual(result['description_source'], 'Wikidata')
        self.assertEqual(result['description_url'], 'https://www.wikidata.org/wiki/Q3494657')
        self.assertEqual(result['url'], '')
        self.assertEqual(self.http.call_count, 1, 'Do not replace the linked park with an unrelated search result')

    def test_foreign_article_without_wikidata_id_follows_english_language_link(self):
        self.response.json.side_effect = [
            {'query': {'pages': [{'title': 'Lieu', 'extract': 'Texte français.',
                                 'fullurl': 'https://fr.wikipedia.org/wiki/Lieu',
                                 'langlinks': [{'lang': 'en', 'title': 'Place'}]}]}},
            {'query': {'pages': [{'title': 'Place', 'extract': 'English description.',
                                 'fullurl': 'https://en.wikipedia.org/wiki/Place'}]}},
        ]
        result = WikipediaClient().place_summary(wikipedia_link='fr:Lieu')
        self.assertEqual(result['description'], 'English description.')
        self.assertEqual(self.http.call_args_list[0].kwargs['params']['lllang'], 'en')

    @patch.object(WikipediaClient, 'summary', side_effect=ProviderUnavailableError('Wikipedia'))
    def test_wikipedia_outage_keeps_wikidata_description(self, summary):
        self.response.json.return_value = {'entities': {'Q123': {
            'sitelinks': {'enwiki': {'title': 'Park'}}, 'descriptions': {'en': {'value': 'park in Paris'}}}}}
        result = WikipediaClient().place_summary(wikidata_id='Q123')
        self.assertEqual(result['description'], 'park in Paris')
        self.assertEqual(result['description_source'], 'Wikidata')
        result = WikipediaClient().place_summary(title='Park', wikidata_id='Q123')
        self.assertEqual(result['description'], 'park in Paris')

    def test_wikidata_article_validation_and_cache(self):
        client = WikipediaClient()
        self.assertEqual(client.wikidata_article('https://evil.test'), {})
        self.http.assert_not_called()
        self.response.json.return_value = {'entities': {'Q123': {'descriptions': {}, 'sitelinks': {}}}}
        client.wikidata_article('Q123')
        client.wikidata_article('Q123')
        self.assertEqual(self.http.call_count, 1)
        self.response.json.return_value = {'entities': None}
        with self.assertRaises(ProviderUnavailableError):
            client.wikidata_article('Q456')

    def test_wikipedia_search_label(self):
        self.response.json.return_value = {'query': {'pages': [{'title': 'Львів', 'fullurl': 'https://en.wikipedia.org/wiki/Lviv'}]}}
        result = WikipediaClient().summary(query='Львів')
        self.assertEqual(result['match'], 'search')
        self.assertEqual(self.http.call_args.kwargs['params']['generator'], 'search')

    def test_place_search_rejects_city_article_and_image(self):
        self.response.json.return_value = {'query': {'pages': [{'title': 'Lviv',
            'fullurl': 'https://en.wikipedia.org/wiki/Lviv',
            'thumbnail': {'source': 'https://upload.wikimedia.org/city.jpg'}}]}}
        result = WikipediaClient().summary(query='Monument to Leopold von Sacher-Masoch Lviv',
                                            subject='Monument to Leopold von Sacher-Masoch')
        self.assertFalse(result['found'])
        self.assertEqual(result['image_url'], '')
        self.assertTrue(WikipediaClient().summary(query='Lviv')['found'])

    def test_place_title_matching(self):
        self.assertTrue(WikipediaClient.matches_subject('Market Square (Lviv)', 'Market Square'))
        self.assertFalse(WikipediaClient.matches_subject('Lviv', 'Rynok square'))

    def test_foreign_linked_photo_and_language_cache(self):
        self.response.json.return_value = {'query': {'pages': [{
            'title': 'Castle', 'fullurl': 'https://el.wikipedia.org/wiki/Castle',
            'thumbnail': {'source': 'https://upload.wikimedia.org/castle.jpg'}}]}}
        result = WikipediaClient().linked_image(wikipedia_link='el:Castle')
        self.assertEqual(result['image_source_url'], 'https://el.wikipedia.org/wiki/Castle')
        self.assertEqual(self.http.call_args.args[1], 'https://el.wikipedia.org/w/api.php')
        WikipediaClient().linked_image(wikipedia_link='el:Castle')
        self.assertEqual(self.http.call_count, 1)

    def test_foreign_link_cannot_select_an_arbitrary_host(self):
        with self.assertRaises(ProviderUnavailableError):
            WikipediaClient().linked_image(wikipedia_link='evil.test/path:Castle')
        self.http.assert_not_called()

    def test_geo_preserves_foreign_media_identity(self):
        feature = geo_feature()
        feature['properties']['wiki_and_media'] = {'wikipedia': 'el:Castle', 'wikidata': 'Q123'}
        result = GeoapifyClient.normalize(feature)
        self.assertEqual(result['wikipedia_link'], 'el:Castle')
        self.assertEqual(result['wikidata_id'], 'Q123')
        self.assertEqual(result['wikipedia_title'], '')

    def test_wikidata_photo_resolves_commons_thumbnail_and_source(self):
        self.response.json.side_effect = [
            {'entities': {'Q123': {'claims': {'P18': [{'rank': 'normal', 'mainsnak': {
                'snaktype': 'value', 'datavalue': {'value': 'Statue.jpg'}}}]}}}},
            {'query': {'pages': [{'imageinfo': [{'thumburl': 'https://upload.wikimedia.org/statue.jpg',
                'descriptionurl': 'https://commons.wikimedia.org/wiki/File:Statue.jpg'}]}]}},
        ]
        result = WikipediaClient().linked_image(wikidata_id='Q123')
        self.assertEqual(result['image_url'], 'https://upload.wikimedia.org/statue.jpg')
        self.assertEqual(result['image_source_url'], 'https://commons.wikimedia.org/wiki/File:Statue.jpg')
        WikipediaClient().linked_image(wikidata_id='Q123')
        self.assertEqual(self.http.call_count, 2)

    def test_wikidata_no_image_and_invalid_identity(self):
        self.response.json.return_value = {'entities': {'Q123': {'claims': {}}}}
        self.assertEqual(WikipediaClient().linked_image(wikidata_id='Q123')['image_url'], '')
        self.assertEqual(WikipediaClient().linked_image(wikidata_id='https://bad.test')['image_url'], '')
        self.assertEqual(self.http.call_count, 1)

    def test_wikidata_malformed_response_is_provider_error(self):
        self.response.json.return_value = {'entities': None}
        with self.assertRaises(ProviderUnavailableError):
            WikipediaClient().linked_image(wikidata_id='Q123')

    def test_commons_exact_name_search_and_cache(self):
        self.response.json.return_value = {'query': {'pages': [{'imageinfo': [{
            'thumburl': 'https://thumb.wikimedia.org/statue.jpg',
            'descriptionurl': 'https://commons.wikimedia.org/wiki/File:Statue.jpg'}]}]}}
        result = WikipediaClient().search_image('Mikhail Damiralis')
        self.assertTrue(result['image_url'])
        self.assertEqual(self.http.call_args.kwargs['params']['gsrsearch'], '"Mikhail Damiralis" filetype:bitmap')
        WikipediaClient().search_image('Mikhail Damiralis')
        self.assertEqual(self.http.call_count, 1)

    def test_commons_ignores_generic_single_word_names(self):
        self.assertFalse(WikipediaClient().search_image('Cafe')['image_url'])
        self.http.assert_not_called()

    def test_commons_empty_and_unsafe_image(self):
        self.response.json.return_value = {'batchcomplete': True}
        self.assertFalse(WikipediaClient().search_image('No place')['image_url'])
        self.response.json.return_value = {'query': {'pages': [{'imageinfo': [{
            'thumburl': 'https://evil.test/photo.jpg',
            'descriptionurl': 'https://commons.wikimedia.org/wiki/File:Photo.jpg'}]}]}}
        self.assertFalse(WikipediaClient().search_image('Other place')['image_url'])

    def test_wikipedia_empty_or_disambiguation(self):
        for data in ({'batchcomplete': True}, {'query': {'pages': [{'missing': True}]}},
                     {'query': {'pages': [{'pageprops': {'disambiguation': ''}}]}}):
            cache.clear()
            self.response.json.return_value = data
            self.assertFalse(WikipediaClient().summary(query='Unknown')['found'])

    def test_wikipedia_upstream_error(self):
        self.response.json.return_value = {'error': {'code': 'failed'}}
        with self.assertRaises(ProviderUnavailableError):
            WikipediaClient().summary(query='Львів')

    def test_wikipedia_rejects_unsafe_article_and_image_urls(self):
        self.response.json.return_value = {'query': {'pages': [{'title': 'Lviv', 'fullurl': 'javascript:alert(1)'}]}}
        with self.assertRaises(ProviderUnavailableError):
            WikipediaClient().summary(title='Lviv')
        self.response.json.return_value = {'query': {'pages': [{'title': 'Lviv', 'fullurl': 'https://en.wikipedia.org/wiki/Lviv', 'thumbnail': {'source': 'https://untrusted.test/file'}}]}}
        self.assertEqual(WikipediaClient().summary(title='Lviv')['image_url'], '')
