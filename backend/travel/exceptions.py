class ProviderError(Exception):
    """A sanitized upstream failure without credentials or request URLs."""

    def __init__(self, provider, message='External service is temporarily unavailable.'):
        self.provider = provider
        super().__init__(message)


class ProviderUnavailableError(ProviderError):
    pass


class ProviderConfigurationError(ProviderError):
    pass


class ProviderNotFoundError(ProviderError):
    pass


class PlaceNotFoundError(Exception):
    pass


class CountryNotFoundError(Exception):
    pass


class TravelProjectError(Exception):
    pass


class ProjectPlaceLimitError(TravelProjectError):
    pass


class DuplicateProjectPlaceError(TravelProjectError):
    pass


class ProjectHasVisitedPlacesError(TravelProjectError):
    pass
