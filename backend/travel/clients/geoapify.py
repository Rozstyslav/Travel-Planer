import math
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache

from travel.clients.base import request_json
from travel.exceptions import PlaceNotFoundError, ProviderConfigurationError, ProviderUnavailableError, ProviderNotFoundError
from travel.place_identity import unique_places


class GeoapifyClient:
    GEOCODING_URL = 'https://api.geoapify.com/v1/geocode/search'
    PLACES_URL = 'https://api.geoapify.com/v2/places'
    DETAILS_URL = 'https://api.geoapify.com/v2/place-details'
    TOURISM_CATEGORIES = 'tourism.sights,tourism.attraction'
    LANDMARK_CATEGORIES = (
        'man_made.tower,tourism.sights.tower,tourism.sights.city_gate,'
        'tourism.sights.castle,tourism.sights.place_of_worship.cathedral'
    )
    # Each family gets its own candidate budget: dense collections of plaques
    # or galleries must not crowd theatres, museums or historic buildings out.
    SIGHT_CATEGORY_GROUPS = (
        TOURISM_CATEGORIES,
        LANDMARK_CATEGORIES,
        'entertainment.culture',
        'entertainment.museum',
        'heritage,building.historic',
    )
    SIGHT_CATEGORIES = ','.join(SIGHT_CATEGORY_GROUPS)
    HIGHLIGHT_GROUP_LIMIT = 200
    HIGHLIGHT_MAX_RESULTS = len(SIGHT_CATEGORY_GROUPS) * HIGHLIGHT_GROUP_LIMIT

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
                'sight_priority': GeoapifyClient.sight_priority(raw, categories),
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

    @staticmethod
    def sight_priority(raw, categories):
        """OSM prominence hints, not a visitor rating or a curated city-specific list."""
        score = {'international': 100, 'national': 60, 'regional': 20}.get(raw.get('importance'), 0)
        score += 60 if str(raw.get('landmark', '')).lower() in ('1', 'yes', 'true') else 0
        score += 40 if 'heritage.unesco' in categories else 0
        score += 10 if raw.get('wikipedia') else 0
        score += 5 if raw.get('wikidata') else 0
        score += min(20, sum(1 for key, value in raw.items() if key.startswith('name:') and value)) * 2
        return score

    def search_places(self, *, latitude, longitude, categories, radius=5000, limit=12, offset=0, sort='distance'):
        if categories == 'tourism.sights' and sort == 'highlights':
            return self.sight_highlights(latitude, longitude, radius)[offset:offset + limit]
        if categories == 'tourism.sights':
            categories = self.SIGHT_CATEGORIES
        params = {'categories': categories, 'filter': f'circle:{longitude},{latitude},{radius}',
                  'bias': f'proximity:{longitude},{latitude}', 'conditions': 'named',
                  'lang': 'en', 'limit': limit, 'offset': offset}
        return [self.normalize(f) for f in self._get(self.PLACES_URL, params)]

    def sight_highlights(self, latitude, longitude, radius):
        key = 'sight-highlights:v2:' + sha256(
            f'{latitude}|{longitude}|{radius}|{settings.GEOAPIFY_API_KEY}'.encode()).hexdigest()
        cached = cache.get(key)
        if cached is not None:
            return cached
        common = {'filter': f'circle:{longitude},{latitude},{radius}', 'conditions': 'named',
                  'lang': 'en', 'limit': self.HIGHLIGHT_GROUP_LIMIT}
        # Query all families throughout the radius before ranking and pagination.
        # Keep the nearby tourism feed, but do not restrict other families to it.
        with ThreadPoolExecutor(max_workers=len(self.SIGHT_CATEGORY_GROUPS)) as executor:
            requests = [executor.submit(self._get, self.PLACES_URL, {
                **common, 'categories': group,
                **({'bias': f'proximity:{longitude},{latitude}'} if group == self.TOURISM_CATEGORIES else {}),
            }) for group in self.SIGHT_CATEGORY_GROUPS]
            features = [feature for request in requests for feature in request.result()]
        places = [self.normalize(feature) for feature in features]

        def distance(place):
            lat1, lat2 = math.radians(latitude), math.radians(place['latitude'])
            delta_lon = math.radians(place['longitude'] - longitude)
            haversine = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
            return 6371000 * 2 * math.asin(min(1, math.sqrt(haversine)))

        places = [p for p in places if p['has_name'] and distance(p) <= radius]
        places.sort(key=lambda p: (-p['sight_priority'], distance(p), p['name'], p['place_id']))
        result = unique_places(places)
        cache.set(key, result, 900)
        return result

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
