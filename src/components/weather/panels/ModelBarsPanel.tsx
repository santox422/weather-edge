'use client';

import type { AnalysisData } from '@/types';

interface ModelBarsPanelProps {
  data: AnalysisData;
}

export default function ModelBarsPanel({ data }: ModelBarsPanelProps) {
  const mm = data.multiModel;
  if (!mm?.consensus?.predictions) return <div className="p-2 text-[9px] text-[#333]">No data</div>;
  const preds = mm.consensus.predictions.filter((p: any) => p.maxTemp != null);
  if (preds.length === 0) return <div className="p-2 text-[9px] text-[#333]">No data</div>;
  const maxT = Math.max(...preds.map((p: any) => p.maxTemp || 0), 1);
  const sorted = [...preds].sort((a: any, b: any) => (b.weight || 1) - (a.weight || 1));

  return (
    <div>
      {sorted.map((p: any) => {
        const pctVal = ((p.maxTemp || 0) / (maxT * 1.15)) * 100;
        const modelName = p.model.replace('_seamless', '').replace('_ifs025', ' IFS').replace('_aifs025', ' AIFS').toUpperCase();
        const wt = p.weight ?? 1;
        const wtColor = wt >= 1.3 ? 'text-[#00ff41] border-[#00ff41]/30' : wt >= 1.0 ? 'text-[#ff8c00] border-[#ff8c00]/30' : 'text-[#555] border-[#333]';
        return (
          <div key={p.model} className="flex items-center gap-[4px] px-2 py-[2px]">
            <span className="text-[8px] text-[#666] w-[55px] truncate font-semibold">{modelName}</span>
            <span className={`text-[7px] font-bold w-[22px] text-center border px-[2px] py-[0px] ${wtColor}`}
              title={`Weight: ${wt.toFixed(1)}x`}>{wt.toFixed(1)}</span>
            <div className="flex-1 h-[6px] bg-[#111] overflow-hidden">
              <div className={`h-full transition-all ${p.exceedsThreshold ? 'bg-[#00ff41]' : 'bg-[#ff3333]'}`} style={{ width: `${pctVal}%` }} />
            </div>
            <span className={`text-[10px] font-bold w-[45px] text-right ${p.exceedsThreshold ? 'text-[#00ff41]' : 'text-[#ff3333]'}`}>
              {p.maxTemp != null ? `${p.maxTemp.toFixed(1)}°C` : '--'}
            </span>
          </div>
        );
      })}
      <div className="text-[8px] text-[#444] text-center py-[3px] border-t border-[#111]">
        {mm.consensus.isWeighted ? 'WEIGHTED ' : ''}{(mm.consensus.agreementRatio * 100).toFixed(0)}% consensus {mm.consensus.allAgree ? '│ UNANIMOUS' : '│ DIVERGENT'}
        {mm.consensus.medianTemp != null && ` │ MED ${mm.consensus.medianTemp.toFixed(1)}°C`}
      </div>
    </div>
  );
}
