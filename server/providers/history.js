'use strict';

const core = require('../../userscript/src/core.js');
const { request } = require('../util/http');
const logger = require('../logger');

const DAY_MS = core.DAY_MS;

/**
 * 历史价格数据源。
 *
 * 三种来源按优先级合并：
 *   1. 上游历史价接口（慢慢买 / 自定义 endpoint）
 *   2. 本地采集库（浏览器脚本每次上报的成交价，按天取最低）
 *   3. 演示序列（只在没有任何真实数据时铺底，响应里 mock=true）
 *
 * 上游接口格式不统一，统一在这里做归一化，业务层只认 { t, p }。
 */

function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v === null || v === undefined ? '' : v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function parseTime(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    // 秒级时间戳
    return v < 1e11 ? v * 1000 : v;
  }
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return n < 1e11 ? n * 1000 : n;
  }
  // Safari 不认 "2023-05-01 12:00:00"，替换成斜杠
  const d = new Date(s.indexOf('T') > 0 ? s : s.replace(/-/g, '/'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function pickArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  // 旧版比价接口常见格式 { data: { his: [...] } }
  if (payload.data && Array.isArray(payload.data.his)) return payload.data.his;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.list)) return payload.data.list;
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.his)) return payload.his;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.result && Array.isArray(payload.result.list)) return payload.result.list;
  return [];
}

function stripJsonp(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  // cb({...}) / callback({...}); 去掉最外层包裹
  const m = s.match(/^[A-Za-z_$][\w$.]*\s*\(([\s\S]*)\)\s*;?$/);
  return m ? m[1] : s;
}

/**
 * 归一化上游返回。价格单位默认元；有的接口给分（整数且 >= 10000），
 * 用 priceInCents 显式声明，不做启发式猜测。
 */
function normalizePayload(payload, priceInCents) {
  const arr = pickArray(payload);
  const out = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    let price = toNumber(
      row.price !== undefined ? row.price :
        row.p !== undefined ? row.p :
          row.yj !== undefined ? row.yj :
            row.value !== undefined ? row.value : row.jg
    );
    if (priceInCents) price = price / 100;
    const t = parseTime(
      row.date !== undefined ? row.date :
        row.updatetime !== undefined ? row.updatetime :
          row.time !== undefined ? row.time :
            row.dt !== undefined ? row.dt : row.day
    );
    if (!price || price <= 0 || !t) continue;
    out.push({ t: t, p: core.round2(price) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function fillTemplate(tpl, query) {
  return String(tpl || '')
    .replace(/\{url\}/g, encodeURIComponent(query.url || ''))
    .replace(/\{rawUrl\}/g, query.url || '')
    .replace(/\{platform\}/g, encodeURIComponent(query.platform || ''))
    .replace(/\{itemId\}/g, encodeURIComponent(query.itemId || ''))
    .replace(/\{title\}/g, encodeURIComponent(query.title || ''))
    .replace(/\{days\}/g, String(query.days || 180));
}

/** 慢慢买历史价接口：无需密钥，按商品 URL 查 */
async function fetchManmanbuy(query, conf, cfg) {
  if (!query.url) throw new Error('缺少商品 URL');
  const endpoint = conf.endpoint || 'https://apapia-history.manmanbuy.com/HistoryDataNew.ashx';
  const url = endpoint +
    (endpoint.indexOf('?') >= 0 ? '&' : '?') +
    'methodName=GetHistoryData&url=' + encodeURIComponent(query.url);
  const res = await request(url, {
    timeout: conf.timeoutMs || cfg.requestTimeoutMs || 8000,
    retries: 1,
    headers: Object.assign({
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://www.manmanbuy.com/',
      'X-Requested-With': 'XMLHttpRequest'
    }, conf.headers || {})
  });
  if (res.status >= 400) throw new Error('上游 HTTP ' + res.status);
  const text = stripJsonp(res.body);
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('上游返回不是 JSON: ' + text.slice(0, 120));
  }
  return normalizePayload(json, Boolean(conf.priceInCents));
}

/** 自定义历史价接口：endpoint 模板里用 {url} {platform} {itemId} {title} {days} 占位 */
async function fetchGeneric(query, conf, cfg) {
  const url = fillTemplate(conf.endpoint, query);
  if (!url) throw new Error('未配置 endpoint');
  const res = await request(url, {
    timeout: conf.timeoutMs || cfg.requestTimeoutMs || 8000,
    retries: 1,
    headers: Object.assign({ 'Accept': 'application/json' }, conf.headers || {})
  });
  if (res.status >= 400) throw new Error('上游 HTTP ' + res.status);
  let json;
  try {
    json = JSON.parse(stripJsonp(res.body));
  } catch (err) {
    throw new Error('上游返回不是 JSON: ' + res.body.slice(0, 120));
  }
  return normalizePayload(json, Boolean(conf.priceInCents));
}

function upstreamList(cfg) {
  const h = cfg.history || {};
  const list = Array.isArray(h.upstreams) ? h.upstreams : [];
  return list.filter((x) => x && x.enabled !== false);
}

/**
 * 依次尝试上游，第一个拿到数据的就停。
 * 单个源失败不影响其它源，错误收集起来放在 note 里给前端看。
 */
async function fetchUpstream(query, cfg, ctx) {
  const list = upstreamList(cfg);
  const errors = [];
  // 单个源最多等这么久，超时立刻降级，不让面板一直转圈
  const timeoutMs = Number(cfg.history.upstreamTimeoutMs) || 4500;

  for (const conf of list) {
    const cacheKey = 'his:' + conf.name + ':' + (query.key || query.url) + ':' + query.days;
    let timer = null;
    try {
      const task = ctx.cache.wrap(cacheKey, async () => {
        if (conf.type === 'manmanbuy') return fetchManmanbuy(query, conf, cfg);
        if (conf.type === 'generic') return fetchGeneric(query, conf, cfg);
        throw new Error('未知的上游类型: ' + conf.type);
      }, (cfg.history.cacheTtlMs || 1800000));

      const points = await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('上游超时(' + timeoutMs + 'ms)')), timeoutMs);
        })
      ]);
      if (points && points.length) {
        return { name: conf.name, points: points, errors: errors };
      }
      errors.push(conf.name + ': 返回空序列');
    } catch (err) {
      errors.push(conf.name + ': ' + err.message);
      logger.warn('历史源 ' + conf.name + ' 失败: ' + err.message);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { name: '', points: [], errors: errors };
}

