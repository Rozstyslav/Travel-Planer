from django.core.cache import cache

from travel.clients.base import request_json
from travel.exceptions import CountryNotFoundError, ProviderUnavailableError


class CountriesClient:
    URL = 'https://countries.trevorblades.com'
    FIELDS = 'code name native emoji capital currency continent { code name } languages { code name native }'

    def _query(self, query, variables=None):
        payload = request_json('Countries', 'POST', self.URL, json={'query': query, 'variables': variables or {}})
        if payload.get('errors') or not isinstance(payload.get('data'), dict):
            raise ProviderUnavailableError('Countries', 'Countries returned an invalid GraphQL response.')
        return payload['data']

    def list_countries(self):
        key = 'countries:v2:all'
        result = cache.get(key)
        if result is None:
            result = self._query('{ countries { ' + self.FIELDS + ' } }').get('countries')
            if not isinstance(result, list) or any(
                    not isinstance(c, dict) or not c.get('code') or not c.get('name') for c in result):
                raise ProviderUnavailableError('Countries')
            cache.set(key, result, 86400)
        return result

    def get_country(self, code):
        code = code.upper()
        key = f'countries:v2:{code}'
        result = cache.get(key)
        if result is None:
            data = self._query('query Country($code: ID!) { country(code: $code) { ' + self.FIELDS + ' } }',
                               {'code': code})
            if 'country' not in data:
                raise ProviderUnavailableError('Countries')
            result = data['country']
            if result is None:
                raise CountryNotFoundError('Country was not found.')
            if not isinstance(result, dict) or result.get('code') != code or not result.get('name'):
                raise ProviderUnavailableError('Countries')
            cache.set(key, result, 86400)
        return result
