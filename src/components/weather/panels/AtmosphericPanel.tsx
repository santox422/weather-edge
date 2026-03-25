'use client';

import type { Atmospheric, AirQuality } from '@/types';
import MetricTile from './MetricTile';

interface AtmosphericPanelProps {
  atmospheric: Atmospheric;
  airQuality?: AirQuality;
}

function compassDir(deg: number) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export default function AtmosphericPanel({ atmospheric, airQuality }: AtmosphericPanelProps) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-[1px] bg-[#222]">
      {atmospheric.humidity != null && (
        <MetricTile label="HUMIDITY" value={`${atmospheric.humidity.toFixed(0)}%`}
          colorClass={atmospheric.humidity > 80 ? 'text-[#00bcd4]' : atmospheric.humidity < 30 ? 'text-[#ff8c00]' : 'text-[#ccc]'} />
      )}
      {atmospheric.dewPoint != null && (
        <MetricTile label="DEW POINT" value={`${atmospheric.dewPoint.toFixed(1)}°C`} />
      )}
      {atmospheric.dewPointDepression != null && (
        <MetricTile label="DEW SPREAD" value={`${atmospheric.dewPointDepression.toFixed(1)}°C`}
          colorClass={atmospheric.dewPointDepression < 3 ? 'text-[#00bcd4]' : atmospheric.dewPointDepression > 15 ? 'text-[#ff3333]' : 'text-[#ccc]'} />
      )}
      {atmospheric.pressure != null && (
        <MetricTile label="PRESSURE" value={`${atmospheric.pressure.toFixed(0)} hPa`}
          colorClass={atmospheric.pressure > 1020 ? 'text-[#00ff41]' : atmospheric.pressure < 1005 ? 'text-[#ff3333]' : 'text-[#ccc]'} />
      )}
      {atmospheric.cloudCover != null && (
        <MetricTile label="CLOUD" value={`${atmospheric.cloudCover.toFixed(0)}%`}
          colorClass={atmospheric.cloudCover > 70 ? 'text-[#555]' : atmospheric.cloudCover < 30 ? 'text-[#ff8c00]' : 'text-[#ccc]'} />
      )}
      {atmospheric.windSpeed != null && (
        <MetricTile label="WIND" value={`${atmospheric.windSpeed.toFixed(0)} mph`}
          colorClass={atmospheric.windSpeed > 20 ? 'text-[#ff3333]' : 'text-[#ccc]'} />
      )}
      {atmospheric.windDirection != null && (
        <MetricTile label="WIND DIR" value={`${compassDir(atmospheric.windDirection)} ${atmospheric.windDirection.toFixed(0)}°`} />
      )}
      {atmospheric.windGusts != null && (
        <MetricTile label="GUSTS" value={`${atmospheric.windGusts.toFixed(0)} mph`}
          colorClass={atmospheric.windGusts > 30 ? 'text-[#ff3333]' : 'text-[#ccc]'} />
      )}
      {atmospheric.precipProbability != null && (
        <MetricTile label="PRECIP" value={`${atmospheric.precipProbability}%`}
          colorClass={atmospheric.precipProbability > 50 ? 'text-[#00bcd4]' : 'text-[#ccc]'} />
      )}
      {atmospheric.visibility != null && (
        <MetricTile label="VISIBILITY" value={`${(atmospheric.visibility / 1000).toFixed(0)} km`}
          colorClass={atmospheric.visibility < 5000 ? 'text-[#ff3333]' : 'text-[#ccc]'} />
      )}
      {airQuality?.uvIndex != null && (
        <MetricTile label="UV" value={`${airQuality.uvIndex.toFixed(1)}`}
          colorClass={airQuality.uvIndex > 6 ? 'text-[#ff3333]' : airQuality.uvIndex > 3 ? 'text-[#ff8c00]' : 'text-[#ccc]'} />
      )}
    </div>
  );
}
