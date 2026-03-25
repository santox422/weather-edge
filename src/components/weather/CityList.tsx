'use client';

import { useState, useEffect, useMemo } from 'react';
import type { MultiDayData, City, Market } from '@/types';
import { isoToFlag, fmtDateLabel } from '@/lib/helpers';

interface CityListProps {
  multiDayData: MultiDayData | null;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onAnalyzeCity: (slug: string, date: string) => void;
  currentSlug?: string;
  marketCount: number;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
}

const CITY_TZ: Record<string, string> = {
  ankara: 'Europe/Istanbul', atlanta: 'America/New_York', 'buenos-aires': 'America/Argentina/Buenos_Aires',
  chicago: 'America/Chicago', dallas: 'America/Chicago', london: 'Europe/London', miami: 'America/New_York',
  milan: 'Europe/Rome', munich: 'Europe/Berlin', nyc: 'America/New_York', paris: 'Europe/Paris',
  'sao-paulo': 'America/Sao_Paulo', seattle: 'America/Los_Angeles', seoul: 'Asia/Seoul',
  toronto: 'America/Toronto', wellington: 'Pacific/Auckland',
};

function getLocalTime(slug: string): string {
  const tz = CITY_TZ[slug];
  if (!tz) return '';
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false }).format(new Date()); } catch { return ''; }
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const WEEKDAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

export default function CityList({ multiDayData, selectedDate, onSelectDate, onAnalyzeCity, currentSlug, marketCount, sidebarOpen, onCloseSidebar }: CityListProps) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }, []);

  const cities = useMemo(() => {
    if (!multiDayData || !selectedDate) return { withMarket: [], withoutMarket: [] };
    const withMarket: (City & { activeMarket: Market })[] = [];
    const withoutMarket: City[] = [];
    for (const city of multiDayData.cities) {
      const market = city.marketsByDate?.[selectedDate];
      if (market) withMarket.push({ ...city, activeMarket: market as Market });
      else withoutMarket.push(city);
    }
    return { withMarket, withoutMarket };
  }, [multiDayData, selectedDate]);

  // Date strip
  const dateStrip = useMemo(() => {
    if (!multiDayData) return [];
    return multiDayData.dates.map(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const dayName = dateStr === today ? 'TODAY' : dateStr === yesterday ? 'YSTRDY' : WEEKDAYS[d.getDay()];
      const count = multiDayData.cities.filter(c => c.marketsByDate?.[dateStr] != null).length;
      return { dateStr, dayName, monthDay: `${MONTHS[d.getMonth()]} ${d.getDate()}`, count };
    });
  }, [multiDayData, today, yesterday]);

  return (
    <aside className={`mobile-sidebar flex flex-col overflow-hidden border-r border-[#111] bg-[#050505] ${sidebarOpen ? 'open' : ''}`}>
      <div className="section-header px-2 py-1.5 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] border-l-2 border-l-[#ff8c00] flex items-center justify-between gap-1.5">
        <span>MARKETS<span className="text-[#444]"> // {marketCount}</span></span>
        <button className="md:hidden flex items-center justify-center text-[#666] text-[18px] cursor-pointer hover:text-[#ff8c00] active:text-[#ff8c00] w-[36px] h-[36px] transition-colors" onClick={onCloseSidebar} aria-label="Close sidebar">✕</button>
      </div>

      {/* Date Strip */}
      <div className="overflow-x-auto flex-shrink-0 border-b border-[#111] bg-[#050505]">
        <div className="flex gap-0">
          {dateStrip.map(d => (
            <button
              key={d.dateStr}
              className={`flex flex-col items-center px-2 py-1 min-w-[48px] border border-[#1a1a1a] text-[8px] font-bold transition-colors cursor-pointer ${
                d.dateStr === selectedDate ? 'bg-[#ff8c00] text-black' : 'bg-[#0a0a0a] text-[#888] hover:bg-[#111] hover:text-[#ccc]'
              } ${d.count === 0 ? 'opacity-30' : ''}`}
              onClick={() => onSelectDate(d.dateStr)}
            >
              <span className="uppercase tracking-wider">{d.dayName}</span>
              <span className="text-[9px]">{d.monthDay}</span>
              {d.count > 0 && (
                <span className={`text-[7px] mt-[1px] ${d.dateStr === selectedDate ? 'text-black/60' : 'text-[#ff8c00]'}`}>{d.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* City List */}
      <div className="flex-1 overflow-y-auto">
        {!multiDayData ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[#ff8c00] text-[10px] font-bold animate-pulse">[SCANNING...]</span>
          </div>
        ) : (
          <>
            {cities.withMarket.length > 0 && (
              <>
                <div className="px-2 py-[3px] text-[7px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#050505] border-b border-[#111]">
                  ACTIVE // {fmtDateLabel(selectedDate!)}
                </div>
                {cities.withMarket.map(city => (
                  <CityRow
                    key={city.slug}
                    city={city}
                    hasData
                    dateStr={selectedDate!}
                    selected={city.slug === currentSlug}
                    onAnalyze={onAnalyzeCity}
                  />
                ))}
              </>
            )}
            {cities.withoutMarket.length > 0 && (
              <>
                <div className="px-2 py-[3px] text-[7px] font-bold text-[#333] uppercase tracking-[0.15em] bg-[#050505] border-b border-[#111]">
                  NO MARKET
                </div>
                {cities.withoutMarket.map(city => (
                  <CityRow
                    key={city.slug}
                    city={city}
                    hasData={false}
                    dateStr={selectedDate!}
                    selected={false}
                    onAnalyze={onAnalyzeCity}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function CityRow({ city, hasData, dateStr, selected, onAnalyze }: {
  city: City & { activeMarket?: Market | null };
  hasData: boolean;
  dateStr: string;
  selected: boolean;
  onAnalyze: (slug: string, date: string) => void;
}) {
  const d = new Date(dateStr + 'T12:00:00');
  const dateDisplay = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const localTime = getLocalTime(city.slug);
  const outcomeCount = city.activeMarket?.outcomes?.length || 0;

  return (
    <div
      className={`city-row flex items-center justify-between px-2 py-[4px] border-b border-[#0a0a0a] cursor-pointer transition-colors ${
        hasData ? 'hover:bg-[#0a0a0a]' : 'opacity-40'
      } ${selected ? 'selected' : ''}`}
      onClick={() => onAnalyze(city.slug, dateStr)}
    >
      <div className="flex items-center gap-1.5 overflow-hidden">
        <span className="text-[12px]">{isoToFlag(city.country)}</span>
        <span className="text-[10px] text-[#ccc] font-semibold truncate">{city.name}</span>
        <span className="text-[8px] text-[#ff8c00] font-bold">{dateDisplay}</span>
        {localTime && <span className="text-[8px] text-[#333]">{localTime}</span>}
        <span className="text-[8px] text-[#444]">{hasData ? outcomeCount + ' OC' : '—'}</span>
      </div>
      <a
        href={city.polymarketUrl || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-[#333] hover:text-[#ff8c00] no-underline"
        onClick={(e) => e.stopPropagation()}
      >↗</a>
    </div>
  );
}
