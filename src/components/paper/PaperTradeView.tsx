'use client';

import { useState, useEffect, useCallback } from 'react';
import { edgeColorClass } from '@/lib/analysis/constants';

export default function PaperTradeView() {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState({ text: 'Loading backend metrics...', color: '#ff8c00' });
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [savingSettings, setSavingSettings] = useState(false);

  // Form State
  const [config, setConfig] = useState({
    capital: 10000,
    trade_size_pct: 0.02,
    scan_start_hours: 24,
    max_entry_price: 0.60,
    allow_entries: true
  });

  const loadDashboard = async () => {
    setStatus({ text: 'Syncing SQLite database...', color: '#ff8c00' });
    try {
      const res = await fetch('/api/paper/dashboard');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      
      setData(json);
      setConfig(json.settings);

      const today = new Date().toISOString().split('T')[0];
      setExpandedDates(new Set<string>([today]));
      setStatus({ text: `✓ Live reporting active connected to SQLite`, color: '#00ff41' });
    } catch (err: any) {
      setStatus({ text: `Error: ${err.message}`, color: '#ff3333' });
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const saveSettings = async (e: any) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await fetch('/api/paper/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      setStatus({ text: '✓ Configuration updated safely', color: '#00ff41' });
    } catch (err: any) {
      setStatus({ text: `Error saving config: ${err.message}`, color: '#ff3333' });
    }
    setSavingSettings(false);
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

  if (!data) return (
    <main className="flex flex-col h-[calc(100vh-28px)] bg-black p-4 text-[10px] text-[#555] font-mono">
      {status.text}
    </main>
  );

  return (
    <main className="flex flex-col h-[calc(100vh-28px)] overflow-hidden bg-black" id="tab-paper">
      {/* ── STATUS BAR ── */}
      <div className="px-2 py-1 bg-[#050505] border-b border-[#111] text-[8px] font-mono" style={{ color: status.color }}>
        {status.text}
      </div>

      <div className="flex-1 overflow-auto flex flex-col md:flex-row">
        
        {/* ── LEFT SIDEBAR: CONFIG & OVERALL PERFORMANCE ── */}
        <div className="w-full md:w-[320px] shrink-0 border-r border-[#1a1a1a] bg-[#030303] overflow-y-auto">
          {/* Engine Config */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <h3 className="text-[9px] font-bold text-[#bb86fc] tracking-widest mb-3 uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#bb86fc]/50 animate-pulse"></span>
              Autonomous Engine
            </h3>
            <form onSubmit={saveSettings} className="space-y-3 font-mono text-[9px]">
              <div className="flex items-center justify-between">
                <label className="text-[#888]">STARTING CAPITAL</label>
                <div className="flex items-center bg-[#111] px-1.5 py-1 rounded-sm border border-[#222]">
                  <span className="text-[#555]">$</span>
                  <input type="number" className="bg-transparent text-[#eee] w-14 text-right outline-none ml-1 font-bold" 
                    value={config.capital} onChange={e => setConfig({...config, capital: +e.target.value})} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[#888]" title="Percentage of capital used per trade">TRADE SIZE %</label>
                <div className="flex items-center bg-[#111] px-1.5 py-1 rounded-sm border border-[#222]">
                  <input type="number" step="0.01" className="bg-transparent text-[#eee] w-12 text-right outline-none mr-1 font-bold" 
                    value={config.trade_size_pct * 100} onChange={e => setConfig({...config, trade_size_pct: +(+e.target.value / 100).toFixed(4)})} />
                  <span className="text-[#555]">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[#888]" title="How many hours prior to market close to start scanning">ENTRY WINDOW</label>
                <div className="flex items-center bg-[#111] px-1.5 py-1 rounded-sm border border-[#222]">
                  <span className="text-[#555] mr-1">FINAL</span>
                  <input type="number" className="bg-transparent text-[#eee] w-8 text-right outline-none mr-1 font-bold" 
                    value={config.scan_start_hours} onChange={e => setConfig({...config, scan_start_hours: +e.target.value})} />
                  <span className="text-[#555]">H</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[#888]" title="Max allowed entry price (¢)">MAX YES PRICE</label>
                <div className="flex items-center bg-[#111] px-1.5 py-1 rounded-sm border border-[#222]">
                  <input type="number" step="0.01" className="bg-transparent text-[#eee] w-12 text-right outline-none mr-1 font-bold" 
                    value={+(config.max_entry_price * 100).toFixed(0)} onChange={e => setConfig({...config, max_entry_price: +(+e.target.value / 100).toFixed(4)})} />
                  <span className="text-[#555]">¢</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-[#00e676]" 
                    checked={config.allow_entries} onChange={e => setConfig({...config, allow_entries: e.target.checked})} />
                  <span className="text-white font-bold">ENABLE TRADING</span>
                </label>
                <button disabled={savingSettings} className={`px-3 py-1 bg-[#111] border border-[#333] text-[#eee] rounded-sm transition-colors ${savingSettings ? 'opacity-50' : 'hover:bg-[#222] hover:border-[#00e676] active:bg-[#00e676] active:text-black cursor-pointer'}`}>
                  {savingSettings ? 'SAVING...' : 'SAVE'}
                </button>
              </div>
            </form>
          </div>

          {/* Model Portfolios */}
          <div className="p-3">
            <h3 className="text-[9px] font-bold text-[#888] tracking-widest mb-3 uppercase">STRATEGY PERFORMANCE</h3>
            <div className="space-y-3">
              {['ENS', 'BMA', 'ENS_PHD', 'BMA_PHD'].map(m => {
                const port = data.portfolios[m];
                if (!port) return null;
                const roi = ((port.balance - port.startingCapital) / port.startingCapital) * 100;
                return (
                  <div key={m} className="bg-[#0c0c0c] border border-[#1a1a1a] p-2 rounded-sm font-mono">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-white">{m.replace('_', '+')}</span>
                      <span className={`text-[10px] font-bold ${roi > 0 ? 'text-[#00ff41]' : roi < 0 ? 'text-[#ff3333]' : 'text-[#888]'}`}>
                        {roi > 0 ? '+' : ''}{roi.toFixed(1)}% ROI
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[8px] text-[#888] mb-1">
                      <div>BAL: <span className="text-white">${port.balance.toFixed(0)}</span></div>
                      <div>W/L: <span className="text-[#00ff41]">{port.wins}</span>-<span className="text-[#ff3333]">{port.losses}</span></div>
                      <div>RISK: <span className="text-white">${port.deployed.toFixed(0)}</span> ({port.pending})</div>
                      <div>WIN%: <span className="text-white">{port.winRate}%</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT MAIN: DAILY LOGS ── */}
        <div className="flex-1 bg-black p-2 min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-[12px] font-bold text-white tracking-widest uppercase mb-0">DAILY SIGNALS & LOGS</h2>
          </div>
          
          <div className="space-y-px">
            {data.dates.map((dConfig: any) => {
              const { date, cities } = dConfig;
              const dateExpanded = expandedDates.has(date);
              
              return (
                <div key={date} className="bg-[#050505] border border-[#111]">
                  <div className="paper-date-row cursor-pointer" onClick={() => toggleDate(date)}>
                    <span className="pc-chevron">{dateExpanded ? '▾' : '▸'}</span>
                    <span className="pc-date-label text-white font-bold">{date}</span>
                    <span className="pc-chips">
                      <span className="pc-muted">{cities.length} markets</span>
                    </span>
                  </div>

                  {dateExpanded && (
                    <div className="p-1 pl-4 space-y-1 bg-[#030303]">
                      {cities.map((cityData: any) => {
                        const { city, isActive, final_temp, winning_bracket, trades, signals, hc } = cityData;
                        const key = `${date}|${city}`;
                        const cityExpanded = expandedCities.has(key);

                        // Find any won trades to highlight background
                        const hasWin = trades.some((t:any) => t.status === 'WON');
                        const hasLoss = trades.some((t:any) => t.status === 'LOST');

                        return (
                          <div key={city} className={`border ${hasWin ? 'border-[#00ff41]/20 bg-[#00ff41]/5' : hasLoss ? 'border-[#ff3333]/10 bg-[#ff3333]/5' : 'border-[#1a1a1a] bg-[#0a0a0a]'}`}>
                            <div className="flex items-center px-2 py-1.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors" onClick={() => toggleCity(key)}>
                              <span className="text-[8px] text-[#555] w-4">{cityExpanded ? '▾' : '▸'}</span>
                              <span className={`text-[10px] font-bold ${isActive ? 'text-white' : 'text-[#888]'}`}>{city.toUpperCase().replace('-', ' ')}</span>
                              
                              <div className="ml-auto flex items-center gap-2 text-[8px] font-mono">
                                {winning_bracket && (
                                  <span className="bg-[#bb86fc]/20 text-[#bb86fc] px-1.5 py-0.5 rounded-xs font-bold border border-[#bb86fc]/30 flex items-center gap-1">
                                    <span className="text-[6px] uppercase tracking-widest text-[#bb86fc]/70">WINNER</span>
                                    {winning_bracket}
                                  </span>
                                )}
                                {final_temp != null ? (
                                  <span className="bg-white text-black px-1.5 py-0.5 rounded-xs font-bold shadow-[0_0_8px_rgba(255,255,255,0.3)]">
                                    {Math.round(final_temp)}°C
                                  </span>
                                ) : (
                                  <span className="text-[#555]">PENDING</span>
                                )}
                              </div>
                            </div>

                            {/* City Detail Drawer */}
                            {cityExpanded && (
                              <div className="p-2 pt-0 border-t border-[#111] grid grid-cols-1 xl:grid-cols-2 gap-2 mt-1">
                                
                                {/* Autonomous AI Strategies */}
                                <div>
                                  <div className="text-[7px] font-bold text-[#888] mb-1.5 tracking-widest pb-1 border-b border-[#222]">AUTONOMOUS PICKS</div>
                                  <div className="space-y-1">
                                    {['ENS', 'BMA', 'ENS_PHD', 'BMA_PHD'].map(m => {
                                      const sig = signals.find((s:any) => s.model_column === m);
                                      const trade = trades.find((t:any) => t.model_column === m);
                                      
                                      if (!sig && !trade) return null;
                                      
                                      // Render the outcome
                                      const bracket = trade?.bracket || sig?.pick_bracket;
                                      let statusBadge = null;
                                      if (trade) {
                                        if (trade.status === 'WON') statusBadge = <span className="text-[#00ff41] font-bold">WON +${trade.pnl.toFixed(0)}</span>;
                                        else if (trade.status === 'LOST') statusBadge = <span className="text-[#ff3333] font-bold">LOST -${trade.cost.toFixed(0)}</span>;
                                        else statusBadge = <span className="text-[#ff8c00]">BOUGHT @ {Math.round(trade.entry_price * 100)}¢ (IN PLAY)</span>;
                                      } else if (sig) {
                                        statusBadge = <span className="text-[#555]">NO ENTRY ({Math.round(sig.pick_price * 100)}¢)</span>;
                                      }

                                      let confidenceBadge = null;
                                      if (winning_bracket && sig?.probabilities_json) {
                                        const winnerProb = sig.probabilities_json.find((b:any) => (b.name || b.title) === winning_bracket)?.forecastProb;
                                        if (winnerProb != null) {
                                          confidenceBadge = <span className="text-[#bb86fc] bg-[#bb86fc]/10 px-1 py-0.5 rounded-sm ml-2">🎯 {Math.round(winnerProb * 100)}% prob</span>;
                                        }
                                      }

                                      return (
                                        <div key={m} className={`flex items-center justify-between text-[8px] font-mono px-1.5 py-1 ${trade ? 'bg-[#141414]' : 'bg-[#0a0a0a]'}`}>
                                          <div className="flex items-center gap-2">
                                            <span className="w-12 text-[#00bcd4] uppercase font-bold">{m.replace('_', '+')}</span>
                                            <span className="text-[#eee]">{bracket}</span>
                                          </div>
                                          <div className="flex items-center">
                                            {statusBadge}
                                            {confidenceBadge}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {signals.length === 0 && trades.length === 0 && (
                                       <div className="text-[8px] text-[#444] font-mono py-1 italic">No signals recorded...</div>
                                    )}
                                  </div>
                                </div>

                                {/* Honda Civic */}
                                <div>
                                  <div className="text-[7px] font-bold text-[#888] mb-1.5 tracking-widest pb-1 border-b border-[#222]">HONDA CIVIC (BENCHMARK)</div>
                                  {hc ? (
                                    <div className="space-y-1 text-[8px] font-mono">
                                      {hc.yesPositions?.map((p: any, i: number) => (
                                        <div key={`hcy-${i}`} className="flex justify-between items-center bg-[#141414] px-1.5 py-1">
                                          <div>
                                            <span className="text-[#00bcd4] mr-2">YES</span>
                                            <span className="text-[#eee]">{p.label}</span>
                                          </div>
                                          <div>
                                            <span className="text-[#888]">${p.netCost.toFixed(0)}</span>
                                            {p.redeemed > 0 && <span className="text-[#00ff41] ml-2">+${p.redeemed.toFixed(0)}</span>}
                                          </div>
                                        </div>
                                      ))}
                                      {hc.noPositions?.map((p: any, i: number) => (
                                        <div key={`hcn-${i}`} className="flex justify-between items-center bg-[#0a0a0a] px-1.5 py-1">
                                          <div>
                                            <span className="text-[#ff3333] mr-2">NO</span>
                                            <span className="text-[#555]">{p.label}</span>
                                          </div>
                                          <div className="text-[#555]">${p.netCost.toFixed(0)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-[8px] text-[#444] font-mono py-1 italic">No HC trades discovered...</div>
                                  )}
                                </div>

                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </main>
  );
}
