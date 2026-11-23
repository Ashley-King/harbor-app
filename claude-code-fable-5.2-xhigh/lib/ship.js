// A ship's backstory from Wikidata, looked up by IMO number: the year it was built,
// who built and operates it, and a photo when Wikimedia Commons has one. No key.
// Cruise ships and navy ships are well covered. Most cargo ships are not, and the
// answer then says found: false.

import { getJson, validImo } from './harbor.js';
import { cleanText } from './vessels.js';

const SPARQL = 'https://query.wikidata.org/sparql';

const query = (imo) => `SELECT ?ship ?shipLabel ?built ?builderLabel ?operatorLabel ?ownerLabel ?image ?article WHERE {
  ?ship wdt:P458 "${imo}".
  OPTIONAL { ?ship wdt:P571 ?built }
  OPTIONAL { ?ship wdt:P176 ?builder }
  OPTIONAL { ?ship wdt:P137 ?operator }
  OPTIONAL { ?ship wdt:P127 ?owner }
  OPTIONAL { ?ship wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?ship; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 12`;

/** Only links to the two sites this data comes from are passed on to the page. */
function safeUrl(value, hosts) {
  try {
    const u = new URL(String(value).replace(/^http:/, 'https:'));
    return u.protocol === 'https:' && hosts.includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Look one ship up. Throws on a bad IMO number or when Wikidata does not answer. */
export async function shipStory(imoText) {
  const imo = /^\d{7}$/.test(String(imoText)) ? validImo(imoText) : null;
  if (!imo) throw new RangeError('not an IMO number');
  const d = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(query(imo))}`, { accept: 'application/sparql-results+json', timeout: 10000 });
  const rows = (d && d.results && d.results.bindings) || [];
  if (!rows.length) return { imo, found: false };
  // One row per combination of builder, operator and so on. The first of each is enough.
  const first = (key) => {
    const row = rows.find((r) => r[key] && r[key].value);
    return row ? row[key].value : null;
  };
  // A label that is only the item's id (Q12345) means Wikidata has no English name for it.
  const label = (key) => {
    const v = cleanText(first(key));
    return v && !/^Q\d+$/.test(v) ? v.slice(0, 120) : null;
  };
  const year = /^(\d{4})-/.exec(first('built') || '');
  const image = safeUrl(first('image'), ['commons.wikimedia.org']);
  const file = image ? decodeURIComponent(new URL(image).pathname.split('/').pop()) : null;
  return {
    imo,
    found: true,
    name: label('shipLabel'),
    built: year ? Number(year[1]) : null,
    builder: label('builderLabel'),
    operator: label('operatorLabel'),
    owner: label('ownerLabel'),
    image: image ? `${image}?width=640` : null,
    imagePage: file ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}` : null,
    article: safeUrl(first('article'), ['en.wikipedia.org']),
    wikidata: safeUrl(first('ship'), ['www.wikidata.org']),
  };
}
