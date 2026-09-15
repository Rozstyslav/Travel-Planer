import requests
from django.conf import settings

from travel.exceptions import ProviderConfigurationError, ProviderUnavailableError, ProviderNotFoundError


def request_json(provider, method, url, *, not_found_statuses=(), **kwargs):
    try:
        response = requests.request(
            method, url, timeout=settings.EXTERNAL_API_TIMEOUT,
            headers={'User-Agent': settings.EXTERNAL_API_USER_AGENT}, **kwargs,
        )
        if response.status_code in (401, 403):
            raise ProviderConfigurationError(provider, f'{provider} rejected the server credentials or access policy.')
        if response.status_code in not_found_statuses:
            raise ProviderNotFoundError(provider, 'Place was not found or its identifier is invalid.')
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError('Expected an object')
        return data
    except (requests.RequestException, ValueError):
        # requests errors may contain the URL and apiKey. Never expose them.
        raise ProviderUnavailableError(provider) from None
