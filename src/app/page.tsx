'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnalysisData, MultiDayData, City, Market, WsMessage } from '@/types';

// ── Shared app-level state ────────────────────────────────────
export interface AppState {
  multiDayData: MultiDayData | null;
  selectedDate: string | null;
  currentAnalysis: { slug: string; date: string } | null;
  lastAnalysisData: AnalysisData | null;
  tokenMap: Map<string, { name: string; price: number | null }>;
}

import CityList from '@/components/weather/CityList';
import AnalysisView from '@/components/weather/AnalysisView';
import RightPanel from '@/components/weather/RightPanel';
import CryptoTab from '@/components/crypto/CryptoTab';
import PaperTradeView from '@/components/paper/PaperTradeView';
import Tooltip from '@/components/ui/Tooltip';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'weather' | 'crypto' | 'paper'>('weather');
  const [wsStatus, setWsStatus] = useState<'offline' | 'connecting' | 'online'>('offline');
  const [utcTime, setUtcTime] = useState('--:--');

  // App state
  const [multiDayData, setMultiDayData] = useState<MultiDayData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<{ slug: string; date: string } | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [marketCount, setMarketCount] = useState(0);
  const [sysStatus, setSysStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [sysStatusText, setSysStatusText] = useState('INIT');
  const [instName, setInstName] = useState('—');

  // Right panel visibility
  const [showRightPanel, setShowRightPanel] = useState(false);

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // WS ref
  const wsRef = useRef<WebSocket | null>(null);
  const tokenMapRef = useRef(new Map<string, { name: string; price: number | null }>());
  const analysisDataRef = useRef<AnalysisData | null>(null);

  // Keep ref in sync
  useEffect(() => { analysisDataRef.current = analysisData; }, [analysisData]);

  // ── UTC Clock ──
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setUtcTime(now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── WebSocket ──
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      setWsStatus('connecting');
      try {
        ws = new WebSocket(url);
        wsRef.current = ws;
      } catch {
        setWsStatus('offline');
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }

      ws.onopen = () => {
        setWsStatus('online');
        // Re-subscribe if we have analysis data  
        const data = analysisDataRef.current;
        if (data?.market?.outcomes) {
          const tokens = data.market.outcomes.filter((o: any) => o.tokenId).map((o: any) => ({
            tokenId: o.tokenId, name: o.name || o.title, conditionId: o.conditionId,
          }));
          if (tokens.length > 0 && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', tokens }));
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          if (msg.type === 'price_update') {
            handlePriceUpdate(msg as any);
          }
        } catch {}
      };

      ws.onclose = () => {
        setWsStatus('offline');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => setWsStatus('offline');
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // ── Price Update Handler ──
  const handlePriceUpdate = useCallback((msg: { tokenId: string; name: string; price: number; change: number }) => {
    tokenMapRef.current.set(msg.tokenId, { name: msg.name, price: msg.price });

    // 1. Update ALL matching price cells in DOM directly for performance
    const cells = document.querySelectorAll(`[data-token-id="${msg.tokenId}"] .price-cell`);
    const newMkt = (msg.price * 100).toFixed(0);
    cells.forEach(cell => {
      if (cell.textContent !== `${newMkt}¢`) {
        cell.textContent = `${newMkt}¢`;
        cell.classList.remove('price-up', 'price-down');
        void (cell as HTMLElement).offsetWidth;
        cell.classList.add(msg.change >= 0 ? 'price-up' : 'price-down');
      }
    });

    // 2. Update React state so prices survive re-renders
    setAnalysisData((prev: AnalysisData | null) => {
      if (!prev?.market?.outcomes) return prev;
      const idx = prev.market.outcomes.findIndex((o: any) => o.tokenId === msg.tokenId);
      if (idx === -1) return prev;
      const updated = { ...prev };
      const outcomes = [...prev.market.outcomes];
      outcomes[idx] = { ...outcomes[idx], price: msg.price };
      updated.market = { ...prev.market, outcomes };
      return updated;
    });
  }, []);

  // ── Load Multi-Day Data ──
  const loadMultiDay = useCallback(async () => {
    setSysStatus('loading');
    setSysStatusText('SCANNING...');
    try {
      const res = await fetch('/api/cities-multiday');
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: MultiDayData = await res.json();
      setMultiDayData(data);
      const defaultDate = data.dates[1] || data.dates[0];
      setSelectedDate(defaultDate);

      const total = data.cities.reduce(
        (sum, c) => sum + Object.values(c.marketsByDate || {}).filter(Boolean).length, 0
      );
      setMarketCount(total);
      setSysStatus('live');
      setSysStatusText(`${total} MKTS`);
    } catch {
      setSysStatus('error');
      setSysStatusText('OFFLINE');
    }
  }, []);

  // ── Analyze City ──
  const analyzeCity = useCallback(async (slug: string, dateStr: string) => {
    setCurrentAnalysis({ slug, date: dateStr });
    setAnalysisLoading(true);
    setShowRightPanel(true);
    setAnalysisData(null);

    const city = multiDayData?.cities?.find((c) => c.slug === slug);
    const cityName = (city?.name || slug).toUpperCase();
    const today = new Date().toISOString().split('T')[0];
    const dateLabel = dateStr === today ? 'TODAY' : dateStr;
    setInstName(`${cityName} // ${dateLabel} // TEMP`);

    // Close mobile sidebar
    if (window.innerWidth < 768) setSidebarOpen(false);

    try {
      const res = await fetch(`/api/analyze/${slug}/${dateStr}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || String(res.status)); }
      const data: AnalysisData = await res.json();
      setAnalysisData(data);

      // Subscribe to price updates
      if (data?.market?.outcomes && wsRef.current?.readyState === WebSocket.OPEN) {
        const tokens = data.market.outcomes.filter((o) => o.tokenId).map((o) => ({
          tokenId: o.tokenId, name: o.name || o.title, conditionId: o.conditionId,
        }));
        if (tokens.length > 0) {
          wsRef.current.send(JSON.stringify({ type: 'subscribe', tokens }));
        }
      }
    } catch (err: any) {
      setAnalysisData({ error: err.message } as AnalysisData);
    } finally {
      setAnalysisLoading(false);
    }
  }, [multiDayData]);

  // ── Refresh ──
  const handleRefresh = useCallback(() => {
    loadMultiDay();
    if (currentAnalysis) {
      analyzeCity(currentAnalysis.slug, currentAnalysis.date);
    }
  }, [loadMultiDay, currentAnalysis, analyzeCity]);

  // ── Initial Load ──
  useEffect(() => { loadMultiDay(); }, [loadMultiDay]);

  // ── Auto-refresh analysis every 2 min ──
  useEffect(() => {
    const id = setInterval(() => {
      if (currentAnalysis) analyzeCity(currentAnalysis.slug, currentAnalysis.date);
    }, 120000);
    return () => clearInterval(id);
  }, [currentAnalysis, analyzeCity]);

  // Tab classes
  const tabCls = (t: string) => t === activeTab
    ? 'px-3 flex items-center h-full border-b-2 border-[#ff8c00] text-[#ff8c00] hover:bg-[#111] transition-colors cursor-pointer'
    : 'px-3 flex items-center h-full border-b-2 border-transparent text-[#555] hover:text-[#ccc] hover:bg-[#111] transition-colors cursor-pointer';

  return (
    <>
      {/* ── Tab Navigation + Controls ── */}
      <nav className="flex items-center border-b border-[#111] bg-[#050505] h-7 px-2 gap-1 text-[9px] font-bold tracking-widest select-none">
        <button
          className="md:hidden flex items-center justify-center bg-transparent border border-[#ff8c00]/40 text-[#ff8c00] text-[18px] font-bold w-[44px] h-[26px] cursor-pointer mr-1 hover:bg-[#ff8c00]/10 active:bg-[#ff8c00]/20 transition-colors rounded-sm"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open city list"
        >☰</button>
        <div className={tabCls('weather')} onClick={() => setActiveTab('weather')}>WEATHER</div>
        <div className={tabCls('crypto')} onClick={() => setActiveTab('crypto')}>CRYPTO</div>
        <div className={tabCls('paper')} onClick={() => setActiveTab('paper')}>PAPER</div>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-1.5 text-[8px] text-[#888] mr-2 px-2 py-[2px] bg-[#0a0a0a] border border-[#111] rounded-sm">
          <span className="text-[#ff8c00]/60">◉</span>
          <span className="truncate max-w-[300px]">{instName}</span>
        </div>
        {/* Mobile instrument label */}
        <div className="sm:hidden flex-1 text-center text-[8px] text-[#666] truncate px-1">
          {instName !== '—' && <span>{instName}</span>}
        </div>
        <div className="flex items-center gap-2 text-[8px]">
          <span className="hidden sm:inline text-[#ff8c00]/40">|</span>
          <span className="hidden sm:inline text-[#555]">UTC</span>
          <span className="hidden sm:inline text-[#fff] font-bold">{utcTime}</span>
          <span className={`ws-dot ${wsStatus}`} data-tip={`WebSocket: ${wsStatus}`} />
          <span className={`status-dot ${sysStatus === 'live' ? 'live' : sysStatus === 'error' ? 'error' : 'loading'}`} data-tip={sysStatusText} />
          <button
            className="bg-transparent border border-[#222] text-[#555] text-[9px] font-bold px-2 py-[2px] cursor-pointer hover:border-[#ff8c00] hover:text-[#ff8c00] transition-colors uppercase tracking-wider"
            onClick={handleRefresh}
            data-tip="Refresh all data (R)"
          >↻</button>
        </div>
      </nav>

      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Weather Tab ── */}
      {activeTab === 'weather' && (
        <main className="flex flex-col md:grid md:grid-cols-[240px_1fr_270px] h-[calc(100vh-28px)] md:h-[calc(100vh-28px)] overflow-hidden" id="tab-weather">
          {/* LEFT: City List */}
          <CityList
            multiDayData={multiDayData}
            selectedDate={selectedDate}
            onSelectDate={(d) => {
              setSelectedDate(d);
              setShowRightPanel(false);
              setAnalysisData(null);
              setCurrentAnalysis(null);
              setInstName('—');
            }}
            onAnalyzeCity={analyzeCity}
            currentSlug={currentAnalysis?.slug}
            marketCount={marketCount}
            sidebarOpen={sidebarOpen}
            onCloseSidebar={() => setSidebarOpen(false)}
          />

          {/* CENTER: Analysis */}
          <section className="flex-1 overflow-y-auto bg-black min-h-0" id="col-center">
            {!analysisData && !analysisLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                <div className="text-[20px] text-[#ff8c00]/20">◎</div>
                <span className="text-[14px] text-[#ff8c00] font-bold tracking-[0.2em] uppercase">SELECT INSTRUMENT</span>
                <span className="text-[9px] text-[#444] max-w-[420px] leading-relaxed">
                  Click any city with an active market to execute forecast analysis.
                  Analysis includes: ensemble spread, GFS/ECMWF divergence, 6-model consensus, forecast skill decay, CRPS calibration, atmospheric conditions, historical base rates.
                </span>
                <div className="flex items-center gap-3 text-[8px] text-[#333] mt-2">
                  <span>← SELECT CITY</span>
                  <span className="text-[#222]">│</span>
                  <span>↻ REFRESH DATA</span>
                </div>
              </div>
            ) : analysisLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-8 h-8 border-2 border-[#ff8c00]/20 border-t-[#ff8c00] rounded-full animate-spin" />
                <span className="text-[#ff8c00] text-[10px] font-bold tracking-wider">[RUNNING ANALYSIS...]</span>
                <span className="text-[#444] text-[9px]">Fetching GFS, ECMWF, ICON, JMA, GEM, ensemble data...</span>
              </div>
            ) : analysisData?.error ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-[#ff3333] text-[10px]">[ERROR] {analysisData.error}</span>
              </div>
            ) : (
              <AnalysisView
                data={analysisData!}
                city={multiDayData?.cities?.find(c => c.slug === currentAnalysis?.slug)}
                market={multiDayData?.cities?.find(c => c.slug === currentAnalysis?.slug)?.marketsByDate?.[currentAnalysis?.date || '']}
              />
            )}
          </section>

          {/* RIGHT: Metrics */}
          {showRightPanel && analysisData && !analysisData.error && (
            <RightPanel data={analysisData} wsStatus={wsStatus} />
          )}
        </main>
      )}

      {/* ── Crypto Tab ── */}
      {activeTab === 'crypto' && <CryptoTab />}

      {/* ── Paper Tab ── */}
      {activeTab === 'paper' && <PaperTradeView />}

      {/* ── Tooltip ── */}
      <Tooltip />
    </>
  );
}
