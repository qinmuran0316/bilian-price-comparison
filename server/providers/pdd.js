'use strict';

const { requestJson } = require('../util/http');
const { signParams } = require('../util/sign');
const logger = require('../logger');

/**
 * 多多进宝 pdd.ddk.goods.search
 * 需要：clientId / clientSecret / pid。
 * 注意：拼多多金额单位是「分」，全部除以 100。
 */
const SORT_MAP = { renqi: 0, xiaoliang: 1, jiage: 2 };

function fen(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n) / 100 : 0;
}

module.exports = {
  name: 'pdd',
  platform: 'pdd',
  enabled(cfg) {
    return Boolean(cfg.providers.pdd && cfg.providers.pdd.enabled) && cfg.mode !== 'mock';
  },
  ready(cfg) {
    const p = cfg.providers.pdd || {};
    return Boolean(p.clientId && p.clientSecret);
  },
  async search(keyword, opts = {}, cfg) {
    const p = cfg.providers.pdd;
    const params = {
      type: 'pdd.ddk.goods.search',
      client_id: p.clientId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      data_type: 'JSON',
      keyword: keyword,
      sort_type: String(SORT_MAP[opts.sort] !== undefined ? SORT_MAP[opts.sort] : 0),
      page: String(Math.max(1, Number(opts.page) || 1)),
      page_size: String(Math.min(Number(opts.limit) || p.pageSize || 20, 100)),
      pid: p.pid || ''
    };
    params.sign = signParams(params, p.clientSecret);

    const body = new URLSearchParams(params).toString();
    const json = await requestJson(p.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeout: cfg.requestTimeoutMs || 8000
    });
    if (json.error_response) {
      throw new Error(`多多进宝: ${json.error_response.error_msg || json.error_response.error_code || '未知错误'}`);
    }
    const resp = json.goods_search_response;
    const list = (resp && resp.goods_list) || [];
    logger.debug(`多多进宝返回 ${list.length} 条`);

    return list.map((it) => {
      const price = fen(it.min_group_price) || fen(it.min_normal_price);
      const coupon = fen(it.coupon_discount);
      const threshold = fen(it.coupon_min_order_amount);
      return {
        platform: 'pdd',
        channel: '',
        id: String(it.goods_id || ''),
        title: it.goods_name,
        price,
        originPrice: fen(it.min_normal_price),
        coupon,
        couponThreshold: threshold,
        couponDesc: coupon ? `满${threshold || ''}减${coupon}` : '',
        couponStart: it.coupon_start_time ? new Date(Number(it.coupon_start_time) * 1000).toISOString().slice(0, 10) : '',
        couponEnd: it.coupon_end_time ? new Date(Number(it.coupon_end_time) * 1000).toISOString().slice(0, 10) : '',
        shop: it.mall_name || '',
        sales: it.sales_tip,
        salesText: it.sales_tip || '',
        image: it.goods_image_url || it.goods_thumb_url || '',
        url: it.goods_url || (it.goods_id ? `https://mobile.yangkeduo.com/goods.html?goods_id=${it.goods_id}` : ''),
        source: 'api'
      };
    });
  }
};
