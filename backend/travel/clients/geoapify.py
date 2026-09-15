import math
from hashlib import sha256
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache

from travel.clients.base import request_json
from travel.exceptions import PlaceNotFoundError, ProviderConfigurationError, ProviderUnavailableError, ProviderNotFoundError


class GeoapifyClient:
    GEOCODING_URL = 'https://api.geoapify.com/v1/geocode/search'
    PLACES_URL = 'https://api.geoapify.com/v2/places'
    DETAILS_URL = 'https://api.geoapify.com/v2/place-details'

    def _get(self, url, params):
        if not settings.GEOAPIFY_API_KEY:
            raise ProviderConfigurationError('Geoapify', 'Geoapify API key is not configured on the server.')
        key = 'geoapify:v2:' + sha256(
            (url + urlencode(sorted(params.items())) + settings.GEOAPIFY_API_KEY).encode()).hexdigest()
        data = cache.get(key)
        if data is None:
            data = request_json('Geoapify', 'GET', url,
                                not_found_statuses=(400, 404) if url == self.DETAILS_URL else (),
                                params={**params, 'apiKey': settings.GEOAPIFY_API_KEY})
            features = data.get('features')
            if not isinstance(features, list):
                raise ProviderUnavailableError('Geoapify', 'Geoapify returned invalid location data.')
            for feature in features:
                self.normalize(feature)
            cache.set(key, data, 900)
        return data['features']

    @staticmethod
    def normalize(feature, *, city_result=False):
        try:
            p = feature['properties']
            lat, lon = float(p['lat']), float(p['lon'])
            if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError
            place_id = p['place_id']
            if not isinstance(place_id, str) or not place_id or len(place_id) > 512:
                raise ValueError
            categories = p.get('categories') or []
            if not isinstance(categories, list) or not all(isinstance(c, str) for c in categories):
                raise ValueError
            raw = (p.get('datasource') or {}).get('raw') or {}
            wiki = (p.get('wiki_and_media') or {}).get('wikipedia') or raw.get('wikipedia', '')
            name = raw.get('name:en') or raw.get('int_name') or p.get('name') or raw.get('name')
            if city_result:
                name = name or p.get('city') or p.get('town') or p.get('village')
            fallback = 'Unnamed park' if 'leisure.park' in categories else 'Unnamed place'
            return {
                'place_id': place_id, 'name': str(name or fallback)[:500],
                'has_name': bool(name),
                'source_id': f"osm:{raw.get('osm_type')}:{raw['osm_id']}" if raw.get('osm_id') else place_id,
                'address': str(p.get('formatted') or ''), 'country_code': str(p.get('country_code') or '').upper(),
                'city': str(p.get('city') or p.get('town') or p.get('village') or '')[:255],
                'region': str(p.get('state') or '')[:255],
                'latitude': lat, 'longitude': lon, 'categories': categories,
                'wikipedia_title': wiki[3:] if isinstance(wiki, str) and wiki.startswith('en:') else '',
                'wikipedia_link': wiki if isinstance(wiki, str) else '',
                'wikidata_id': (p.get('wiki_and_media') or {}).get('wikidata') or raw.get('wikidata', ''),
                'image_search_name': str(raw.get('name:en') or raw.get('int_name') or p.get('name') or '')[:500],
                'english_name': str(raw.get('name:en') or raw.get('int_name') or '')[:500],
                'name_aliases': list(dict.fromkeys(str(value)[:500] for key, value in raw.items()
                                                  if value and (key == 'name' or key == 'int_name' or key.startswith('name:')))),
                'description': '', 'image_url': '', 'wikipedia_url': '',
            }
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ProviderUnavailableError('Geoapify', 'Geoapify returned invalid location data.') from None

    def search_cities(self, query, country_code='', limit=6):
        params = {'text': query, 'type': 'city', 'lang': 'en', 'limit': limit}
        if country_code:
            params['filter'] = f'countrycode:{country_code.lower()}'
        return [self.normalize(f, city_result=True) for f in self._get(self.GEOCODING_URL, params)]

    def search_places(self, *, latitude, longitude, categories, radius=5000, limit=12, offset=0):
        params = {'categories': categories, 'filter': f'circle:{longitude},{latitude},{radius}',
                  'bias': f'proximity:{longitude},{latitude}', 'conditions': 'named',
                  'lang': 'en', 'limit': limit, 'offset': offset}
        return [self.normalize(f) for f in self._get(self.PLACES_URL, params)]

    def get_place(self, place_id):
        try:
            features = self._get(self.DETAILS_URL, {'id': place_id, 'features': 'details', 'lang': 'en'})
        except ProviderNotFoundError:
            raise PlaceNotFoundError('Place was not found or its identifier is invalid.') from None
        if not features:
            raise PlaceNotFoundError('Place was not found.')
        place = self.normalize(features[0])
        # Geoapify may recalculate the centroid embedded in an ID. Use the
        # requested ID for lookup and the stable OSM identity for deduplication.
        place['place_id'] = place_id
        return place
