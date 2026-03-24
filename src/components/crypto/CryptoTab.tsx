'use client';

export default function CryptoTab() {
  return (
    <main className="grid grid-cols-[240px_1fr_270px] h-[calc(100vh-28px)] overflow-hidden" id="tab-crypto">
      <aside className="flex flex-col overflow-hidden border-r border-[#111] bg-[#050505]">
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]">CRYPTO MARKETS</div>
        <div className="flex-1 overflow-y-auto flex items-center justify-center">
          <span className="text-[9px] text-[#555]">[FUTURE: BINANCE/POLYMARKET SYNC]</span>
        </div>
      </aside>
      <section className="overflow-y-auto bg-black flex flex-col items-center justify-center h-full gap-2 text-center">
        <span className="text-[14px] text-[#ff8c00] font-bold tracking-[0.2em] uppercase">CRYPTO ENGINE OFFLINE</span>
        <span className="text-[9px] text-[#333] max-w-[400px] leading-relaxed">
          Crypto analysis dashboard scaffolding initialized. Ready for orderbook depth APIs, TradingView overlays, and volatility-based Kelly sizing.
        </span>
      </section>
      <aside className="flex flex-col overflow-y-auto border-l border-[#111] bg-[#050505]">
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] flex justify-between items-center">
          LIVE METRICS <span className="ws-live-dot" />
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col p-2">
          <div className="text-[9px] text-[#555] text-center my-8">[AWAITING BINANCE L2 STREAM...]</div>
        </div>
      </aside>
    </main>
  );
}
