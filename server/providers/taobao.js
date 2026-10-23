'use strict';

const { requestJson } = require('../util/http');
const { signParams, timestamp } = require('../util/sign');
const logger = require('../logger');

/**
 * 淘宝客 taobao.tbk.dg.material.optional
 * 淘宝/天猫同一个接口，user_type 区分：1=天猫，0=淘宝。
 * 需要：appKey / appSecret / adzoneId（推广位 PID 里的数字部分）。
 */
const SORT_MAP = {
  renqi: 'tk_total_sales',
  xiaoliang: 'total_sales_des',
  jiage: 'price_unit_asc'
};

module.exports = {
  name: 'taobao',
  platform: 'taobao',
  enabled(cfg) {
    return Boolean(cfg.providers.taobao && cfg.providers.taobao.enabled) && cfg.mode !== 'mock';
  },
  ready(cfg) {
    const p = cfg.providers.taobao || {};
    return Boolean(p.appKey && p.appSecret && p.adzoneId);
  },
  async search(keyword, opts = {}, cfg) {
    const p = cfg.providers.taobao;
    const params = {
      method: 'taobao.tbk.dg.material.optional',
      app_key: p.appKey,
      timestamp: timestamp(),
      format: 'json',
      v: '2.0',
      sign_method: 'md5',
      q: keyword,
      adzone_id: p.adzoneId,
      page_no: Math.max(1, Number(opts.page) || 1),
      page_size: Math.min(Number(opts.limit) || p.pageSize || 20, 100),
      sort: SORT_MAP[opts.sort] || SORT_MAP.renqi,
      has_coupon: 'true'
    };
    params.sign = signParams(params, p.appSecret);

    const url = p.endpoint + '?' + new URLSearchParams(params).toString();
    const json = await requestJson(url, { timeout: cfg.requestTimeoutMs || 8000 });
    if (json.error_response) {
      throw new Error(`淘宝客: ${json.error_response.sub_msg || json.error_response.msg || '未知错误'}`);
    }
    const result = json.tbk_dg_material_optional_response &&
      json.tbk_dg_material_optional_response.result_list;
    const list = (result && result.map_data) || [];
    logger.debug(`淘宝客返回 ${list.length} 条`);

    return list.map((it) => ({
      platform: Number(it.user_type) === 1 ? 'tmall' : 'taobao',
      channel: Number(it.user_type) === 1 ? '' : '',
      id: String(it.item_id || ''),
      title: it.title,
      price: it.zk_final_price,
      originPrice: it.reserve_price,
      coupon: it.coupon_amount,
      couponThreshold: it.coupon_start_fee,
      couponDesc: it.coupon_amount ? `满${it.coupon_start_fee || ''}减${it.coupon_amount}` : '',
      couponStart: it.coupon_start_time,
      couponEnd: it.coupon_end_time,
      shop: it.shop_title || '',
      sales: it.volume,
      salesText: it.volume ? String(it.volume) : '',
      image: it.pict_url ? (String(it.pict_url).startsWith('//') ? 'https:' + it.pict_url : it.pict_url) : '',
      url: it.coupon_share_url || it.url || it.item_url || '',
      source: 'api'
    }));
  }
};
