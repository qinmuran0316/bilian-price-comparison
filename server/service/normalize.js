'use strict';

const core = require('../../userscript/src/core.js');

/** 统一商品结构 + 到手价计算 + 去重 */
function finalize(raw) {
  if (!raw || !raw.title) return null;
  const platform = raw.platform || core.detectPlatform(raw.host || '');
  if (!platform) return null;
  const price = core.parsePrice(raw.price);
  if (!price) return null;
  const coupon = core.parsePrice(raw.coupon);
  const threshold = core.parsePrice(raw.couponThreshold);
  const finalPrice = core.computeFinalPrice(price, coupon, threshold);
  const originPrice = core.parsePrice(raw.originPrice);
  return {
    platform,
    platformName: core.platformName(platform),
    channel: raw.channel || '',
    id: String(raw.id || ''),
    title: String(raw.title).replace(/\s+/g, ' ').trim().slice(0, 200),
    price,
    originPrice: originPrice > price ? originPrice : 0,
    coupon: coupon || 0,
    couponThreshold: threshold || 0,
    couponDesc: raw.couponDesc || (coupon ? `满${threshold || price}减${coupon}` : ''),
    couponStart: raw.couponStart || '',
    couponEnd: raw.couponEnd || '',
    finalPrice,
    shop: raw.shop || '',
    sales: core.parseSales(raw.sales),
    salesText: raw.salesText || (raw.sales !== undefined ? String(raw.sales) : ''),
    reviews: core.parseSales(raw.reviews),
    image: raw.image || '',
    url: raw.url || '',
    source: raw.source || 'api',
    mock: Boolean(raw.mock)
  };
}

function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.platform + '|' + (item.id || core.hashString(core.normalizeTitle(item.title)));
    const prev = seen.get(key);
    if (!prev || item.finalPrice < prev.finalPrice) seen.set(key, item);
  }
  return Array.from(seen.values());
}

/** 同平台内保留最便宜的 N 条，避免一个平台刷屏 */
function pickPerPlatform(items, limit) {
  const byPlatform = new Map();
  for (const item of core.sortItems(items, 'jiage')) {
    const list = byPlatform.get(item.platform) || [];
    if (list.length < limit) list.push(item);
    byPlatform.set(item.platform, list);
  }
  return Array.from(byPlatform.values()).flat();
}

module.exports = { finalize, dedupe, pickPerPlatform };
