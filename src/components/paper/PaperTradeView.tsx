'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PaperAnalysis, PaperAnalysisCity, PaperBracket, HCCityData } from '@/types';

interface ActualData {
  [citySlug: string]: { temp: number | null; source: string };
}

export default function PaperTradeView() {
  const [loaded, setLoaded] = useState(false);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [marketDates, setMarketDates] = useState<Set<string>>(new Set());
  const [analysisCache, setAnalysisCache] = useState<Record<string, PaperAnalysis>>({});
  const [actualsCache, setActualsCache] = useState<Record<string, ActualData>>({});
  const [hondaData, setHondaData] = useState<Record<string, HCCityData[]>>({});
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState({ text: 'Loading...', color: '#ff8c00' });

  useEffect(() => {
    if (!loaded) { setLoaded(true); loadEverything(); }
  }, [loaded]);

  const loadEverything = async () => {
    setStatus({ text: 'Loading...', color: '#ff8c00' });
    try {
      const [datesRes, hondaRes] = await Promise.all([
        fetch('/api/paper/dates'),
        fetch('/api/paper/honda-all'),
      ]);
      const datesData = await datesRes.json();
      const hondaAllData = await hondaRes.json();

      const dates = datesData.dates || [];
      const mkts = new Set<string>(datesData.marketDates || []);
      setAllDates(dates);
      setMarketDates(mkts);
      setHondaData(hondaAllData.dates || {});

      const today = new Date().toISOString().split('T')[0];
      setExpandedDates(new Set<string>([today]));
      setStatus({ text: `✓ ${dates.length} dates loaded`, color: '#00ff41' });

      // Progressive: fetch analysis + actuals for each date
      for (const date of dates) {
        if (mkts.has(date)) {
          try {
            setStatus({ text: `Analyzing ${date}...`, color: '#ff8c00' });
            const [analysisRes, actualsRes] = await Promise.all([
              fetch(`/api/paper/analyze/${date}`),
              fetch(`/api/paper/actuals/${date}`),
            ]);
            const analysis = await analysisRes.json();
            const actuals = await actualsRes.json();
            if (!analysis.error) {
              setAnalysisCache(prev => ({ ...prev, [date]: analysis }));
            }
            if (actuals.actuals) {
              setActualsCache(prev => ({ ...prev, [date]: actuals.actuals }));
            }
          } catch {}
        }
      }
      setStatus({ text: `✓ ${dates.length} dates · analysis complete`, color: '#00ff41' });
    } catch (err: any) {
      setStatus({ text: `Error: ${err.message}`, color: '#ff3333' });
    }
  };

  const toggleDate = useCallback((date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }, []);

  const toggleCity = useCallback((key: string) => {
    setExpandedCities(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const normCity = (name: string) => name?.toLowerCase().replace(/[\s-]/g, '').replace('newyorkcity', 'nyc') || '';
  const today = new Date().toISOString().split('T')[0];

  const ALL_CITIES = [
    'Ankara','Atlanta','Buenos Aires','Chicago','Dallas','London',
    'Miami','Milan','Munich','New York City','Paris','Sao Paulo',
    'Seattle','Seoul','Toronto','Wellington'
  ];

  const citySlugMap: Record<string, string> = {
    'ankara': 'ankara', 'atlanta': 'atlanta', 'buenosaires': 'buenos-aires',
    'chicago': 'chicago', 'dallas': 'dallas', 'london': 'london',
    'miami': 'miami', 'milan': 'milan', 'munich': 'munich',
    'nyc': 'nyc', 'paris': 'paris', 'saopaulo': 'sao-paulo',
    'seattle': 'seattle', 'seoul': 'seoul', 'toronto': 'toronto',
    'wellington': 'wellington',
  };

  const getSlug = (cityNorm: string) => citySlugMap[cityNorm] || cityNorm;

  const getHondaFor = (slug: string, date: string): HCCityData | null => {
    const dateCities = hondaData[date];
    if (!dateCities) return null;
    return dateCities.find((c: any) => normCity(c.city) === normCity(slug)) || null;
  };

  return (
    <main className="flex flex-col h-[calc(100vh-28px)] overflow-hidden bg-black" id="tab-paper">
      {/* Dashboard Bar */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 bg-[#0a0a0a] border-b border-[#222]">
        <DashStat label="MODE" value="DAILY LOG" color="#4fc3f7" />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="DATES" value={`${allDates.length}`} />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="MARKETS" value={`${marketDates.size}`} />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="ANALYZED" value={`${Object.keys(analysisCache).length}`} color="#00ff41" />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="HC DATES" value={`${Object.keys(hondaData).length}`} color="#00e676" />
      </div>

      {/* Status */}
      <div className="px-2 py-1 bg-[#050505] border-b border-[#111] text-[8px] font-mono" style={{ color: status.color }}>
        {status.text}
      </div>

      {/* Accordion */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {allDates.length === 0 ? (
          <div className="text-center py-8 text-[#333] text-[9px]">Loading market dates...</div>
        ) : allDates.map(date => {
          const analysis = analysisCache[date];
          const actuals = actualsCache[date] || {};
          const isMarketDate = marketDates.has(date);
          const isToday = date === today;
          const isFuture = date > today;
          const dateExpanded = expandedDates.has(date);
          const dateHonda = hondaData[date] || [];

          // Build city set
          const citySet = new Set<string>();
          for (const name of ALL_CITIES) citySet.add(normCity(name));

          return (
            <div key={date}>
              {/* Date Row */}
              <div className="paper-date-row" onClick={() => toggleDate(date)}>
                <span className="pc-chevron">{dateExpanded ? '▾' : '▸'}</span>
                <span className={`pc-date-label ${isToday ? 'pc-green' : isFuture ? 'pc-amber' : 'pc-white'}`}>
                  {date}{isToday ? ' (TODAY)' : ''}
                </span>
                <span className="pc-chips">
                  {analysis ? (
                    <>
                      <span className="pc-muted">{analysis.cities.length} mkts</span>
                      <span className="pc-sep">·</span>
                      <span className="pc-ens">ENS ${analysis.totalEnsExpectedProfit}</span>
                      <span className="pc-sep">·</span>
                      <span className="pc-fcst">FCST ${analysis.totalFcstExpectedProfit}</span>
                    </>
                  ) : isMarketDate ? (
                    <span className="pc-muted">analyzing…</span>
                  ) : (
                    <span className="pc-muted">no markets</span>
                  )}
                  {dateHonda.length > 0 && (
                    <>
                      <span className="pc-sep">│</span>
                      <span className="pc-hc">HC: {dateHonda.length} cities</span>
                    </>
                  )}
                </span>
              </div>

              {/* City Rows */}
              {dateExpanded && [...citySet].sort().map(cityNorm => {
                const slug = getSlug(cityNorm);
                const an = analysis?.cities?.find((c: any) =>
                  normCity(c.city) === cityNorm || normCity(c.cityName || '') === cityNorm
                );
                const cityKey = `${date}|${cityNorm}`;
                const cityExpanded = expandedCities.has(cityKey);
                const displayName = an?.cityName || ALL_CITIES.find(n => normCity(n) === cityNorm) || cityNorm;
                const actual = actuals[slug];
                const hc = getHondaFor(slug, date);
                const hasData = an || hc;

                // Determine the best YES bracket from analysis
                const yesPick = an?.fcst?.yesBracket || an?.ens?.yesBracket;

                return (
                  <div key={cityKey}>
                    <div className="paper-city-row" onClick={() => toggleCity(cityKey)}>
                      <span className="pc-chevron">{cityExpanded ? '▾' : '▸'}</span>
                      <span className="pc-city-name">{displayName}</span>
                      <span className="pc-chips">
                        {/* Actual temp */}
                        {actual?.temp != null ? (
                          <span className="pc-actual-temp">{Math.round(actual.temp)}°C</span>
                        ) : actual?.source === 'future' ? (
                          <span className="pc-muted">—</span>
                        ) : (
                          <span className="pc-muted">…</span>
                        )}
                        <span className="pc-sep">│</span>
                        {/* Analysis summary */}
                        {an ? (
                          <>
                            <span className="pc-fcst">FCST:{an.fcst.yesBracket} {an.fcst.yesProb}%</span>
                            <span className="pc-sep">·</span>
                            <span className="pc-ens">ENS:{an.ens.yesBracket} {an.ens.yesProb}%</span>
                          </>
                        ) : (
                          <span className="pc-muted">no mkt</span>
                        )}
                        {/* Honda Civic summary */}
                        {hc && (
                          <>
                            <span className="pc-sep">│</span>
                            <span className="pc-hc">
                              HC: {hc.mainYesBracket || '?'} ${hc.totalCost?.toFixed(0)}
                              {hc.estimatedPnl != null && (
                                <span className={(hc.estimatedPnl || 0) >= 0 ? 'pc-green' : 'pc-red'}>
                                  {' '}{(hc.estimatedPnl || 0) >= 0 ? '+' : ''}{hc.estimatedPnl?.toFixed(0)}
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Expanded Detail */}
                    {cityExpanded && (
                      <CityDetail
                        an={an || null}
                        actual={actual}
                        honda={hc}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function DashStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] uppercase tracking-widest" style={{ color: color || '#555' }}>{label}</span>
      <span className="text-[11px] font-bold text-white" style={color && color !== '#555' ? { color } : undefined}>{value}</span>
    </div>
  );
}

function CityDetail({ an, actual, honda }: {
  an: PaperAnalysisCity | null;
  actual: { temp: number | null; source: string } | undefined;
  honda: HCCityData | null;
}) {
  return (
    <div className="paper-detail">
      {/* Actual Temperature */}
      <div className="pd-section-title" style={{ color: '#fff' }}>ACTUAL TEMPERATURE (WUNDERGROUND)</div>
      <div className="pd-actual-row">
        {actual?.temp != null ? (
          <>
            <span className="pd-actual-temp">{Math.round(actual.temp)}°C</span>
            <span className="pc-muted">({actual.source})</span>
          </>
        ) : actual?.source === 'future' ? (
          <span className="pc-muted">Not yet available (future date)</span>
        ) : (
          <span className="pc-muted">Loading...</span>
        )}
      </div>

      {/* Bracket Probabilities Table */}
      {an?.allBrackets && an.allBrackets.length > 0 && (
        <>
          <div className="pd-section-title" style={{ marginTop: '6px' }}>BRACKET PROBABILITIES</div>
          <div className="pd-bracket-header">
            <span className="pd-bname">Bracket</span>
            <span className="pc-muted">Market</span>
            <span className="pc-ens">Ensemble</span>
            <span className="pc-fcst">Blended</span>
            <span className="pc-muted">Edge</span>
          </div>
          {an.allBrackets.map((b: PaperBracket) => {
            const isEnsPick = b.name === an.ens?.yesBracket;
            const isFcstPick = b.name === an.fcst?.yesBracket;
            const mkt = parseFloat(b.mkt as any) || 0;
            const fcst = parseFloat(b.fcst as any) || 0;
            const edge = fcst - mkt;
            // Check if actual temp resolves to this bracket
            const isWinner = actual?.temp != null && bracketContainsTemp(b.name, actual.temp);

            return (
              <div key={b.name} className={`pd-bracket-row ${isWinner ? 'pd-bracket-winner' : ''}`}>
                <span className="pd-bname">
                  {isEnsPick && isFcstPick ? <span className="pc-green">★</span>
                    : isEnsPick ? <span className="pc-ens">◆</span>
                    : isFcstPick ? <span className="pc-fcst">◆</span>
                    : <span style={{ width: '8px', display: 'inline-block' }}> </span>}
                  {' '}{b.name}
                  {isWinner && <span className="pc-green"> ✓</span>}
                </span>
                <span className="pc-muted">{b.mkt}%</span>
                <span className="pc-ens">{b.ens}%</span>
                <span className="pc-fcst">{b.fcst}%</span>
                <span className={edge >= 5 ? 'pc-green' : edge <= -5 ? 'pc-red' : 'pc-muted'}>
                  {edge >= 0 ? '+' : ''}{edge.toFixed(1)}%
                </span>
              </div>
            );
          })}
          <div style={{ paddingTop: '3px', fontSize: '7px', color: '#444' }}>
            ◆ = YES pick &nbsp; ★ = both agree &nbsp; ✓ = actual winner
          </div>
        </>
      )}

      {/* Honda Civic Investments */}
      {honda && (
        <>
          <div className="pd-section-title" style={{ color: '#00e676', marginTop: '6px' }}>HONDA CIVIC INVESTMENTS</div>
          <div className="pd-bracket-header">
            <span className="pd-bname">Side</span>
            <span className="pc-white">Bracket</span>
            <span className="pc-muted">Cost</span>
            <span className="pc-muted">Shares</span>
            <span className="pc-muted">Redeemed</span>
          </div>
          {honda.yesPositions?.map((p: any, i: number) => (
            <div key={`hc-yes-${i}`} className="pd-hc-row">
              <span className="paper-side-badge paper-side-yes">YES</span>
              <span className="pc-white">{p.label}</span>
              <span className="pc-muted">${p.netCost.toFixed(2)}</span>
              <span className="pc-muted">{p.netShares.toFixed(1)}</span>
              <span className={p.redeemed > 0 ? 'pc-green' : 'pc-muted'}>${p.redeemed.toFixed(2)}</span>
            </div>
          ))}
          {honda.noPositions?.map((p: any, i: number) => (
            <div key={`hc-no-${i}`} className="pd-hc-row">
              <span className="paper-side-badge paper-side-no">NO</span>
              <span className="pc-white">{p.label}</span>
              <span className="pc-muted">${p.netCost.toFixed(2)}</span>
              <span className="pc-muted">{p.netShares.toFixed(1)}</span>
              <span className={p.redeemed > 0 ? 'pc-green' : 'pc-muted'}>${p.redeemed.toFixed(2)}</span>
            </div>
          ))}
          <div className="pd-hc-summary">
            <span className="pc-muted">Total Cost:</span>
            <span className="pc-white">${honda.totalCost?.toFixed(2) || '0'}</span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">Redeemed:</span>
            <span className="pc-green">${honda.totalRedeemed?.toFixed(2) || '0'}</span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">PnL:</span>
            <span className={(honda.estimatedPnl || 0) >= 0 ? 'pc-green' : 'pc-red'}>
              {(honda.estimatedPnl || 0) >= 0 ? '+' : ''}${honda.estimatedPnl?.toFixed(2) || '0'}
            </span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">{honda.tradeCount || 0} trades</span>
          </div>
        </>
      )}

      {/* No data */}
      {!an && !honda && (
        <div style={{ padding: '4px 0', color: '#333', fontSize: '8px' }}>
          No market data or Honda Civic investments for this city/date
        </div>
      )}
    </div>
  );
}

/**
 * Check if an actual temperature falls within a bracket name like "14°C", "9°C or below",
 * "19°C or higher", "84-85°F", etc.
 */
function bracketContainsTemp(bracketName: string, tempC: number): boolean {
  if (!bracketName) return false;
  const name = bracketName.trim();

  // Detect unit
  const isFahrenheit = name.includes('°F');
  // Convert actual temp to bracket unit
  const actual = isFahrenheit ? tempC * 9 / 5 + 32 : tempC;
  const rounded = Math.round(actual);

  // "X°C or below" / "X°F or below"
  const belowMatch = name.match(/(\d+)°[CF]\s+or\s+below/i);
  if (belowMatch) return rounded <= parseInt(belowMatch[1]);

  // "X°C or higher" / "X°F or higher"
  const aboveMatch = name.match(/(\d+)°[CF]\s+or\s+higher/i);
  if (aboveMatch) return rounded >= parseInt(aboveMatch[1]);

  // "X-Y°C" / "X-Y°F" range
  const rangeMatch = name.match(/(-?\d+)-(-?\d+)°[CF]/i);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1]);
    const hi = parseInt(rangeMatch[2]);
    return rounded >= lo && rounded <= hi;
  }

  // Exact: "X°C" / "X°F"
  const exactMatch = name.match(/(-?\d+)°[CF]/i);
  if (exactMatch) return rounded === parseInt(exactMatch[1]);

  return false;
}
