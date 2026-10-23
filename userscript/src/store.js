/** 配置与状态存储：优先 GM 存储，退回 localStorage */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEYS = ['apiBase', 'panelPos', 'closed', 'collapsed', 'auto', 'sort', 'tab', 'lastQuery'];
  var cache = {};
  var ready = false;

  function gmGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        var v = GM_getValue(key);
        return v === undefined ? undefined : v;
      }
    } catch (err) { /* 被沙箱拒绝就退回 localStorage */ }
    try {
      var raw = root.localStorage && root.localStorage.getItem('bl.' + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err2) {
      return undefined;
    }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (err) { /* fallthrough */ }
    // Violentmonkey / 新版管理器可能只提供异步 GM.setValue。
    // set() 保持同步 API，持久化请求在后台完成，失败时静默退回 localStorage。
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
        var pending = GM.setValue(key, value);
        if (pending && typeof pending.catch === 'function') pending.catch(function () {});
        return;
      }
    } catch (errAsync) { /* fallthrough */ }
    try {
      if (root.localStorage) root.localStorage.setItem('bl.' + key, JSON.stringify(value));
    } catch (err2) { /* 隐私模式写不进去，忽略 */ }
  }

  var DEFAULTS = {
    apiBase: 'http://127.0.0.1:8787',
    panelPos: { right: 18, top: 96 },
    closed: false,
    collapsed: false,
    auto: true,
    sort: 'renqi',
    tab: 'compare',
    lastQuery: ''
  };

  function init() {
    return new Promise(function (resolve) {
      var needAsync = (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' &&
        typeof GM_getValue !== 'function');
      if (!needAsync) {
        KEYS.forEach(function (k) {
          var v = gmGet(k);
          cache[k] = v === undefined ? DEFAULTS[k] : v;
        });
        ready = true;
        resolve(cache);
        return;
      }
      Promise.all(KEYS.map(function (k) {
        return Promise.resolve(GM.getValue(k, DEFAULTS[k])).then(function (v) {
          cache[k] = v === undefined ? DEFAULTS[k] : v;
        }).catch(function () {
          cache[k] = DEFAULTS[k];
        });
      })).then(function () {
        ready = true;
        resolve(cache);
      });
    });
  }

  function get(key) {
    if (!ready) return DEFAULTS[key];
    return cache[key] === undefined ? DEFAULTS[key] : cache[key];
  }

  function set(key, value) {
    cache[key] = value;
    gmSet(key, value);
    return value;
  }

  return { init: init, get: get, set: set, KEYS: KEYS, DEFAULTS: DEFAULTS };
});
