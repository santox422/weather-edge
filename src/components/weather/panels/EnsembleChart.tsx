'use client';

import type { AnalysisData, BracketProbability } from '@/types';

interface EnsembleChartProps {
  data: AnalysisData;
}

export default function EnsembleChart({ data }: EnsembleChartProps) {
  const bp = data.ensemble?.bracketProbabilities || (data.edge as any)?.bracketProbabilities;
  if (!bp || bp.length === 0) return <div className="p-2 text-[9px] text-[#333]">No ensemble data</div>;

  const maxProb = Math.max(...bp.map((b: BracketProbability) => Math.max(b.forecastProb || 0, b.marketPrice || 0)), 0.01);
  const memberCount = data.ensemble?.memberCount;
  const spread = data.ensemble?.averageSpread;

  return (
    <div className="px-2 py-1">
      {bp.map((b: BracketProbability, i: number) => {
        const fcPct = ((b.forecastProb || 0) / maxProb) * 100;
        const mktPct = ((b.marketPrice || 0) / maxProb) * 100;
        const edge = (b.forecastProb || 0) - (b.marketPrice || 0);
        const isPositiveEdge = edge > 0.02;
        const isNegativeEdge = edge < -0.02;
        const name = b.name || b.title || `Bracket ${i}`;
        return (
          <div key={name} className="flex items-center gap-[4px] py-[2px]">
            <span className={`text-[7px] w-[45px] truncate font-semibold ${isPositiveEdge ? 'text-[#00ff41]' : isNegativeEdge ? 'text-[#ff3333]' : 'text-[#555]'}`}>{name}</span>
            <div className="flex-1 flex flex-col gap-[1px]">
              <div className="h-[4px] bg-[#111] overflow-hidden" title={`Forecast: ${((b.forecastProb || 0) * 100).toFixed(1)}%`}>
                <div className="h-full bg-[#00bcd4] transition-all" style={{ width: `${fcPct}%` }} />
              </div>
              <div className="h-[3px] bg-[#111] overflow-hidden" title={`Market: ${((b.marketPrice || 0) * 100).toFixed(1)}%`}>
                <div className="h-full bg-[#ff8c00]/50 transition-all" style={{ width: `${mktPct}%` }} />
              </div>
            </div>
            <span className={`text-[8px] font-bold w-[32px] text-right ${isPositiveEdge ? 'text-[#00ff41]' : isNegativeEdge ? 'text-[#ff3333]' : 'text-[#444]'}`}>
              {((b.forecastProb || 0) * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-3 mt-1 pt-1 border-t border-[#111]">
        <span className="text-[7px] text-[#444]">■ <span className="text-[#00bcd4]">FCST</span> ■ <span className="text-[#ff8c00]">MKT</span></span>
        {memberCount != null && <span className="text-[7px] text-[#444]">{memberCount} members</span>}
        {spread != null && <span className="text-[7px] text-[#444]">σ {spread.toFixed(1)}°C</span>}
      </div>
    </div>
  );
}
