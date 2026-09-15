def geo_place(place_id='geo-1', source_id='osm:n:1'):
    return {'place_id': place_id, 'source_id': source_id, 'name': 'Львівська ратуша',
            'address': 'площа Ринок, Львів, Україна', 'country_code': 'UA', 'city': 'Львів',
            'latitude': 49.8419, 'longitude': 24.0316, 'categories': ['tourism.sights'],
            'description': '', 'image_url': '', 'wikipedia_url': '', 'wikipedia_title': '',
            'wikipedia_match': 'none'}


def geo_feature(place_id='geo-1'):
    return {'properties': {'place_id': place_id, 'name': 'Львівська ратуша',
            'formatted': 'Львів, Україна', 'country_code': 'ua', 'city': 'Львів',
            'lat': 49.8419, 'lon': 24.0316, 'categories': ['tourism.sights'],
            'datasource': {'raw': {'osm_id': 1, 'osm_type': 'n', 'wikipedia': 'en:Львівська ратуша'}}}}
