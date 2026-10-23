'use strict';

const core = require('../userscript/src/core.js');

function render(cfg, stats, desc) {
  const modeLabel = { mock: '模拟数据', live: '真实接口', hybrid: '混合' }[cfg.mode] || cfg.mode;
  const providerChips = desc.active.map((p) => `<span class="chip on">${core.escapeHtml(p)}</span>`).join('');
  const skippedChips = desc.skipped.map((s) => `<span class="chip off" title="${core.escapeHtml(s.reason)}">${core.escapeHtml(s.name)}</span>`).join('');
  const pddNote = cfg.providers.pdd.clientId ? '' : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>比价聚合控制台</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f6f8; --card:#fff; --text:#15181d; --sub:#6b7280; --line:#e5e7eb; --accent:#e1251b; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#171a20; --text:#e8eaed; --sub:#9aa0a6; --line:#262b33; --accent:#ff5c4d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:28px 20px 64px; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
  h1 { font-size:22px; margin:0; letter-spacing:.3px; }
  h1 small { font-size:12px; font-weight:400; color:var(--sub); margin-left:8px; }
  .meta { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .chip { font-size:12px; padding:3px 9px; border-radius:999px; border:1px solid var(--line); color:var(--sub); }
  .chip.on { color:#0a7d33; border-color:#9bd8b3; background:rgba(16,185,129,.10); }
  .chip.off { color:#a16207; border-color:#e5c07b; background:rgba(245,158,11,.10); text-decoration:line-through; }
  @media (prefers-color-scheme: dark) { .chip.on { color:#5fd98f; } .chip.off { color:#f0b64b; } }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  .searchbar { display:flex; gap:10px; flex-wrap:wrap; }
  input[type=search] { flex:1; min-width:240px; padding:11px 13px; border-radius:10px; border:1px solid var(--line); background:transparent; color:var(--text); font-size:14px; outline:none; }
  input[type=search]:focus { border-color:var(--accent); }
  button { cursor:pointer; border:1px solid transparent; border-radius:10px; padding:10px 18px; font-size:14px; background:var(--accent); color:#fff; }
  button.ghost { background:transparent; border-color:var(--line); color:var(--text); }
  button.ghost.on { border-color:var(--accent); color:var(--accent); }
  .chips { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin:16px 0 4px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card .k { font-size:12px; color:var(--sub); }
  .card .v { font-size:20px; font-weight:650; margin-top:4px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--sub); font-weight:500; white-space:nowrap; }
  td.title { max-width:420px; }
  td.title a { color:inherit; text-decoration:none; }
  td.title a:hover { color:var(--accent); }
  .price { color:var(--accent); font-weight:650; white-space:nowrap; }
  .was { color:var(--sub); text-decoration:line-through; font-size:12px; margin-left:6px; }
  .pf { font-size:12px; padding:2px 7px; border-radius:6px; background:rgba(225,37,27,.10); color:var(--accent); white-space:nowrap; }
  .empty { color:var(--sub); padding:24px 4px; text-align:center; }
  .note { margin-top:10px; font-size:12px; color:var(--sub); }
  .row-hint { font-size:12px; color:var(--sub); margin-top:2px; }
  .split { display:grid; grid-template-columns:1.45fr 1fr; gap:16px; }
  @media (max-width: 900px) { .split { grid-template-columns:1fr; } td.title { max-width:none; } }
  .coupon { border:1px dashed var(--line); border-radius:10px; padding:10px 12px; margin-bottom:9px; display:flex; justify-content:space-between; gap:10px; align-items:center; }
  .coupon b { color:var(--accent); font-size:17px; }
  .coupon small { color:var(--sub); display:block; }
  .coupon a { font-size:12px; color:var(--accent); text-decoration:none; white-space:nowrap; }
  footer { color:var(--sub); font-size:12px; margin-top:22px; line-height:1.8; }
  code { background:rgba(127,127,127,.12); padding:1px 6px; border-radius:5px; font-size:12px; }
  .loading { opacity:.5; pointer-events:none; }
  #chart { min-height:120px; }
  #chart svg { width:100%; height:220px; display:block; }
  .his-link { font-size:11px; color:var(--accent); text-decoration:none; margin-left:6px; white-space:nowrap; border:1px solid var(--line); border-radius:5px; padding:0 5px; vertical-align:1px; }
  .his-link:hover { border-color:var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>比价聚合控制台 <small>server ${core.VERSION}</small></h1>
    <div class="meta">
      <span class="chip on">模式 ${core.escapeHtml(modeLabel)}</span>
      ${providerChips}
      ${skippedChips}
      <span class="chip">采集 ${stats.collected} 条</span>
    </div>
  </header>

  <div class="panel">
    <div class="searchbar">
      <input id="kw" type="search" placeholder="输入商品标题，例如：罗技 G304 无线鼠标" autocomplete="off">
      <button id="go">搜索比价</button>
      <button id="refresh" class="ghost">刷新状态</button>
    </div>
    <div class="chips">
      <button class="ghost on" data-sort="renqi">人气</button>
      <button class="ghost" data-sort="xiaoliang">销量</button>
      <button class="ghost" data-sort="jiage">价格</button>
      <button class="ghost on" data-platform="all">全部平台</button>
      <button class="ghost" data-platform="taobao">淘宝</button>
      <button class="ghost" data-platform="tmall">天猫</button>
      <button class="ghost" data-platform="jd">京东</button>
      <button class="ghost" data-platform="pdd">拼多多</button>
      <button class="ghost" data-platform="vip">唯品会</button>
    </div>
    <div class="note" id="note">数据源：${core.escapeHtml(desc.active.join(' / ') || 'none')}${pddNote}。未配置联盟密钥时使用模拟数据，接口结构与真实数据一致。</div>
  </div>

  <div class="cards" id="cards"></div>

  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-weight:600">历史价格走势</div>
      <div class="chips" style="margin:0" id="his-days">
        <button class="ghost" data-days="30">30 天</button>
        <button class="ghost" data-days="90">90 天</button>
        <button class="ghost on" data-days="180">180 天</button>
        <button class="ghost" data-days="365">1 年</button>
      </div>
    </div>
    <div class="searchbar" style="margin-top:12px">
      <input id="his-url" type="search" placeholder="粘贴商品链接查走势，或点下方结果里的「走势」" autocomplete="off">
      <button id="his-go">查走势</button>
    </div>
    <div class="note" id="his-stat">只有 1 个采样点时曲线画不出来；接入历史源或浏览几天后自动成形。</div>
    <div id="chart"></div>
  </div>

  <div class="split">
    <div class="panel">
      <table>
        <thead><tr><th>平台</th><th>商品</th><th>现价</th><th>券</th><th>到手</th><th>销量</th></tr></thead>
        <tbody id="rows"><tr><td colspan="6" class="empty">输入关键词后显示结果</td></tr></tbody>
      </table>
    </div>
    <div class="panel">
      <div style="font-weight:600;margin-bottom:10px">隐藏优惠券</div>
      <div id="coupons"><div class="empty">暂无</div></div>
    </div>
  </div>

  <div class="panel">
    <div style="font-weight:600;margin-bottom:10px">最近采集（浏览器脚本上报的真实页面价格）</div>
    <table>
      <thead><tr><th>时间</th><th>平台</th><th>商品</th><th>价格</th></tr></thead>
      <tbody id="collected"><tr><td colspan="4" class="empty">暂无采集数据</td></tr></tbody>
    </table>
  </div>

  <footer>
    后端接口：<code>GET /api/search?keyword=&amp;sort=renqi|xiaoliang|jiage</code> ·
    <code>POST /api/compare</code> · <code>POST /api/collect</code> · <code>GET /api/history?key=</code><br>
    用户脚本构建：<code>node userscript/build.js</code>，产物 <code>userscript/dist/bilian.user.js</code>。
  </footer>
</div>
<script src="/core.js"></script>
<script>
(function () {
  'use strict';
  var state = { sort: 'renqi', platform: 'all', keyword: '', list: [], days: 180 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) { return '¥' + (Number(n) || 0).toFixed(2); }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  function renderCards(summary, stats) {
    var html = '';
    if (summary && summary.lowest) {
      html += '<div class="card"><div class="k">最低到手价</div><div class="v">' + money(summary.lowest.min) +
        ' <span style="font-size:12px;color:var(--sub)">' + esc(summary.lowest.platformName) + '</span></div></div>';
    }
    html += '<div class="card"><div class="k">匹配商品</div><div class="v">' + ((summary && summary.count) || 0) + '</div></div>';
    html += '<div class="card"><div class="k">本次耗时</div><div class="v">' + ((stats && stats.elapsedMs) || 0) + ' ms</div></div>';
    $('cards').innerHTML = html;
  }

  function renderRows(list) {
    if (!list || !list.length) {
      $('rows').innerHTML = '<tr><td colspan="6" class="empty">没有结果，换个关键词试试</td></tr>';
      return;
    }
    var html = '';
    list.forEach(function (it, idx) {
      html += '<tr>' +
        '<td><span class="pf">' + esc(it.platformName) + '</span></td>' +
        '<td class="title"><a href="' + esc(it.url) + '" target="_blank" rel="noreferrer">' + esc(it.title) + '</a>' +
        '<a href="#" class="his-link" data-idx="' + idx + '">走势</a>' +
        (it.shop ? '<div class="row-hint">' + esc(it.shop) + (it.channel ? ' · ' + esc(it.channel) : '') + '</div>' : '') +
        (it.matchScore ? '<div class="row-hint">同款度 ' + it.matchScore + '</div>' : '') + '</td>' +
        '<td>' + money(it.price) + (it.originPrice ? '<span class="was">' + money(it.originPrice) + '</span>' : '') + '</td>' +
        '<td>' + (it.coupon ? '¥' + it.coupon : '—') + '</td>' +
        '<td class="price">' + money(it.finalPrice) + '</td>' +
        '<td>' + (it.salesText || it.sales || '—') + '</td>' +
        '</tr>';
    });
    $('rows').innerHTML = html;
  }

  function loadHistory(item) {
    if (!item) return;
    var q = '/api/history?days=' + state.days +
      '&url=' + encodeURIComponent(item.url || '') +
      '&platform=' + encodeURIComponent(item.platform || '') +
      '&itemId=' + encodeURIComponent(item.id || '') +
      '&title=' + encodeURIComponent(item.title || '') +
      '&price=' + encodeURIComponent(item.price || '');
    $('his-stat').textContent = '正在拉取历史价…';
    $('chart').innerHTML = '';
    api(q).then(function (res) {
      if (!res.ok) throw new Error(res.error || '查询失败');
      renderHistory(res);
    }).catch(function (err) {
      $('his-stat').textContent = '历史价获取失败：' + err.message;
    });
  }

  function renderHistory(res) {
    var stats = res.stats || {};
    if (!stats.count) {
      $('chart').innerHTML = '<div class="empty">' + esc(res.note || '没有历史数据') + '</div>';
      $('his-stat').textContent = res.note || '';
      return;
    }
    var w = $('chart').clientWidth || 720;
    var chart = window.BL.core.buildChartSvg(res.points, {
      width: w, height: 220, current: stats.current, days: res.days
    });
    $('chart').innerHTML = chart.svg;
    var advice = res.advice || {};
    var srcLabel = { mock: '演示数据', local: '本地采样', mixed: '历史源 + 本地采样', none: '无' }[res.source] || res.source;
    $('his-stat').innerHTML = '当前 ' + money(stats.current) +
      ' · 史低 ' + money(stats.min.price) + '（' + esc(stats.min.date) + '）' +
      ' · 均价 ' + money(stats.avg) +
      ' · 分位 ' + stats.position + '%' +
      ' · <b>' + esc(advice.label || '') + '</b>' +
      (res.mock ? ' · 曲线为演示形态' : '') +
      ' · 来源 ' + esc(srcLabel) + ' · ' + stats.count + ' 天样本';
  }

  function renderCoupons(list) {
    if (!list || !list.length) {
      $('coupons').innerHTML = '<div class="empty">当前结果没有可领的券</div>';
      return;
    }
    var html = '';
    list.slice(0, 12).forEach(function (c) {
      html += '<div class="coupon"><div><b>¥' + c.amount + '</b>' +
        '<small>' + esc(c.platformName) + ' · ' + esc(c.desc) + '</small>' +
        '<small>券后 ' + money(c.finalPrice) + ' · 约省 ' + c.rate + '%</small></div>' +
        '<a href="' + esc(c.url) + '" target="_blank" rel="noreferrer">去领券</a></div>';
    });
    $('coupons').innerHTML = html;
  }

  function search() {
    var kw = $('kw').value.trim();
    if (!kw) { $('kw').focus(); return; }
    state.keyword = kw;
    document.body.classList.add('loading');
    var q = '/api/search?keyword=' + encodeURIComponent(kw) + '&sort=' + state.sort +
      '&platform=' + state.platform + '&limit=30';
    api(q).then(function (res) {
      if (!res.ok) throw new Error(res.error || '请求失败');
      state.list = res.list || [];
      renderRows(state.list);
      renderCoupons(res.coupons || []);
      renderCards(res.summary, res.stats);
      $('note').textContent = (res.note || '') + ' 共 ' + res.total + ' 条，耗时 ' + (res.stats.elapsedMs || 0) + 'ms';
      if (state.list.length) {
        state.hisQuery = state.list[0];
        $('his-url').value = state.list[0].title || state.list[0].url || '';
        loadHistory(state.list[0]);
      }
    }).catch(function (err) {
      $('note').textContent = '请求失败：' + err.message;
    }).finally(function () {
      document.body.classList.remove('loading');
    });
  }

  function loadStats() {
    api('/api/stats').then(function (res) {
      if (!res.ok) return;
      var rows = '';
      (res.recent || []).forEach(function (x) {
        rows += '<tr><td>' + new Date(x.ts).toLocaleString('zh-CN') + '</td>' +
          '<td>' + esc(x.platform) + '</td>' +
          '<td class="title"><a href="' + esc(x.url) + '" target="_blank" rel="noreferrer">' + esc(x.title) + '</a></td>' +
          '<td class="price">' + money(x.price) + '</td></tr>';
      });
      $('collected').innerHTML = rows || '<tr><td colspan="4" class="empty">暂无采集数据，安装用户脚本后浏览商详页会自动上报</td></tr>';
    });
  }

  $('go').addEventListener('click', search);
  $('kw').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });

  $('his-go').addEventListener('click', function () {
    var v = $('his-url').value.trim();
    if (!v) { $('his-url').focus(); return; }
    // 输入框里是刚选中的商品标题就用原对象（带 url / id），手输的新值按链接处理
    if (state.hisQuery && v === (state.hisQuery.title || state.hisQuery.url)) {
      loadHistory(state.hisQuery);
      return;
    }
    loadHistory({ url: v, title: v });
  });
  $('his-url').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('his-go').click();
  });
  $('rows').addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('[data-idx]') : null;
    if (!a) return;
    e.preventDefault();
    var it = state.list[Number(a.getAttribute('data-idx'))];
    if (!it) return;
    state.hisQuery = it;
    $('his-url').value = it.title || it.url || '';
    loadHistory(it);
    try {
      $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      $('chart').scrollIntoView();
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('#his-days [data-days]'), function (btn) {
    btn.addEventListener('click', function () {
      state.days = Number(btn.getAttribute('data-days')) || 180;
      Array.prototype.forEach.call(document.querySelectorAll('#his-days [data-days]'), function (b) {
        b.classList.remove('on');
      });
      btn.classList.add('on');
      if (state.hisQuery) loadHistory(state.hisQuery);
    });
  });
  $('refresh').addEventListener('click', function () { loadStats(); search(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (btn) {
    btn.addEventListener('click', function () {
      state.sort = btn.getAttribute('data-sort');
      Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      if (state.keyword) search();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-platform]'), function (btn) {
    btn.addEventListener('click', function () {
      state.platform = btn.getAttribute('data-platform');
      Array.prototype.forEach.call(document.querySelectorAll('[data-platform]'), function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      if (state.keyword) search();
    });
  });

  loadStats();
  var pre = new URLSearchParams(location.search).get('q');
  if (pre) {
    $('kw').value = pre;
    search();
  } else {
    $('kw').value = '罗技 G304 无线鼠标';
  }
})();
</script>
</body>
</html>`;
}

module.exports = { render };
