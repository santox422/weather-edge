'use client';

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polyline, LayerGroup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { AnalysisData, CityInfo, LiveWeather, Atmospheric, AirQuality, BracketProbability } from '@/types';

// Fix default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Temperature → color gradient ──────────────────────────────
function tempToColor(tempC: number | null | undefined): string {
  if (tempC == null) return '#555';
  if (tempC <= -10) return '#4488ff';
  if (tempC <= 0) return '#00bcd4';
  if (tempC <= 10) return '#00e5ff';
  if (tempC <= 20) return '#00ff41';
  if (tempC <= 30) return '#ff8c00';
  if (tempC <= 40) return '#ff3333';
  return '#ff0066';
}

function tempToLabel(tempC: number | null | undefined): string {
  if (tempC == null) return '--';
  return `${tempC.toFixed(1)}°C`;
}

// ── Edge → color ──────────────────────────────────────────────
function edgeToColor(edge: number): string {
  if (edge > 10) return '#00ff41';
  if (edge > 5) return '#00e5ff';
  if (edge > 0) return '#00bcd4';
  if (edge > -5) return '#ff8c00';
  return '#ff3333';
}

// ── Create custom animated DivIcon ────────────────────────────
function createStationIcon(opts: {
  temp: number | null | undefined;
  icao: string;
  isSelected: boolean;
  hasLiveData: boolean;
  edge?: number | null;
  showEdge?: boolean;
}) {
  const color = tempToColor(opts.temp);
  const glowColor = opts.isSelected ? '#ff8c00' : color;
  const pulseClass = opts.hasLiveData ? 'station-marker-pulse' : '';
  const selectedClass = opts.isSelected ? 'station-marker-selected' : '';
  const tempLabel = opts.temp != null ? `${opts.temp.toFixed(0)}°` : '--';

  // Edge badge
  let edgeBadge = '';
  if (opts.showEdge && opts.edge != null) {
    const eColor = edgeToColor(opts.edge);
    edgeBadge = `<div class="station-marker-edge" style="color:${eColor}">${opts.edge > 0 ? '+' : ''}${opts.edge.toFixed(0)}%</div>`;
  }

  return L.divIcon({
    className: 'weather-station-marker',
    html: `
      <div class="station-marker-container ${selectedClass} ${pulseClass}" style="--marker-color: ${color}; --glow-color: ${glowColor};">
        <div class="station-marker-dot"></div>
        <div class="station-marker-ring"></div>
        <div class="station-marker-label">${tempLabel}</div>
        <div class="station-marker-icao">${opts.icao}</div>
        ${edgeBadge}
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
    popupAnchor: [0, -20],
  });
}

// ── Fly-to animation controller ───────────────────────────────
function FlyToStation({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], zoom, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [lat, lon, zoom, map]);
  return null;
}

// ── RainViewer precipitation radar layer ──────────────────────
function RainViewerLayer({ opacity }: { opacity: number }) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadRadar() {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) return;
        const data = await res.json();
        const latest = data.radar?.past?.[data.radar.past.length - 1];
        if (!latest || !mounted) return;

        const url = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        if (layerRef.current) {
          map.removeLayer(layerRef.current);
        }
        layerRef.current = L.tileLayer(url, {
          opacity,
          zIndex: 10,
          attribution: '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
        });
        layerRef.current.addTo(map);
      } catch {
        // silent — precipitation layer is optional
      }
    }
    loadRadar();
    return () => {
      mounted = false;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, opacity]);

  return null;
}

// ── Wind direction arrow overlay ──────────────────────────────
function WindArrow({ lat, lon, direction, speed }: {
  lat: number; lon: number; direction: number; speed: number;
}) {
  // Create an arrow showing wind direction
  const arrowLength = Math.min(speed * 0.003, 0.15); // Scale by speed
  const rad = (direction * Math.PI) / 180;
  const endLat = lat + arrowLength * Math.cos(rad);
  const endLon = lon + arrowLength * Math.sin(rad);

  const arrowColor = speed > 30 ? '#ff3333' : speed > 15 ? '#ff8c00' : '#00bcd4';

  return (
    <Polyline
      positions={[[lat, lon], [endLat, endLon]]}
      pathOptions={{
        color: arrowColor,
        weight: 2,
        opacity: 0.7,
        dashArray: undefined,
      }}
    />
  );
}

// ── Ensemble spread visualization ring ────────────────────────
function EnsembleSpreadRing({ lat, lon, spread, memberCount }: {
  lat: number; lon: number; spread: number; memberCount?: number;
}) {
  // Spread ring — larger spread = larger ring = more uncertainty
  const radiusMeters = Math.max(5000, spread * 15000); // Scale spread to meters
  const color = spread > 4 ? '#ff3333' : spread > 2 ? '#ff8c00' : '#00ff41';

  return (
    <>
      <Circle
        center={[lat, lon]}
        radius={radiusMeters}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.06,
          weight: 1,
          opacity: 0.4,
          dashArray: '4 4',
        }}
      />
      <Circle
        center={[lat, lon]}
        radius={radiusMeters * 0.5}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.08,
          weight: 1,
          opacity: 0.3,
        }}
      />
    </>
  );
}

// ── Station data type ─────────────────────────────────────────
interface StationData {
  name: string;
  icao: string;
  lat: number;
  lon: number;
  station: string;
  currentTemp?: number | null;
  maxToday?: number | null;
}

// ── Layer toggle type ─────────────────────────────────────────
interface LayerState {
  precipitation: boolean;
  ensembleSpread: boolean;
  wind: boolean;
  analysisPanel: boolean;
  allStations: boolean;
  edgeBadges: boolean;
}

// ════════════════════════════════════════════════════════════════
//  WeatherMap — full analysis map component
// ════════════════════════════════════════════════════════════════
export default function WeatherMap({ data }: { data: AnalysisData }) {
  const [layers, setLayers] = useState<LayerState>({
    precipitation: false,
    ensembleSpread: true,
    wind: true,
    analysisPanel: true,
    allStations: false,
    edgeBadges: false,
  });

  const [allStations, setAllStations] = useState<StationData[]>([]);
  const [allStationsLoading, setAllStationsLoading] = useState(false);

  const cityInfo = data.city;
  const liveWeather = data.liveWeather;
  const atmospheric = data.atmospheric;
  const airQuality = data.airQuality;
  const ensemble = data.ensemble;
  const edge = data.edge;
  const strategy = data.strategy;
  const multiModel = data.multiModel;
  const factorAdj = data.factorAdjustment;

  const lat = cityInfo?.lat ?? 40.77;
  const lon = cityInfo?.lon ?? -73.87;
  const icao = cityInfo?.icao ?? 'KLGA';
  const stationName = cityInfo?.station ?? 'Unknown Station';

  const toggleLayer = useCallback((key: keyof LayerState) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Fetch all stations when overview mode toggled
  const fetchAllStations = useCallback(async () => {
    if (allStations.length > 0) return;
    setAllStationsLoading(true);
    try {
      const res = await fetch('/api/stations');
      if (res.ok) {
        const data = await res.json();
        setAllStations(data);
      }
    } catch { /* silent */ } finally {
      setAllStationsLoading(false);
    }
  }, [allStations.length]);

  useEffect(() => {
    if (layers.allStations) fetchAllStations();
  }, [layers.allStations, fetchAllStations]);

  // Best edge bracket
  const bestEdge = useMemo(() => {
    const bp = edge?.bracketProbabilities;
    if (!bp) return null;
    let best: BracketProbability | null = null;
    let bestVal = -Infinity;
    for (const b of bp) {
      const e = b.edge ?? ((b.forecastProb || 0) - (b.marketPrice || 0));
      if (e > bestVal) { bestVal = e; best = b; }
    }
    return best ? { ...best, edgeVal: bestVal } : null;
  }, [edge?.bracketProbabilities]);

  // Selected station marker
  const selectedIcon = useMemo(() => createStationIcon({
    temp: liveWeather?.currentTemp ?? null,
    icao,
    isSelected: true,
    hasLiveData: liveWeather?.currentTemp != null,
    edge: bestEdge ? bestEdge.edgeVal * 100 : null,
    showEdge: layers.edgeBadges,
  }), [liveWeather?.currentTemp, icao, bestEdge, layers.edgeBadges]);

  // Ensemble spread
  const ensembleSpread = ensemble?.averageSpread ?? (edge as any)?.ensembleSpread ?? null;

  // Strategy summary
  const strat = strategy?.summary;

  // Bracket probabilities for analysis panel
  const bracketProbs = edge?.bracketProbabilities;

  // Model predictions
  const modelPreds = multiModel?.consensus?.predictions;

  return (
    <div className="weather-map-container">
      {/* ── Layer Control Panel ── */}
      <div className="weather-map-controls">
        <div className="wm-layer-toggles">
          {([
            ['precipitation', '🌧 PRECIP', 'RainViewer precipitation radar'],
            ['ensembleSpread', '◎ SPREAD', 'Ensemble uncertainty spread ring'],
            ['wind', '💨 WIND', 'Wind direction and speed indicator'],
            ['analysisPanel', '📊 DATA', 'Analysis data overlay panel'],
            ['allStations', '🌍 ALL', 'Show all weather stations'],
            ['edgeBadges', '◆ EDGE', 'Show edge values on markers'],
          ] as [keyof LayerState, string, string][]).map(([key, label, tip]) => (
            <button
              key={key}
              className={`weather-map-btn ${layers[key] ? 'active' : ''}`}
              onClick={() => toggleLayer(key)}
              data-tip={tip}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="weather-map-station-label">
          ◉ {stationName} <span className="weather-map-icao">({icao})</span>
        </span>
      </div>

      <div className="weather-map-body">
        {/* ── Map ── */}
        <MapContainer
          center={[lat, lon]}
          zoom={8}
          className="weather-map-leaflet"
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />

          <FlyToStation lat={lat} lon={lon} zoom={layers.allStations ? 3 : 8} />

          {/* Precipitation radar overlay */}
          {layers.precipitation && <RainViewerLayer opacity={0.5} />}

          {/* Ensemble spread ring */}
          {layers.ensembleSpread && ensembleSpread != null && (
            <EnsembleSpreadRing
              lat={lat}
              lon={lon}
              spread={ensembleSpread}
              memberCount={ensemble?.memberCount}
            />
          )}

          {/* Wind direction arrow */}
          {layers.wind && atmospheric?.windDirection != null && atmospheric?.windSpeed != null && (
            <WindArrow
              lat={lat}
              lon={lon}
              direction={atmospheric.windDirection}
              speed={atmospheric.windSpeed}
            />
          )}

          {/* Selected station marker */}
          <Marker position={[lat, lon]} icon={selectedIcon}>
            <Popup className="station-popup" maxWidth={320} minWidth={260}>
              <div className="station-popup-content">
                <div className="station-popup-header">
                  <span className="station-popup-name">{stationName}</span>
                  <span className="station-popup-icao">{icao}</span>
                </div>
                <div className="station-popup-coords">
                  {lat.toFixed(4)}°, {lon.toFixed(4)}°
                </div>

                {/* Live weather */}
                {liveWeather && (
                  <div className="station-popup-section">
                    <div className="station-popup-section-title">LIVE OBSERVATION</div>
                    <div className="station-popup-grid">
                      <div className="station-popup-metric">
                        <span className="station-popup-metric-label">TEMP</span>
                        <span className="station-popup-metric-value" style={{ color: tempToColor(liveWeather.currentTemp) }}>
                          {tempToLabel(liveWeather.currentTemp)}
                        </span>
                      </div>
                      <div className="station-popup-metric">
                        <span className="station-popup-metric-label">MAX TODAY</span>
                        <span className="station-popup-metric-value" style={{ color: tempToColor(liveWeather.maxToday) }}>
                          {tempToLabel(liveWeather.maxToday)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Atmospheric */}
                {atmospheric && (
                  <div className="station-popup-section">
                    <div className="station-popup-section-title">ATMOSPHERIC</div>
                    <div className="station-popup-grid">
                      {atmospheric.humidity != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">HUMID</span>
                          <span className="station-popup-metric-value" style={{ color: '#00bcd4' }}>{atmospheric.humidity.toFixed(0)}%</span>
                        </div>
                      )}
                      {atmospheric.windSpeed != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">WIND</span>
                          <span className="station-popup-metric-value">{atmospheric.windSpeed.toFixed(0)} mph {atmospheric.windDirection != null ? `${atmospheric.windDirection.toFixed(0)}°` : ''}</span>
                        </div>
                      )}
                      {atmospheric.pressure != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">PRESS</span>
                          <span className="station-popup-metric-value" style={{ color: '#bb86fc' }}>{atmospheric.pressure.toFixed(0)} hPa</span>
                        </div>
                      )}
                      {atmospheric.cloudCover != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">CLOUD</span>
                          <span className="station-popup-metric-value">{atmospheric.cloudCover.toFixed(0)}%</span>
                        </div>
                      )}
                      {atmospheric.dewPoint != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">DEW PT</span>
                          <span className="station-popup-metric-value" style={{ color: '#4488ff' }}>{atmospheric.dewPoint.toFixed(1)}°C</span>
                        </div>
                      )}
                      {atmospheric.precipProbability != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">PRECIP</span>
                          <span className="station-popup-metric-value" style={{ color: atmospheric.precipProbability > 50 ? '#4488ff' : '#555' }}>
                            {atmospheric.precipProbability.toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Best edge */}
                {bestEdge && (
                  <div className="station-popup-section">
                    <div className="station-popup-section-title">BEST EDGE</div>
                    <div className="station-popup-grid">
                      <div className="station-popup-metric">
                        <span className="station-popup-metric-label">BRACKET</span>
                        <span className="station-popup-metric-value">{bestEdge.name || bestEdge.title}</span>
                      </div>
                      <div className="station-popup-metric">
                        <span className="station-popup-metric-label">EDGE</span>
                        <span className="station-popup-metric-value" style={{ color: edgeToColor(bestEdge.edgeVal * 100) }}>
                          {bestEdge.edgeVal > 0 ? '+' : ''}{(bestEdge.edgeVal * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Air quality */}
                {airQuality && (airQuality.usAqi != null || airQuality.uvIndex != null) && (
                  <div className="station-popup-section">
                    <div className="station-popup-section-title">AIR QUALITY</div>
                    <div className="station-popup-grid">
                      {airQuality.usAqi != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">AQI</span>
                          <span className="station-popup-metric-value" style={{
                            color: airQuality.usAqi <= 50 ? '#00ff41' : airQuality.usAqi <= 100 ? '#ff8c00' : '#ff3333'
                          }}>{airQuality.usAqi.toFixed(0)}</span>
                        </div>
                      )}
                      {airQuality.uvIndex != null && (
                        <div className="station-popup-metric">
                          <span className="station-popup-metric-label">UV</span>
                          <span className="station-popup-metric-value" style={{
                            color: airQuality.uvIndex <= 2 ? '#00ff41' : airQuality.uvIndex <= 5 ? '#ff8c00' : '#ff3333'
                          }}>{airQuality.uvIndex.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>

          {/* All stations overlay */}
          {layers.allStations && allStations.map((s) => {
            if (s.icao === icao) return null;
            const icon = createStationIcon({
              temp: s.currentTemp,
              icao: s.icao,
              isSelected: false,
              hasLiveData: s.currentTemp != null,
            });
            return (
              <Marker key={s.icao} position={[s.lat, s.lon]} icon={icon}>
                <Popup className="station-popup" maxWidth={220} minWidth={180}>
                  <div className="station-popup-content">
                    <div className="station-popup-header">
                      <span className="station-popup-name">{s.station}</span>
                      <span className="station-popup-icao">{s.icao}</span>
                    </div>
                    <div className="station-popup-coords">{s.lat.toFixed(4)}°, {s.lon.toFixed(4)}°</div>
                    {s.currentTemp != null && (
                      <div className="station-popup-section">
                        <div className="station-popup-grid">
                          <div className="station-popup-metric">
                            <span className="station-popup-metric-label">TEMP</span>
                            <span className="station-popup-metric-value" style={{ color: tempToColor(s.currentTemp) }}>
                              {tempToLabel(s.currentTemp)}
                            </span>
                          </div>
                          {s.maxToday != null && (
                            <div className="station-popup-metric">
                              <span className="station-popup-metric-label">MAX</span>
                              <span className="station-popup-metric-value" style={{ color: tempToColor(s.maxToday) }}>
                                {tempToLabel(s.maxToday)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* ── Analysis Overlay Panel (Bloomberg HUD) ── */}
        {layers.analysisPanel && (
          <div className="wm-analysis-hud">
            {/* Live weather hero */}
            {liveWeather && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">LIVE</div>
                <div className="wm-hud-hero" style={{ color: tempToColor(liveWeather.currentTemp) }}>
                  {liveWeather.currentTemp.toFixed(1)}°C
                </div>
                <div className="wm-hud-sub">MAX: {liveWeather.maxToday.toFixed(1)}°C</div>
              </div>
            )}

            {/* Ensemble spread */}
            {ensembleSpread != null && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">ENSEMBLE</div>
                <div className="wm-hud-row">
                  <span>SPREAD</span>
                  <span style={{ color: ensembleSpread > 4 ? '#ff3333' : ensembleSpread > 2 ? '#ff8c00' : '#00ff41' }}>
                    ±{ensembleSpread.toFixed(1)}°C
                  </span>
                </div>
                {ensemble?.memberCount && (
                  <div className="wm-hud-row">
                    <span>MEMBERS</span>
                    <span style={{ color: '#00bcd4' }}>{ensemble.memberCount}</span>
                  </div>
                )}
              </div>
            )}

            {/* Model consensus */}
            {modelPreds && modelPreds.length > 0 && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">MODELS</div>
                {modelPreds.slice(0, 6).map((p: any) => (
                  <div key={p.model} className="wm-hud-row">
                    <span>{(p.model || '').replace(/_seamless|_ifs025/g, '').toUpperCase()}</span>
                    <span style={{ color: '#00bcd4' }}>{p.maxTemp != null ? `${p.maxTemp.toFixed(1)}°C` : '--'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Bracket probabilities */}
            {bracketProbs && bracketProbs.length > 0 && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">BRACKETS</div>
                {bracketProbs.map((b: BracketProbability) => {
                  const edg = b.edge ?? ((b.forecastProb || 0) - (b.marketPrice || 0));
                  return (
                    <div key={b.name || b.title} className="wm-hud-row">
                      <span className="wm-hud-bracket-name">{b.name || b.title}</span>
                      <span className="wm-hud-bracket-vals">
                        <span style={{ color: '#555' }}>{b.marketPrice != null ? `${(b.marketPrice * 100).toFixed(0)}¢` : '--'}</span>
                        <span style={{ color: '#fff' }}>{b.forecastProb != null ? `${(b.forecastProb * 100).toFixed(0)}%` : '--'}</span>
                        <span style={{ color: edg > 0 ? '#00ff41' : edg < 0 ? '#ff3333' : '#555' }}>
                          {edg > 0 ? '+' : ''}{(edg * 100).toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Atmospheric summary */}
            {atmospheric && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">ATMOSPHERIC</div>
                {atmospheric.humidity != null && (
                  <div className="wm-hud-row">
                    <span>HUMIDITY</span><span style={{ color: '#00bcd4' }}>{atmospheric.humidity.toFixed(0)}%</span>
                  </div>
                )}
                {atmospheric.windSpeed != null && (
                  <div className="wm-hud-row">
                    <span>WIND</span>
                    <span>{atmospheric.windSpeed.toFixed(0)} mph {atmospheric.windDirection != null ? `@ ${atmospheric.windDirection.toFixed(0)}°` : ''}</span>
                  </div>
                )}
                {atmospheric.pressure != null && (
                  <div className="wm-hud-row">
                    <span>PRESSURE</span><span style={{ color: '#bb86fc' }}>{atmospheric.pressure.toFixed(0)} hPa</span>
                  </div>
                )}
                {atmospheric.cloudCover != null && (
                  <div className="wm-hud-row">
                    <span>CLOUD</span><span>{atmospheric.cloudCover.toFixed(0)}%</span>
                  </div>
                )}
                {atmospheric.dewPoint != null && (
                  <div className="wm-hud-row">
                    <span>DEW POINT</span><span style={{ color: '#4488ff' }}>{atmospheric.dewPoint.toFixed(1)}°C</span>
                  </div>
                )}
                {atmospheric.precipProbability != null && (
                  <div className="wm-hud-row">
                    <span>PRECIP PROB</span>
                    <span style={{ color: atmospheric.precipProbability > 50 ? '#4488ff' : '#555' }}>
                      {atmospheric.precipProbability.toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Factor adjustment */}
            {factorAdj && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">FACTORS</div>
                <div className="wm-hud-row">
                  <span>SHIFT</span>
                  <span style={{ color: factorAdj.shiftDirection === 'WARMING' ? '#ff3333' : '#00bcd4' }}>
                    {factorAdj.shiftDirection} {factorAdj.effectiveShift > 0 ? '+' : ''}{factorAdj.effectiveShift.toFixed(2)}°C
                  </span>
                </div>
              </div>
            )}

            {/* Strategy summary */}
            {strat && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">STRATEGY</div>
                <div className="wm-hud-row">
                  <span>WIN PROB</span>
                  <span style={{ color: strat.winProbability > 60 ? '#00ff41' : '#ff8c00' }}>
                    {strat.winProbability.toFixed(0)}%
                  </span>
                </div>
                <div className="wm-hud-row">
                  <span>EXP RETURN</span>
                  <span style={{ color: strat.expectedReturn > 0 ? '#00ff41' : '#ff3333' }}>
                    {strat.expectedReturn > 0 ? '+' : ''}{strat.expectedReturn.toFixed(1)}%
                  </span>
                </div>
                <div className="wm-hud-row">
                  <span>CONFIDENCE</span>
                  <span style={{ color: '#ff8c00' }}>{strat.confidence.toFixed(0)}%</span>
                </div>
              </div>
            )}

            {/* Station bias */}
            {data.stationBias && data.stationBias.reliable && (
              <div className="wm-hud-section">
                <div className="wm-hud-title">STATION BIAS</div>
                <div className="wm-hud-row">
                  <span>BIAS</span>
                  <span style={{ color: data.stationBias.direction === 'warm' ? '#ff3333' : data.stationBias.direction === 'cold' ? '#4488ff' : '#00ff41' }}>
                    {data.stationBias.bias > 0 ? '+' : ''}{data.stationBias.bias.toFixed(2)}°C
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
