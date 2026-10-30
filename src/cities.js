// Cities available in the app.
// `half` is half the width (in metres) of the square area that gets loaded.
// `defaultHeight` is used when OpenStreetMap has no height / level data for a building.

export const CITIES = [
  {
    id: 'london',
    name: 'London',
    subtitle: 'City of London & Southwark',
    lat: 51.5100,
    lon: -0.0850,
    half: 1000,
    defaultHeight: 14,
  },
  {
    id: 'chicago',
    name: 'Chicago',
    subtitle: 'The Loop',
    lat: 41.8800,
    lon: -87.6310,
    half: 1000,
    defaultHeight: 18,
  },
  {
    id: 'thane',
    name: 'Thane',
    subtitle: 'Thane West, Mumbai',
    lat: 19.1960,
    lon: 72.9720,
    half: 1000,
    defaultHeight: 12,
  },
];

export function getCity(id) {
  return CITIES.find((c) => c.id === id) || CITIES[0];
}
