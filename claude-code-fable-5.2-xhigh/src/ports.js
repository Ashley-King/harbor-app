// Seaports by UN/LOCODE, for turning an AIS destination such as "BEANR" into
// "Antwerp, Belgium". The first two letters of a code are the country. This is the
// subset of the UN list that ships calling at Charleston actually sail to and from.
// Positions are to about a tenth of a degree, enough for a distance estimate.
// Each entry: code: [name, latitude, longitude].

export const PORTS = {
  // United States, Atlantic and Gulf
  USCHS: ['Charleston, South Carolina', 32.78, -79.93], USSAV: ['Savannah, Georgia', 32.08, -81.09], USBQK: ['Brunswick, Georgia', 31.13, -81.5],
  USJAX: ['Jacksonville, Florida', 30.33, -81.66], USFEB: ['Fernandina Beach, Florida', 30.67, -81.46], USPCV: ['Port Canaveral, Florida', 28.41, -80.6],
  USPBI: ['Palm Beach, Florida', 26.77, -80.05], USPEF: ['Port Everglades, Florida', 26.09, -80.12], USMIA: ['Miami, Florida', 25.77, -80.17],
  USKEY: ['Key West, Florida', 24.56, -81.8], USTPA: ['Tampa, Florida', 27.95, -82.45], USPFN: ['Panama City, Florida', 30.15, -85.66],
  USMOB: ['Mobile, Alabama', 30.69, -88.04], USPGL: ['Pascagoula, Mississippi', 30.35, -88.56], USGPT: ['Gulfport, Mississippi', 30.36, -89.09],
  USMSY: ['New Orleans, Louisiana', 29.95, -90.06], USLCH: ['Lake Charles, Louisiana', 30.22, -93.22], USBPT: ['Beaumont, Texas', 30.08, -94.09],
  USPOA: ['Port Arthur, Texas', 29.87, -93.93], USHOU: ['Houston, Texas', 29.73, -95.27], USGLS: ['Galveston, Texas', 29.31, -94.79],
  USFPO: ['Freeport, Texas', 28.94, -95.3], USCRP: ['Corpus Christi, Texas', 27.81, -97.4], USILM: ['Wilmington, North Carolina', 34.24, -77.95],
  USMRH: ['Morehead City, North Carolina', 34.72, -76.71], USORF: ['Norfolk, Virginia', 36.85, -76.3], USNNS: ['Newport News, Virginia', 36.98, -76.43],
  USBAL: ['Baltimore, Maryland', 39.27, -76.58], USILG: ['Wilmington, Delaware', 39.72, -75.52], USPHL: ['Philadelphia, Pennsylvania', 39.95, -75.14],
  USNYC: ['New York', 40.67, -74.04], USEWR: ['Newark, New Jersey', 40.69, -74.15], USBOS: ['Boston, Massachusetts', 42.36, -71.05],
  USPWM: ['Portland, Maine', 43.66, -70.25],
  // United States, Pacific
  USLAX: ['Los Angeles, California', 33.73, -118.26], USLGB: ['Long Beach, California', 33.75, -118.2], USOAK: ['Oakland, California', 37.8, -122.3],
  USSEA: ['Seattle, Washington', 47.6, -122.34], USTIW: ['Tacoma, Washington', 47.27, -122.42],
  // Canada
  CAHAL: ['Halifax', 44.64, -63.57], CASJB: ['Saint John', 45.27, -66.06], CAMTR: ['Montreal', 45.5, -73.55], CAVAN: ['Vancouver', 49.29, -123.11],
  // Caribbean, Mexico and Central America
  PRSJU: ['San Juan', 18.46, -66.1], BSFPO: ['Freeport', 26.52, -78.77], BSNAS: ['Nassau', 25.08, -77.35], JMKIN: ['Kingston', 17.97, -76.8],
  DOCAU: ['Caucedo', 18.42, -69.63], DOHAI: ['Rio Haina', 18.42, -70.02], CUHAV: ['Havana', 23.13, -82.35], KYGEC: ['George Town', 19.29, -81.38],
  TTPOS: ['Port of Spain', 10.65, -61.52], MXVER: ['Veracruz', 19.2, -96.13], MXATM: ['Altamira', 22.48, -97.86], MXZLO: ['Manzanillo', 19.05, -104.3],
  MXLZC: ['Lazaro Cardenas', 17.94, -102.18], GTSTC: ['Santo Tomas de Castilla', 15.7, -88.62], HNPCR: ['Puerto Cortes', 15.84, -87.95],
  CRLIO: ['Puerto Limon', 10.0, -83.03], CRMOB: ['Moin', 10.0, -83.08], PAMIT: ['Manzanillo', 9.36, -79.88], PACTB: ['Cristobal', 9.35, -79.9],
  PAONX: ['Colon', 9.36, -79.9], PABLB: ['Balboa', 8.95, -79.57], PAROD: ['Rodman', 8.95, -79.58], PAPCN: ['the Panama Canal', 9.1, -79.7],
  // South America
  COCTG: ['Cartagena', 10.4, -75.53], COBAQ: ['Barranquilla', 10.97, -74.78], VEPBL: ['Puerto Cabello', 10.48, -68.0], ECGYE: ['Guayaquil', -2.28, -79.9],
  PECLL: ['Callao', -12.05, -77.15], CLSAI: ['San Antonio', -33.6, -71.62], CLVAP: ['Valparaiso', -33.03, -71.63], BRPEC: ['Pecem', -3.55, -38.8],
  BRSUA: ['Suape', -8.39, -34.96], BRSSA: ['Salvador', -12.97, -38.5], BRRIO: ['Rio de Janeiro', -22.9, -43.17], BRSSZ: ['Santos', -23.95, -46.3],
  BRPNG: ['Paranagua', -25.5, -48.5], BRIOA: ['Itapoa', -26.18, -48.6], BRITJ: ['Itajai', -26.9, -48.65], BRNVT: ['Navegantes', -26.9, -48.65],
  BRRIG: ['Rio Grande', -32.05, -52.08], UYMVD: ['Montevideo', -34.9, -56.2], ARBUE: ['Buenos Aires', -34.6, -58.37],
  // Northern Europe
  BEANR: ['Antwerp', 51.27, 4.35], BEZEE: ['Zeebrugge', 51.33, 3.2], NLRTM: ['Rotterdam', 51.95, 4.14], NLAMS: ['Amsterdam', 52.4, 4.8],
  DEBRV: ['Bremerhaven', 53.55, 8.57], DEHAM: ['Hamburg', 53.53, 9.95], DEWVN: ['Wilhelmshaven', 53.6, 8.15], DEEME: ['Emden', 53.34, 7.19],
  FRLEH: ['Le Havre', 49.48, 0.12], FRDKK: ['Dunkirk', 51.05, 2.37], GBSOU: ['Southampton', 50.9, -1.42], GBFXT: ['Felixstowe', 51.95, 1.32],
  GBLGP: ['London Gateway', 51.5, 0.47], GBLIV: ['Liverpool', 53.45, -3.02], GBBRS: ['Bristol', 51.5, -2.72], IEDUB: ['Dublin', 53.35, -6.2],
  IEORK: ['Cork', 51.85, -8.3], SEGOT: ['Gothenburg', 57.7, 11.9], DKAAR: ['Aarhus', 56.15, 10.23], NOOSL: ['Oslo', 59.9, 10.73],
  PLGDN: ['Gdansk', 54.4, 18.67], PLGDY: ['Gdynia', 54.53, 18.55],
  // Iberia, the Mediterranean and North Africa
  ESBIO: ['Bilbao', 43.35, -3.05], ESSDR: ['Santander', 43.45, -3.8], ESVGO: ['Vigo', 42.24, -8.73], PTLEI: ['Leixoes', 41.18, -8.7],
  PTLIS: ['Lisbon', 38.7, -9.15], PTSIE: ['Sines', 37.95, -8.87], ESALG: ['Algeciras', 36.13, -5.43], ESVLC: ['Valencia', 39.44, -0.32],
  ESBCN: ['Barcelona', 41.35, 2.16], FRFOS: ['Fos-sur-Mer', 43.4, 4.9], FRMRS: ['Marseille', 43.33, 5.35], ITGOA: ['Genoa', 44.4, 8.9],
  ITSPE: ['La Spezia', 44.1, 9.83], ITLIV: ['Livorno', 43.55, 10.3], ITCVV: ['Civitavecchia', 42.1, 11.78], ITNAP: ['Naples', 40.84, 14.27],
  ITSAL: ['Salerno', 40.67, 14.74], ITGIT: ['Gioia Tauro', 38.45, 15.9], MTMAR: ['Marsaxlokk', 35.82, 14.54], GRPIR: ['Piraeus', 37.94, 23.63],
  TRIST: ['Istanbul', 41.0, 28.97], TRALI: ['Aliaga', 38.83, 26.95], TRIZM: ['Izmir', 38.44, 27.14], TRMER: ['Mersin', 36.8, 34.65],
  ILHFA: ['Haifa', 32.82, 35.0], ILASH: ['Ashdod', 31.82, 34.65], EGPSD: ['Port Said', 31.26, 32.3], EGALY: ['Alexandria', 31.18, 29.87],
  EGSUZ: ['Suez', 29.95, 32.55], MAPTM: ['Tanger Med', 35.88, -5.5], MACAS: ['Casablanca', 33.6, -7.6],
  // Africa south of the Sahara
  SNDKR: ['Dakar', 14.68, -17.43], CIABJ: ['Abidjan', 5.28, -4.0], GHTEM: ['Tema', 5.63, 0.0], NGLOS: ['Lagos', 6.43, 3.4],
  ZACPT: ['Cape Town', -33.9, 18.43], ZADUR: ['Durban', -29.87, 31.03],
  // The Middle East and South Asia
  SAJED: ['Jeddah', 21.47, 39.17], OMSLL: ['Salalah', 16.95, 54.0], AEJEA: ['Jebel Ali', 25.0, 55.06], INMUN: ['Mundra', 22.74, 69.7],
  INNSA: ['Nhava Sheva', 18.95, 72.95], LKCMB: ['Colombo', 6.95, 79.85],
  // East and Southeast Asia, Oceania
  SGSIN: ['Singapore', 1.26, 103.82], MYPKG: ['Port Klang', 3.0, 101.37], MYTPP: ['Tanjung Pelepas', 1.36, 103.55], THLCH: ['Laem Chabang', 13.08, 100.9],
  VNSGN: ['Ho Chi Minh City', 10.77, 106.72], VNVUT: ['Vung Tau', 10.5, 107.02], VNHPH: ['Haiphong', 20.85, 106.75], HKHKG: ['Hong Kong', 22.3, 114.15],
  CNYTN: ['Yantian', 22.58, 114.27], CNSZX: ['Shenzhen', 22.5, 113.9], CNNSA: ['Nansha', 22.75, 113.6], CNXMN: ['Xiamen', 24.45, 118.07],
  CNNGB: ['Ningbo', 29.93, 121.85], CNSHA: ['Shanghai', 31.23, 121.5], CNTAO: ['Qingdao', 36.07, 120.32], CNTXG: ['Tianjin', 39.0, 117.72],
  CNDLC: ['Dalian', 38.93, 121.65], TWKHH: ['Kaohsiung', 22.6, 120.28], KRPUS: ['Busan', 35.1, 129.07], KRKAN: ['Gwangyang', 34.9, 127.7],
  KRUSN: ['Ulsan', 35.5, 129.38], KRPTK: ['Pyeongtaek', 36.97, 126.83], KRINC: ['Incheon', 37.45, 126.6], JPTYO: ['Tokyo', 35.62, 139.78],
  JPYOK: ['Yokohama', 35.45, 139.65], JPNGO: ['Nagoya', 35.05, 136.85], JPUKB: ['Kobe', 34.68, 135.2], JPOSA: ['Osaka', 34.65, 135.43],
  JPHIJ: ['Hiroshima', 34.35, 132.45], AUSYD: ['Sydney', -33.86, 151.2], AUMEL: ['Melbourne', -37.83, 144.92], NZAKL: ['Auckland', -36.84, 174.77],
};

