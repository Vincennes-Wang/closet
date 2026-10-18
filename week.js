// 下周穿搭（阶段 5）：日期、天气预报、按天气给搭配排序。纯函数可在 node 里测；存储在 store.js（plans 表），界面在 app.js。
// 日期一律用本地日期字符串 YYYY-MM-DD（用户在巴黎，设备时区即巴黎）。
import { WEATHER } from './config.js';
import { outfitSeasons } from './outfit.js';

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
// '2026-10-19' → { weekday: '周一', md: '10/19' }
export function dayLabel(s) {
  const d = parse(s);
  return { weekday: WEEKDAYS[d.getDay()], md: `${d.getMonth() + 1}/${d.getDate()}` };
}

// 周一到周日的 7 个日期。offset 0 = 本周，1 = 下周（今天是周日时，下周从明天开始）。
// 用年月日分量算，不加毫秒，避开夏令时切换那天只有 23 / 25 小时的问题
export function weekDates(today, offset = 0) {
  const monday = today.getDate() - ((today.getDay() + 6) % 7) + 7 * offset;
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(today.getFullYear(), today.getMonth(), monday + i)));
}

// Open-Meteo 每日数据 → { 'YYYY-MM-DD': { code, max, min, rain } }。缺值的天跳过
export function parseForecast(json) {
  const d = json?.daily;
  if (!Array.isArray(d?.time)) throw new Error('天气数据格式不对');
  const days = {};
  d.time.forEach((date, i) => {
    const max = d.temperature_2m_max?.[i], min = d.temperature_2m_min?.[i];
    if (typeof max !== 'number' || typeof min !== 'number') return;
    days[date] = { code: d.weather_code?.[i] ?? null, max, min, rain: d.precipitation_probability_max?.[i] ?? null };
  });
  return days;
}

// 当天最高温 → 适合的季节（和 options.js SEASONS 同名）
export function seasonsForTemp(max, { hot, cold } = WEATHER) {
  if (max >= hot) return ['夏'];
  if (max < cold) return ['冬'];
  return ['春', '秋'];
}

// WMO 天气代码（Open-Meteo 文档）→ 图标和中文
export function weatherIcon(code) {
  if (code === 0) return { icon: '☀️', text: '晴' };
  if (code === 1 || code === 2) return { icon: '🌤️', text: '少云' };
  if (code === 3) return { icon: '☁️', text: '阴' };
  if (code === 45 || code === 48) return { icon: '🌫️', text: '雾' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: '毛毛雨' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: '🌧️', text: '雨' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '🌨️', text: '雪' };
  if (code >= 95 && code <= 99) return { icon: '⛈️', text: '雷雨' };
  return { icon: '🌡️', text: '' };
}

// 搭配按当天季节排序：fit = 'yes'（搭配季节含其中之一）在前，'unknown'（没有季节信息）居中，'no' 在后。同组保持原顺序
export function rankOutfits(outfits, seasons, itemsById) {
  const order = { yes: 0, unknown: 1, no: 2 };
  return outfits.map((outfit) => {
    const s = outfitSeasons(outfit, itemsById);
    return { outfit, fit: !s.length ? 'unknown' : s.some((x) => seasons.includes(x)) ? 'yes' : 'no' };
  }).sort((a, b) => order[a.fit] - order[b.fit]);
}

// 今天及以后、排了这套搭配的计划（删除搭配前提示用）
export const upcomingPlansUsing = (outfitId, plans, today) => plans.filter((p) => p.outfitId === outfitId && p.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));

export function forecastUrl({ lat, lon, timezone } = WEATHER) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone, forecast_days: 16,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

// 测试用（?fakeWeather=1）：从 today 起 16 天，Open-Meteo 的返回格式。第 3 天热（26°，晴），其余 6–14°、有雨
export function fakeForecastJson(today) {
  const time = Array.from({ length: 16 }, (_, i) => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
  return { daily: {
    time,
    weather_code: time.map((_, i) => (i === 2 ? 0 : 61)),
    temperature_2m_max: time.map((_, i) => (i === 2 ? 26 : 14)),
    temperature_2m_min: time.map((_, i) => (i === 2 ? 17 : 6)),
    precipitation_probability_max: time.map((_, i) => (i === 2 ? 0 : 60)),
  } };
}

// 取天气：缓存（meta.device.weather = { fetchedAt, days }）不超过 maxAgeMs 直接用，否则请求。
// 返回 { days, fetchedAt, stale }（stale = 请求失败，用的是旧缓存），既没网络又没缓存时 days 为 null。
// fake：'1' 用假数据，'fail' 模拟请求失败（测试用）
export async function loadWeather(store, { fake = null, now = new Date(), force = false } = {}) {
  const cached = (await store.getDevice()).weather ?? null;
  if (!force && cached && now - cached.fetchedAt < WEATHER.maxAgeMs) return { ...cached, stale: false };
  try {
    let json;
    if (fake === 'fail') throw new Error('模拟天气请求失败');
    if (fake) json = fakeForecastJson(now);
    else {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), WEATHER.timeoutMs);
      try {
        const res = await fetch(forecastUrl(), { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
      } finally { clearTimeout(timer); }
    }
    const fresh = { fetchedAt: now.getTime(), days: parseForecast(json) };
    await store.setDevice({ weather: fresh });
    return { ...fresh, stale: false };
  } catch (err) {
    console.warn('天气获取失败', err);
    return cached ? { ...cached, stale: true } : { days: null, fetchedAt: null, stale: true };
  }
}
