'use strict';

const core = require('../../userscript/src/core.js');

/**
 * 隐藏券汇总：同平台同面额同门槛视为同一张券，只留一张。
 * rate = 券面额 / 商品价，用来排「哪张券最值」。
 */
function build(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it.coupon || it.coupon <= 0) continue;
    const key = [it.platform, it.coupon, it.couponThreshold].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: it.platform,
      platformName: it.platformName,
      channel: it.channel || '',
      amount: it.coupon,
      threshold: it.couponThreshold || 0,
      desc: it.couponDesc || `满${it.couponThreshold || ''}减${it.coupon}`,
      start: it.couponStart || '',
      end: it.couponEnd || '',
      price: it.price,
      finalPrice: it.finalPrice,
      rate: it.price ? core.round2((it.coupon / it.price) * 100) : 0,
      title: it.title,
      url: it.url,
      shop: it.shop || '',
      mock: Boolean(it.mock)
    });
  }
  // 先按面额，再按折扣率：100 减 20 比 50 减 15 更值得先看
  return out.sort((a, b) => b.amount - a.amount || b.rate - a.rate);
}

module.exports = { build };
