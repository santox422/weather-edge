/**
 * City Resolver — maps market descriptions to lat/lon coordinates.
 * Pre-loaded with common US weather stations used by Polymarket/Kalshi.
 */

const CITY_DATABASE = {
  // Major US cities — coordinates match the ICAO resolution station used by Polymarket/Wunderground
  'new york': { lat: 40.7772, lon: -73.8726, station: 'LaGuardia Airport, NY', icao: 'KLGA', tz: 'America/New_York', region: 'us' },
  'nyc': { lat: 40.7772, lon: -73.8726, station: 'LaGuardia Airport, NY', icao: 'KLGA', tz: 'America/New_York', region: 'us' },
  'manhattan': { lat: 40.7772, lon: -73.8726, station: 'LaGuardia Airport, NY', icao: 'KLGA', tz: 'America/New_York', region: 'us' },
  'jfk': { lat: 40.6413, lon: -73.7781, station: 'JFK Airport, NY', icao: 'KJFK', tz: 'America/New_York', region: 'us' },
  'laguardia': { lat: 40.7772, lon: -73.8726, station: 'LaGuardia Airport, NY', icao: 'KLGA', tz: 'America/New_York', region: 'us' },

  'chicago': { lat: 41.9742, lon: -87.9073, station: "O'Hare Airport, IL", icao: 'KORD', tz: 'America/Chicago', region: 'us' },
  'chicago midway': { lat: 41.7868, lon: -87.7522, station: 'Midway Airport, IL', icao: 'KMDW', tz: 'America/Chicago', region: 'us' },

  'los angeles': { lat: 33.9382, lon: -118.3886, station: 'LAX Airport, CA', icao: 'KLAX', tz: 'America/Los_Angeles', region: 'us' },
  'la': { lat: 33.9382, lon: -118.3886, station: 'LAX Airport, CA', icao: 'KLAX', tz: 'America/Los_Angeles', region: 'us' },

  'houston': { lat: 29.9844, lon: -95.3414, station: 'IAH Airport, TX', icao: 'KIAH', tz: 'America/Chicago', region: 'us' },
  'dallas': { lat: 32.8459, lon: -96.8509, station: 'Love Field, TX', icao: 'KDAL', tz: 'America/Chicago', region: 'us' },
  'austin': { lat: 30.1945, lon: -97.6699, station: 'AUS Airport, TX', icao: 'KAUS', tz: 'America/Chicago', region: 'us' },
  'san antonio': { lat: 29.5337, lon: -98.4698, station: 'SAT Airport, TX', icao: 'KSAT', tz: 'America/Chicago', region: 'us' },

  'miami': { lat: 25.7959, lon: -80.2870, station: 'MIA Airport, FL', icao: 'KMIA', tz: 'America/New_York', region: 'us' },
  'orlando': { lat: 28.4312, lon: -81.3081, station: 'MCO Airport, FL', icao: 'KMCO', tz: 'America/New_York', region: 'us' },
  'tampa': { lat: 27.9756, lon: -82.5333, station: 'TPA Airport, FL', icao: 'KTPA', tz: 'America/New_York', region: 'us' },
  'jacksonville': { lat: 30.4941, lon: -81.6879, station: 'JAX Airport, FL', icao: 'KJAX', tz: 'America/New_York', region: 'us' },

  'phoenix': { lat: 33.4373, lon: -112.0078, station: 'PHX Airport, AZ', icao: 'KPHX', tz: 'America/Phoenix', region: 'us' },
  'las vegas': { lat: 36.0840, lon: -115.1522, station: 'LAS Airport, NV', icao: 'KLAS', tz: 'America/Los_Angeles', region: 'us' },
  'denver': { lat: 39.8561, lon: -104.6737, station: 'DEN Airport, CO', icao: 'KDEN', tz: 'America/Denver', region: 'us' },

  'seattle': { lat: 47.4502, lon: -122.3088, station: 'SEA Airport, WA', icao: 'KSEA', tz: 'America/Los_Angeles', region: 'us' },
  'portland': { lat: 45.5898, lon: -122.5951, station: 'PDX Airport, OR', icao: 'KPDX', tz: 'America/Los_Angeles', region: 'us' },
  'san francisco': { lat: 37.6213, lon: -122.3790, station: 'SFO Airport, CA', icao: 'KSFO', tz: 'America/Los_Angeles', region: 'us' },

  'atlanta': { lat: 33.6407, lon: -84.4277, station: 'Hartsfield-Jackson Airport, GA', icao: 'KATL', tz: 'America/New_York', region: 'us' },
  'boston': { lat: 42.3656, lon: -71.0096, station: 'BOS Airport, MA', icao: 'KBOS', tz: 'America/New_York', region: 'us' },
  'washington': { lat: 38.8512, lon: -77.0402, station: 'DCA Airport, DC', icao: 'KDCA', tz: 'America/New_York', region: 'us' },
  'dc': { lat: 38.8512, lon: -77.0402, station: 'DCA Airport, DC', icao: 'KDCA', tz: 'America/New_York', region: 'us' },

  'detroit': { lat: 42.2162, lon: -83.3554, station: 'DTW Airport, MI', icao: 'KDTW', tz: 'America/Detroit', region: 'us' },
  'minneapolis': { lat: 44.8848, lon: -93.2223, station: 'MSP Airport, MN', icao: 'KMSP', tz: 'America/Chicago', region: 'us' },
  'st louis': { lat: 38.7487, lon: -90.3700, station: 'STL Airport, MO', icao: 'KSTL', tz: 'America/Chicago', region: 'us' },

  'philadelphia': { lat: 39.8721, lon: -75.2411, station: 'PHL Airport, PA', icao: 'KPHL', tz: 'America/New_York', region: 'us' },
  'pittsburgh': { lat: 40.4915, lon: -80.2329, station: 'PIT Airport, PA', icao: 'KPIT', tz: 'America/New_York', region: 'us' },

  'nashville': { lat: 36.1245, lon: -86.6782, station: 'BNA Airport, TN', icao: 'KBNA', tz: 'America/Chicago', region: 'us' },
  'charlotte': { lat: 35.2140, lon: -80.9431, station: 'CLT Airport, NC', icao: 'KCLT', tz: 'America/New_York', region: 'us' },

  'new orleans': { lat: 29.9934, lon: -90.2580, station: 'MSY Airport, LA', icao: 'KMSY', tz: 'America/Chicago', region: 'us' },
  'salt lake city': { lat: 40.7884, lon: -111.9778, station: 'SLC Airport, UT', icao: 'KSLC', tz: 'America/Denver', region: 'us' },

  // International cities — coordinates match Wunderground resolution station (see strategy.md Station Links)
  'london': { lat: 51.5048, lon: 0.0553, station: 'London City Airport, UK', icao: 'EGLC', tz: 'Europe/London', region: 'uk' },
  'paris': { lat: 49.0097, lon: 2.5479, station: 'Paris CDG, France', icao: 'LFPG', tz: 'Europe/Paris', region: 'france' },
  'tokyo': { lat: 35.5533, lon: 139.7811, station: 'Haneda Airport, Japan', icao: 'RJTT', tz: 'Asia/Tokyo', region: 'east_asia' },
  'sydney': { lat: -33.9461, lon: 151.1772, station: 'Sydney Airport, Australia', icao: 'YSSY', tz: 'Australia/Sydney', region: 'southern_hemisphere' },

  // HondaCivic cities — additional (coordinates match ICAO station)
  'new york city': { lat: 40.7772, lon: -73.8726, station: 'LaGuardia Airport, NY', icao: 'KLGA', tz: 'America/New_York', region: 'us' },
  'ankara': { lat: 40.1244, lon: 32.9992, station: 'Esenboga Airport, Turkey', icao: 'LTAC', tz: 'Europe/Istanbul', region: 'europe_other' },
  'buenos aires': { lat: -34.8222, lon: -58.5358, station: 'Ezeiza Airport, Argentina', icao: 'SAEZ', tz: 'America/Argentina/Buenos_Aires', region: 'southern_hemisphere' },
  'hong kong': { lat: 22.3080, lon: 113.9185, station: 'HKG Airport, China', icao: 'VHHH', tz: 'Asia/Hong_Kong', region: 'east_asia' },
  'milan': { lat: 45.6306, lon: 8.7231, station: 'Malpensa Airport, Italy', icao: 'LIMC', tz: 'Europe/Rome', region: 'europe_other' },
  'munich': { lat: 48.3538, lon: 11.7861, station: 'MUC Airport, Germany', icao: 'EDDM', tz: 'Europe/Berlin', region: 'central_europe' },
  'sao paulo': { lat: -23.4356, lon: -46.4731, station: 'Guarulhos Airport, Brazil', icao: 'SBGR', tz: 'America/Sao_Paulo', region: 'southern_hemisphere' },
  'toronto': { lat: 43.6777, lon: -79.6248, station: 'Pearson Airport, Canada', icao: 'CYYZ', tz: 'America/Toronto', region: 'canada' },
  'seoul': { lat: 37.4691, lon: 126.4510, station: 'Incheon Intl Airport, South Korea', icao: 'RKSI', tz: 'Asia/Seoul', region: 'east_asia' },
  'wellington': { lat: -41.3272, lon: 174.8052, station: 'Wellington Airport, NZ', icao: 'NZWN', tz: 'Pacific/Auckland', region: 'southern_hemisphere' },
};

