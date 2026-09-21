// Local associations, supplemented by country/city data supplied by the caller.
// Keep aliases as whole words/phrases so "Rome" does not match "romantic".
const destinations = [
  ["AU", "🦘", "sand", "Australia", "australia|австралія|австралії|sydney|сидней|сиднеї|melbourne|мельбурн|canberra|канберра"],
  ["AR", "🧉", "sage", "Argentina", "argentina|аргентина|аргентині|аргентини|buenos aires|буенос айрес|буенос айресі"],
  ["CA", "🍁", "clay", "Canada", "canada|канада|канаді|канади|toronto|торонто|montreal|монреаль|vancouver|ванкувер"],
  ["BR", "⚽", "sage", "Brazil", "brazil|brasil|бразилія|бразилії|rio de janeiro|ріо де жанейро|sao paulo|são paulo|сан паулу"],
  ["NZ", "🥝", "sage", "New Zealand", "new zealand|нова зеландія|новій зеландії|auckland|окленд"],
  ["EG", "🐪", "sand", "Egypt", "egypt|єгипет|єгипті|cairo|каїр|каїрі|hurghada|хургада"],
  ["MX", "🌮", "sand", "Mexico", "mexico|мексика|мексиці|cancun|cancún|канкун"],
  ["IN", "🪷", "clay", "India", "india|індія|індії|delhi|делі|mumbai|мумбаї"],
  ["TH", "🐘", "sage", "Thailand", "thailand|таїланд|таїланді|bangkok|бангкок|phuket|пхукет"],
  ["IS", "🌋", "blue", "Iceland", "iceland|ісландія|ісландії|reykjavik|рейкʼявік|рейк'явік"],
  ["FR", "🥐", "sand", "Paris · France", "paris|париж|парижі|парижа|france|франція|франції"],
  ["IT", "🍕", "clay", "Rome · Italy", "rome|roma|рим|римі|рима|italy|italia|італія|італії"],
  ["IT", "🛶", "blue", "Venice · Italy", "venice|venezia|венеція|венеції"],
  ["GB", "🫖", "sand", "London · United Kingdom", "london|лондон|лондоні|лондона|united kingdom|britain|британія|британії|англія|англії|england"],
  ["UA", "🌻", "sage", "Kyiv · Ukraine", "kyiv|kiev|київ|києві|києва|ukraine|україна|україні|україни"],
  ["UA", "☕", "sand", "Lviv · Ukraine", "lviv|львів|львові|львова"],
  ["UA", "⚓", "blue", "Odesa · Ukraine", "odesa|odessa|одеса|одесі|одеси"],
  ["JP", "🌸", "clay", "Japan", "tokyo|kyoto|japan|токіо|кіото|японія|японії"],
  ["NL", "🌷", "clay", "Netherlands", "amsterdam|netherlands|holland|амстердам|амстердамі|нідерланди|нідерландах|голландія"],
  ["ES", "☀️", "sand", "Spain", "barcelona|madrid|spain|барселона|барселоні|мадрид|мадриді|іспанія|іспанії"],
  ["GR", "🏛️", "blue", "Greece", "athens|santorini|greece|афіни|афінах|санторіні|греція|греції"],
  ["CH", "🏔️", "blue", "Switzerland", "zurich|zürich|geneva|switzerland|цюрих|цюриху|женева|женеві|швейцарія|швейцарії"],
  ["DE", "🥨", "sand", "Germany", "berlin|munich|germany|берлін|берліні|мюнхен|мюнхені|німеччина|німеччині|німеччини"],
  ["AT", "🎻", "clay", "Austria", "vienna|wien|austria|відень|відні|австрія|австрії"],
  ["CZ", "🏰", "sage", "Czechia", "prague|praha|czechia|czech republic|прага|празі|праги|чехія|чехії"],
  ["PL", "🏰", "clay", "Poland", "warsaw|krakow|kraków|poland|варшава|варшаві|краків|кракові|польща|польщі"],
  ["TR", "🧿", "blue", "Turkey", "istanbul|cappadocia|turkey|türkiye|стамбул|стамбулі|каппадокія|каппадокії|туреччина|туреччині|туреччини"],
  ["US", "🗽", "blue", "New York · United States", "new york|nyc|нью йорк|нью йорку"],
  ["US", "🌉", "clay", "San Francisco · United States", "san francisco|сан франциско"],
  ["PT", "🌊", "blue", "Portugal", "lisbon|lisboa|porto|portugal|лісабон|лісабоні|порту|португалія|португалії"],
];
const themes = [
  ["", "🏔️", "sage", "Mountains", "mountains|hiking|alps|carpathians|гори|горах|карпати|карпатах|альпи|альпах|похід|походи"],
  ["", "🏖️", "blue", "By the sea", "beach|sea|seaside|ocean|море|морі|моря|пляж|океан"],
  ["", "☕", "sand", "Coffee stops", "coffee|cafes|кава|кави|кафе|кавовий|кавові|кавова|кавʼярні|кав'ярні"],
  ["", "🌲", "sage", "Into nature", "forest|camping|nature|ліс|лісі|кемпінг|природа|природі"],
];