/**
 * 确定性演示序列，锚定真实现价。
 * 同一天在大促节点（618/1111/1212）砸价，其余时间小幅波动，
 * 让曲线形态接近真实商详页，但每一分钱都是算出来的，不是抓的。
 */
function mockSeries(key, price, days) {
  const anchor = core.parsePrice(price) || 99;
  let s = core.hashString('his|' + key) >>> 0;
  const rand = function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [];
  let cur = anchor * (1.02 + rand() * 0.16);
  // 末点必须是「现在」，不能用当天 12:00 —— 上午打开会画出未来价格
  const endTs = Date.now();

  for (let i = days - 1; i >= 0; i--) {
    const ts = endTs - i * DAY_MS;
    const d = new Date(ts);
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    let drift = (rand() - 0.5) * 0.022;
    if (md === 618 || md === 1111 || md === 1212) drift -= 0.05 + rand() * 0.06;
    if (md === 315 || md === 815) drift -= 0.03 + rand() * 0.02;
    cur = cur * (1 + drift);
    // 缓慢向现价回归，避免曲线尾巴离现价太远；系数太大会把波动抹平
    cur += (anchor - cur) * 0.014;
    const p = core.round2(Math.max(1, cur));
    out.push({ t: ts, p: p, mock: true });
  }
  if (core.parsePrice(price)) {
    out[out.length - 1] = { t: endTs, p: core.round2(anchor), mock: true };
  }
  return out;
}

/** 同一天两个来源：真实数据（上游/本地）覆盖演示数据 */
function mergeSeries(real, fake) {
  const byDay = new Map();
  for (const x of fake || []) {
    byDay.set(core.dayKey(x.t), { t: x.t, p: x.p, mock: true });
  }
  for (const x of real || []) {
    byDay.set(core.dayKey(x.t), { t: x.t, p: x.p, mock: false });
  }
  return Array.from(byDay.values()).sort((a, b) => a.t - b.t);
}

/**
 * 取历史序列。
 * 返回 { points, source, mock, realPoints, errors, note }
 */
async function getSeries(query, cfg, ctx) {
  const h = cfg.history || {};
  const days = Math.max(1, Math.min(Number(h.maxDays) || 730, Number(query.days) || Number(h.days) || 180));
  const local = ctx.store.getHistory(query.key, days);

  let upstream = { name: '', points: [], errors: [] };
  if (h.enabled !== false) {
    upstream = await fetchUpstream(Object.assign({}, query, { days: days }), cfg, ctx);
  }

  const real = local.concat(upstream.points);
  const realPoints = real.length;
  let points = core.dailyMin(real);
  let mock = false;

  // 真实点不足 3 个时用演示序列铺底（live 模式不掺假数据）
  const fill = h.mockFill !== false && cfg.mode !== 'live';
  if (fill && points.length < 3) {
    points = mergeSeries(real, mockSeries(query.key, query.price, days));
    mock = true;
  }

  let source = 'local';
  if (upstream.points.length && local.length) source = 'mixed';
  else if (upstream.points.length) source = upstream.name;
  else if (!local.length) source = mock ? 'mock' : 'none';

  const note = [];
  if (mock) note.push('未接入历史源或采样不足，曲线为演示形态；每次浏览商品会自动累积真实采样');
  if (upstream.errors.length) note.push('历史源异常：' + upstream.errors.join('; '));
  if (!points.length) note.push('没有历史数据，打开商品页会自动采样');

  return {
    key: query.key,
    days: days,
    points: points,
    source: source,
    mock: mock,
    realPoints: realPoints,
    localPoints: local.length,
    upstreamPoints: upstream.points.length,
    upstream: upstream.name,
    errors: upstream.errors,
    note: note.join('；')
  };
}

function describe(cfg) {
  const h = cfg.history || {};
  if (h.enabled === false) return { enabled: false, active: [] };
  return {
    enabled: true,
    active: upstreamList(cfg).map((x) => x.name)
  };
}

module.exports = {
  name: 'history',
  getSeries,
  describe,
  mockSeries,
  normalizePayload,
  parseTime,
  mergeSeries,
  DAY_MS
};
