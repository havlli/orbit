import { smallBodies, type SmallBodyId } from './small-bodies';
import { journeys, type MissionJourney } from './mission-journeys';

export type BodyId =
  | SmallBodyId
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'belt'
  | 'jupiter'
  | 'europa'
  | 'saturn'
  | 'titan'
  | 'uranus'
  | 'neptune'
  | 'pluto'
  | 'kuiper'
  | 'comet';
export type Destination = BodyId | 'overview';
export interface Body {
  id: BodyId;
  name: string;
  kind: string;
  radius: number;
  orbit: number;
  angle: number;
  color: string;
  texture?: string;
  parent?: BodyId;
  region?: BodyId;
  shape?: [number, number, number];
  mapNote?: string;
  textureWest?: boolean;
  tilt?: number;
  au: string;
  diameter: string;
  period: string;
  title: string;
  description: string;
  feature: string;
  featureText: string;
  featureView?: string;
  source: string;
}
const nasa = 'https://science.nasa.gov/';
export const bodies: Body[] = [
  {
    id: 'sun',
    name: 'The Sun',
    kind: 'OUR STAR',
    radius: 5.8,
    orbit: 0,
    angle: 0,
    color: '#ffc573',
    texture: 'sun-2k.jpg',
    au: '0',
    diameter: '1.39 million km',
    period: '~4.6 billion years old',
    title: 'The star that started everything.',
    description:
      'The Sun holds almost all the mass in our solar system and supplies its planets with sunlight.',
    feature: 'The corona',
    featureText:
      'The Sun’s outer atmosphere reaches far beyond its visible surface. In 2021, Parker Solar Probe became the first spacecraft to fly through it.',
    featureView: 'corona',
    source: nasa + 'sun/facts/',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    kind: 'TERRESTRIAL PLANET',
    radius: 0.62,
    orbit: 13,
    angle: 0.4,
    color: '#b5a99d',
    texture: 'mercury-2k.jpg',
    au: '0.39',
    diameter: '4,879 km',
    period: '88 Earth days',
    title: 'A small world. An ancient record.',
    description:
      'Craters preserve billions of years of impacts on the planet closest to the Sun. Its long days swing between extremes of heat and cold.',
    feature: 'The cratered surface',
    featureText:
      'With almost no atmosphere to soften an impact, Mercury keeps the scars. Caloris is one of the largest impact basins in the solar system.',
    featureView: 'surface',
    source: nasa + 'mercury/facts/',
  },
  {
    id: 'venus',
    name: 'Venus',
    kind: 'TERRESTRIAL PLANET',
    radius: 1.05,
    orbit: 21,
    angle: 1.8,
    color: '#dfbc80',
    texture: 'venus-atmosphere-2k.jpg',
    au: '0.72',
    diameter: '12,104 km',
    period: '225 Earth days',
    title: 'A beautiful veil. A hostile world.',
    description:
      'Bright clouds hide a rocky planet with a crushing atmosphere. Venus is hotter than Mercury, despite being farther from the Sun.',
    feature: 'Cloud tops',
    featureText:
      'Sulfuric-acid clouds race around Venus above a dense carbon-dioxide atmosphere. This portrait shows the clouds, not the hidden surface.',
    featureView: 'clouds',
    source: nasa + 'venus/facts/',
  },
  {
    id: 'earth',
    name: 'Earth',
    kind: 'TERRESTRIAL PLANET',
    radius: 1.1,
    orbit: 30,
    angle: 2.7,
    color: '#6ebad6',
    texture: 'earth-day-2k.jpg',
    tilt: 0.41,
    au: '1.00',
    diameter: '12,756 km',
    period: '365.25 days',
    title: 'Every journey begins at home.',
    description: 'Earth is an ocean world beneath a thin blue atmosphere.',
    feature: 'The night side',
    featureText:
      'Cross the line between day and night. On the dark hemisphere, the lights of our cities trace the presence of a technological civilization.',
    featureView: 'night',
    source: nasa + 'earth/facts/',
  },
  {
    id: 'moon',
    name: 'The Moon',
    kind: 'EARTH’S NATURAL SATELLITE',
    radius: 0.3,
    orbit: 3.5,
    angle: 0.9,
    parent: 'earth',
    color: '#c9c6c0',
    texture: 'moon-2k.jpg',
    au: '1.00',
    diameter: '3,475 km',
    period: '27.3 Earth days',
    title: 'Our first other world.',
    description:
      'A landscape shaped by impacts and ancient lava. The Moon preserves a chapter of solar-system history that Earth’s restless surface has erased.',
    feature: 'Earthrise',
    featureText:
      'Pull back from the lunar surface and see both worlds together. Every person who has walked on the Moon began on that blue point nearby.',
    featureView: 'earthrise',
    source: nasa + 'moon/facts/',
  },
  {
    id: 'mars',
    name: 'Mars',
    kind: 'TERRESTRIAL PLANET',
    radius: 0.83,
    orbit: 41,
    angle: 4.05,
    color: '#d18c69',
    texture: 'mars-2k.jpg',
    tilt: 0.44,
    au: '1.52',
    diameter: '6,792 km',
    period: '687 Earth days',
    title: 'The world that might have been.',
    description:
      'Rust-red deserts cover a planet that once held rivers and lakes. Its polar caps, giant volcanoes, and deep canyons preserve clues to a wetter past.',
    feature: 'A closer look',
    featureText:
      'Mars holds Olympus Mons, the largest volcano in the solar system, and Valles Marineris, a canyon system stretching thousands of kilometers.',
    featureView: 'surface',
    source: nasa + 'mars/facts/',
  },
  {
    id: 'belt',
    name: 'Asteroid belt',
    kind: 'REMNANTS OF PLANET BUILDING',
    radius: 9,
    orbit: 51,
    angle: 4.8,
    color: '#a8a396',
    au: '2.2–3.2',
    diameter: 'Millions of rocky bodies',
    period: 'Between Mars & Jupiter',
    title: 'The pieces left behind.',
    description:
      'Rocky worlds circle the Sun between Mars and Jupiter. These remnants carry evidence of the material that built the planets.',
    feature: 'Through the belt',
    featureText:
      'Spacecraft cross this region safely because its objects are far apart. The particles here are enlarged and their density exaggerated so the structure is visible.',
    featureView: 'belt',
    source: nasa + 'solar-system/asteroids/',
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    kind: 'GAS GIANT',
    radius: 3.3,
    orbit: 66,
    angle: 5.42,
    color: '#dec0a4',
    texture: 'jupiter-2k.jpg',
    au: '5.20',
    diameter: '142,984 km',
    period: '11.9 Earth years',
    title: 'A solar system in miniature.',
    description:
      'Jupiter is a gas giant with swirling clouds, persistent storms and a large system of moons.',
    feature: 'Cloud bands & storms',
    featureText:
      'Bright zones and dark belts trace opposing winds. The Great Red Spot is a vast storm that has been observed for centuries.',
    featureView: 'storm',
    source: nasa + 'jupiter/facts/',
  },
  {
    id: 'europa',
    texture: 'europa.jpg',
    name: 'Europa',
    kind: 'JUPITER’S OCEAN MOON',
    radius: 0.29,
    orbit: 7.6,
    angle: 0.3,
    parent: 'jupiter',
    color: '#c5b6a1',
    au: '5.20',
    diameter: '3,122 km',
    period: '3.55 Earth days',
    title: 'An ocean beneath the ice.',
    description:
      'Europa has a fractured shell. Evidence points to a deep, salty ocean below the surface.',
    feature: 'Jupiter on the horizon',
    featureText:
      'Europa is continually stretched by Jupiter’s gravity. Tidal heating is one reason to investigate its habitability. This grayscale mosaic has seams and a narrow unmapped south-polar strip.',
    featureView: 'parent',
    source: nasa + 'jupiter/jupiter-moons/europa/',
  },
  {
    id: 'saturn',
    name: 'Saturn',
    kind: 'GAS GIANT',
    radius: 2.8,
    orbit: 91,
    angle: 0.95,
    color: '#e0bc8a',
    texture: '../saturn.jpg',
    tilt: 0.47,
    au: '9.58',
    diameter: '120,536 km',
    period: '29.4 Earth years',
    title: 'A world wearing its history.',
    description:
      'Billions of pieces of ice and rock orbit Saturn, forming its rings.',
    feature: 'Across the rings',
    featureText:
      'Fly above the ring plane to see its structure. The Cassini Division is a broad gap between the bright A and B rings.',
    featureView: 'rings',
    source: nasa + 'saturn/facts/',
  },
  {
    id: 'titan',
    name: 'Titan',
    kind: 'SATURN’S LARGEST MOON',
    radius: 0.46,
    orbit: 10,
    angle: 2.7,
    parent: 'saturn',
    color: '#c9934f',
    au: '9.58',
    diameter: '5,150 km',
    period: '15.9 Earth days',
    title: 'Familiar weather. Alien chemistry.',
    description:
      'A golden haze wraps the only moon with a thick atmosphere. Here, methane and ethane fill lakes, fall as rain, and carve channels.',
    feature: 'Under Saturn’s influence',
    featureText:
      'Huygens descended through Titan’s atmosphere in January 2005, becoming the first probe to land on a moon in the outer solar system.',
    featureView: 'parent',
    source: nasa + 'saturn/moons/titan/',
  },
  {
    id: 'uranus',
    name: 'Uranus',
    kind: 'ICE GIANT',
    radius: 1.7,
    orbit: 119,
    angle: 3.55,
    color: '#8cd5de',
    texture: 'uranus-2k.jpg',
    tilt: 1.71,
    au: '19.2',
    diameter: '51,118 km',
    period: '84 Earth years',
    title: 'The world turned sideways.',
    description:
      'Uranus is an ice giant with a pale blue atmosphere. Its axis lies almost in its orbital plane.',
    feature: 'The tilted rings',
    featureText:
      'Its dark rings share the planet’s tilted equator. This view makes the unusual orientation visible against the rest of the solar system.',
    featureView: 'rings',
    mapNote:
      'Schematic rings: widths and brightness are exaggerated; some inner and outer rings are omitted.',
    source: nasa + 'uranus/facts/',
  },
  {
    id: 'neptune',
    name: 'Neptune',
    kind: 'ICE GIANT',
    radius: 1.66,
    orbit: 150,
    angle: 5.8,
    color: '#6494e1',
    texture: 'neptune-2k.jpg',
    au: '30.1',
    diameter: '49,528 km',
    period: '165 Earth years',
    title: 'Where sunlight grows distant.',
    description:
      'The outermost planet is a cold, windy world. Voyager 2’s 1989 flyby remains humanity’s only close encounter with Neptune.',
    feature: 'An atmospheric world',
    featureText:
      'Powerful winds move cloud systems through Neptune’s atmosphere. Its deep-blue portrait here uses an enhanced-color planetary texture.',
    featureView: 'clouds',
    source: nasa + 'neptune/facts/',
  },
  {
    id: 'pluto',
    texture: 'pluto.jpg',
    name: 'Pluto',
    kind: 'DWARF PLANET',
    radius: 0.44,
    orbit: 180,
    angle: 2.0,
    color: '#cab6a0',
    au: '39.5',
    diameter: '2,377 km',
    period: '248 Earth years',
    title: 'The edge became a place.',
    description:
      'New Horizons revealed a landscape of nitrogen ice and mountains on Pluto.',
    feature: 'A closer encounter',
    featureText:
      'Sputnik Planitia forms the western side of Pluto’s bright heart. Nitrogen ice flows across this active landscape. The black southern area in this map is missing imagery, not dark terrain.',
    featureView: 'surface',
    source: nasa + 'dwarf-planets/pluto/',
  },
  {
    id: 'kuiper',
    name: 'Kuiper belt',
    kind: 'THE OUTER RESERVOIR',
    radius: 22,
    orbit: 197,
    angle: 0.8,
    color: '#8497aa',
    au: '30–50',
    diameter: 'An extended region',
    period: 'Beyond Neptune',
    title: 'There is always more beyond.',
    description:
      'Past the planets lies a broad population of icy remnants, including Pluto and many smaller bodies.',
    feature: 'The wider system',
    featureText:
      'This belt is a surviving record of solar-system formation. Its icy objects are shown enlarged; real separations are enormous.',
    featureView: 'belt',
    source: nasa + 'solar-system/kuiper-belt/',
  },
  {
    id: 'comet',
    name: 'A comet',
    kind: 'AN ICY VISITOR',
    radius: 0.3,
    orbit: 48,
    angle: 2.4,
    color: '#a6ced7',
    au: 'Variable',
    diameter: 'A small icy nucleus',
    period: 'An elongated orbit',
    title: 'A messenger from the cold.',
    description:
      'As an icy body approaches the Sun, warming material escapes to form a coma and tails.',
    feature: 'Follow the tail',
    featureText:
      'A comet’s ion tail points away from the Sun, shaped by the solar wind. This is a schematic comet, not a reconstruction of a specific object.',
    featureView: 'tail',
    source: nasa + 'solar-system/comets/',
  },
  ...smallBodies,
];
export const bodyById = Object.fromEntries(
  bodies.map((body) => [body.id, body]),
) as Record<BodyId, Body>;
export interface Milestone {
  journey: MissionJourney;
  year: string;
  date: string;
  body: BodyId;
  mission: string;
  title: string;
  text: string;
  view?: string;
  source: string;
}
const firsts = nasa + 'deep-space-exploration/';
export const milestones: Milestone[] = [
  {
    year: '1957',
    date: '04 OCTOBER 1957',
    body: 'earth',
    mission: 'SPUTNIK 1',
    journey: journeys.sputnik,
    title: 'We begin to leave home.',
    text: 'Sputnik 1 enters Earth orbit, becoming the first artificial satellite.',
    source: 'https://www.nasa.gov/history/sputnik/',
  },
  {
    year: '1959',
    date: 'OCTOBER 1959',
    body: 'moon',
    mission: 'LUNA 3',
    journey: journeys.luna,
    title: 'The hidden side revealed.',
    text: 'Luna 3 returns the first photographs of the far side of the Moon.',
    source: firsts,
  },
  {
    year: '1962',
    date: '14 DECEMBER 1962',
    body: 'venus',
    mission: 'MARINER 2',
    journey: journeys.mariner2,
    title: 'The first planetary encounter.',
    text: 'Mariner 2 passes Venus, becoming the first successful mission to another planet.',
    source: firsts,
  },
  {
    year: '1965',
    date: 'JULY 1965',
    body: 'mars',
    mission: 'MARINER 4',
    journey: journeys.mariner4,
    title: 'Mars comes into focus.',
    text: 'Mariner 4 returns the first close images of Mars, revealing a cratered landscape.',
    source: nasa + 'mission/mariner-4/',
  },
  {
    year: '1969',
    date: '20 JULY 1969',
    body: 'moon',
    mission: 'APOLLO 11',
    journey: journeys.apollo,
    title: 'Footsteps on another world.',
    text: 'Two people walk on the Moon for the first time.',
    view: 'earthrise',
    source: 'https://www.nasa.gov/mission/apollo-11/',
  },
  {
    year: '1973',
    date: 'FEBRUARY 1973',
    body: 'belt',
    mission: 'PIONEER 10',
    journey: journeys.belt,
    title: 'Through the uncharted.',
    text: 'Pioneer 10 completes the first crossing of the asteroid belt.',
    source: firsts,
  },
  {
    year: '1973',
    date: 'DECEMBER 1973',
    body: 'jupiter',
    mission: 'PIONEER 10',
    journey: journeys.pioneer10,
    title: 'The first giant.',
    text: 'Pioneer 10 makes the first close encounter with Jupiter.',
    source: firsts,
  },
  {
    year: '1974',
    date: '29 MARCH 1974',
    body: 'mercury',
    mission: 'MARINER 10',
    journey: journeys.mariner10,
    title: 'Reaching the innermost world.',
    text: 'Mariner 10 flies past Mercury after using Venus for a gravity assist.',
    source: firsts,
  },
  {
    year: '1979',
    date: '01 SEPTEMBER 1979',
    body: 'saturn',
    mission: 'PIONEER 11',
    journey: journeys.pioneer11,
    title: 'An encounter with the rings.',
    text: 'Pioneer 11 becomes the first spacecraft to visit Saturn, testing a path that the Voyager missions will follow.',
    source: firsts,
  },
  {
    year: '1986',
    date: '24 JANUARY 1986',
    body: 'uranus',
    mission: 'VOYAGER 2',
    journey: journeys.uranus,
    title: 'A world on its side.',
    text: 'Voyager 2 makes the first and still only close flyby of Uranus, revealing its unusual magnetic environment and family of moons.',
    view: 'rings',
    source: firsts,
  },
  {
    year: '1989',
    date: '25 AUGUST 1989',
    body: 'neptune',
    mission: 'VOYAGER 2',
    journey: journeys.neptune,
    title: 'Beyond the last giant.',
    text: 'Twelve years after launch, Voyager 2 reaches Neptune. Its planetary grand tour ends at a blue world thirty times farther from the Sun than Earth.',
    source: firsts,
  },
  {
    year: '2004',
    date: '01 JULY 2004',
    body: 'saturn',
    mission: 'CASSINI',
    journey: journeys.cassini,
    title: 'We stay a while.',
    text: 'Cassini enters Saturn orbit, beginning years of investigation across the rings, atmosphere and moons.',
    view: 'rings',
    source: firsts,
  },
  {
    year: '2005',
    date: '14 JANUARY 2005',
    body: 'titan',
    mission: 'HUYGENS',
    journey: journeys.huygens,
    title: 'Beneath the golden haze.',
    text: 'Huygens lands on Titan, revealing a landscape shaped by flowing liquid. It is the most distant landing yet.',
    source: firsts,
  },
  {
    year: '2014',
    date: '12 NOVEMBER 2014',
    body: 'comet',
    mission: 'ROSETTA / PHILAE',
    journey: journeys.philae,
    title: 'Touching an ancient remnant.',
    text: 'Philae lands on comet 67P, a remnant from the formation of the solar system. The comet shown is schematic.',
    source: firsts,
  },
  {
    year: '2015',
    date: '14 JULY 2015',
    body: 'pluto',
    mission: 'NEW HORIZONS',
    journey: journeys.horizons,
    title: 'A new horizon.',
    text: 'After nine years in flight, New Horizons passes Pluto, revealing mountains and flowing ice.',
    source: nasa + 'mission/new-horizons/',
  },
  {
    year: '2021',
    date: '28 APRIL 2021',
    body: 'sun',
    mission: 'PARKER SOLAR PROBE',
    journey: journeys.parker,
    title: 'Into the atmosphere of a star.',
    text: 'Parker Solar Probe crosses into the Sun’s corona.',
    view: 'corona',
    source: 'https://svs.gsfc.nasa.gov/14036/',
  },
];
