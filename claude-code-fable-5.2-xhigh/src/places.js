// Places worth a pin: landmarks round the harbor and the wrecks with a known story.
// Positions are [latitude, longitude]. The charted wrecks without a name come from
// the NOAA chart data in public/data/chart.json instead.

// A search link lands on the article when the title matches, and on the results when it does not.
const wiki = (title) => ({ href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}`, text: 'Wikipedia' });

export const LANDMARKS = [
  {
    title: 'Fort Sumter', at: [32.7523, -79.8747], sub: 'Sea fort at the harbor mouth',
    text: ['The Civil War began here on April 12, 1861, when Confederate guns around the harbor opened fire on the Union garrison. The fort is a national monument now, and the tour boats that run to it from Liberty Square and Patriots Point show up on this map.'],
    links: [wiki('Fort Sumter')],
  },
  {
    title: 'Fort Moultrie', at: [32.7594, -79.8578], sub: "Sullivan's Island",
    text: ["On June 28, 1776, a half-built fort of palmetto logs here drove off a British fleet. The soft logs soaked up the cannon balls, which is why a palmetto tree stands on South Carolina's flag."],
    links: [wiki('Fort Moultrie')],
  },
  {
    title: 'Castle Pinckney', at: [32.7737, -79.9113], sub: "Shute's Folly island",
    text: ['A small brick fort finished in 1810 to guard the inner harbor. It held Union prisoners after the First Battle of Bull Run, and has stood empty for most of the time since.'],
    links: [wiki('Castle Pinckney')],
  },
  {
    title: 'Fort Johnson', at: [32.7517, -79.899], sub: 'James Island',
    text: ['The signal shot that began the bombardment of Fort Sumter was fired from here at 4:30 in the morning on April 12, 1861. The point is a marine science campus today.'],
    links: [wiki('Fort Johnson South Carolina')],
  },
  {
    title: 'USS Yorktown', at: [32.7906, -79.9087], sub: 'Aircraft carrier at Patriots Point',
    text: ['An Essex-class carrier, 872 ft long, commissioned in 1943. She fought across the Pacific, picked up the Apollo 8 astronauts in 1968, and has been a museum ship here since 1975.'],
    links: [wiki('USS Yorktown (CV-10)')],
  },
  {
    title: 'Arthur Ravenel Jr. Bridge', at: [32.8032, -79.9147], sub: 'Cooper River',
    text: ['Opened in 2005. The main span is 1,546 ft between two diamond towers 575 ft tall, and the deck leaves 186 ft of clearance so the largest container ships can reach the upriver terminals. The board shows the clearance measured right now.'],
    links: [wiki('Arthur Ravenel Jr. Bridge')],
  },
  {
    title: 'Charleston Light', at: [32.7579, -79.8433], sub: "Sullivan's Island lighthouse",
    text: ['First lit in 1962, one of the last lighthouses built in the United States. The triangular tower has an elevator, and its light shows two white flashes every 30 seconds. Turn on the night view to watch it.'],
    links: [wiki('Charleston Light')],
  },
  {
    title: 'The Battery', at: [32.7697, -79.9303], sub: 'White Point Garden',
    text: ['The sea wall and promenade at the tip of the peninsula, where the Ashley and Cooper rivers meet. Charlestonians watched the bombardment of Fort Sumter from here.'],
    links: [wiki('The Battery (Charleston)')],
  },
  {
    title: 'Waterfront Park', at: [32.7781, -79.9255], sub: 'Pineapple Fountain and pier',
    text: ['A park on what was once a run of burnt-out wharves, opened in 1990. The pier is one of the best free places in the city to watch ships pass.'],
    links: [wiki('Waterfront Park Charleston South Carolina')],
  },
  {
    title: 'United States Custom House', at: [32.7806, -79.9267], sub: 'East Bay Street',
    text: ['Begun in 1853 and finished in 1879 after the war stopped the work. Customs officers have cleared cargo for the port from this building ever since.'],
    links: [wiki('United States Custom House (Charleston, South Carolina)')],
  },
  {
    title: 'Shem Creek', at: [32.7916, -79.8806], sub: 'Mount Pleasant',
    text: ["Home of the harbor's shrimp boats. The trawlers tie up along the creek, and dolphins often follow them in."],
    links: [wiki('Shem Creek')],
  },
  {
    title: 'H. L. Hunley', at: [32.8523, -79.9617], sub: 'Warren Lasch Conservation Center, about here',
    text: ['The first submarine to sink a warship. The Hunley was raised from the sea floor off Sullivan\'s Island in 2000 and is kept here in a tank of fresh water while conservators work on her.'],
    links: [wiki('H. L. Hunley')],
  },
];

export const HISTORIC_WRECKS = [
  {
    title: 'USS Housatonic', at: [32.7186, -79.7756], sub: 'Sunk February 17, 1864. Position approximate',
    text: ['A Union sloop-of-war on blockade duty, and the first ship ever sunk by a submarine. The Confederate H. L. Hunley rammed a spar torpedo into her side. She went down in five minutes in about 27 ft of water.'],
    links: [wiki('USS Housatonic (1861)')],
  },
  {
    title: 'Where the Hunley sank', at: [32.717, -79.7722], sub: 'Lost February 17, 1864. Position approximate',
    text: ['After sinking the Housatonic the submarine never came home. She was found in 1995 a little seaward of her victim, buried in silt with her crew of eight still at their stations, and raised in 2000.'],
    links: [wiki('H. L. Hunley')],
  },
  {
    title: 'USS Patapsco', at: [32.754, -79.866], sub: 'Sunk January 15, 1865. Position approximate',
    text: ['A Union ironclad monitor that struck a Confederate mine while covering boats clearing the channel between Fort Sumter and Fort Moultrie. She sank in under a minute with the loss of more than 60 men.'],
    links: [wiki('USS Patapsco (1862)')],
  },
  {
    title: 'Georgiana and Mary Bowers', at: [32.7797, -79.7597], sub: 'Blockade runners, 1863 and 1864',
    text: ['The iron steamer Georgiana was run aground and scuttled here on her maiden voyage in March 1863, with a cargo for the Confederacy still aboard. A year later the blockade runner Mary Bowers hit the wreck and sank on top of it. Two wrecks are still charted on this spot.'],
    links: [wiki('SS Georgiana')],
  },
];

const WRECK_KIND = {
  h: 'Part of the hull shows above the water.',
  m: 'Only the masts show above the water.',
  d: 'Under water, and marked on the chart as a danger to boats.',
  n: 'Under water, deep enough that boats pass over it.',
};

/** The card for a wreck from the NOAA chart: [x, y, kind, depth m, year]. */
export function chartedWreck(w) {
  const depth = w[3] != null ? `The least depth over it is ${w[3].toFixed(1)} m (${Math.round(w[3] / 0.3048)} ft).` : null;
  return {
    title: 'Charted wreck',
    sub: w[4] ? `On the NOAA chart since at least ${w[4]}` : 'From the NOAA chart',
    text: [[WRECK_KIND[w[2]] || WRECK_KIND.d, depth].filter(Boolean).join(' ')],
    note: 'The chart gives no name for this wreck. Not for navigation.',
    links: [{ href: 'https://nauticalcharts.noaa.gov/data/wrecks-and-obstructions.html', text: 'NOAA wrecks and obstructions' }],
  };
}