/**
 * Resolve a city name from market text to lat/lon coordinates
 */
export function resolveCity(text) {
  const lower = text.toLowerCase();

  // Sort keys by length descending so longer (more specific) keys match first
  // This prevents 'la' matching inside 'at-LA-nta' before 'atlanta' gets a chance
  const sortedKeys = Object.keys(CITY_DATABASE).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    // Short keys (< 4 chars like 'dc', 'la', 'nyc', 'jfk') use word-boundary
    // matching to prevent false positives in unrelated text
    if (key.length < 4) {
      if (new RegExp('\\b' + key + '\\b', 'i').test(lower)) {
        return { ...CITY_DATABASE[key], matchedKey: key };
      }
    } else {
      // Use word-boundary regex for long keys too, preventing false positives
      // from substring matches (e.g. 'miami' inside unrelated text).
      // Multi-word keys like "new york city" work correctly since spaces
      // are naturally handled by the regex engine as word boundaries.
      if (new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(lower)) {
        return { ...CITY_DATABASE[key], matchedKey: key };
      }
    }
  }

  // ICAO code match
  for (const [key, value] of Object.entries(CITY_DATABASE)) {
    if (lower.includes(value.icao.toLowerCase())) {
      return { ...value, matchedKey: key };
    }
  }

  return null;
}

/**
 * Get all available cities
 */
export function getAvailableCities() {
  const uniqueCities = {};
  for (const [key, value] of Object.entries(CITY_DATABASE)) {
    if (!uniqueCities[value.icao]) {
      uniqueCities[value.icao] = { name: key, ...value };
    }
  }
  return Object.values(uniqueCities);
}

export { CITY_DATABASE };