// Names crews type instead of a code, where they differ from the names above.
const ALIASES = {
  'PT EVERGLADES': 'USPEF', 'PORT EVERGLADES': 'USPEF', 'NEW YORK': 'USNYC', 'NYC': 'USNYC', NORFOLK: 'USORF', JACKSONVILLE: 'USJAX', SAVANNAH: 'USSAV',
  CHARLESTON: 'USCHS', BALTIMORE: 'USBAL', HOUSTON: 'USHOU', MIAMI: 'USMIA', WILMINGTON: 'USILM', 'NEW ORLEANS': 'USMSY', PHILADELPHIA: 'USPHL',
  BRUNSWICK: 'USBQK', FREEPORT: 'BSFPO', 'PANAMA CANAL': 'PAPCN', CRISTOBAL: 'PACTB', ANTWERPEN: 'BEANR',
};

const NAME_INDEX = (() => {
  const idx = { ...ALIASES };
  for (const [code, [name]] of Object.entries(PORTS)) {
    const key = name.split(',')[0].replace(/^the /, '').toUpperCase();
    if (key.length >= 5 && !(key in idx)) idx[key] = code;
  }
  return Object.entries(idx).sort((a, b) => b[0].length - a[0].length);
})();

/**
 * The port an AIS destination names, as { code, name, country code, lat, lon }, or
 * null when it cannot be read. Crews type this field by hand: "USCHS", "US CHS",
 * "BEANR>USCHS" (from > to) and plain names are all common.
 */
export function findPort(destination) {
  if (!destination) return null;
  // "FROM > TO": the destination is the last part.
  const text = String(destination).toUpperCase().split(/>+|=>|->/).pop().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const hit = (code) => ({ code, name: PORTS[code][0], country: code.slice(0, 2), lat: PORTS[code][1], lon: PORTS[code][2] });
  for (const m of text.matchAll(/\b([A-Z]{2}) ?([A-Z]{3})\b/g)) {
    if (PORTS[m[1] + m[2]]) return hit(m[1] + m[2]);
  }
  for (const [name, code] of NAME_INDEX) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return hit(code);
  }
  return null;
}
