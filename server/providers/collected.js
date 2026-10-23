'use strict';

const core = require('../../userscript/src/core.js');

/**
 * 采集缓存源：用户浏览商详页时脚本上报的真实价格。
 * 没有任何联盟 key 的情况下，这是唯一能拿到真实成交价的来源。
 */
module.exports = {
  name: 'collected',
  platform: 'multi',
  enabled(cfg) {
    return !cfg.providers.collected || cfg.providers.collected.enabled !== false;
  },
  ready() {
    return true;
  },
  async search(keyword, opts = {}, cfg, ctx) {
    if (!ctx || !ctx.store) return [];
    const found = ctx.store.findCollected(keyword, 40);
    return found.map((x) => ({
      platform: x.platform,
      channel: x.channel || '',
      id: x.itemId || x.key,
      title: x.title,
      price: x.price,
      originPrice: x.originPrice,
      coupon: 0,
      couponThreshold: 0,
      couponDesc: '',
      shop: x.shop,
      sales: 0,
      salesText: '',
      image: x.image,
      url: x.url || core.buildSearchUrl(x.platform, keyword),
      source: 'collected',
      collectedAt: x.ts
    }));
  }
};
