// week.js：周日期、天气解析、季节阈值、搭配排序、天气缓存
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ymd, weekDates, dayLabel, parseForecast, seasonsForTemp, weatherIcon, rankOutfits, upcomingPlansUsing, forecastUrl, loadWeather, fakeForecastJson } from '../week.js';
import { emptySlots } from '../outfit.js';

test('weekDates：周一到周日；今天是周日时下周从明天开始', () => {
  const sun = new Date(2026, 9, 18); // 周日
  assert.deepEqual(weekDates(sun, 0), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(weekDates(sun, 1)[0], '2026-10-19');
  const mon = new Date(2026, 9, 19, 23, 30);
  assert.equal(weekDates(mon, 0)[0], '2026-10-19');
  assert.equal(weekDates(mon, 1)[0], '2026-10-26');
});

test('weekDates：跨月、跨年、夏令时切换那周（10-25 只有 25 小时）都是连续 7 天', () => {
  const dst = weekDates(new Date(2026, 9, 21), 0);
  assert.deepEqual(dst, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.deepEqual(weekDates(new Date(2026, 9, 25), 1), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(weekDates(new Date(2026, 11, 30), 0), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(ymd(new Date(2026, 2, 29)), '2026-03-29');
});

test('dayLabel', () => {
  assert.deepEqual(dayLabel('2026-10-19'), { weekday: '周一', md: '10/19' });
  assert.deepEqual(dayLabel('2026-11-01'), { weekday: '周日', md: '11/1' });
});

test('parseForecast：解析 Open-Meteo 实际返回格式（2026-10-18 巴黎），缺值的天跳过', () => {
  const json = { latitude: 48.85, daily_units: { temperature_2m_max: '°C' }, daily: {
    time: ['2026-10-18', '2026-10-19', '2026-10-20'],
    weather_code: [80, 61, null], temperature_2m_max: [13.3, 14.0, null], temperature_2m_min: [6.7, 5.7, null],
    precipitation_probability_max: [20, 53, null],
  } };
  assert.deepEqual(parseForecast(json), {
    '2026-10-18': { code: 80, max: 13.3, min: 6.7, rain: 20 },
    '2026-10-19': { code: 61, max: 14, min: 5.7, rain: 53 },
  });
  assert.throws(() => parseForecast({ error: true }), /格式不对/);
});

test('seasonsForTemp：最高温 ≥ 24 夏，< 12 冬，其余春秋', () => {
  assert.deepEqual(seasonsForTemp(24), ['夏']);
  assert.deepEqual(seasonsForTemp(23.9), ['春', '秋']);
  assert.deepEqual(seasonsForTemp(12), ['春', '秋']);
  assert.deepEqual(seasonsForTemp(11.9), ['冬']);
});

test('weatherIcon：WMO 代码分组', () => {
  assert.equal(weatherIcon(0).text, '晴');
  assert.equal(weatherIcon(61).text, '雨');
  assert.equal(weatherIcon(80).text, '雨');
  assert.equal(weatherIcon(73).text, '雪');
  assert.equal(weatherIcon(95).text, '雷雨');
  assert.equal(weatherIcon(null).icon, '🌡️');
});

test('rankOutfits：适合在前，没有季节信息居中，不合适在后，同组保持顺序', () => {
  const items = new Map([
    ['tee', { id: 'tee', seasons: ['夏'], archived: false }],
    ['coat', { id: 'coat', seasons: ['冬'], archived: false }],
    ['shirt', { id: 'shirt', seasons: ['春', '秋'], archived: false }],
    ['bare', { id: 'bare', seasons: [], archived: false }],
  ]);
  const o = (id, top) => ({ id, slots: { ...emptySlots(), top } });
  const outfits = [o('summer', 'tee'), o('none', 'bare'), o('winter', 'coat'), o('autumn', 'shirt'), o('gone', 'deleted')];
  const r = rankOutfits(outfits, ['春', '秋'], items);
  assert.deepEqual(r.map((x) => `${x.outfit.id}:${x.fit}`), ['autumn:yes', 'none:unknown', 'gone:unknown', 'summer:no', 'winter:no']);
  assert.deepEqual(rankOutfits(outfits, ['夏'], items)[0], { outfit: outfits[0], fit: 'yes' });
});

test('upcomingPlansUsing：只算今天及以后，按日期排序', () => {
  const plans = [
    { date: '2026-10-21', outfitId: 'a' }, { date: '2026-10-17', outfitId: 'a' },
    { date: '2026-10-18', outfitId: 'a' }, { date: '2026-10-19', outfitId: 'b' },
  ];
  assert.deepEqual(upcomingPlansUsing('a', plans, '2026-10-18').map((p) => p.date), ['2026-10-18', '2026-10-21']);
});

test('forecastUrl：巴黎坐标、16 天、四个每日字段', () => {
  const u = new URL(forecastUrl());
  assert.equal(u.host, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '48.8566');
  assert.equal(u.searchParams.get('timezone'), 'Europe/Paris');
  assert.equal(u.searchParams.get('forecast_days'), '16');
  assert.equal(u.searchParams.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
});

// 内存里的假 store（只有 getDevice / setDevice）
const fakeStore = (device = {}) => ({ device, getDevice: async function () { return this.device; }, setDevice: async function (p) { this.device = { ...this.device, ...p }; } });

test('loadWeather：缓存 3 小时内直接用；过期重新取并保存；失败时用旧缓存并标 stale；没缓存时 days 为 null', async () => {
  const now = new Date(2026, 9, 18, 12);
  const s = fakeStore();
  const a = await loadWeather(s, { fake: '1', now });
  assert.equal(a.stale, false);
  assert.equal(a.days['2026-10-20'].max, 26);
  assert.equal(s.device.weather.fetchedAt, now.getTime());

  const cached = { fetchedAt: now.getTime() - 3600e3, days: { '2026-10-18': { code: 0, max: 1, min: 0, rain: 0 } } };
  const b = await loadWeather(fakeStore({ weather: cached }), { fake: 'fail', now });
  assert.deepEqual(b, { ...cached, stale: false }); // 没过期，不请求

  const old = { ...cached, fetchedAt: now.getTime() - 4 * 3600e3 };
  const c = await loadWeather(fakeStore({ weather: old, noWebgpu: true }), { fake: 'fail', now });
  assert.deepEqual(c, { ...old, stale: true });

  const d = await loadWeather(fakeStore(), { fake: 'fail', now });
  assert.deepEqual(d, { days: null, fetchedAt: null, stale: true });

  // 刷新后不丢 device 里的其他设置
  const e = fakeStore({ weather: old, noWebgpu: true });
  await loadWeather(e, { fake: '1', now });
  assert.equal(e.device.noWebgpu, true);
  assert.equal(Object.keys(fakeForecastJson(now).daily.time).length, 16);
});
