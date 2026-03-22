/**
 * City list, date strip, data loading, and analysis trigger.
 */
import { $, setStatus, fmtDateLabel, isoToFlag, esc } from './helpers.js';
import { renderAnalysis } from './analysis-view.js';
import { subscribeToTokens } from './websocket.js';
import { state } from '../main.js';

// ─── Load multi-day market data ───────────────────────────────
export async function loadMultiDay() {
  setStatus('loading', 'SCANNING...');
  $('city-list').innerHTML = `<div class="flex items-center justify-center py-8"><span class="text-[#ff8c00] text-[10px] font-bold animate-pulse">[SCANNING MARKETS...]</span></div>`;
  $('date-strip').innerHTML = '';

  try {
    const res = await fetch('/api/cities-multiday');
    if (!res.ok) throw new Error(`API ${res.status}`);
    state.multiDayData = await res.json();
    state.selectedDate = state.multiDayData.dates[1] || state.multiDayData.dates[0];

    const totalMarkets = state.multiDayData.cities.reduce(
      (sum, c) => sum + Object.values(c.marketsByDate).filter(Boolean).length, 0
    );
    $('market-count').textContent = ` // ${totalMarkets}`;
    setStatus('live', `${totalMarkets} MKTS / ${state.multiDayData.dates.length}D`);

    renderDateStrip();
    renderCityListForDate(state.selectedDate);
  } catch (err) {
    setStatus('error', 'OFFLINE');
    $('city-list').innerHTML = `<div class="flex items-center justify-center py-8"><span class="text-[#ff3333] text-[10px]">[ERROR] Server unreachable on port 3001</span></div>`;
  }
}

export async function refreshAnalysis() {
  if (!state.currentAnalysis) return;
  try {
    const res = await fetch(`/api/analyze/${state.currentAnalysis.slug}/${state.currentAnalysis.date}?fresh=1`);
    if (!res.ok) return;
    const data = await res.json();
    const city = state.multiDayData?.cities?.find((c) => c.slug === state.currentAnalysis.slug);
    const market = city?.marketsByDate?.[state.currentAnalysis.date];
    
    // CRITICAL: Update global state so websocket price ticks don't revert to old data!
    state.lastAnalysisData = data;
    
    renderAnalysis(data, city, market);
  } catch { /* silent */ }
}

// ─── Date strip ───────────────────────────────────────────────
function renderDateStrip() {
  const strip = $('date-strip');
  if (!state.multiDayData) return;

  const today = new Date().toISOString().split('T')[0];
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  strip.innerHTML = state.multiDayData.dates.map((dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const dayName = dateStr === today ? 'TODAY' : dateStr === yesterday ? 'YSTRDY' : weekdays[d.getDay()];
    const dayNum = d.getDate();
    const monthName = months[d.getMonth()];
    const isActive = dateStr === state.selectedDate;
    const confirmedCount = state.multiDayData.cities.filter((c) => c.marketsByDate[dateStr] != null).length;

    const activeCls = isActive ? 'bg-[#ff8c00] text-black' : 'bg-[#0a0a0a] text-[#888] hover:bg-[#111] hover:text-[#ccc]';
    const emptyCls = confirmedCount === 0 ? 'opacity-30' : '';

    return `<button class="flex flex-col items-center px-2 py-1 min-w-[48px] border border-[#1a1a1a] text-[8px] font-bold transition-colors cursor-pointer ${activeCls} ${emptyCls}" data-date="${dateStr}" onclick="selectDate('${dateStr}')">
      <span class="uppercase tracking-wider">${dayName}</span>
      <span class="text-[9px]">${monthName} ${dayNum}</span>
      ${confirmedCount > 0 ? `<span class="text-[7px] mt-[1px] ${isActive ? 'text-black/60' : 'text-[#ff8c00]'}">${confirmedCount}</span>` : ''}
    </button>`;
  }).join('');
}

