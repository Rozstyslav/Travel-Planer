// Share requests across cards/rerenders and avoid a burst of geocoding requests.
export function createCityCoverLookup(searchCities, coverForCities) {
  const cache = new Map();
  const queue = [];
  let active = 0;

  function drain() {
    while (active < 2 && queue.length) {
      active += 1;
      const { name, entry, resolve } = queue.shift();
      const query = name.replace(
        /^(?:(?:a |my )?trip to|(?:a )?weekend in|holiday in|подорож до|подорож у|подорож в|вихідні у|вихідні в)\s+/iu,
        "",
      );
      Promise.resolve().then(() => searchCities(query))
        .then((cities) => {
          entry.expires = Date.now() + 86400000;
          resolve(coverForCities(name, Array.isArray(cities) ? cities : []));
        })
        .catch(() => {
          // Temporary errors can retry on a later render, without blocking cards.
          entry.expires = Date.now() + 60000;
          resolve(null);
        })
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  return (name) => {
    const query = name.trim();
    if (query.length < 2 || query.length > 150 || /[<>]/u.test(query)) {
      return Promise.resolve(null);
    }
    const key = query.normalize("NFKC").toLowerCase();
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) return existing.promise;
    const entry = { expires: Infinity };
    entry.promise = new Promise((resolve) => queue.push({ name: query, entry, resolve }));
    cache.set(key, entry);
    drain();
    return entry.promise;
  };
}
