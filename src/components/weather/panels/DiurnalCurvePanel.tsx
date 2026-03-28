'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import type { AnalysisData } from '@/types';
import { getModelColor } from '@/lib/analysis/constants';

interface DiurnalCurvePanelProps {
  data: AnalysisData;
}

interface DataPoint {
  hour: number;
  temp: number;
}

interface ModelCurve {
  model: string;
  points: DataPoint[];
  peak: DataPoint | null;
  plateauStart: number | null; // hour when temp stops rising
}

export default function DiurnalCurvePanel({ data }: DiurnalCurvePanelProps) {
  const { hourlyCurve, targetDate } = data;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; hour: number } | null>(null);

  if (!hourlyCurve || hourlyCurve.length === 0 || !targetDate) {
    return <div className="p-2 text-[9px] text-[#333]">No diurnal curve data available</div>;
  }

  const tDate = targetDate.split('T')[0];
  const START_HR = 5;
  const END_HR = 21;

  // ── Extract model data ──
  const extractedModels: ModelCurve[] = useMemo(() => {
    return hourlyCurve.map(hc => {
      const times = hc.data?.hourly?.time || [];
      const temps = hc.data?.hourly?.temperature_2m || [];

      const points: DataPoint[] = [];
      for (let i = 0; i < times.length; i++) {
        const tStr = times[i];
        if (tStr.startsWith(tDate)) {
          const hourPart = parseInt(tStr.split('T')[1].split(':')[0], 10);
          if (hourPart >= START_HR && hourPart <= END_HR) {
            points.push({ hour: hourPart, temp: temps[i] });
          }
        }
      }

      // Find peak temperature
      let peak: DataPoint | null = null;
      for (const p of points) {
        if (!peak || p.temp > peak.temp) peak = { ...p };
      }

      // Detect plateau start: first hour after peak where temp begins dropping
      let plateauStart: number | null = null;
      if (peak && points.length > 2) {
        const peakIdx = points.findIndex(p => p.hour === peak!.hour);
        // Walk forward from peak; plateau = when temp drops by ≥0.2°C from peak
        for (let i = peakIdx + 1; i < points.length; i++) {
          if (points[i].temp < peak.temp - 0.2) {
            plateauStart = points[i].hour;
            break;
          }
        }
      }

      return { model: hc.model, points, peak, plateauStart };
    }).filter(m => m.points.length > 0);
  }, [hourlyCurve, tDate]);

  if (extractedModels.length === 0) {
    return <div className="p-2 text-[9px] text-[#333]">No hourly data found for target date</div>;
  }

  // ── Y-axis scaling ──
  let globalMin = Infinity;
  let globalMax = -Infinity;
  extractedModels.forEach(m => {
    m.points.forEach(p => {
      if (p.temp < globalMin) globalMin = p.temp;
      if (p.temp > globalMax) globalMax = p.temp;
    });
  });

  if (globalMax === -Infinity) return null;
  const yPad = Math.max((globalMax - globalMin) * 0.15, 0.5);
  const yMin = globalMin - yPad;
  const yMax = globalMax + yPad;
  const yRange = yMax - yMin;

  // ── Chart dimensions (viewBox units) ──
  const PAD_L = 10;
  const PAD_R = 4;
  const PAD_T = 6;
  const PAD_B = 10;
  const W = 200;
  const H = 70;
  const cW = W - PAD_L - PAD_R;
  const cH = H - PAD_T - PAD_B;

  const mapX = (hour: number) => PAD_L + ((hour - START_HR) / (END_HR - START_HR)) * cW;
  const mapY = (val: number) => PAD_T + cH - ((val - yMin) / yRange) * cH;

  // ── Smooth path (catmull-rom) ──
  const toSmoothPath = (points: DataPoint[]): string => {
    if (points.length < 2) return '';
    // Build polyline with cubic bezier smoothing
    const pts = points.map(p => ({ x: mapX(p.hour), y: mapY(p.temp) }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  };

  // ── Mean curve for multi-model average ──
  const meanCurve: DataPoint[] = useMemo(() => {
    const hourMap = new Map<number, number[]>();
    extractedModels.forEach(m => {
      m.points.forEach(p => {
        if (!hourMap.has(p.hour)) hourMap.set(p.hour, []);
        hourMap.get(p.hour)!.push(p.temp);
      });
    });
    return [...hourMap.entries()]
      .map(([hour, temps]) => ({ hour, temp: temps.reduce((s, t) => s + t, 0) / temps.length }))
      .sort((a, b) => a.hour - b.hour);
  }, [extractedModels]);

  // Mean peak
  const meanPeak = meanCurve.reduce((best, p) => (!best || p.temp > best.temp ? p : best), null as DataPoint | null);

  // ── Hover handling ──
  const handleMouseMove = useCallback((evt: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPct = (evt.clientX - rect.left) / rect.width;
    const svgX = xPct * W;
    const hour = START_HR + ((svgX - PAD_L) / cW) * (END_HR - START_HR);
    const clampedHour = Math.max(START_HR, Math.min(END_HR, hour));
    setHover({ x: svgX, hour: clampedHour });
  }, []);

  const handleMouseLeave = useCallback(() => setHover(null), []);

  // Interpolate temperature at fractional hour
  const interpTemp = (points: DataPoint[], hour: number): number | null => {
    if (points.length === 0) return null;
    if (hour <= points[0].hour) return points[0].temp;
    if (hour >= points[points.length - 1].hour) return points[points.length - 1].temp;
    for (let i = 0; i < points.length - 1; i++) {
      if (hour >= points[i].hour && hour <= points[i + 1].hour) {
        const t = (hour - points[i].hour) / (points[i + 1].hour - points[i].hour);
        return points[i].temp + t * (points[i + 1].temp - points[i].temp);
      }
    }
    return null;
  };

  // Y-axis grid: generate ~4 nice values
  const yStep = yRange > 6 ? 2 : yRange > 3 ? 1 : 0.5;
  const yGridLines: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    yGridLines.push(v);
  }

  // X-axis: every 2 hours
  const xTicks: number[] = [];
  for (let h = START_HR + 1; h <= END_HR; h += 2) xTicks.push(h);

  // Peak heating window
  const peakStartX = mapX(13);
  const peakEndX = mapX(16.5);

  // Hovered data
  const hoverHour = hover ? Math.round(hover.hour) : null;
  const hoverX = hover ? mapX(hover.hour) : 0;

  // Format model name for legend
  const fmtModel = (m: string) => m.replace('_seamless', '').replace('_ifs025', ' IFS').replace(/_/g, ' ').toUpperCase();

  return (
    <div className="px-2 py-2 flex flex-col gap-1">
      {/* ── SVG Chart ── */}
      <div className="relative w-full" style={{ aspectRatio: '2.8 / 1' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full cursor-crosshair"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* Gradient for peak heating area */}
            <linearGradient id="peakGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ff8c00" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#ff8c00" stopOpacity="0.03" />
            </linearGradient>
            {/* Gradient fill under mean curve */}
            <linearGradient id="curveGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#00bcd4" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#00bcd4" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Background */}
          <rect x={PAD_L} y={PAD_T} width={cW} height={cH} fill="#060606" rx="1" />

          {/* Peak heating window */}
          <rect x={peakStartX} y={PAD_T} width={peakEndX - peakStartX} height={cH} fill="url(#peakGrad)" />
          <line x1={peakStartX} y1={PAD_T} x2={peakStartX} y2={PAD_T + cH} stroke="#ff8c00" strokeWidth="0.15" strokeDasharray="1 1" opacity="0.5" />
          <line x1={peakEndX} y1={PAD_T} x2={peakEndX} y2={PAD_T + cH} stroke="#ff8c00" strokeWidth="0.15" strokeDasharray="1 1" opacity="0.5" />
          <text x={(peakStartX + peakEndX) / 2} y={PAD_T + 3.5} fontSize="2.2" fill="#ff8c00" opacity="0.6" textAnchor="middle" fontWeight="bold" style={{ letterSpacing: '0.08em' }}>PEAK HEATING</text>

          {/* Y-axis grid lines */}
          {yGridLines.map(v => (
            <g key={v}>
              <line x1={PAD_L} y1={mapY(v)} x2={PAD_L + cW} y2={mapY(v)} stroke="#1a1a1a" strokeWidth="0.2" />
              <text x={PAD_L - 1.5} y={mapY(v) + 0.8} fontSize="2.2" fill="#555" textAnchor="end" dominantBaseline="middle">{v.toFixed(yStep < 1 ? 1 : 0)}°</text>
            </g>
          ))}

          {/* X-axis grid lines & labels */}
          {xTicks.map(h => (
            <g key={h}>
              <line x1={mapX(h)} y1={PAD_T} x2={mapX(h)} y2={PAD_T + cH} stroke="#111" strokeWidth="0.15" />
              <text x={mapX(h)} y={H - 2} fontSize="2.2" fill="#555" textAnchor="middle">{h < 10 ? `0${h}` : h}h</text>
            </g>
          ))}

          {/* Area fill under mean curve */}
          {meanCurve.length > 1 && (
            <path
              d={toSmoothPath(meanCurve) + ` L ${mapX(meanCurve[meanCurve.length - 1].hour)} ${PAD_T + cH} L ${mapX(meanCurve[0].hour)} ${PAD_T + cH} Z`}
              fill="url(#curveGrad)"
            />
          )}

          {/* Individual model curves (dimmed) */}
          {extractedModels.map((m) => {
            const color = getModelColor(m.model);
            return (
              <path
                key={m.model}
                d={toSmoothPath(m.points)}
                fill="none"
                stroke={color}
                strokeWidth="0.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.35"
              />
            );
          })}

          {/* Mean curve (prominent) */}
          {meanCurve.length > 1 && (
            <path
              d={toSmoothPath(meanCurve)}
              fill="none"
              stroke="#00bcd4"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
          )}

          {/* Peak temperature marker */}
          {meanPeak && (
            <g>
              {/* Horizontal dashed line at peak */}
              <line x1={PAD_L} y1={mapY(meanPeak.temp)} x2={PAD_L + cW} y2={mapY(meanPeak.temp)} stroke="#ff3333" strokeWidth="0.2" strokeDasharray="1 0.5" opacity="0.4" />
              {/* Peak dot */}
              <circle cx={mapX(meanPeak.hour)} cy={mapY(meanPeak.temp)} r="1.5" fill="none" stroke="#ff3333" strokeWidth="0.4" />
              <circle cx={mapX(meanPeak.hour)} cy={mapY(meanPeak.temp)} r="0.6" fill="#ff3333" />
              {/* Peak label */}
              <text
                x={mapX(meanPeak.hour) + (meanPeak.hour > 17 ? -2 : 2)}
                y={mapY(meanPeak.temp) - 2.5}
                fontSize="2.5"
                fill="#ff3333"
                fontWeight="bold"
                textAnchor={meanPeak.hour > 17 ? 'end' : 'start'}
              >
                {meanPeak.temp.toFixed(1)}° @ {meanPeak.hour < 10 ? `0${meanPeak.hour}` : meanPeak.hour}:00
              </text>
            </g>
          )}

          {/* Live temperature marker */}
          {data.liveWeather?.currentTemp != null && (() => {
            const now = new Date();
            const currentHour = now.getUTCHours() + (now.getUTCMinutes() / 60);
            if (currentHour >= START_HR && currentHour <= END_HR) {
              return (
                <g>
                  <line x1={mapX(currentHour)} y1={PAD_T} x2={mapX(currentHour)} y2={PAD_T + cH} stroke="#00ff41" strokeWidth="0.3" opacity="0.5" />
                  <text x={mapX(currentHour)} y={PAD_T + cH + 4.5} fontSize="1.8" fill="#00ff41" textAnchor="middle" fontWeight="bold">NOW</text>
                </g>
              );
            }
            return null;
          })()}

          {/* ── Hover crosshair ── */}
          {hover && hoverHour != null && (
            <g>
              {/* Vertical line */}
              <line x1={hoverX} y1={PAD_T} x2={hoverX} y2={PAD_T + cH} stroke="#fff" strokeWidth="0.2" opacity="0.4" />

              {/* Dots on each model at hovered hour */}
              {extractedModels.map(m => {
                const t = interpTemp(m.points, hover.hour);
                if (t == null) return null;
                return (
                  <circle
                    key={`hover-${m.model}`}
                    cx={hoverX}
                    cy={mapY(t)}
                    r="0.8"
                    fill={getModelColor(m.model)}
                    stroke="#000"
                    strokeWidth="0.2"
                  />
                );
              })}

              {/* Mean dot */}
              {(() => {
                const mt = interpTemp(meanCurve, hover.hour);
                if (mt == null) return null;
                return (
                  <circle cx={hoverX} cy={mapY(mt)} r="1" fill="#00bcd4" stroke="#000" strokeWidth="0.3" />
                );
              })()}
            </g>
          )}
        </svg>

        {/* ── Hover tooltip (HTML overlay) ── */}
        {hover && hoverHour != null && (() => {
          const meanT = interpTemp(meanCurve, hover.hour);
          const hourInt = Math.round(hover.hour);
          const hourStr = `${hourInt < 10 ? '0' + hourInt : hourInt}:00`;
          const isPastPeak = meanPeak && hover.hour > meanPeak.hour;

          return (
            <div
              className="absolute pointer-events-none z-10 bg-[#0a0a0a]/95 border border-[#333] px-2 py-1.5 shadow-lg"
              style={{
                left: `${(hover.x / W) * 100}%`,
                top: '0',
                transform: hover.x > W * 0.65 ? 'translateX(-105%)' : 'translateX(5%)',
                minWidth: '100px',
              }}
            >
              <div className="text-[9px] font-bold text-[#eee] tracking-wider mb-1">{hourStr} UTC</div>
              {meanT != null && (
                <div className="text-[8px] text-[#00bcd4] font-bold mb-0.5">
                  AVG {meanT.toFixed(1)}°C
                </div>
              )}
              {extractedModels.slice(0, 5).map(m => {
                const t = interpTemp(m.points, hover.hour);
                if (t == null) return null;
                return (
                  <div key={m.model} className="flex justify-between gap-3 text-[7px]">
                    <span style={{ color: getModelColor(m.model) }}>{fmtModel(m.model)}</span>
                    <span className="text-[#aaa] font-semibold">{t.toFixed(1)}°</span>
                  </div>
                );
              })}
              {isPastPeak && (
                <div className="text-[7px] text-[#ff8c00] mt-1 border-t border-[#222] pt-0.5">
                  ↓ Past peak — temp declining
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Legend bar ── */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 border-t border-[#111] items-center text-[7px] text-[#555]">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-[2px] bg-[#00bcd4] rounded-sm" /> <span className="uppercase tracking-wider">Mean</span>
        </span>
        {extractedModels.slice(0, 6).map(m => (
          <span key={m.model} className="flex items-center gap-1">
            <span className="inline-block w-2 h-[1px] rounded-sm" style={{ backgroundColor: getModelColor(m.model) }} />
            <span style={{ color: getModelColor(m.model), opacity: 0.7 }}>{fmtModel(m.model)}</span>
          </span>
        ))}
        <span className="flex items-center gap-1 ml-auto">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff3333]" /> <span>Peak</span>
        </span>
        {meanPeak && (
           <span className="text-[#ff3333] font-bold">
             {meanPeak.temp.toFixed(1)}° @ {meanPeak.hour < 10 ? `0${meanPeak.hour}` : meanPeak.hour}:00
           </span>
        )}
      </div>
    </div>
  );
}
