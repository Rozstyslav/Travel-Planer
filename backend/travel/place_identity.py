import math
import re
import unicodedata


def normalized_name(value):
    return ' '.join(re.findall(r'\w+', unicodedata.normalize('NFKC', value).casefold()))


def same_place(a, b):
    if a['place_id'] == b['place_id'] or (a.get('source_id') and a.get('source_id') == b.get('source_id')):
        return True
    # Nearby branches and unrelated objects with different identities stay separate.
    lat = math.radians((a['latitude'] + b['latitude']) / 2)
    distance = 111_320 * math.hypot(a['latitude'] - b['latitude'],
                                  (a['longitude'] - b['longitude']) * math.cos(lat))
    if distance > 150:
        return False
    for field in ('wikidata_id', 'wikipedia_link'):
        if a.get(field) and b.get(field):
            return a[field] == b[field]
    names_a = {normalized_name(n) for n in [a['name'], *a.get('name_aliases', [])] if n}
    names_b = {normalized_name(n) for n in [b['name'], *b.get('name_aliases', [])] if n}
    return bool(names_a & names_b)


def unique_places(places):
    result = []
    for place in places:
        existing = next((p for p in result if same_place(p, place)), None)
        if existing is None:
            result.append(dict(place))
        else:
            existing['name_aliases'] = list(dict.fromkeys([
                existing['name'], *existing.get('name_aliases', []), place['name'], *place.get('name_aliases', [])]))
            if not existing.get('english_name') and place.get('english_name'):
                existing['name'] = existing['english_name'] = place['english_name']
    return result
