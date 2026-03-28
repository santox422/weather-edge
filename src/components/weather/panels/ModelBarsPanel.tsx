'use client';

import type { AnalysisData, PerModelBracket } from '@/types';

interface ModelBarsPanelProps {
  data: AnalysisData;
}

const MODEL_COLORS: Record<string, string> = {
  ENS_KDE: '#bb86fc', gfs_seamless: '#4488ff', ecmwf_ifs025: '#00bcd4',
  icon_seamless: '#ff8c00', icon_eu: '#ff6600', icon_d2: '#ff4400',
  jma_seamless: '#ff6b81', gem_seamless: '#26de81', meteofrance_seamless: '#a55eea',
  meteofrance_arome_france: '#8854d0', ukmo_seamless: '#fed330',
};

function getModelColor(model: string): string {
  return MODEL_COLORS[model] || '#888';
}

function formatModelName(model: string): string {
  return model
    .replace('_seamless', '')
    .replace('_ifs025', ' IFS')
    .replace('_aifs025', ' AIFS')
    .replace('_arome_france', ' AROME')
    .replace(/_/g, ' ')
    .toUpperCase()
    .trim();
}

interface ModelRow {
  model: string;
  maxTemp: number;
  weight: number;
  exceedsThreshold?: boolean;
  isEnsemble?: boolean;
  memberCount?: number;
}

export default function ModelBarsPanel({ data }: ModelBarsPanelProps) {
  // Build model list from ALL available sources
  const rows: ModelRow[] = [];
  const seenModels = new Set<string>();

  // Source 1: perModelBrackets — most complete (always has all models)
  const pmb: PerModelBracket[] = data.perModelBrackets || [];
  for (const m of pmb) {
    if (m.maxTemp != null && !seenModels.has(m.model)) {
      seenModels.add(m.model);
      rows.push({
        model: m.model,
        maxTemp: m.maxTemp,
        weight: m.weight,
        isEnsemble: m.isEnsemble,
        memberCount: m.memberCount,
      });
    }
  }

  // Source 2: multiModel.consensus.predictions — may have threshold info
  const mm = data.multiModel;
  const preds = mm?.consensus?.predictions || [];
  for (const p of preds) {
    if (p.maxTemp != null && !seenModels.has(p.model)) {
      seenModels.add(p.model);
      rows.push({
        model: p.model,
        maxTemp: p.maxTemp,
        weight: p.weight ?? 1,
        exceedsThreshold: p.exceedsThreshold,
      });
    }
    // Merge exceedsThreshold from multiModel into existing rows
    if (p.exceedsThreshold != null) {
      const existing = rows.find(r => r.model === p.model);
      if (existing && existing.exceedsThreshold == null) {
        existing.exceedsThreshold = p.exceedsThreshold;
      }
    }
  }

  if (rows.length === 0) return <div className="p-2 text-[9px] text-[#333]">No data</div>;

  // Sort by weight descending (highest influence first)
  const sorted = [...rows].sort((a, b) => b.weight - a.weight);
  const maxT = Math.max(...sorted.map(r => r.maxTemp), 1);
  const temps = sorted.map(r => r.maxTemp);
  const medianTemp = temps.length > 0
    ? [...temps].sort((a, b) => a - b)[Math.floor(temps.length / 2)]
    : null;
  const agreementRatio = mm?.consensus?.agreementRatio;
  const allAgree = mm?.consensus?.allAgree;
  const isWeighted = mm?.consensus?.isWeighted ?? (sorted.some(r => r.weight !== sorted[0].weight));

  return (
    <div>
      {sorted.map((r) => {
        const pctVal = (r.maxTemp / (maxT * 1.15)) * 100;
        const modelName = r.isEnsemble
          ? `ENS KDE (${r.memberCount || '?'}m)`
          : formatModelName(r.model);
        const wt = r.weight;
        const wtColor = wt >= 1.3 ? 'text-[#00ff41] border-[#00ff41]/30'
          : wt >= 1.0 ? 'text-[#ff8c00] border-[#ff8c00]/30'
          : 'text-[#555] border-[#333]';
        const color = getModelColor(r.model);
        const exceeds = r.exceedsThreshold;

        return (
          <div key={r.model} className="flex items-center gap-[4px] px-2 py-[2px]">
            {/* Color dot */}
            <span className="w-[5px] h-[5px] shrink-0" style={{ backgroundColor: color }} />
            {/* Model name */}
            <span className="text-[8px] w-[55px] truncate font-semibold" style={{ color }}>{modelName}</span>
            {/* Weight badge */}
            <span className={`text-[7px] font-bold w-[22px] text-center border px-[2px] py-[0px] ${wtColor}`}
              title={`Weight: ${wt.toFixed(1)}x`}>{wt.toFixed(1)}</span>
            {/* Temperature bar */}
            <div className="flex-1 h-[6px] bg-[#111] overflow-hidden">
              <div className="h-full transition-all" style={{
                width: `${pctVal}%`,
                backgroundColor: exceeds != null
                  ? (exceeds ? '#00ff41' : '#ff3333')
                  : color,
                opacity: 0.7,
              }} />
            </div>
            {/* Temperature value */}
            <span className={`text-[10px] font-bold w-[45px] text-right`} style={{
              color: exceeds != null
                ? (exceeds ? '#00ff41' : '#ff3333')
                : color,
            }}>
              {r.maxTemp.toFixed(1)}°C
            </span>
          </div>
        );
      })}
      <div className="text-[8px] text-[#444] text-center py-[3px] border-t border-[#111]">
        {isWeighted ? 'WEIGHTED ' : ''}{agreementRatio != null ? `${(agreementRatio * 100).toFixed(0)}% consensus` : `${sorted.length} models`}
        {allAgree != null && (allAgree ? ' │ UNANIMOUS' : ' │ DIVERGENT')}
        {medianTemp != null && ` │ MED ${medianTemp.toFixed(1)}°C`}
      </div>
    </div>
  );
}
