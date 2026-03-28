'use client';

import dynamic from 'next/dynamic';
import type { AnalysisData } from '@/types';

// Dynamic import with SSR disabled — Leaflet requires browser DOM
const WeatherMap = dynamic(() => import('./WeatherMap'), {
  ssr: false,
  loading: () => (
    <div className="weather-map-container">
      <div className="weather-map-loading">
        <div className="weather-map-loading-spinner" />
        <span>LOADING MAP...</span>
      </div>
    </div>
  ),
});

export default function WeatherMapWrapper({ data }: { data: AnalysisData }) {
  return <WeatherMap data={data} />;
}
