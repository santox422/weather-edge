import { NextResponse } from 'next/server';
import { getAvailableCities } from '@/lib/analysis/city-resolver';
import { getStationMETAR } from '@/lib/services/weather-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stations — returns all weather stations with optional live METAR data.
 * Used by the weather map "All Stations" overview mode.
 */
export async function GET() {
  try {
    const cities = getAvailableCities();

    // Fetch METAR data for all stations in parallel (with graceful fallback)
    const results = await Promise.allSettled(
      cities.map(async (city: any) => {
        let metar = null;
        try {
          metar = await getStationMETAR(city.icao);
        } catch {
          // silent — METAR is optional
        }
        return {
          name: city.name,
          icao: city.icao,
          lat: city.lat,
          lon: city.lon,
          station: city.station,
          currentTemp: metar?.currentTemp ?? null,
          maxToday: metar?.maxToday ?? null,
        };
      })
    );

    const stations = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);

    return NextResponse.json(stations);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
