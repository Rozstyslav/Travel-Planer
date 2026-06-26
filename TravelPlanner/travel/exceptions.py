class ArtInstituteError(Exception):
    pass

class ArtworkNotFoundError(ArtInstituteError):
    pass

class ArtInstituteUnavailableError(ArtInstituteError):
    pass

class TravelProjectError(Exception):
    pass

class ProjectPlaceLimitError(TravelProjectError):
    pass

class DuplicateProjectPlaceError(TravelProjectError):
    pass

class ProjectHasVisitedPlacesError(TravelProjectError):
    pass