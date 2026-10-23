'use strict';

const { requestJson } = require('../util/http');
const { signParams, timestamp } = require('../util/sign');
const logger = require('../logger');

/**
 * 京东联盟 jd.union.open.goods.query
 * 需要：appKey / appSecret（联盟后台的 App Key、App Secret）。
 * 返回结构里 result 是一段 JSON 字符串，要二次 parse。
 */
const SORT_MAP = {
  renqi: { sortName: 'inOrderCount30Days', sort: 'desc' },
  xiaoliang: { sortName: 'inOrderCount30DaysSku', sort: 'desc' },
  jiage: { sortName: 'price', sort: 'asc' }
};

function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http')) return u;
  return 'https://' + u.replace(/^\/+/, '');
}

module.exports = {
  name: 'jd',
  platform: 'jd',
  enabled(cfg) {
    return Boolean(cfg.providers.jd && cfg.providers.jd.enabled) && cfg.mode !== 'mock';
  },
  ready(cfg) {
    const p = cfg.providers.jd || {};
    return Boolean(p.appKey && p.appSecret);
  },
  async search(keyword, opts = {}, cfg) {
    const p = cfg.providers.jd;
    const sortCfg = SORT_MAP[opts.sort] || SORT_MAP.renqi;
    const biz = {
      goodsReqDTO: {
        keyword: keyword,
        pageIndex: Math.max(1, Number(opts.page) || 1),
        pageSize: Math.min(Number(opts.limit) || p.pageSize || 20, 50),
        sortName: sortCfg.sortName,
        sort: sortCfg.sort,
        owner: 'g',
        isCoupon: 1
      }
    };
    const params = {
      method: 'jd.union.open.goods.query',
      app_key: p.appKey,
      timestamp: timestamp(),
      format: 'json',
      v: '1.0',
      sign_method: 'md5',
      '360buy_param_json': JSON.stringify(biz)
    };
    params.sign = signParams(params, p.appSecret);

    const url = p.endpoint + '?' + new URLSearchParams(params).toString();
    const json = await requestJson(url, { timeout: cfg.requestTimeoutMs || 8000 });
    if (json.error_response) {
      throw new Error(`京东联盟: ${json.error_response.zh_desc || json.error_response.code || '未知错误'}`);
    }
    const raw = json.jd_union_open_goods_query_response;
    if (!raw) throw new Error('京东联盟: 响应缺少 jd_union_open_goods_query_response');
    let payload = raw.result;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        throw new Error('京东联盟: result 字段解析失败');
      }
    }
    if (payload && payload.code && Number(payload.code) !== 200) {
      throw new Error(`京东联盟: ${payload.message || payload.code}`);
    }
    const list = (payload && payload.data) || [];
    logger.debug(`京东联盟返回 ${list.length} 条`);

    return list.map((it) => {
      const priceInfo = it.priceInfo || {};
      const couponInfo = it.couponInfo || {};
      const coupons = (couponInfo.couponList || []).slice().sort((a, b) => (b.discount || 0) - (a.discount || 0));
      const best = coupons[0] || {};
      const images = (it.imageInfo && it.imageInfo.imageList) || [];
      return {
        platform: 'jd',
        channel: '',
        id: String(it.skuId || ''),
        title: it.skuName,
        price: priceInfo.lowestPrice || priceInfo.price,
        originPrice: priceInfo.price,
        coupon: best.discount,
        couponThreshold: best.quota,
        couponDesc: best.discount ? `满${best.quota || ''}减${best.discount}` : '',
        couponStart: best.beginTime,
        couponEnd: best.endTime,
        shop: (it.shopInfo && it.shopInfo.shopName) || '',
        sales: it.inOrderCount30Days,
        salesText: it.inOrderCount30Days ? String(it.inOrderCount30Days) : '',
        image: images[0] ? absUrl(images[0].url) : '',
        url: it.materialUrl ? absUrl(it.materialUrl) : (it.skuId ? `https://item.jd.com/${it.skuId}.html` : ''),
        source: 'api'
      };
    });
  }
};
