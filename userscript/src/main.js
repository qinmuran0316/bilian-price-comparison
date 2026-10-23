/**
 * 入口：挂载面板、监听 SPA 路由、自动提取 + 比价 + 上报。
 */
(function (root) {
  'use strict';

  var BL = root.BL;
  if (!BL || !BL.core) return;
  var core = BL.core;
  var platformApi = BL.platform;
  var extractApi = BL.extract;
  var store = BL.store;
  var api = BL.api;
  var uiFactory = BL.ui;

  var state = {
    site: null,
    item: null,
    status: 'idle',
    statusText: '',
    error: '',
    result: null,
    tab: 'compare',
    keyword: '',
    sort: 'renqi',
    platform: 'all',
    searchStatus: 'idle',
    searchResult: null,
    searchError: '',
    history: null,
    historyStatus: 'idle',
    historyError: '',
    historyDays: 180,
    apiBase: '',
    auto: true,
    health: null,
    collapsed: false,
    closed: false,
    panelPos: { right: 18, top: 96 }
  };

  var ui = null;
  var reqSeq = 0;
  var searchSeq = 0;
  var historySeq = 0;
  var lastUrl = '';
  var collectCache = {};
  var extractTimer = null;
  var stopExtract = null;

  function render() {
    if (ui) ui.render(state);
  }

  function siteOf(item) {
    var platform = (item && item.platform) || core.detectPlatform(location.host);
    var channel = (item && item.channel) || core.detectChannel(location.host, location.pathname);
    return {
      platform: platform,
      platformName: core.platformName(platform),
      channel: channel
    };
  }

  // 页面全局变量（__INITIAL_STATE__ 之类）要读未沙箱的 window，否则被隔离拿不到
  var pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : root;

  function safeExtract() {
    try {
      return extractApi.extract(document, pageWindow, location.href);
    } catch (err) {
      return { ok: false, reason: err && err.message };
    }
  }

  function updateItem(item) {
    state.item = item;
    state.site = siteOf(item);
    if (state.tab === 'search' && !state.keyword) state.keyword = item.title;
    render();
  }

  function collect(item) {
    if (!item || !item.price || !item.title) return;
    var key = item.platform + '|' + (item.itemId || item.title);
    if (collectCache[key] && Date.now() - collectCache[key] < 600000) return;
    collectCache[key] = Date.now();
    api.collect({
      platform: item.platform,
      itemId: item.itemId,
      title: item.title,
      price: item.price,
      originPrice: item.originPrice,
      image: item.image,
      shop: item.shop,
      channel: item.channel,
      url: item.url,
      host: location.host,
      path: location.pathname
    }).catch(function () { /* 采集失败不影响比价 */ });
  }

  function compare() {
    if (!state.item) {
      state.status = 'error';
      state.error = '还没识别到商品，稍等页面加载完再点刷新';
      render();
      return;
    }
    var seq = ++reqSeq;
    state.status = 'loading';
    state.error = '';
    state.statusText = '';
    render();

    api.compare({
      platform: state.item.platform,
      title: state.item.title,
      price: state.item.price,
      itemId: state.item.itemId,
      image: state.item.image,
      shop: state.item.shop,
      channel: state.item.channel,
      url: state.item.url,
      host: location.host,
      path: location.pathname
    }).then(function (res) {
      if (seq !== reqSeq) return;
      state.result = res;
      state.status = 'ready';
      state.statusText = '';
      render();
    }).catch(function (err) {
      if (seq !== reqSeq) return;
      state.status = 'error';
      state.error = (err && err.message) || '比价请求失败';
      render();
    });
  }

  function search(keyword) {
    var kw = String(keyword || '').trim();
    if (!kw) {
      state.searchStatus = 'error';
      state.searchError = '先输入商品标题';
      render();
      return;
    }
    state.keyword = kw;
    state.tab = 'search';
    store.set('lastQuery', kw);
    var seq = ++searchSeq;
    state.searchStatus = 'loading';
    state.searchError = '';
    render();

    api.search({
      keyword: kw,
      sort: state.sort,
      platform: state.platform,
      limit: 20
    }).then(function (res) {
      if (seq !== searchSeq) return;
      state.searchResult = res;
      state.searchStatus = 'ready';
      render();
    }).catch(function (err) {
      if (seq !== searchSeq) return;
      state.searchStatus = 'error';
      state.searchError = (err && err.message) || '搜索失败';
      render();
    });
  }

  /**
   * 拉历史价。同一个区间已经拿过就直接用缓存，切区间或手动刷新才重新请求。
   * 请求带上 url，后端能从链接里提到商品 id，比只传标题准。
   */
  function loadHistory(days, force) {
    if (!state.item) return;
    var d = Number(days) || state.historyDays || 180;
    state.historyDays = d;
    if (!force && state.history && state.history.days === d && state.historyStatus === 'ready') {
      render();
      return;
    }
    var seq = ++historySeq;
    state.historyStatus = 'loading';
    state.historyError = '';
    render();

    api.history({
      url: state.item.url,
      platform: state.item.platform,
      itemId: state.item.itemId,
      title: state.item.title,
      price: state.item.price,
      days: d
    }).then(function (res) {
      if (seq !== historySeq) return;
      state.history = res;
      state.historyStatus = 'ready';
      render();
    }).catch(function (err) {
      if (seq !== historySeq) return;
      state.historyStatus = 'error';
      state.historyError = (err && err.message) || '历史价获取失败';
      render();
    });
  }

  function checkHealth() {
    api.health().then(function (h) {
      state.health = h;
      if (h && h.ok === false) state.health = null;
      render();
    }).catch(function () {
      state.health = null;
      render();
    });
  }

  function syncSettingsFromStore() {
    state.apiBase = store.get('apiBase');
    state.auto = store.get('auto');
    state.sort = store.get('sort') || 'renqi';
    state.tab = store.get('tab') || 'compare';
    state.collapsed = Boolean(store.get('collapsed'));
    state.closed = Boolean(store.get('closed'));
    state.panelPos = store.get('panelPos') || { right: 18, top: 96 };
    api.setBase(state.apiBase);
  }

  function mount(item) {
    if (ui) return;
    syncSettingsFromStore();
    state.site = siteOf(item);
    if (item) state.item = item;
    ui = uiFactory.mount({
      initial: state,
      onRefresh: function () {
        var fresh = safeExtract();
        if (fresh && fresh.ok) updateItem(fresh);
        state.history = null;
        compare();
        if (state.tab === 'trend') loadHistory(state.historyDays, true);
      },
      onTab: function (tab) {
        state.tab = tab;
        store.set('tab', tab);
        if (tab === 'search' && !state.keyword && state.item) state.keyword = state.item.title;
        // 走势是要额外请求的，等用户真点进来再拉，别拖慢首屏
        if (tab === 'trend' && state.item) {
          loadHistory();
          return;
        }
        render();
      },
      onRange: function (days) {
        loadHistory(days);
      },
      onHistoryRefresh: function () {
        loadHistory(state.historyDays, true);
      },
      onSearch: search,
      onSort: function (sort) {
        state.sort = sort;
        store.set('sort', sort);
        if (state.searchResult || state.keyword) search(state.keyword);
        else render();
      },
      onPlatform: function (platform) {
        state.platform = platform;
        if (state.searchResult || state.keyword) search(state.keyword);
        else render();
      },
      onCollapse: function (collapsed) {
        state.collapsed = collapsed;
        store.set('collapsed', collapsed);
        render();
      },
      onClose: function (forceOpen) {
        var closed = forceOpen === false ? false : !state.closed;
        state.closed = closed;
        store.set('closed', closed);
        render();
      },
      onSave: function (cfg) {
        var base = String(cfg.apiBase || '').replace(/\/+$/, '');
        if (!/^https?:\/\/[^\s]+$/.test(base)) {
          ui.toast('地址格式不对，要 http:// 开头');
          return;
        }
        state.apiBase = base;
        state.auto = Boolean(cfg.auto);
        store.set('apiBase', base);
        store.set('auto', state.auto);
        api.setBase(base);
        checkHealth();
        ui.toast('已保存，正在连接…');
        setTimeout(function () {
          if (state.health && state.health.ok) ui.toast('后端连接正常');
          else ui.toast('连不上，检查地址和端口');
        }, 900);
      },
      onMove: function (pos) {
        state.panelPos = pos;
        store.set('panelPos', pos);
      }
    });

    checkHealth();
    if (state.auto && state.item && state.item.price) compare();
    else render();
    if (state.tab === 'trend' && state.item) loadHistory();
  }

  /** 轮询 + DOM 变动双触发，页面异步渲染也能抓到价格 */
  function scheduleExtract(onDone) {
    if (stopExtract) stopExtract();
    if (extractTimer) {
      clearTimeout(extractTimer);
      extractTimer = null;
    }
    var attempts = 0;
    var stopped = false;
    var observer = null;
    var observerTimer = null;

    function stop() {
      if (stopped) return;
      stopped = true;
      if (extractTimer) {
        clearTimeout(extractTimer);
        extractTimer = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (observerTimer) {
        clearTimeout(observerTimer);
        observerTimer = null;
      }
      if (stopExtract === stop) stopExtract = null;
    }
    stopExtract = stop;

    function finish(item) {
      if (stopped) return;
      stop();
      onDone(item);
    }

    function tick() {
      if (stopped) return;
      var item = safeExtract();
      attempts++;
      if (item && item.ok && item.price) {
        finish(item);
        return;
      }
      if (item && item.ok && attempts >= 4) {
        // 有标题没价格：先把面板挂出来，价格留给刷新
        finish(item);
        return;
      }
      if (attempts >= 18) {
        finish(item && item.ok ? item : null);
        return;
      }
      extractTimer = setTimeout(tick, attempts < 6 ? 400 : 900);
    }

    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(function () {
        if (stopped) return;
        var item = safeExtract();
        if (item && item.ok && item.price) {
          finish(item);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      observerTimer = setTimeout(function () {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        observerTimer = null;
      }, 20000);
    }

    tick();
  }

  function handlePage() {
    var url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    // SPA 快速切换时取消旧页面的轮询和 MutationObserver，避免旧商品回调覆盖新页面。
    if (stopExtract) stopExtract();

    var platform = core.detectPlatform(location.host);
    if (!platform) return;
    if (platformApi.isExcluded(location.host, location.pathname)) {
      if (ui) ui.destroy();
      ui = null;
      return;
    }

    var detail = platformApi.isDetailPage(url, platform);
    var list = platformApi.isListPage(url, platform);
    if (list && !detail) {
      if (ui) ui.destroy();
      ui = null;
      return;
    }

    // 切换商品：清掉上一个商品的结果，保留面板与设置
    state.status = 'idle';
    state.result = null;
    state.error = '';
    state.statusText = '';
    state.searchResult = null;
    state.searchStatus = 'idle';
    state.history = null;
    state.historyStatus = 'idle';
    state.historyError = '';
    state.item = null;
    state.site = siteOf(null);

    scheduleExtract(function (item) {
      if (!item) {
        if (!detail) {
          if (ui) ui.destroy();
          ui = null;
          return;
        }
        if (!ui) mount(null);
        state.status = 'error';
        state.error = '页面结构识别失败，可手动在搜索页输入标题';
        render();
        return;
      }
      updateItem(item);
      collect(item);
      if (!ui) mount(item);
      else {
        render();
        if (state.auto) compare();
      }
      state.keyword = item.title;
      if (!state.auto) state.statusText = '已识别，点 ↻ 比价';
      render();
      if (state.tab === 'trend') loadHistory();
    });
  }

  function watchNavigation() {
    var wrap = function (type) {
      var orig = history[type];
      if (typeof orig !== 'function') return;
      history[type] = function () {
        var ret = orig.apply(this, arguments);
        setTimeout(handlePage, 60);
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    root.addEventListener('popstate', function () { setTimeout(handlePage, 60); });
    setInterval(function () {
      if (location.href !== lastUrl) handlePage();
    }, 1200);
  }

  function init() {
    store.init().then(function () {
      syncSettingsFromStore();
      lastUrl = '';
      handlePage();
      watchNavigation();
      if (root.console) {
        console.info('%c比价助手 ' + core.VERSION + '%c 已载入 · 后端 ' + state.apiBase,
          'color:#fff;background:#e11d48;padding:2px 6px;border-radius:4px',
          'color:#888');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  root.BL.app = {
    compare: compare,
    search: search,
    loadHistory: loadHistory,
    state: state,
    get ui() { return ui; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
