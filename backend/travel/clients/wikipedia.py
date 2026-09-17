from hashlib import sha256
import re
from urllib.parse import urlparse

from django.core.cache import cache

from travel.clients.base import request_json
from travel.exceptions import ProviderError, ProviderUnavailableError


class WikipediaClient:
    URL = 'https://en.wikipedia.org/w/api.php'

    def summary(self, *, title='', query='', language='en', subject=''):
        """Exact linked article or a labelled search suggestion."""
        if not re.fullmatch(r'[a-z]{2,12}(?:-[a-z]{2,12})?', language):
            raise ProviderUnavailableError('Wikipedia')
        key = 'wikipedia:v5:' + sha256(f'{language}|{title}|{query}|{subject}'.encode()).hexdigest()
        cached = cache.get(key)
        if cached is not None:
            return cached
        params = {'action': 'query', 'format': 'json', 'formatversion': 2,
                  'prop': 'extracts|pageimages|info|pageprops', 'exintro': 1, 'explaintext': 1,
                  'exchars': 1600, 'piprop': 'thumbnail', 'pithumbsize': 800, 'inprop': 'url', 'redirects': 1}
        if language != 'en':
            params.update(prop=params['prop'] + '|langlinks', lllang='en', lllimit=1)
        if title:
            params['titles'] = title
        else:
            params.update(generator='search', gsrsearch=query, gsrnamespace=0, gsrlimit=1)
        data = request_json('Wikipedia', 'GET', f'https://{language}.wikipedia.org/w/api.php', params=params)
        if data.get('error') or ('query' not in data and 'batchcomplete' not in data):
            raise ProviderUnavailableError('Wikipedia', 'Wikipedia returned an invalid response.')
        query_data = data.get('query', {})
        if not isinstance(query_data, dict):
            raise ProviderUnavailableError('Wikipedia')
        pages = query_data.get('pages', [])
        if not isinstance(pages, list) or any(not isinstance(p, dict) for p in pages):
            raise ProviderUnavailableError('Wikipedia')
        if any(not isinstance(p.get('pageprops', {}), dict) or not isinstance(p.get('thumbnail', {}), dict) for p in pages):
            raise ProviderUnavailableError('Wikipedia')
        page = next((p for p in pages if not p.get('missing') and 'disambiguation' not in p.get('pageprops', {})), None)
        if page and subject and not title and not self.matches_subject(page.get('title', ''), subject):
            page = None
        result = {'found': False, 'title': '', 'description': '', 'image_url': '', 'url': '', 'match': 'none',
                  'attribution': 'Wikipedia contributors',
                  'license_url': 'https://creativecommons.org/licenses/by-sa/4.0/'}
        if page:
            page_url = page.get('fullurl', '')
            image_url = page.get('thumbnail', {}).get('source', '')
            if not isinstance(page.get('extract', ''), str):
                raise ProviderUnavailableError('Wikipedia')
            if urlparse(page_url).scheme != 'https' or urlparse(page_url).hostname != f'{language}.wikipedia.org':
                raise ProviderUnavailableError('Wikipedia')
            if urlparse(image_url).scheme != 'https' or urlparse(image_url).hostname not in ('upload.wikimedia.org',
                                                                                             'thumb.wikimedia.org'):
                image_url = ''
            result.update(found=True, title=page.get('title', ''), description=page.get('extract', ''),
                          image_url=image_url, url=page_url, match='linked' if title else 'search')
            result['wikidata_id'] = page.get('pageprops', {}).get('wikibase_item', '')
            links = page.get('langlinks', [])
            if not isinstance(links, list) or any(not isinstance(link, dict) for link in links):
                raise ProviderUnavailableError('Wikipedia')
            result['english_title'] = next((link.get('title', '') for link in links if link.get('lang') == 'en'), '')
        cache.set(key, result, 86400)
        return result

    def wikidata_article(self, entity_id):
        """English article identity and short description for the exact linked entity."""
        if not re.fullmatch(r'Q[1-9][0-9]*', str(entity_id)):
            return {}
        key = f'wikidata-article:v1:{entity_id}'
        cached = cache.get(key)
        if cached is not None:
            return cached
        data = request_json('Wikipedia', 'GET', 'https://www.wikidata.org/w/api.php', params={
            'action': 'wbgetentities', 'ids': entity_id, 'props': 'sitelinks|descriptions',
            'languages': 'en', 'sitefilter': 'enwiki', 'format': 'json'})
        try:
            entity = data['entities'][entity_id]
            if 'missing' in entity:
                result = {}
            else:
                title = entity.get('sitelinks', {}).get('enwiki', {}).get('title', '')
                description = entity.get('descriptions', {}).get('en', {}).get('value', '')
                if not isinstance(title, str) or not isinstance(description, str):
                    raise ValueError
                result = {'title': title, 'description': description.strip(),
                          'url': f'https://www.wikidata.org/wiki/{entity_id}'}
        except (KeyError, TypeError, AttributeError, ValueError):
            raise ProviderUnavailableError('Wikipedia') from None
        cache.set(key, result, 86400)
        return result

    def place_summary(self, *, title='', query='', subject='', wikipedia_link='', wikidata_id=''):
        """Prefer linked English content, including places with a local-language name."""
        metadata = {}
        linked = {}
        if not title:
            try:
                metadata = self.wikidata_article(wikidata_id)
            except ProviderError:
                pass  # A linked article or name search may still be available.
            title = metadata.get('title', '')
        if not title and not metadata:
            language, separator, local_title = wikipedia_link.partition(':')
            if separator and local_title:
                try:
                    if language == 'en':
                        title = local_title
                    else:
                        linked = self.summary(title=local_title, language=language)
                        title = linked.get('english_title', '')
                        if not title:
                            metadata = self.wikidata_article(linked.get('wikidata_id', ''))
                            title = metadata.get('title', '')
                except ProviderError:
                    pass

        def short_description():
            return {
                'found': True, 'title': '', 'description': metadata['description'],
                'image_url': linked.get('image_url', ''), 'url': '', 'match': 'linked',
                'description_source': 'Wikidata', 'description_url': metadata['url'],
                'image_source_url': linked.get('url', '') if linked.get('image_url') else '',
            }

        # No English article exists for this entity: use its verified short description.
        if not title and metadata.get('description'):
            return short_description()
        try:
            result = self.summary(title=title, query=query, subject=subject)
        except ProviderError:
            if not metadata:
                try:
                    metadata = self.wikidata_article(wikidata_id)
                except ProviderError:
                    pass
            if metadata.get('description'):
                return short_description()
            raise
        if not result.get('description', '').strip() and metadata.get('description'):
            fallback = short_description()
            if result.get('image_url'):
                fallback.update(image_url=result['image_url'], image_source_url=result['url'])
            return fallback
        return {**result, 'description_source': 'Wikipedia' if result.get('description') else '',
                'description_url': result['url'] if result.get('description') else ''}

    @staticmethod
    def matches_subject(title, subject):
        # Full-text search can return a city article merely mentioning a monument.
        # Require the distinctive words of the place name in the article title.
        ignored = {'the', 'a', 'an', 'of', 'to', 'in', 'at', 'and', 'von', 'de', 'la',
                   'monument', 'memorial', 'statue', 'bust', 'square'}
        words = lambda text: set(re.findall(r'\w+', text.casefold())) - ignored
        wanted = words(subject)
        return bool(wanted) and wanted <= words(title)

    def linked_image(self, *, wikipedia_link='', wikidata_id=''):
        """Use only media explicitly linked to the geographic object."""
        if re.fullmatch(r'Q[1-9][0-9]*', str(wikidata_id)):
            photo = self.wikidata_image(wikidata_id)
            if photo['image_url']:
                return photo
        language, separator, title = wikipedia_link.partition(':')
        if separator and title and language != 'en':
            article = self.summary(title=title, language=language)
            if article['image_url']:
                return {'image_url': article['image_url'], 'image_source_url': article['url']}
        return {'image_url': '', 'image_source_url': ''}

    def wikidata_image(self, entity_id):
        key = f'wikidata-image:v1:{entity_id}'
        cached = cache.get(key)
        if cached is not None:
            return cached
        data = request_json('Wikipedia', 'GET', 'https://www.wikidata.org/w/api.php',
                            params={'action': 'wbgetentities', 'ids': entity_id, 'props': 'claims', 'format': 'json'})
        result = {'image_url': '', 'image_source_url': ''}
        try:
            claims = data['entities'][entity_id].get('claims', {}).get('P18', [])
            for claim in sorted(claims, key=lambda c: c.get('rank') != 'preferred'):
                if claim.get('rank') == 'deprecated':
                    continue
                snak = claim['mainsnak']
                if snak.get('snaktype') != 'value':
                    continue
                filename = snak['datavalue']['value']
                if not isinstance(filename, str) or '|' in filename:
                    continue
                media = request_json('Wikipedia', 'GET', 'https://commons.wikimedia.org/w/api.php', params={
                    'action': 'query', 'format': 'json', 'formatversion': 2, 'prop': 'imageinfo',
                    'titles': f'File:{filename}', 'iiprop': 'url', 'iiurlwidth': 800})
                for page in media['query']['pages']:
                    for info in page.get('imageinfo', []):
                        image = info.get('thumburl') or info.get('url', '')
                        source = info.get('descriptionurl', '')
                        if (urlparse(image).scheme == 'https' and urlparse(image).hostname in
                            ('upload.wikimedia.org', 'thumb.wikimedia.org') and
                            urlparse(source).scheme == 'https' and urlparse(source).hostname == 'commons.wikimedia.org'):
                            result = {'image_url': image, 'image_source_url': source}
                            break
                if result['image_url']:
                    break
        except (KeyError, TypeError, AttributeError):
            raise ProviderUnavailableError('Wikipedia') from None
        cache.set(key, result, 86400)
        return result

    def search_image(self, name):
        """A labelled exact-phrase Commons suggestion, never a random nearby image."""
        words = re.findall(r'\w+', name, re.UNICODE)
        if len(words) < 2:
            return {'image_url': '', 'image_source_url': ''}
        query = '"' + ' '.join(words) + '" filetype:bitmap'
        key = 'commons-search:v1:' + sha256(query.encode()).hexdigest()
        cached = cache.get(key)
        if cached is not None:
            return cached
        data = request_json('Wikipedia', 'GET', 'https://commons.wikimedia.org/w/api.php', params={
            'action': 'query', 'format': 'json', 'formatversion': 2, 'generator': 'search',
            'gsrsearch': query, 'gsrnamespace': 6, 'gsrlimit': 1, 'prop': 'imageinfo',
            'iiprop': 'url', 'iiurlwidth': 800})
        result = {'image_url': '', 'image_source_url': ''}
        try:
            if data.get('error') or ('query' not in data and 'batchcomplete' not in data):
                raise ValueError
            for page in data.get('query', {}).get('pages', []):
                for info in page.get('imageinfo', []):
                    image = info.get('thumburl') or info.get('url', '')
                    source = info.get('descriptionurl', '')
                    if (urlparse(image).scheme == 'https' and urlparse(image).hostname in
                        ('upload.wikimedia.org', 'thumb.wikimedia.org') and
                        urlparse(source).scheme == 'https' and urlparse(source).hostname == 'commons.wikimedia.org'):
                        result = {'image_url': image, 'image_source_url': source}
        except (ValueError, TypeError, AttributeError):
            raise ProviderUnavailableError('Wikipedia') from None
        cache.set(key, result, 86400)
        return result