function normalize(value) {
  return ` ${String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

const prepare = ([country, icon, tone, label, aliases]) => ({
  country,
  icon,
  tone,
  label,
  aliases: aliases.split("|").map(normalize),
});
const destinationRules = destinations.map(prepare);
const themeRules = themes.map(prepare);

// ISO country/territory codes. Intl supplies localized names without a request.
const countryCodes = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" "));
const englishNames = new Intl.DisplayNames(["en"], { type: "region" });
const ukrainianNames = new Intl.DisplayNames(["uk"], { type: "region" });

function countryRule(code, aliases = []) {
  const country = String(code || "").toUpperCase();
  if (!countryCodes.has(country)) return null;
  const association = destinationRules.find((rule) => rule.country === country);
  return {
    country,
    icon: association?.icon || "🧭",
    tone: association?.tone || "blue",
    label: englishNames.of(country),
    aliases: aliases.filter((alias) => typeof alias === "string" && alias.trim()).map(normalize),
  };
}

const countryRules = [...countryCodes].map((code) => countryRule(code, [
  englishNames.of(code), ukrainianNames.of(code),
]));

function placeRules(places) {
  return places.map((place) => countryRule(place.country_code, [
    place.city, place.name, ...(Array.isArray(place.name_aliases) ? place.name_aliases : []),
  ])).filter(Boolean);
}

function matches(rules, name) {
  const candidates = rules.flatMap((rule) => rule.aliases.flatMap((alias) => {
    const position = name.indexOf(alias);
    return position < 0 ? [] : [{ ...rule, position, end: position + alias.length - 1 }];
  })).sort((a, b) => a.position - b.position || b.end - a.end);
  // Prefer "Papua New Guinea" over the nested country name "Guinea".
  return candidates.filter((candidate, index) => !candidates.slice(0, index).some(
    (other) => other.position <= candidate.position && other.end >= candidate.end,
  ));
}

function coverFromMatches(found) {
  if (!found.length) return null;
  if (new Set(found.map((rule) => rule.country)).size > 1) {
    return { icon: "🌍", flag: "", tone: "blue", label: "Multiple destinations" };
  }
  const match = found[0];
  return {
    icon: match.icon,
    flag: match.country
      ? String.fromCodePoint(...[...match.country].map((letter) => 127397 + letter.charCodeAt(0)))
      : "",
    tone: match.tone,
    label: match.label,
  };
}

export function tripCover(name, { countries = [], places = [] } = {}) {
  const normalized = normalize(name);
  const catalog = countries.map((country) => countryRule(country.code, [
    country.name, country.native, country.capital,
  ])).filter(Boolean);
  const found = matches([...destinationRules, ...countryRules, ...catalog, ...placeRules(places)], normalized);
  return coverFromMatches(found)
    || coverFromMatches(matches(themeRules, normalized))
    || coverFromMatches(places.map((place) => countryRule(place.country_code)).filter(Boolean));
}

// Never accept an unrelated first geocoding result as the trip's destination.
export function cityCover(name, cities) {
  const normalized = normalize(name);
  const found = placeRules(cities).flatMap((rule) => matches([rule], normalized));
  if (new Set(found.map((rule) => rule.country)).size > 1) return null;
  return coverFromMatches(found);
}
