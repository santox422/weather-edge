/**
 * Model display helpers — shared formatting functions for model names.
 *
 * Extracted from BracketAnalysisPanel to be reused by ModelControlsBar
 * and BracketExpandedDrawer.
 */

import type { PerModelBracket } from '@/types';

/** Full human-readable model label (e.g. "GFS", "ECMWF IFS025", "ENS KDE (170m)") */
export function formatModelLabel(pm: PerModelBracket): string {
  if (pm.isEnsemble) return `ENS KDE (${pm.memberCount}m)`;
  return (pm.model || '')
    .replace(/_/g, ' ')
    .replace(/seamless/i, '')
    .replace(/arome france/i, 'AROME')
    .trim()
    .toUpperCase();
}

/** Short 3-4 character model abbreviation for compact table columns */
export function formatModelShort(pm: PerModelBracket): string {
  if (pm.isEnsemble) return 'ENS';
  const name = formatModelLabel(pm);
  const map: Record<string, string> = {
    GFS: 'GFS', 'ECMWF IFS025': 'ECMW', 'ECMWF IFS': 'ECMW',
    ICON: 'ICON', 'ICON EU': 'I-EU', 'ICON D2': 'I-D2',
    JMA: 'JMA', GEM: 'GEM', UKMO: 'UKMO',
    AROME: 'ARM', METEOFRANCE: 'METE',
  };
  return map[name] || name.slice(0, 4);
}

/**
 * Count ensemble members landing in a bracket.
 *
 * Previously an inline IIFE inside BracketAnalysisPanel JSX (lines 549-565).
 * Extracted for readability and testability.
 */
export function countEnsembleMembersInBracket(
  members: number[],
  threshold: { type: string; value: number; high?: number },
): { count: number; total: number; pct: string } {
  const val = threshold.value;
  let lo: number, hi: number;

  if (threshold.type === 'below') {
    lo = -999;
    hi = val + 0.5;
  } else if (threshold.type === 'above') {
    lo = val - 0.5;
    hi = 999;
  } else if (threshold.type === 'range') {
    lo = val - 0.5;
    hi = (threshold.high ?? val) + 0.5;
  } else {
    lo = val - 0.5;
    hi = val + 0.5;
  }

  const count = members.filter((m) => m >= lo && m < hi).length;
  return {
    count,
    total: members.length,
    pct: ((count / members.length) * 100).toFixed(0),
  };
}