window.selectDate = function (dateStr) {
  state.selectedDate = dateStr;
  document.querySelectorAll('[data-date]').forEach((btn) => {
    const isActive = btn.dataset.date === dateStr;
    btn.className = btn.className
      .replace(/bg-\[#ff8c00\] text-black/g, '')
      .replace(/bg-\[#0a0a0a\] text-\[#888\] hover:bg-\[#111\] hover:text-\[#ccc\]/g, '');
    if (isActive) {
      btn.classList.add('bg-[#ff8c00]', 'text-black');
    } else {
      btn.classList.add('bg-[#0a0a0a]', 'text-[#888]', 'hover:bg-[#111]', 'hover:text-[#ccc]');
    }
  });
  renderCityListForDate(dateStr);
  $('placeholder').style.display = 'flex';
  $('analysis-content').style.display = 'none';
  $('col-right').style.display = 'none';
  $('inst-name').textContent = '—';
  document.querySelectorAll('.city-row').forEach((r) => r.classList.remove('selected'));
};

// ─── City list ────────────────────────────────────────────────
function renderCityListForDate(dateStr) {
  const list = $('city-list');
  if (!state.multiDayData) return;

  const citiesWithMarket = [];
  const citiesWithout = [];

  for (const city of state.multiDayData.cities) {
    const market = city.marketsByDate[dateStr];
    if (market) citiesWithMarket.push({ ...city, activeMarket: market });
    else citiesWithout.push({ ...city, activeMarket: null });
  }

  let html = '';
  if (citiesWithMarket.length > 0) {
    html += `<div class="px-2 py-[3px] text-[7px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#050505] border-b border-[#111]">ACTIVE // ${fmtDateLabel(dateStr)}</div>`;
    html += citiesWithMarket.map((c) => cityRow(c, true, dateStr)).join('');
  }
  if (citiesWithout.length > 0) {
    html += `<div class="px-2 py-[3px] text-[7px] font-bold text-[#333] uppercase tracking-[0.15em] bg-[#050505] border-b border-[#111]">NO MARKET</div>`;
    html += citiesWithout.map((c) => cityRow(c, false, dateStr)).join('');
  }
  if (!html) html = '<div class="flex items-center justify-center py-8"><span class="text-[#444] text-[9px]">NO DATA</span></div>';
  list.innerHTML = html;
}

const CITY_TZ = {
  ankara: 'Europe/Istanbul', atlanta: 'America/New_York', 'buenos-aires': 'America/Argentina/Buenos_Aires',
  chicago: 'America/Chicago', dallas: 'America/Chicago', london: 'Europe/London', miami: 'America/New_York',
  milan: 'Europe/Rome', munich: 'Europe/Berlin', nyc: 'America/New_York', paris: 'Europe/Paris',
  'sao-paulo': 'America/Sao_Paulo', seattle: 'America/Los_Angeles', seoul: 'Asia/Seoul',
  toronto: 'America/Toronto', wellington: 'Pacific/Auckland',
};

function getLocalTime(slug) {
  const tz = CITY_TZ[slug];
  if (!tz) return '';
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false }).format(new Date()); } catch { return ''; }
}

function cityRow(city, hasData, dateStr) {
  const m = city.activeMarket;
  const url = m?.polymarketUrl || buildPolymarketUrl(city.slug, dateStr);
  const outcomeCount = m?.outcomes?.length || 0;
  const localTime = getLocalTime(city.slug);

  // Format the date for display (e.g. "MAR 22")
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateDisplay = `${months[d.getMonth()]} ${d.getDate()}`;

  const rowCls = hasData
    ? 'flex items-center justify-between px-2 py-[4px] border-b border-[#0a0a0a] cursor-pointer hover:bg-[#0a0a0a] transition-colors'
    : 'flex items-center justify-between px-2 py-[4px] border-b border-[#0a0a0a] cursor-pointer opacity-40';

  return `<div class="city-row ${rowCls}" data-slug="${city.slug}" onclick="analyzeCity('${city.slug}', '${dateStr}')">
    <div class="flex items-center gap-1.5 overflow-hidden">
      <span class="text-[12px]">${isoToFlag(city.country)}</span>
      <span class="text-[10px] text-[#ccc] font-semibold truncate">${city.name}</span>
      <span class="text-[8px] text-[#ff8c00] font-bold">${dateDisplay}</span>
      ${localTime ? `<span class="text-[8px] text-[#333]">${localTime}</span>` : ''}
      <span class="text-[8px] text-[#444]">${hasData ? outcomeCount + ' OC' : '—'}</span>
    </div>
    <a href="${url}" target="_blank" class="text-[10px] text-[#333] hover:text-[#ff8c00] no-underline" onclick="event.stopPropagation()">↗</a>
  </div>`;
}

function buildPolymarketUrl(slug, dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  return `https://polymarket.com/event/highest-temperature-in-${slug}-on-${months[d.getMonth()]}-${d.getDate()}-${d.getFullYear()}`;
}

// ─── Analyze city ─────────────────────────────────────────────
window.analyzeCity = async function (slug, dateStr) {
  dateStr = dateStr || state.selectedDate;
  state.currentAnalysis = { slug, date: dateStr };

  document.querySelectorAll('.city-row').forEach((r) => r.classList.remove('selected'));
  const row = document.querySelector(`.city-row[data-slug="${slug}"]`);
  if (row) row.classList.add('selected');

  $('placeholder').style.display = 'none';
  $('analysis-content').style.display = 'block';
  $('col-right').style.display = 'flex';
  $('col-center').scrollTop = 0;

  const city = state.multiDayData?.cities?.find((c) => c.slug === slug);
  const market = city?.marketsByDate?.[dateStr];

  const cityName = (city?.name || slug).toUpperCase();
  const dateLabel = fmtDateLabel(dateStr);
  $('inst-name').textContent = `${cityName} // ${dateLabel} // TEMP`;
  const mobileInst = $('inst-name-mobile');
  if (mobileInst) {
    mobileInst.textContent = `${cityName} // ${dateLabel}`;
    $('mobile-inst-bar').style.display = '';
  }

  $('edge-grid').innerHTML = `<div class="flex flex-col items-center justify-center py-8"><span class="text-[#ff8c00] text-[10px] font-bold animate-pulse">[RUNNING ANALYSIS...]</span><span class="text-[#333] text-[9px]">Fetching GFS, ECMWF, ICON, JMA, GEM, ensemble data...</span></div>`;
  $('outcomes-list').innerHTML = '';
  $('model-bars').innerHTML = '';
  $('reasoning-text').textContent = '';
  $('card-divergence').style.display = 'none';
  $('baserate-text').textContent = '';
  $('atmospheric-grid').innerHTML = '';
  $('skill-metrics').innerHTML = '';
  $('airquality-grid').innerHTML = '';
  $('strategy-panel').innerHTML = '';
  $('panel-strategy').parentElement.style.display = '';
  $('ticker-feed').innerHTML = '<span class="ticker-placeholder text-[#333] text-[9px]">Waiting for price data...</span>';

  try {
    const res = await fetch(`/api/analyze/${slug}/${dateStr}`);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.status); }
    const data = await res.json();
    state.lastAnalysisData = data;
    renderAnalysis(data, city, market);
    subscribeToTokens(data);
  } catch (err) {
    $('edge-grid').innerHTML = `<div class="flex items-center justify-center py-8"><span class="text-[#ff3333] text-[10px]">[ERROR] ${esc(err.message)}</span></div>`;
  }
};
