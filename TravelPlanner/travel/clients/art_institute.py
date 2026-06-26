from dataclasses import dataclass
from typing import Any

import requests

from travel.exceptions import (
    ArtworkNotFoundError,
    ArtInstituteUnavailableError,
)

@dataclass(frozen=True)
class ArtworkData:
    external_id: int
    title: str
    artist_display: str
    image_id: str

class ArtInstituteClient:
    BASE_URL = "https://api.artic.edu/api/v1"
    TIMEOUT = 10

    def get_artwork(self, external_id: int) -> ArtworkData:

        if (not isinstance(external_id, int)
            or isinstance(external_id, bool)
            or external_id <= 0
        ):
            raise ValueError(
                "external_id must be a positive integer."
            )

        url = f"{self.BASE_URL}/artworks/{external_id}"

        try:
            response = requests.get(
                url,
                params={
                    "fields": (
                        "id,title,artist_display,image_id"
                    ),
                },
                timeout=self.TIMEOUT,
            )
        except requests.RequestException as exc:
            raise ArtInstituteUnavailableError(
                "Could not connect to the Art Institute API."
            ) from exc

        if response.status_code == 404:
            raise ArtworkNotFoundError(
                f"Artwork with external ID {external_id} was not found."
            )

        try:
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ArtInstituteUnavailableError(
                "The Art Institute API returned an error."
            ) from exc

        try:
            payload: dict[str, Any] = response.json()
            artwork = payload["data"]

            artwork_id = int(artwork["id"])
        except (
            ValueError,
            TypeError,
            KeyError,
            requests.JSONDecodeError,
        ) as exc:
            raise ArtInstituteUnavailableError(
                "The Art Institute API returned an invalid response."
            ) from exc

        return ArtworkData(
            external_id=artwork_id,
            title=str(artwork.get("title") or ""),
            artist_display=str(
                artwork.get("artist_display") or ""
            ),
            image_id=str(artwork.get("image_id") or ""),
        )