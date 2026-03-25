// @ts-nocheck
/**
 * API: GET /api/paper/actuals/[date]
 * Returns actual measured temperatures (from Open-Meteo archive / METAR) for all tracked cities.
 */
import { NextResponse } from 'next/server';
import { getHistorical, getStationMETAR } from '@/lib/services/weather-service.js';
import { CITY_DATABASE } from '@/lib/analysis/city-resolver.js';

// Static map: city slug → { lat, lon, icao, name }
const CITY_COORDS = {
  ankara:        { lat: 40.1244, lon: 32.9992, icao: 'LTAC', name: 'Ankara' },
  atlanta:       { lat: 33.6407, lon: -84.4277, icao: 'KATL', name: 'Atlanta' },
  'buenos-aires':{ lat: -34.8222, lon: -58.5358, icao: 'SAEZ', name: 'Buenos Aires' },
  chicago:       { lat: 41.9742, lon: -87.9073, icao: 'KORD', name: 'Chicago' },
  dallas:        { lat: 32.8459, lon: -96.8509, icao: 'KDAL', name: 'Dallas' },
  london:        { lat: 51.5048, lon: 0.0553, icao: 'EGLC', name: 'London' },
  miami:         { lat: 25.7959, lon: -80.2870, icao: 'KMIA', name: 'Miami' },
  milan:         { lat: 45.6306, lon: 8.7231, icao: 'LIMC', name: 'Milan' },
  munich:        { lat: 48.3538, lon: 11.7861, icao: 'EDDM', name: 'Munich' },
  nyc:           { lat: 40.7772, lon: -73.8726, icao: 'KLGA', name: 'New York City' },
  paris:         { lat: 49.0097, lon: 2.5479, icao: 'LFPG', name: 'Paris' },
  'sao-paulo':   { lat: -23.4356, lon: -46.4731, icao: 'SBGR', name: 'Sao Paulo' },
  seattle:       { lat: 47.4502, lon: -122.3088, icao: 'KSEA', name: 'Seattle' },
  seoul:         { lat: 37.4691, lon: 126.4510, icao: 'RKSI', name: 'Seoul' },
  toronto:       { lat: 43.6777, lon: -79.6248, icao: 'CYYZ', name: 'Toronto' },
  wellington:    { lat: -41.3272, lon: 174.8052, icao: 'NZWN', name: 'Wellington' },
};

export async function GET(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const today = new Date().toISOString().split('T')[0];
  const isToday = date === today;
  const isPast = date < today;

  try {
    const actuals: Record<string, { temp: number | null; source: string }> = {};

    if (isPast) {
      // Use Open-Meteo archive API for past dates
      const results = await Promise.allSettled(
        Object.entries(CITY_COORDS).map(async ([slug, city]) => {
          try {
            const data = await getHistorical(city.lat, city.lon, date, date);
            const maxTemps = data?.daily?.temperature_2m_max || [];
            const temp = maxTemps[0] ?? null;
            return { slug, temp, source: 'archive' };
          } catch {
            return { slug, temp: null, source: 'error' };
          }
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          actuals[r.value.slug] = { temp: r.value.temp, source: r.value.source };
        }
      }
    } else if (isToday) {
      // Use METAR for today's live data
      const results = await Promise.allSettled(
        Object.entries(CITY_COORDS).map(async ([slug, city]) => {
          try {
            const metar = await getStationMETAR(city.icao);
            return { slug, temp: metar?.maxToday ?? null, source: 'metar' };
          } catch {
            return { slug, temp: null, source: 'error' };
          }
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          actuals[r.value.slug] = { temp: r.value.temp, source: r.value.source };
        }
      }
    }
    // Future dates: all null (no actual data yet)
    if (!isPast && !isToday) {
      for (const slug of Object.keys(CITY_COORDS)) {
        actuals[slug] = { temp: null, source: 'future' };
      }
    }

    return NextResponse.json({ date, isToday, isPast, actuals });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
