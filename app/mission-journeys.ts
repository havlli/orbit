export type CraftKind =
  | 'satellite'
  | 'probe'
  | 'capsule'
  | 'lander'
  | 'solar-probe';
export interface MissionJourney {
  discoveryTitle: string;
  discoveryText: string;
  eventLabel: string;
  craft: CraftKind;
  seconds: number;
  source: string;
  routeSource?: string;
}

// Discovery narratives are separate from validated trajectory coverage.
// Historical state-vector windows and quality live in scripts/ephemeris-missions.json.
export const journeys = {
  sputnik: {
    discoveryTitle: 'A signal from orbit.',
    discoveryText:
      'Sputnik becomes the first artificial satellite. Radio operators around the world can hear its transmissions: a human-made object is circling Earth.',
    eventLabel: 'FIRST SATELLITE',
    craft: 'satellite',
    seconds: 19,
    source:
      'https://www.nasa.gov/history/65-years-ago-sputnik-ushers-in-the-space-age/',
  },
  luna: {
    discoveryTitle: 'The other face of the Moon.',
    discoveryText:
      'Luna 3 photographs the lunar far side. The rough, cratered terrain has far fewer dark volcanic plains than the side visible from Earth.',
    eventLabel: 'FIRST FAR-SIDE PHOTOGRAPHS',
    craft: 'probe',
    seconds: 22,
    source:
      'https://www.nasa.gov/history/60-years-ago-luna-2-makes-impact-in-moon-race/',
  },
  mariner2: {
    discoveryTitle: 'Heat behind the clouds.',
    discoveryText:
      'Mariner 2’s measurements reveal an intensely hot world beneath Venus’s clouds. The first successful planetary science mission carries radiometers, but no camera.',
    eventLabel: 'FIRST PLANETARY SCIENCE FLYBY',
    craft: 'probe',
    seconds: 25,
    source: 'https://science.nasa.gov/mission/mariner-2/',
  },
  mariner4: {
    discoveryTitle: 'Craters replace speculation.',
    discoveryText:
      'The first close photographs of Mars reveal a heavily cratered landscape. This small sampled region overturns popular visions of a lush, inhabited planet.',
    eventLabel: 'FIRST CLOSE IMAGES OF MARS',
    craft: 'probe',
    seconds: 25,
    source: 'https://science.nasa.gov/mission/mariner-4/',
  },
  apollo: {
    discoveryTitle: 'The Eagle has landed.',
    discoveryText:
      'Armstrong and Aldrin land in the Sea of Tranquility. Their surface exploration and collected samples make the Moon a world we can study firsthand.',
    eventLabel: 'FIRST CREWED LUNAR LANDING',
    craft: 'capsule',
    seconds: 25,
    source: 'https://www.nasa.gov/mission/apollo-11/',
  },
  belt: {
    discoveryTitle: 'A passage to the giants.',
    discoveryText:
      'Pioneer 10 emerges from the asteroid belt in February 1973. The first crossing succeeds, opening the way for its encounter with Jupiter later that year.',
    eventLabel: 'FIRST ASTEROID-BELT CROSSING',
    craft: 'probe',
    seconds: 25,
    source: 'https://science.nasa.gov/mission/pioneer-10/',
  },
  pioneer10: {
    discoveryTitle: 'Jupiter, at close range.',
    discoveryText:
      'Pioneer 10 returns the first close observations of Jupiter, measuring its magnetic and radiation environment and imaging its cloud-covered disk.',
    eventLabel: 'FIRST JUPITER ENCOUNTER',
    craft: 'probe',
    seconds: 26,
    source: 'https://science.nasa.gov/mission/pioneer-10/',
  },
  mariner10: {
    discoveryTitle: 'A magnetic field at Mercury.',
    discoveryText:
      'Mariner 10 reveals Mercury’s cratered surface and detects a magnetic field.',
    eventLabel: 'FIRST MERCURY ENCOUNTER',
    craft: 'probe',
    seconds: 24,
    source: 'https://science.nasa.gov/mission/mariner-10/',
  },
  pioneer11: {
    discoveryTitle: 'Another ring comes to light.',
    discoveryText:
      'The first Saturn flyby reveals the narrow F ring beyond the A ring. Pioneer 11 also confirms Saturn’s magnetic field.',
    eventLabel: 'FIRST SATURN ENCOUNTER',
    craft: 'probe',
    seconds: 27,
    source: 'https://science.nasa.gov/mission/pioneer-11/',
  },
  uranus: {
    discoveryTitle: 'Ten new moons. Two new rings.',
    discoveryText:
      'Voyager 2’s Uranus encounter reveals ten previously unknown moons and two additional rings.',
    eventLabel: 'URANUS FLYBY',
    craft: 'probe',
    seconds: 27,
    source: 'https://science.nasa.gov/mission/voyager/voyager-2/',
  },
  neptune: {
    discoveryTitle: 'A storm in the deep blue.',
    discoveryText:
      'Voyager 2 discovers Neptune’s Great Dark Spot and new moons and rings. Its final giant-planet encounter reveals a dynamic atmosphere far from the Sun.',
    eventLabel: 'NEPTUNE FLYBY',
    craft: 'probe',
    seconds: 27,
    source: 'https://science.nasa.gov/mission/voyager/voyager-2/',
  },
  cassini: {
    discoveryTitle: 'Saturn’s first orbiter.',
    discoveryText:
      'Cassini becomes the first spacecraft to enter orbit around Saturn. Its long stay allows repeated close encounters.',
    eventLabel: 'SATURN ORBIT INSERTION',
    craft: 'probe',
    seconds: 27,
    source: 'https://science.nasa.gov/mission/cassini/quick-facts/',
  },
  huygens: {
    discoveryTitle: 'Channels beneath the haze.',
    discoveryText:
      'Huygens reveals drainage channels and rounded water-ice pebbles on Titan. Flowing liquid has shaped the landscape beneath the moon’s opaque atmosphere.',
    eventLabel: 'TITAN LANDING',
    craft: 'lander',
    seconds: 24,
    source:
      'https://www.esa.int/Science_Exploration/Space_Science/Results_from_Mars_Express_and_Huygens/Highlights_of_ESA_s_Huygens_mission',
  },
  philae: {
    discoveryTitle: 'Three touchdowns on a comet.',
    discoveryText:
      'Philae reaches the surface, rebounds twice, and comes to rest. The first comet landing returns measurements directly from an ancient remnant of planet formation.',
    eventLabel: 'FIRST COMET LANDING',
    craft: 'lander',
    seconds: 23,
    source:
      'https://www.esa.int/Science_Exploration/Space_Science/Rosetta/Three_touchdowns_for_Rosetta_s_lander',
    routeSource:
      'https://blogs.esa.int/rosetta/2014/11/12/rosetta-and-philae-separation-confirmed/',
  },
  horizons: {
    discoveryTitle: 'Mountains and plains of ice.',
    discoveryText:
      'New Horizons reveals mountains of water ice and plains of nitrogen ice. Some hills may float like icebergs in the frozen nitrogen.',
    eventLabel: 'FIRST PLUTO FLYBY',
    craft: 'probe',
    seconds: 29,
    source:
      'https://science.nasa.gov/photojournal/plutos-mysterious-floating-hills/',
    routeSource: 'https://science.nasa.gov/mission/new-horizons/',
  },
  parker: {
    discoveryTitle: 'Inside the Sun’s atmosphere.',
    discoveryText:
      'Parker crosses into a region where the Sun’s magnetic field controls the particles around it. These measurements mark the first passage through the solar corona.',
    eventLabel: 'FIRST CORONA CROSSING',
    craft: 'solar-probe',
    seconds: 27,
    source:
      'https://blogs.nasa.gov/drthomasz/2021/12/14/hot-news-from-parker-solar-probe/',
    routeSource:
      'https://science.nasa.gov/blogs/parker-solar-probe/2021/04/28/nasas-parker-solar-probe-keeps-its-cool-as-it-speeds-closer-to-the-sun/',
  },
} satisfies Record<string, MissionJourney>;

// The discovery has already received its own nine-second camera interlude.
export const DISCOVERY_DWELL_SECONDS = 2.5;
// An inter-chapter handoff only needs a dispatch beat. The final chapter keeps
// its longer closing hold, and discovery reading time lives inside each shot.
export const CHAPTER_HANDOFF_SECONDS = 0.05;
