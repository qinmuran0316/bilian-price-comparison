/** 后端通讯：GM_xmlhttpRequest 跨域，无 GM 时退回 fetch */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.api = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var DEFAULT_BASE = 'http://127.0.0.1:8787';
  var base = DEFAULT_BASE;
  var timeout = 15000;

  // 脚本只服务于本机聚合服务，限制回环地址，避免被改成远端地址后悄悄外发浏览数据
  function isLoopback(url) {
    try {
      var host = new URL(String(url || '')).hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch (err) {
      return false;
    }
  }

  function setBase(url) {
    var next = String(url || '').replace(/\/+$/, '');
    base = isLoopback(next) ? next : DEFAULT_BASE;
  }

  function full(path) {
    return /^https?:\/\//.test(path) ? path : base + path;
  }

  function parse(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function gmRequest(url, options) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest 不可用'));
        return;
      }
      var timer = setTimeout(function () {
        reject(new Error('请求超时，后端没响应'));
      }, timeout + 2000);
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: url,
        headers: Object.assign({ 'Accept': 'application/json' }, options.headers || {}),
        data: options.body,
        timeout: timeout,
        onload: function (res) {
          clearTimeout(timer);
          var json = parse(res.responseText);
          if (res.status >= 200 && res.status < 300 && json) resolve(json);
          else reject(new Error((json && json.error) || ('HTTP ' + res.status)));
        },
        onerror: function () {
          clearTimeout(timer);
          reject(new Error('连不上后端，检查服务是否启动'));
        },
        ontimeout: function () {
          clearTimeout(timer);
          reject(new Error('请求超时'));
        }
      });
    });
  }

  function fetchRequest(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, timeout);
    return fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      body: options.body,
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.json();
    }).then(function (json) {
      if (json && json.ok === false) throw new Error(json.error || '接口返回失败');
      return json;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function request(path, options) {
    var opts = options || {};
    var url = full(path);
    if (typeof GM_xmlhttpRequest === 'function') return gmRequest(url, opts);
    return fetchRequest(url, opts);
  }

  function get(path, params) {
    var qs = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return request(path + (qs.length ? (path.indexOf('?') >= 0 ? '&' : '?') + qs.join('&') : ''), { method: 'GET' });
  }

  function post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  return {
    setBase: setBase,
    isLoopback: isLoopback,
    getBase: function () { return base; },
    setTimeout: function (ms) { timeout = ms; },
    health: function () { return get('/api/health'); },
    search: function (params) { return get('/api/search', params); },
    compare: function (item) { return post('/api/compare', item); },
    collect: function (item) { return post('/api/collect', item); },
    /**
     * 历史价：传 key 字符串走兼容模式，传对象则带上 url/platform/title，后端自己算 key。
     * 传 url 最准 —— 商品 id 能从链接里直接提出来。
     */
    history: function (query, days) {
      var q = typeof query === 'string' ? { key: query } : Object.assign({}, query || {});
      if (days) q.days = days;
      return get('/api/history', q);
    }
  };
});
