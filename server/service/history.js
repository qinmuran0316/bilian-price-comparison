'use strict';

const core = require('../../userscript/src/core.js');
const historyProvider = require('../providers/history');

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname;
  } catch (err) {
    return '';
  }
}

/**
 * 把接口入参归一成一个 key。
 * key 规则与 store / compare 一致：`platform:itemId`，没有 itemId 时用标题哈希。
 * 这样浏览器端只传 URL 也能命中同一份序列。
 */
function resolveQuery(input) {
  const body = input || {};
  const url = String(body.url || '');
  const platform = String(body.platform || core.detectPlatform(body.host || '') ||
    core.detectPlatform(hostOf(url)) || '');
  const itemId = String(body.itemId || core.extractItemId(url, platform) || '');
  const title = String(body.title || '').replace(/\s+/g, ' ').trim();
  const price = core.parsePrice(body.price);

  let key = String(body.key || '');
  if (!key && platform) {
    const tail = itemId || (title ? core.hashString(core.normalizeTitle(title)) : '');
    if (tail) key = platform + ':' + tail;
  }

  return {
    key: key,
    platform: platform,
    platformName: core.platformName(platform),
    itemId: itemId,
    title: title,
    url: url,
    price: price,
    days: body.days
  };
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

/**
 * 完整历史价：上游 + 本地 + 必要时演示铺底。
 * 这个接口会走网络，比价主流程不调用它，避免拖慢 compare。
 */
async function history(input, cfg, ctx) {
  const q = resolveQuery(input);
  if (!q.key) throw httpError('需要 key，或提供 platform + (itemId 或 title)，也可以直接给 url');

  const t0 = Date.now();
  const series = await historyProvider.getSeries(q, cfg, ctx);
  const stats = core.buildHistoryStats(series.points, q.price, series.days);
  const advice = core.historyAdvice(stats);

  return {
    ok: true,
    key: q.key,
    platform: q.platform,
    platformName: q.platformName,
    itemId: q.itemId,
    title: q.title,
    url: q.url,
    price: q.price,
    days: series.days,
    points: series.points,
    stats: stats,
    advice: advice,
    source: series.source,
    mock: series.mock,
    realPoints: series.realPoints,
    localPoints: series.localPoints,
    upstreamPoints: series.upstreamPoints,
    upstream: series.upstream,
    errors: series.errors,
    note: series.note,
    elapsedMs: Date.now() - t0,
    // 兼容旧版比价接口的字段命名
    data: {
      max: stats.min ? stats.max.price : 0,
      min: stats.min ? stats.min.price : 0,
      his: series.points.map((p) => ({
        price: p.p,
        updatetime: core.formatDate(p.t),
        ts: p.t,
        mock: Boolean(p.mock)
      }))
    }
  };
}

module.exports = { history, resolveQuery, hostOf };
