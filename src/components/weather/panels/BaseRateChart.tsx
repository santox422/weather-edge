'use client';

import type { AnalysisData } from '@/types';

interface BaseRateChartProps {
  data: AnalysisData;
}

export default function BaseRateChart({ data }: BaseRateChartProps) {
  const br = data.baseRate;
  if (!br?.values?.length) {
    return <div className="h-[120px] p-2 flex items-center justify-center text-[9px] text-[#333]">No historical data</div>;
  }

  const values = br.values.filter((v: number) => v != null).sort((a: number, b: number) => a - b);
  const min = Math.floor(values[0]);
  const max = Math.ceil(values[values.length - 1]);
  const range = max - min || 1;
  const bucketCount = Math.min(range + 1, 30);
  const bucketSize = range / bucketCount;
  const buckets: number[] = new Array(bucketCount).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / bucketSize), bucketCount - 1);
    buckets[idx]++;
  }
  const maxBucket = Math.max(...buckets, 1);
  const median = values[Math.floor(values.length / 2)];

  const BAR_H = 80;

  return (
    <div className="px-2 py-1">
      <div className="flex items-end gap-[1px]" style={{ height: BAR_H }}>
        {buckets.map((count: number, i: number) => {
          const pct = count / maxBucket;
          const barH = count > 0 ? Math.max(pct * BAR_H, 2) : 0;
          const temp = min + i * bucketSize;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full" title={`${temp.toFixed(0)}–${(temp + bucketSize).toFixed(0)}°C: ${count} obs`}>
              <div className="bg-[#ff8c00]/60 hover:bg-[#ff8c00] transition-colors w-full"
                style={{ height: `${barH}px` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[7px] text-[#444] mt-1">
        <span>{min}°C</span><span>MED {median.toFixed(1)}°C</span><span>{max}°C</span>
      </div>
      {br.rate != null && (
        <p className="text-[9px] text-[#888] mt-1">
          <strong className="text-[#ff8c00]">{(br.rate * 100).toFixed(0)}%</strong> exceeded threshold │{' '}
          <strong className="text-[#ccc]">{br.sampleSize}</strong> obs │ ~{br.years}y
        </p>
      )}
    </div>
  );
}
