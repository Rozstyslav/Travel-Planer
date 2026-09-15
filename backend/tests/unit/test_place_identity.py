from django.test import SimpleTestCase
from travel.place_identity import unique_places
from tests.fixtures import geo_place


class PlaceIdentityTests(SimpleTestCase):
    def test_square_and_translated_point_are_one_place(self):
        square = {**geo_place('square', 'osm:r:1'), 'name': 'площа Ринок',
                  'name_aliases': ['площа Ринок'], 'wikidata_id': 'Q1980511'}
        point = {**geo_place('point', 'osm:n:2'), 'name': 'Rynok square', 'english_name': 'Rynok square',
                 'name_aliases': ['Площа Ринок', 'Rynok square'], 'longitude': square['longitude'] + .001}
        result = unique_places([square, point])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['place_id'], 'square')
        self.assertEqual(result[0]['name'], 'Rynok square')
        self.assertEqual(square['name'], 'площа Ринок')

    def test_nearby_different_places_and_distant_branches_remain(self):
        a = {**geo_place('a', 'osm:n:1'), 'name': 'Cafe Central'}
        different = {**geo_place('b', 'osm:n:2'), 'name': 'Other Cafe'}
        distant = {**a, 'place_id': 'c', 'source_id': 'osm:n:3', 'latitude': a['latitude'] + .02}
        self.assertEqual(len(unique_places([a, different, distant])), 3)

    def test_conflicting_wikidata_is_not_merged(self):
        a = {**geo_place('a', 'osm:n:1'), 'wikidata_id': 'Q1'}
        b = {**geo_place('b', 'osm:n:2'), 'wikidata_id': 'Q2'}
        self.assertEqual(len(unique_places([a, b])), 2)

    def test_centroid_alias_ids_for_same_source_are_merged(self):
        self.assertEqual(len(unique_places([geo_place('a'), geo_place('b')])), 1)
