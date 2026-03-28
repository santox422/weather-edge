'use client';

import { useMemo } from 'react';
import type { Outcome, BracketProbability } from '@/types';

/**
 * useBracketHighlights — determines which brackets should be visually
 * highlighted as having the max probability in each pipeline stage
 * and which bracket has the best trading edge.
 *
 * Previously inlined as a dense useMemo block in BracketAnalysisPanel.
 */

interface HighlightInputs {
  outcomes: Outcome[];
  rawBp: BracketProbability[] | undefined;
  displayBma: BracketProbability[] | undefined;
  ensPhd: BracketProbability[] | null;
  displayBmaPhd: BracketProbability[] | undefined;
}

interface HighlightResult {
  maxEnsName: string | null;
  maxBmaName: string | null;
  maxEnsPhdName: string | null;
  maxBmaPhdName: string | null;
  bestEdgeName: string | null;
}

export function useBracketHighlights({
  outcomes,
  rawBp,
  displayBma,
  ensPhd,
  displayBmaPhd,
}: HighlightInputs): HighlightResult {
  return useMemo(() => {
    let mE = -1, mB = -1, mEP = -1, mBP = -1, bE = -Infinity;
    let eN: string | null = null, bN: string | null = null;
    let epN: string | null = null, bpN: string | null = null;
    let edgeN: string | null = null;

    for (const o of outcomes) {
      const n = o.name || o.title || '';
      const rb = rawBp?.find(p => p.name === n || p.title === n);
      const bma = displayBma?.find(p => p.name === n || p.title === n);
      const ep = ensPhd?.find(p => p.name === n || p.title === n);
      const bp = displayBmaPhd?.find(p => p.name === n || p.title === n);

      if ((rb?.forecastProb ?? -1) > mE) { mE = rb?.forecastProb ?? -1; eN = n; }
      if ((bma?.forecastProb ?? -1) > mB) { mB = bma?.forecastProb ?? -1; bN = n; }
      if ((ep?.forecastProb ?? -1) > mEP) { mEP = ep?.forecastProb ?? -1; epN = n; }
      if ((bp?.forecastProb ?? -1) > mBP) { mBP = bp?.forecastProb ?? -1; bpN = n; }

      const edge = bp?.edge ?? ((bp?.forecastProb || 0) - o.price);
      if (edge > bE) { bE = edge; edgeN = n; }
    }

    return {
      maxEnsName: eN,
      maxBmaName: bN,
      maxEnsPhdName: epN,
      maxBmaPhdName: bpN,
      bestEdgeName: edgeN,
    };
  }, [outcomes, rawBp, displayBma, ensPhd, displayBmaPhd]);
}
