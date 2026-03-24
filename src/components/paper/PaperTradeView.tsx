'use client';

import { useState, useEffect, useCallback } from 'react';
import type { HCCityData, PaperAnalysis, PaperAnalysisCity, PaperStrategy, PaperBracket } from '@/types';

export default function PaperTradeView() {
  const [loaded, setLoaded] = useState(false);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [marketDates, setMarketDates] = useState<Set<string>>(new Set());
  const [hcAllData, setHcAllData] = useState<Record<string, HCCityData[]>>({});
  const [analysisCache, setAnalysisCache] = useState<Record<string, PaperAnalysis>>({});
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState({ text: 'Loading...', color: '#ff8c00' });

  // Dashboard stats
  const [dashStats, setDashStats] = useState({ spend: 0, pnl: 0, hcDays: 0 });

  useEffect(() => {
    if (!loaded) { setLoaded(true); loadEverything(); }
  }, [loaded]);

  const loadEverything = async () => {
    setStatus({ text: 'Loading Honda Civic trade history + market dates...', color: '#ff8c00' });
    try {
      const [datesRes, hcRes] = await Promise.all([fetch('/api/paper/dates'), fetch('/api/paper/honda-all')]);
      const datesData = await datesRes.json();
      const hcData = await hcRes.json();
      const hcDates = hcData.dates || {};
      setHcAllData(hcDates);

      const dates = datesData.dates || [];
      const mkts = new Set<string>(datesData.marketDates || []);
      setAllDates(dates);
      setMarketDates(mkts);

      // Auto-expand future dates
      const today = new Date().toISOString().split('T')[0];
      const autoExpand = new Set<string>();
      for (const d of dates) { if (d >= today) autoExpand.add(d); }
      setExpandedDates(autoExpand);

      // Dashboard
      let spend = 0, pnl = 0, hcDays = 0;
      for (const cities of Object.values(hcDates)) {
        hcDays++;
        for (const c of cities as HCCityData[]) { spend += c.totalCost; pnl += c.estimatedPnl; }
      }
      setDashStats({ spend, pnl, hcDays });

      setStatus({ text: `✓ ${dates.length} dates · ${Object.keys(hcDates).length} HC days`, color: '#00ff41' });

      // Progressive analysis
      const futureDates = dates.filter((d: string) => d >= today && mkts.has(d)).slice(0, 3);
      for (const date of futureDates) {
        try {
          setStatus({ text: `Analyzing ${date}...`, color: '#ff8c00' });
          const res = await fetch(`/api/paper/analyze/${date}`);
          const analysis = await res.json();
          if (!analysis.error) {
            setAnalysisCache(prev => ({ ...prev, [date]: analysis }));
          }
        } catch {}
      }
      setStatus({ text: `✓ ${dates.length} dates · ${Object.keys(hcDates).length} HC days · ${futureDates.length} analyzed`, color: '#00ff41' });
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

  return (
    <main className="flex flex-col h-[calc(100vh-28px)] overflow-hidden bg-black" id="tab-paper">
      {/* Dashboard Bar */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 bg-[#0a0a0a] border-b border-[#222]">
        <DashStat label="HC TOTAL SPEND" value={`$${dashStats.spend.toFixed(0)}`} color="#00e676" />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="HC TOTAL PnL" value={`${dashStats.pnl >= 0 ? '+' : ''}$${dashStats.pnl.toFixed(0)}`} color={dashStats.pnl >= 0 ? '#00ff41' : '#ff3333'} />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="HC DAYS" value={`${dashStats.hcDays}`} />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="DATES" value={`${allDates.length}`} />
        <div className="w-px h-4 bg-[#222]" />
        <DashStat label="MARKETS" value={`${marketDates.size}`} />
      </div>

      {/* Status */}
      <div className="px-2 py-1 bg-[#050505] border-b border-[#111] text-[8px] font-mono" style={{ color: status.color }}>
        {status.text}
      </div>

      {/* Accordion */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {allDates.length === 0 ? (
          <div className="text-center py-8 text-[#333] text-[9px]">Loading all trade data...</div>
        ) : allDates.map(date => {
          const hcCities = hcAllData[date] || [];
          const analysis = analysisCache[date];
          const isMarketDate = marketDates.has(date);
          const isFuture = date >= today;
          const dateExpanded = expandedDates.has(date);

          // Build city set
          const citySet = new Set<string>();
          for (const c of hcCities) citySet.add(normCity(c.city));
          if (analysis) for (const c of analysis.cities) citySet.add(normCity(c.city));
          if (citySet.size === 0 && !isMarketDate) return null;

          const hcDateCost = hcCities.reduce((s, c) => s + c.totalCost, 0);
          const hcDatePnl = hcCities.reduce((s, c) => s + c.estimatedPnl, 0);
          const hcDateRedeemed = hcCities.reduce((s, c) => s + c.totalRedeemed, 0);

          return (
            <div key={date}>
              {/* Date Row */}
              <div className="paper-date-row" onClick={() => toggleDate(date)}>
                <span className="pc-chevron">{dateExpanded ? '▾' : '▸'}</span>
                <span className={`pc-date-label ${isFuture ? 'pc-amber' : 'pc-white'}`}>{date}</span>
                <span className="pc-chips">
                  <span className="pc-muted">{citySet.size} cit{citySet.size === 1 ? 'y' : 'ies'}</span>
                  {hcCities.length > 0 && (
                    <>
                      <span className="pc-sep">·</span>
                      <span className="pc-hc">HC ${hcDateCost.toFixed(0)}</span>
                      {hcDateRedeemed > 0 && (
                        <>
                          <span className="pc-sep">·</span>
                          <span className={hcDatePnl >= 0 ? 'pc-green' : 'pc-red'}>
                            {hcDatePnl >= 0 ? '+' : ''}${hcDatePnl.toFixed(0)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                  {analysis && (
                    <>
                      <span className="pc-sep">·</span>
                      <span className="pc-ens">ENS E[P]:${analysis.totalEnsExpectedProfit}</span>
                      <span className="pc-sep">·</span>
                      <span className="pc-fcst">FCST E[P]:${analysis.totalFcstExpectedProfit}</span>
                    </>
                  )}
                  {!analysis && isMarketDate && isFuture && <><span className="pc-sep">·</span><span className="pc-muted">analyzing…</span></>}
                </span>
              </div>

              {/* City Rows */}
              {dateExpanded && [...citySet].sort().map(cityNorm => {
                const hc = hcCities.find(c => normCity(c.city) === cityNorm);
                const an = analysis?.cities?.find(c => normCity(c.city) === cityNorm || normCity(c.cityName || '') === cityNorm);
                const cityKey = `${date}|${cityNorm}`;
                const cityExpanded = expandedCities.has(cityKey);
                const displayName = an?.cityName || hc?.city || cityNorm;

                return (
                  <div key={cityKey}>
                    <div className="paper-city-row" onClick={() => toggleCity(cityKey)}>
                      <span className="pc-chevron">{cityExpanded ? '▾' : '▸'}</span>
                      <span className="pc-city-name">{displayName}</span>
                      <span className="pc-chips">
                        {an && (
                          <>
                            <span className="pc-ens">{an.ens.yesBracket} {an.ens.yesProb}%@{an.ens.yesPrice}¢</span>
                            <span className="pc-sep">·</span>
                            <span className={an.ens.expectedProfit >= 0 ? 'pc-green' : 'pc-red'}>
                              {an.ens.expectedProfit >= 0 ? '+' : ''}${an.ens.expectedProfit.toFixed(0)}
                            </span>
                            <span className="pc-sep">│</span>
                            <span className="pc-fcst">{an.fcst.yesBracket} {an.fcst.yesProb}%@{an.fcst.yesPrice}¢</span>
                            <span className="pc-sep">·</span>
                            <span className={an.fcst.expectedProfit >= 0 ? 'pc-green' : 'pc-red'}>
                              {an.fcst.expectedProfit >= 0 ? '+' : ''}${an.fcst.expectedProfit.toFixed(0)}
                            </span>
                          </>
                        )}
                        {hc && (
                          <>
                            <span className="pc-sep">│</span>
                            <span className="pc-hc">HC ${hc.totalCost.toFixed(0)}</span>
                            {hc.totalRedeemed > 0 ? (
                              <><span className="pc-sep">·</span><span className={hc.estimatedPnl >= 0 ? 'pc-green' : 'pc-red'}>{hc.estimatedPnl >= 0 ? '+' : ''}${hc.estimatedPnl.toFixed(0)}</span></>
                            ) : <><span className="pc-sep">·</span><span className="pc-amber">OPEN</span></>}
                          </>
                        )}
                      </span>
                    </div>

                    {/* Detail Panel */}
                    {cityExpanded && (
                      <CityDetail an={an || null} hc={hc || null} />
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

function CityDetail({ an, hc }: { an: PaperAnalysisCity | null; hc: HCCityData | null }) {
  return (
    <div className="paper-detail">
      {an && (
        <>
          <div className="pd-grid">
            <StrategyCol label="ENSEMBLE" strategy={an.ens} color="#4fc3f7" />
            <StrategyCol label="BLENDED FCST" strategy={an.fcst} color="#ffab40" />
          </div>
          <div className="pd-best">
            Best: {an.samePick
              ? <span className="pc-muted">SAME PICK</span>
              : an.ens.expectedProfit > an.fcst.expectedProfit
                ? <span className="pc-ens">⟶ ENS WINS</span>
                : <span className="pc-fcst">⟶ FCST WINS</span>}
          </div>
          {an.allBrackets && an.allBrackets.length > 0 && (
            <>
              <div className="pd-section-title">ALL BRACKETS</div>
              {an.allBrackets.map(b => {
                const isEns = b.name === an.ens.yesBracket;
                const isFcst = b.name === an.fcst.yesBracket;
                const marker = isEns && isFcst ? <span className="pc-green">★</span>
                  : isEns ? <span className="pc-ens">◆</span>
                  : isFcst ? <span className="pc-fcst">◆</span> : null;
                return (
                  <div key={b.name} className="pd-bracket-row">
                    <span className="pd-bname">{marker} {b.name}</span>
                    <span className="pc-muted">mkt {b.mkt}%</span>
                    <span className="pc-ens">ens {b.ens}%</span>
                    <span className="pc-fcst">fcst {b.fcst}%</span>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {hc && (
        <>
          <div className="pd-section-title" style={{ color: '#00e676' }}>HONDA CIVIC POSITIONS</div>
          {hc.yesPositions?.map((p, i) => (
            <div key={`y${i}`} className="pd-hc-row">
              <span className="pc-green">YES</span> <span className="pc-white">{p.label}</span>
              <span className="pc-muted">${p.netCost.toFixed(2)} · {p.netShares.toFixed(1)} shares</span>
              {p.redeemed > 0 && <span className="pc-green">↩${p.redeemed.toFixed(2)}</span>}
            </div>
          ))}
          {hc.noPositions?.map((p, i) => (
            <div key={`n${i}`} className="pd-hc-row">
              <span className="pc-red">NO</span> <span className="pc-white">{p.label}</span>
              <span className="pc-muted">${p.netCost.toFixed(2)} · {p.netShares.toFixed(1)} shares</span>
              {p.redeemed > 0 && <span className="pc-green">↩${p.redeemed.toFixed(2)}</span>}
            </div>
          ))}
          <div className="pd-hc-summary">
            <span className="pc-muted">Cost:</span> <span className="pc-white">${hc.totalCost.toFixed(2)}</span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">Redeemed:</span> <span className="pc-white">${hc.totalRedeemed.toFixed(2)}</span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">PnL:</span> <span className={hc.estimatedPnl >= 0 ? 'pc-green' : 'pc-red'}>{hc.estimatedPnl >= 0 ? '+' : ''}${hc.estimatedPnl.toFixed(2)}</span>
            <span className="pc-sep">·</span>
            <span className="pc-muted">{hc.tradeCount} trades</span>
          </div>
        </>
      )}
    </div>
  );
}

function StrategyCol({ label, strategy, color }: { label: string; strategy: PaperStrategy; color: string }) {
  const profitColor = strategy.expectedProfit >= 0 ? '#00ff41' : '#ff3333';
  return (
    <div className="pd-strat-col">
      <div className="pd-strat-title" style={{ color }}>{label}</div>
      <div className="pd-row"><span className="pc-muted">YES Pick</span> <span style={{ color }}>{strategy.yesBracket}</span></div>
      <div className="pd-row"><span className="pc-muted">Prob / Price</span> <span className="pc-white">{strategy.yesProb}% @ {strategy.yesPrice}¢</span></div>
      <div className="pd-row"><span className="pc-muted">Edge</span> <span style={{ color: strategy.yesEdge >= 0 ? '#00ff41' : '#ff3333' }}>{strategy.yesEdge >= 0 ? '+' : ''}{strategy.yesEdge}%</span></div>
      <div className="pd-row"><span className="pc-muted">NO picks</span> <span className="pc-white">{strategy.noBrackets.join(', ')}</span></div>
      <div className="pd-row"><span className="pc-muted">E[Profit]</span> <span style={{ color: profitColor }}>{strategy.expectedProfit >= 0 ? '+' : ''}${strategy.expectedProfit.toFixed(0)}</span></div>
      <div className="pd-row"><span className="pc-muted">ROI</span> <span style={{ color: profitColor }}>{strategy.expectedROI}%</span></div>
      <div className="pd-row"><span className="pc-muted">Cost</span> <span className="pc-white">${strategy.totalCost.toFixed(0)}</span></div>
    </div>
  );
}
