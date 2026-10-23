'use strict';

const { requestJson, qs } = require('../util/http');
const { signParams, timestamp } = require('../util/sign');
const logger = require('../logger');

/**
 * 唯品会（含 vipglobal.hk 全球购）走联盟网关。
 * 各家联盟字段命名不统一，这里按别名表取值，网关换实现不用改适配器。
 * 配置：providers.vip.{appKey, appSecret, endpoint}
 */
const SORT_MAP = { renqi: 'sales_desc', xiaoliang: 'sales_desc', jiage: 'price_asc' };

function pickField(obj, names) {
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return '';
}

function extractList(json) {
  if (!json || typeof json !== 'object') return [];
  const candidates = [
    json.data && json.data.list,
    json.data && json.data.items,
    json.data && json.data.goodsList,
    json.result && json.result.goods_list,
    json.result && json.result.list,
    json.goods_list,
    json.list
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

module.exports = {
  name: 'vip',
  platform: 'vip',
  enabled(cfg) {
    return Boolean(cfg.providers.vip && cfg.providers.vip.enabled) && cfg.mode !== 'mock';
  },
  ready(cfg) {
    const p = cfg.providers.vip || {};
    return Boolean(p.appKey && p.appSecret && p.endpoint);
  },
  async search(keyword, opts = {}, cfg) {
    const p = cfg.providers.vip;
    const params = {
      method: 'vip.goods.search',
      app_key: p.appKey,
      timestamp: String(Math.floor(Date.now() / 1000)),
      format: 'json',
      v: '1.0',
      keyword: keyword,
      page: Math.max(1, Number(opts.page) || 1),
      page_size: Math.min(Number(opts.limit) || p.pageSize || 20, 100),
      sort: SORT_MAP[opts.sort] || SORT_MAP.renqi
    };
    params.sign = signParams(params, p.appSecret);

    const url = p.endpoint + (p.endpoint.includes('?') ? '&' : '?') + qs(params);
    const json = await requestJson(url, { timeout: cfg.requestTimeoutMs || 8000 });
    if (json.error_response) {
      throw new Error(`唯品会网关: ${json.error_response.message || json.error_response.code || '未知错误'}`);
    }
    const list = extractList(json);
    logger.debug(`唯品会网关返回 ${list.length} 条`);

    return list.map((it) => ({
      platform: 'vip',
      channel: '',
      id: String(pickField(it, ['goodsId', 'productId', 'pid', 'id', 'goods_id'])),
      title: pickField(it, ['goodsName', 'productName', 'title', 'name', 'goods_name']),
      price: pickField(it, ['vipPrice', 'salePrice', 'finalPrice', 'discountPrice', 'price']),
      originPrice: pickField(it, ['marketPrice', 'originPrice', 'retailPrice', 'listPrice']),
      coupon: pickField(it, ['couponAmount', 'couponMoney', 'coupon', 'coupon_money']),
      couponThreshold: pickField(it, ['couponThreshold', 'couponMinOrderAmount', 'coupon_min_order_amount']),
      couponDesc: '',
      couponStart: pickField(it, ['couponStartTime', 'coupon_start_time']),
      couponEnd: pickField(it, ['couponEndTime', 'coupon_end_time']),
      shop: pickField(it, ['shopName', 'storeName', 'brandName', 'mall']),
      sales: pickField(it, ['sales', 'salesCount', 'sellCount', 'sale_count']),
      salesText: pickField(it, ['salesText', 'sales_tip']),
      image: pickField(it, ['image', 'imageUrl', 'mainImage', 'goodsImage', 'pic']),
      url: pickField(it, ['url', 'link', 'goodsUrl', 'detailUrl', 'shareUrl']),
      source: 'api'
    }));
  }
};
