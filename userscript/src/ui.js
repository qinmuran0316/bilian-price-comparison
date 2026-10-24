/**
 * 面板 UI：Shadow DOM 隔离站点样式，四个视图（比价 / 搜索 / 券 / 设置）。
 * 只负责渲染和事件转发，不直接发请求。
 */
(function (root, factory) {
  var core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.BL.core;
  var api = factory(core, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.ui = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, root) {
  'use strict';

  var STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .bl-panel {
    position: fixed; right: 18px; top: 96px; width: 392px; max-height: calc(100vh - 140px);
    display: flex; flex-direction: column; overflow: hidden;
    background: #fff; color: #1b1f24; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, .22), 0 2px 8px rgba(15, 23, 42, .10);
    border: 1px solid rgba(15, 23, 42, .07);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    pointer-events: auto; transition: opacity .16s ease, transform .16s ease;
  }
  .bl-panel.hide { display: none; }
  .bl-panel.min .bl-tabs, .bl-panel.min .bl-body, .bl-panel.min .bl-foot { display: none; }
  .bl-panel.min { width: 236px; }
  .bl-head {
    display: flex; align-items: center; gap: 9px; padding: 0 12px; height: 50px; flex: 0 0 auto;
    background: linear-gradient(100deg, #ff5a1f 0%, #ff2757 55%, #e01e5a 100%);
    color: #fff; cursor: move; user-select: none;
  }
  .bl-logo {
    width: 26px; height: 26px; border-radius: 8px; flex: 0 0 auto;
    background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; letter-spacing: .5px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
  }
  .bl-titles { flex: 1; min-width: 0; }
  .bl-name { font-size: 13px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-sub { font-size: 11px; opacity: .82; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-hbtn {
    width: 24px; height: 24px; border: 0; border-radius: 7px; background: rgba(255,255,255,.14);
    color: #fff; cursor: pointer; font-size: 13px; line-height: 1; display: flex; align-items: center; justify-content: center;
    padding: 0; flex: 0 0 auto;
  }
  .bl-hbtn:hover { background: rgba(255,255,255,.28); }
  .bl-tabs { display: flex; gap: 2px; padding: 7px 8px 0; border-bottom: 1px solid #eef0f3; flex: 0 0 auto; background: #fff; }
  .bl-tab {
    flex: 1; border: 0; background: transparent; padding: 8px 6px 9px; font-size: 12.5px; color: #6b7280;
    cursor: pointer; border-radius: 8px 8px 0 0; position: relative; font-family: inherit;
  }
  .bl-tab:hover { color: #111827; background: #f8f9fb; }
  .bl-tab.on { color: #e11d48; font-weight: 600; }
  .bl-tab.on::after { content: ''; position: absolute; left: 18%; right: 18%; bottom: -1px; height: 2px; background: #e11d48; border-radius: 2px; }
  .bl-body { padding: 12px; overflow-y: auto; flex: 1 1 auto; background: #fff; }
  .bl-body::-webkit-scrollbar { width: 6px; }
  .bl-body::-webkit-scrollbar-thumb { background: #d7dbe2; border-radius: 3px; }
  .bl-foot {
    flex: 0 0 auto; padding: 7px 12px; border-top: 1px solid #eef0f3; font-size: 11px; color: #8b93a1;
    display: flex; align-items: center; gap: 6px; background: #fcfcfd;
  }
  .bl-dot { width: 6px; height: 6px; border-radius: 50%; background: #c2c8d2; flex: 0 0 auto; }
  .bl-dot.ok { background: #12b76a; } .bl-dot.err { background: #f04438; } .bl-dot.mock { background: #f79009; }
  .bl-foot a { color: #8b93a1; margin-left: auto; text-decoration: none; }
  .bl-foot a:hover { color: #e11d48; }

  .bl-item { display: flex; gap: 10px; padding: 10px; border: 1px solid #eef0f3; border-radius: 11px; background: #fcfcfd; }
  .bl-item img, .bl-ph {
    width: 54px; height: 54px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; background: #f2f4f7;
  }
  .bl-ph { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 18px; }
  .bl-ph.taobao { background: linear-gradient(135deg,#ff8a00,#ff5000); }
  .bl-ph.tmall { background: linear-gradient(135deg,#ff5f5f,#d0021b); }
  .bl-ph.jd { background: linear-gradient(135deg,#ff6a6a,#c81623); }
  .bl-ph.pdd { background: linear-gradient(135deg,#ff7a6b,#e02e24); }
  .bl-ph.vip { background: linear-gradient(135deg,#ff6fb5,#f10180); }
  .bl-item-main { min-width: 0; flex: 1; }
  .bl-item-title { font-size: 12.5px; line-height: 1.45; color: #111827; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bl-item-meta { margin-top: 4px; font-size: 11px; color: #8b93a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-item-price { margin-top: 3px; font-size: 17px; font-weight: 700; color: #e11d48; }
  .bl-item-price small { font-size: 11px; font-weight: 400; color: #98a2b3; text-decoration: line-through; margin-left: 6px; }

  .bl-best {
    margin: 10px 0; padding: 10px 12px; border-radius: 11px;
    background: linear-gradient(100deg, #fff4ed, #fff0f4); border: 1px solid #ffe0d1;
    display: flex; align-items: center; gap: 10px;
  }
  .bl-best .bl-best-k { font-size: 11px; color: #9a3412; }
  .bl-best .bl-best-v { font-size: 19px; font-weight: 750; color: #d61f3c; line-height: 1.2; }
  .bl-best .bl-best-p { font-size: 11px; color: #9a3412; background: #fff; border-radius: 999px; padding: 3px 8px; margin-left: auto; white-space: nowrap; }
  .bl-save { color: #067647; background: #ecfdf3; border: 1px solid #abefc6; border-radius: 8px; padding: 6px 9px; font-size: 11px; margin-bottom: 10px; }

  .bl-list { display: flex; flex-direction: column; gap: 6px; }
  .bl-row {
    display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px; border-radius: 9px; cursor: pointer;
    border: 1px solid transparent; transition: background .12s ease, border-color .12s ease;
  }
  .bl-row:hover { background: #f8f9fb; border-color: #eef0f3; }
  .bl-row.cur { background: #fffaf7; border-color: #ffe3d3; }
  .bl-pf {
    font-size: 10.5px; padding: 2px 6px; border-radius: 5px; color: #fff; flex: 0 0 auto; margin-top: 1px;
    font-weight: 600; letter-spacing: .2px;
  }
  .bl-pf.taobao { background: #ff5000; } .bl-pf.tmall { background: #d0021b; }
  .bl-pf.jd { background: #c81623; } .bl-pf.pdd { background: #e02e24; }
  .bl-pf.vip { background: #f10180; } .bl-pf.mock { background: #98a2b3; }
  .bl-row-main { flex: 1; min-width: 0; }
  .bl-row-title { font-size: 12px; line-height: 1.4; color: #344054; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bl-row-meta { font-size: 10.5px; color: #98a2b3; margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; }
  .bl-coupon-tag { color: #c11574; background: #fdf2fa; border-radius: 4px; padding: 0 4px; }
  .bl-row-price { text-align: right; flex: 0 0 auto; min-width: 74px; }
  .bl-row-price b { color: #e11d48; font-size: 14px; }
  .bl-row-price s { display: block; color: #b0b7c3; font-size: 10.5px; }
  .bl-go {
    border: 0; background: #fff1f2; color: #e11d48; border-radius: 6px; font-size: 11px;
    padding: 4px 7px; cursor: pointer; margin-top: 4px; font-family: inherit;
  }
  .bl-go:hover { background: #ffe4e6; }

  .bl-skeleton { padding: 8px 2px; }
  .bl-sk { height: 12px; border-radius: 6px; background: linear-gradient(90deg,#f1f3f6 25%,#e8ebf0 37%,#f1f3f6 63%); background-size: 400% 100%; animation: bl-sh 1.2s ease infinite; margin-bottom: 9px; }
  .bl-sk.w40 { width: 40%; } .bl-sk.w70 { width: 70%; } .bl-sk.w90 { width: 90%; }
  @keyframes bl-sh { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
  .bl-empty { text-align: center; color: #98a2b3; padding: 26px 10px; font-size: 12px; line-height: 1.8; }
  .bl-err { background: #fef3f2; border: 1px solid #fecdca; color: #b42318; border-radius: 10px; padding: 11px 12px; font-size: 12px; line-height: 1.65; }
  .bl-err code { background: rgba(180,35,24,.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
  .bl-btn {
    border: 1px solid #e4e7ec; background: #fff; color: #344054; border-radius: 8px; padding: 7px 11px;
    font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .bl-btn:hover { border-color: #fda4af; color: #e11d48; }
  .bl-btn.pri { background: #e11d48; border-color: #e11d48; color: #fff; }
  .bl-btn.pri:hover { background: #be123c; color: #fff; }
  .bl-row-btns { display: flex; gap: 8px; margin-top: 10px; }

  .bl-searchbar { display: flex; gap: 6px; }
  .bl-input {
    flex: 1; min-width: 0; border: 1px solid #e4e7ec; border-radius: 9px; padding: 8px 10px;
    font-size: 12.5px; color: #101828; background: #fff; outline: none; font-family: inherit;
  }
  .bl-input:focus { border-color: #fda4af; box-shadow: 0 0 0 3px rgba(225,29,72,.08); }
  .bl-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 9px 0 11px; }
  .bl-chip {
    border: 1px solid #e4e7ec; background: #fff; color: #667085; border-radius: 999px;
    font-size: 11px; padding: 4px 9px; cursor: pointer; font-family: inherit;
  }
  .bl-chip.on { border-color: #e11d48; color: #e11d48; background: #fff1f2; }
  .bl-count { font-size: 11px; color: #98a2b3; margin-bottom: 7px; }

  .bl-cpn {
    border: 1px dashed #f5c2d0; border-radius: 10px; padding: 9px 10px; margin-bottom: 8px;
    display: flex; align-items: center; gap: 10px; background: #fffafc;
  }
  .bl-cpn-amt { color: #e11d48; font-weight: 700; font-size: 18px; min-width: 58px; }
  .bl-cpn-amt span { font-size: 11px; font-weight: 400; }
  .bl-cpn-main { flex: 1; min-width: 0; }
  .bl-cpn-desc { font-size: 11.5px; color: #475467; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-cpn-sub { font-size: 10.5px; color: #98a2b3; margin-top: 2px; }
  .bl-cpn-btns { display: flex; flex-direction: column; gap: 4px; }

  .bl-sec { font-size: 11px; color: #98a2b3; margin: 12px 0 6px; letter-spacing: .3px; }
  .bl-hist { margin-top: 10px; border-top: 1px dashed #eef0f3; padding-top: 8px; }
  .bl-hist svg { width: 100%; height: 60px; display: block; }
  .bl-hist-meta { display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: #98a2b3; margin-top: 2px; }
  .bl-hist-more {
    border: 0; background: transparent; color: #e11d48; font-size: 10.5px; cursor: pointer;
    padding: 0; font-family: inherit;
  }
  .bl-hist-more:hover { text-decoration: underline; }

  .bl-range { display: flex; gap: 5px; margin: 2px 0 4px; }
  .bl-range .bl-chip { padding: 3px 9px; font-size: 10.5px; }
  .bl-chart { position: relative; margin: 6px 0 2px; touch-action: pan-y; }
  .bl-chart svg { width: 100%; height: 158px; display: block; }
  .bl-chart-empty {
    height: 158px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; color: #98a2b3; font-size: 12px; background: #fcfcfd; border: 1px dashed #eef0f3; border-radius: 10px;
  }
  .bl-tip {
    position: absolute; left: 0; top: 0; pointer-events: none; z-index: 6;
    background: rgba(16,24,40,.94); color: #fff; font-size: 11px; line-height: 1.4;
    padding: 5px 9px; border-radius: 7px; white-space: nowrap;
    transform: translate(-50%, -100%); opacity: 0; transition: opacity .1s ease;
  }
  .bl-tip.show { opacity: 1; }
  .bl-mock-tag {
    position: absolute; right: 4px; top: 2px; font-size: 10px; color: #b54708;
    background: #fffaeb; border: 1px solid #fedf89; border-radius: 5px; padding: 1px 5px; z-index: 3;
  }
  .bl-hero { display: flex; align-items: flex-end; gap: 8px; margin: 10px 0 6px; }
  .bl-hero-v { font-size: 25px; font-weight: 750; color: #e11d48; line-height: 1.1; letter-spacing: -.4px; }
  .bl-hero-u { font-size: 10.5px; color: #98a2b3; padding-bottom: 3px; }
  .bl-advice {
    display: flex; gap: 7px; align-items: flex-start; border-radius: 9px; padding: 8px 10px;
    font-size: 11.5px; line-height: 1.5; margin: 8px 0 2px;
  }
  .bl-advice b { font-weight: 650; }
  .bl-advice.best { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; }
  .bl-advice.good { background: #f0f9ff; color: #026aa2; border: 1px solid #b9e6fe; }
  .bl-advice.normal { background: #fffaeb; color: #b54708; border: 1px solid #fedf89; }
  .bl-advice.high { background: #fef3f2; color: #b42318; border: 1px solid #fecdca; }
  .bl-advice.sampling, .bl-advice.unknown { background: #f8f9fb; color: #667085; border: 1px solid #eef0f3; }
  .bl-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
  .bl-cell { background: #fcfcfd; border: 1px solid #eef0f3; border-radius: 9px; padding: 7px 9px; }
  .bl-cell .k { font-size: 10.5px; color: #98a2b3; }
  .bl-cell .v { font-size: 14px; font-weight: 650; color: #101828; margin-top: 1px; }
  .bl-cell .v small { font-size: 10px; font-weight: 400; color: #98a2b3; margin-left: 3px; }
  .bl-cell .v.green { color: #067647; } .bl-cell .v.red { color: #b42318; }
  .bl-src { font-size: 10.5px; color: #98a2b3; line-height: 1.6; margin-top: 9px; }
  .bl-src .up { color: #b42318; }
  .bl-src .down { color: #067647; }

  .bl-setting { display: flex; flex-direction: column; gap: 10px; }
  .bl-field { display: flex; flex-direction: column; gap: 5px; }
  .bl-field label { font-size: 11.5px; color: #667085; }
  .bl-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #344054; }
  .bl-kv { display: flex; justify-content: space-between; font-size: 11.5px; color: #667085; padding: 3px 0; border-bottom: 1px dashed #f2f4f7; }
  .bl-kv b { color: #101828; font-weight: 600; }

  .bl-fab {
    position: fixed; right: 0; top: 42%; background: linear-gradient(180deg,#ff5a1f,#e01e5a); color: #fff;
    border-radius: 10px 0 0 10px; padding: 10px 6px; font-size: 12px; letter-spacing: 2px; cursor: pointer;
    box-shadow: 0 6px 18px rgba(224,30,90,.35); writing-mode: vertical-rl; display: none; pointer-events: auto;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .bl-fab.show { display: block; }
  .bl-toast {
    position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%) translateY(8px);
    background: rgba(16,24,40,.92); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 12px;
    opacity: 0; transition: opacity .18s ease, transform .18s ease; pointer-events: none; white-space: nowrap;
    font-family: -apple-system, "PingFang SC", sans-serif;
  }
  .bl-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media (prefers-color-scheme: dark) {
    .bl-panel { background: #171a20; color: #e6e8ec; border-color: #262b33; }
    .bl-tabs { background: #171a20; border-color: #262b33; }
    .bl-tab { color: #9aa0a6; } .bl-tab:hover { background: #1d2129; color: #e6e8ec; }
    .bl-tab.on { color: #ff6b81; } .bl-tab.on::after { background: #ff6b81; }
    .bl-body { background: #171a20; }
    .bl-item { background: #1b1f27; border-color: #262b33; }
    .bl-item-title { color: #e6e8ec; }
    .bl-item-meta, .bl-row-meta { color: #8b93a1; }
    .bl-best { background: linear-gradient(100deg,#2a1a1f,#2a1720); border-color: #4a2530; }
    .bl-best .bl-best-k, .bl-best .bl-best-p { color: #ffb4a2; }
    .bl-best .bl-best-p { background: #171a20; }
    .bl-save { background: #10281f; border-color: #1d5a3f; color: #6ce9a6; }
    .bl-row:hover { background: #1d2129; border-color: #262b33; }
    .bl-row.cur { background: #241a1c; border-color: #3b2429; }
    .bl-row-title { color: #d0d5dd; }
    .bl-go { background: #2a151b; color: #ff8fa3; }
    .bl-input { background: #1b1f27; border-color: #2b3039; color: #e6e8ec; }
    .bl-chip { background: #1b1f27; border-color: #2b3039; color: #98a2b3; }
    .bl-chip.on { background: #2a151b; }
    .bl-btn { background: #1b1f27; border-color: #2b3039; color: #d0d5dd; }
    .bl-cpn { background: #201a1d; border-color: #3b2429; }
    .bl-cpn-desc { color: #d0d5dd; }
    .bl-kv b { color: #e6e8ec; }
    .bl-foot { background: #14171c; border-color: #262b33; }
    .bl-err { background: #2a1517; border-color: #4a2224; color: #fda29b; }
    .bl-sk { background: linear-gradient(90deg,#20242c 25%,#272c35 37%,#20242c 63%); background-size: 400% 100%; }
    .bl-chart-empty { background: #1b1f27; border-color: #262b33; color: #8b93a1; }
    .bl-cell { background: #1b1f27; border-color: #262b33; }
    .bl-cell .v { color: #e6e8ec; }
    .bl-cell .v.green { color: #6ce9a6; } .bl-cell .v.red { color: #fda29b; }
    .bl-advice.best { background: #10281f; border-color: #1d5a3f; color: #6ce9a6; }
    .bl-advice.good { background: #0b2436; border-color: #12496b; color: #84caff; }
    .bl-advice.normal { background: #2a2011; border-color: #4a3413; color: #fec84b; }
    .bl-advice.high { background: #2a1517; border-color: #4a2224; color: #fda29b; }
    .bl-advice.sampling, .bl-advice.unknown { background: #1b1f27; border-color: #262b33; color: #98a2b3; }
    .bl-mock-tag { background: #2a2011; border-color: #4a3413; color: #fec84b; }
    .bl-src { color: #8b93a1; }
  }
  @media (max-width: 640px) {
    .bl-panel {
      left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 76vh; border-radius: 16px;
    }
    .bl-panel.min { width: auto; left: auto; right: 10px; }
    .bl-head { height: 46px; cursor: default; }
  }
  `;

  function esc(s) {
    return core.escapeHtml(s);
  }

  function money(n) {
    return core.formatPrice(n);
  }

  function pfClass(item) {
    return item && item.platform ? item.platform : '';
  }

  function badge(item, extra) {
    return '<span class="bl-pf ' + esc(pfClass(item)) + '">' +
      esc(core.platformName(item.platform)) + '</span>' + (extra || '');
  }

  function imageBlock(item) {
    if (item.image) {
      return '<img src="' + esc(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    }
    var ch = (core.platformName(item.platform) || '?').slice(0, 1);
    return '<div class="bl-ph ' + esc(pfClass(item)) + '">' + esc(ch) + '</div>';
  }

  function rowHtml(item, opts) {
    var meta = [];
    if (item.coupon) meta.push('<span class="bl-coupon-tag">券 ¥' + item.coupon + '</span>');
    if (item.salesText || item.sales) meta.push('<span>月销 ' + esc(item.salesText || item.sales) + '</span>');
    if (item.shop) meta.push('<span>' + esc(item.shop) + '</span>');
    if (item.channel) meta.push('<span>' + esc(item.channel) + '</span>');
    if (item.isCurrent) meta.push('<span>当前页面</span>');
    if (opts && opts.showScore && item.matchScore) meta.push('<span>同款 ' + item.matchScore + '</span>');
    if (item.mock) meta.push('<span>模拟</span>');

    return '<div class="bl-row' + (item.isCurrent ? ' cur' : '') + '" data-act="open" data-url="' + esc(item.url) + '">' +
      badge(item) +
      '<div class="bl-row-main">' +
        '<div class="bl-row-title">' + esc(item.title) + '</div>' +
        '<div class="bl-row-meta">' + meta.join('') + '</div>' +
      '</div>' +
      '<div class="bl-row-price">' +
        '<b>' + money(item.finalPrice || item.price) + '</b>' +
        (item.originPrice ? '<s>' + money(item.originPrice) + '</s>' : (item.coupon ? '<s>' + money(item.price) + '</s>' : '')) +
        '<button class="bl-go" data-act="open" data-url="' + esc(item.url) + '">去看看</button>' +
      '</div>' +
    '</div>';
  }

  function sparkline(points, stats) {
    if (!points || !points.length) return '';
    var chart = core.buildChartSvg(points, { width: 340, height: 60, compact: true });
    if (!chart.svg) return '';
    var st = stats || core.buildHistoryStats(points, 0, 0);
    var meta = [];
    if (st.min) meta.push('<span>史低 ' + money(st.min.price) + '</span>');
    if (st.count > 1) meta.push('<span>均价 ' + money(st.avg) + '</span>');
    else meta.push('<span>已采样 ' + st.count + ' 次</span>');
    return '<div class="bl-hist">' + chart.svg +
      '<div class="bl-hist-meta">' + meta.join('') +
      '<button class="bl-hist-more" data-act="tab" data-tab="trend">完整走势 ›</button></div></div>';
  }

  function mount(opts) {
    if (document.getElementById('bl-root')) return null;
    var host = document.createElement('div');
    host.id = 'bl-root';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
    document.documentElement.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + STYLE + '</style>' +
      '<div class="bl-panel" part="panel">' +
        '<div class="bl-head">' +
          '<div class="bl-logo">比</div>' +
          '<div class="bl-titles"><div class="bl-name">比价助手</div><div class="bl-sub">正在识别…</div></div>' +
          '<button class="bl-hbtn" data-act="refresh" title="刷新">↻</button>' +
          '<button class="bl-hbtn" data-act="collapse" title="收起">–</button>' +
          '<button class="bl-hbtn" data-act="close" title="关闭">×</button>' +
        '</div>' +
        '<div class="bl-tabs">' +
          '<button class="bl-tab" data-act="tab" data-tab="compare">比价</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="trend">走势</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="search">搜索</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="coupon">优惠券</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="settings">设置</button>' +
        '</div>' +
        '<div class="bl-body"></div>' +
        '<div class="bl-foot"><span class="bl-dot"></span><span class="bl-status">初始化…</span><a href="#" data-act="dashboard">控制台</a></div>' +
      '</div>' +
      '<div class="bl-fab" data-act="reopen">比价</div>' +
      '<div class="bl-toast"></div>';

    var panel = shadow.querySelector('.bl-panel');
    var body = shadow.querySelector('.bl-body');
    var toastEl = shadow.querySelector('.bl-toast');
    var statusEl = shadow.querySelector('.bl-status');
    var dotEl = shadow.querySelector('.bl-dot');
    var fab = shadow.querySelector('.bl-fab');
    var subEl = shadow.querySelector('.bl-sub');
    var state = opts.initial || {};

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }

    function applyPosition(pos) {
      if (!pos) return;
      if (root.matchMedia && root.matchMedia('(max-width: 640px)').matches) return;
      panel.style.right = Math.max(0, pos.right || 18) + 'px';
      panel.style.top = Math.max(0, pos.top || 96) + 'px';
    }

    function activeInputSnapshot() {
      var el = shadow.activeElement;
      if (!el || el.tagName !== 'INPUT') return null;
      return { id: el.id, start: el.selectionStart, end: el.selectionEnd, value: el.value };
    }

    function restoreInput(snap) {
      if (!snap) return;
      var el = shadow.getElementById(snap.id);
      if (!el) return;
      el.value = snap.value;
      el.focus();
      try { el.setSelectionRange(snap.start, snap.end); } catch (err) { /* number 输入不支持 */ }
    }

    function swapBody(html) {
      var snap = activeInputSnapshot();
      body.innerHTML = html;
      restoreInput(snap);
    }

    function renderItemCard(item) {
      if (!item) {
        return '<div class="bl-empty">未识别到商品信息<br><button class="bl-btn" data-act="refresh">重新识别</button></div>';
      }
      return '<div class="bl-item">' + imageBlock(item) +
        '<div class="bl-item-main">' +
          '<div class="bl-item-title">' + esc(item.title) + '</div>' +
          '<div class="bl-item-meta">' + esc(item.platformName) + (item.channel ? ' · ' + esc(item.channel) : '') +
            (item.itemId ? ' · ID ' + esc(item.itemId) : '') + '</div>' +
          '<div class="bl-item-price">' + (item.price ? money(item.price) : '价格未识别') +
            (item.originPrice ? '<small>' + money(item.originPrice) + '</small>' : '') + '</div>' +
        '</div>' +
      '</div>';
    }

    var chartGeom = null;

    var SEARCH_PLATFORMS = ['taobao', 'tmall', 'jd', 'pdd', 'vip'];

    // 后端没启动或没查到同款时，至少把用户送到其它平台的同款搜索结果
    function sameItemSearch(keyword, current) {
      var kw = String(keyword || '').trim();
      if (!kw) return '';
      var btns = SEARCH_PLATFORMS.filter(function (p) { return p !== current; }).map(function (p) {
        var url = core.buildSearchUrl(p, kw);
        return url ? '<button class="bl-chip" data-act="open" data-url="' + esc(url) + '">' +
          esc(core.platformName(p)) + '</button>' : '';
      }).join('');
      if (!btns) return '';
      return '<div class="bl-sec">去其它平台搜同款</div><div class="bl-chips">' + btns + '</div>';
    }

    function sourceText(h) {
      var map = { local: '本地采样', mixed: '历史源 + 本地采样', mock: '演示数据', none: '无' };
      if (h.source === 'manmanbuy') return '慢慢买历史价';
      return map[h.source] || h.source || '本地采样';
    }

    function trendChips() {
      var cur = state.historyDays || 180;
      return '<div class="bl-range">' + [30, 90, 180, 365].map(function (d) {
        return '<button class="bl-chip' + (d === cur ? ' on' : '') + '" data-act="range" data-days="' + d + '">' +
          (d === 365 ? '1 年' : d + ' 天') + '</button>';
      }).join('') + '</div>';
    }

    function renderTrend() {
      var s = state;
      var html = '';
      if (s.item) {
        html += '<div class="bl-item" style="padding:8px">' + imageBlock(s.item) +
          '<div class="bl-item-main">' +
            '<div class="bl-item-title" style="font-size:12px;-webkit-line-clamp:1">' + esc(s.item.title) + '</div>' +
            '<div class="bl-item-meta">' + esc(s.item.platformName) +
              (s.item.channel ? ' · ' + esc(s.item.channel) : '') +
              (s.item.itemId ? ' · ID ' + esc(s.item.itemId) : '') + '</div>' +
          '</div></div>';
      }
      html += trendChips();

      if (s.historyStatus === 'loading') {
        return html + '<div class="bl-chart"><div class="bl-chart-empty">正在拉取历史价…</div></div>' +
          '<div class="bl-skeleton"><div class="bl-sk w90"></div><div class="bl-sk w70"></div></div>';
      }
      if (s.historyStatus === 'error') {
        return html + '<div class="bl-err">' + esc(s.historyError || '历史价获取失败') +
          '<div class="bl-row-btns"><button class="bl-btn pri" data-act="history-refresh">重试</button></div></div>';
      }

      var h = s.history;
      if (!h || !h.stats || !h.stats.count) {
        return html + '<div class="bl-chart"><div class="bl-chart-empty">还没有历史价' +
          '<span style="font-size:11px;padding:0 16px;text-align:center;line-height:1.7">打开商品页会自动采样；' +
          '配好历史源后立刻有完整曲线</span></div></div>' +
          '<div class="bl-row-btns"><button class="bl-btn" data-act="history-refresh">重新获取</button></div>';
      }

      var stats = h.stats;
      var advice = h.advice || core.historyAdvice(stats);
      var dark = !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
      var chart = core.buildChartSvg(h.points, {
        width: 340,
        height: 158,
        current: stats.current,
        days: h.days,
        colors: dark ? {
          grid: '#2b313a', axis: '#8b93a1', line: '#ff6b81',
          low: '#4ade80', lowText: '#6ce9a6', high: '#8b93a1',
          current: '#f79009', dot: '#171a20', bg: '#171a20'
        } : null
      });
      chartGeom = chart.geom;

      html += '<div class="bl-hero"><div class="bl-hero-v">' + money(stats.current) + '</div>' +
        '<div class="bl-hero-u">当前价 · ' + (h.days || 0) + ' 天区间</div></div>';

      var arrow = advice.code === 'high' ? '▲' : (advice.code === 'best' || advice.code === 'good' ? '▼' : '•');
      html += '<div class="bl-advice ' + esc(advice.code) + '"><span>' + arrow + '</span>' +
        '<div><b>' + esc(advice.label) + '</b><br>' + esc(advice.hint) + '</div></div>';

      html += '<div class="bl-chart" id="bl-chart">' +
        (h.mock ? '<span class="bl-mock-tag">演示曲线</span>' : '') +
        chart.svg + '<div class="bl-tip"></div></div>';

      var posClass = stats.position <= 25 ? 'green' : (stats.position >= 75 ? 'red' : '');
      html += '<div class="bl-grid2">' +
        '<div class="bl-cell"><div class="k">历史最低</div><div class="v green">' + money(stats.min.price) +
          '<small>' + esc(stats.min.date || '') + '</small></div></div>' +
        '<div class="bl-cell"><div class="k">历史最高</div><div class="v">' + money(stats.max.price) +
          '<small>' + esc(stats.max.date || '') + '</small></div></div>' +
        '<div class="bl-cell"><div class="k">区间均价</div><div class="v">' + money(stats.avg) + '</div></div>' +
        '<div class="bl-cell"><div class="k">历史分位</div><div class="v ' + posClass + '">' +
          stats.position + '%<small>时间比现在便宜</small></div></div>' +
      '</div>';

      html += '<div class="bl-src">来源：' + esc(sourceText(h)) + ' · 采样 ' + stats.count + ' 天' +
        (stats.trend ? ' · 近 7 天 <span class="' + (stats.trend > 0 ? 'up' : 'down') + '">' +
          (stats.trend > 0 ? '↑' : '↓') + Math.abs(stats.trend).toFixed(1) + '%</span>' : '') +
        (h.note ? '<br>' + esc(h.note) : '') +
      '</div>';

      return html;
    }

    /** 走势图 hover：竖线 + 圆点 + 价格气泡，坐标映射复用 core 返回的 geom */
    function bindChart() {
      var wrap = shadow.getElementById('bl-chart');
      if (!wrap || !chartGeom || !chartGeom.points.length) return;
      var svg = wrap.querySelector('svg');
      var line = wrap.querySelector('.bl-hover-line');
      var dot = wrap.querySelector('.bl-hover-dot');
      var tip = wrap.querySelector('.bl-tip');
      if (!svg || !line || !dot || !tip) return;
      var pts = chartGeom.points;

      function nearest(clientX) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return null;
        var vx = ((clientX - rect.left) / rect.width) * chartGeom.width;
        var best = pts[0];
        var bestD = Infinity;
        for (var i = 0; i < pts.length; i++) {
          var d = Math.abs(pts[i].x - vx);
          if (d < bestD) { bestD = d; best = pts[i]; }
        }
        return { p: best, rect: rect };
      }

      function move(e) {
        var point = e.touches && e.touches[0] ? e.touches[0] : e;
        var hit = nearest(point.clientX);
        if (!hit) return;
        var p = hit.p;
        line.setAttribute('x1', p.x);
        line.setAttribute('x2', p.x);
        line.setAttribute('opacity', '1');
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        dot.setAttribute('opacity', '1');
        tip.textContent = core.formatDate(p.t) + ' · ' + core.formatPrice(p.p);
        var rect = hit.rect;
        var px = (p.x / chartGeom.width) * rect.width;
        var py = (p.y / chartGeom.height) * rect.height;
        tip.style.left = Math.max(46, Math.min(rect.width - 46, px)) + 'px';
        tip.style.top = Math.max(22, py - 6) + 'px';
        tip.classList.add('show');
      }

      function leave() {
        line.setAttribute('opacity', '0');
        dot.setAttribute('opacity', '0');
        tip.classList.remove('show');
      }

      wrap.addEventListener('mousemove', move);
      wrap.addEventListener('mouseleave', leave);
      // 移动端按住拖动看价格，不阻断纵向滚动
      wrap.addEventListener('touchstart', move, { passive: true });
      wrap.addEventListener('touchmove', move, { passive: true });
      wrap.addEventListener('touchend', leave);
    }

    function renderCompare() {
      var s = state;
      if (s.status === 'loading') {
        return '<div class="bl-skeleton">' +
          '<div class="bl-sk w40"></div><div class="bl-sk w90"></div><div class="bl-sk w70"></div>' +
          '<div style="height:8px"></div><div class="bl-sk w90"></div><div class="bl-sk w90"></div><div class="bl-sk w40"></div>' +
        '</div><div class="bl-empty" style="padding:8px">正在跨平台查价…</div>';
      }
      if (s.status === 'error') {
        return '<div class="bl-err">' + esc(s.error || '比价失败') +
          '<div style="margin-top:8px;color:#8b93a1;font-size:11px">本机比价服务未连接，可先用下方入口去其它平台搜同款</div>' +
          '<div class="bl-row-btns"><button class="bl-btn pri" data-act="refresh">重试</button>' +
          '<button class="bl-btn" data-act="tab" data-tab="settings">检查设置</button></div></div>' +
          sameItemSearch(s.item && s.item.title, s.site && s.site.platform);
      }
      var html = renderItemCard(s.item);
      html += sameItemSearch(s.item && s.item.title, s.site && s.site.platform);
      if (!s.result) {
        return html + '<div class="bl-empty">' + (s.item ? '点右上角 ↻ 开始比价' : '') + '</div>';
      }
      var r = s.result;
      if (r.best) {
        html += '<div class="bl-best"><div><div class="bl-best-k">全网最低到手</div>' +
          '<div class="bl-best-v">' + money(r.best.finalPrice) + '</div></div>' +
          '<div class="bl-best-p">' + esc(r.best.platformName) + (r.best.mock ? ' · 模拟' : '') + '</div></div>';
      }
      if (r.savings) {
        html += '<div class="bl-save">换到' + esc(core.platformName(r.savings.to)) + '省 ' + money(r.savings.amount) +
          '（' + r.savings.percent + '%）</div>';
      }
      if (r.items && r.items.length) {
        html += '<div class="bl-sec">同款价格 · ' + r.items.length + ' 条</div><div class="bl-list">';
        var shown = r.items.slice(0, 12);
        // 当前页商品哪怕比前 12 名贵也要露出来，否则用户看不到自己的比价基准
        var current = null;
        for (var ci = 0; ci < r.items.length; ci++) {
          if (r.items[ci].isCurrent) { current = r.items[ci]; break; }
        }
        if (current && shown.indexOf(current) < 0) shown.push(current);
        shown.forEach(function (it) {
          html += rowHtml(it, { showScore: true });
        });
        html += '</div>';
        if (r.note) html += '<div class="bl-sec" style="line-height:1.6">' + esc(r.note) + '</div>';
        html += sparkline(r.history || [], r.historyStats);
      } else {
        html += '<div class="bl-empty">没有查到同款<br><span style="font-size:11px">' + esc(r.note || '') + '</span></div>';
      }
      return html;
    }

    function renderSearch() {
      var s = state;
      var sortChips = [['renqi', '人气'], ['xiaoliang', '销量'], ['jiage', '价格']].map(function (x) {
        return '<button class="bl-chip' + (s.sort === x[0] ? ' on' : '') + '" data-act="sort" data-sort="' + x[0] + '">' + x[1] + '</button>';
      }).join('');
      var pfChips = [['all', '全部'], ['taobao', '淘宝'], ['tmall', '天猫'], ['jd', '京东'], ['pdd', '拼多多'], ['vip', '唯品会']]
        .map(function (x) {
          return '<button class="bl-chip' + ((s.platform || 'all') === x[0] ? ' on' : '') + '" data-act="platform" data-platform="' + x[0] + '">' + x[1] + '</button>';
        }).join('');

      var html = '<div class="bl-searchbar">' +
        '<input id="bl-kw" class="bl-input" type="search" placeholder="输入商品标题搜索" value="' + esc(s.keyword || '') + '">' +
        '<button class="bl-btn pri" data-act="search">搜索</button></div>' +
        '<div class="bl-chips">' + sortChips + '</div>' +
        '<div class="bl-chips">' + pfChips + '</div>';

      if (s.searchStatus === 'loading') {
        html += '<div class="bl-skeleton"><div class="bl-sk w40"></div><div class="bl-sk w90"></div><div class="bl-sk w70"></div></div>';
        return html;
      }
      if (s.searchStatus === 'error') {
        html += '<div class="bl-err">' + esc(s.searchError || '搜索失败') + '</div>' +
          sameItemSearch(s.keyword, '');
        return html;
      }
      var res = s.searchResult;
      if (!res) {
        html += '<div class="bl-empty">按人气 / 销量 / 价格排序，跨五个平台一起搜</div>';
        return html;
      }
      html += '<div class="bl-count">共 ' + res.total + ' 条 · ' + esc((res.summary && res.summary.lowest ? res.summary.lowest.platformName + ' 最低 ' + money(res.summary.lowest.min) : '')) + '</div>';
      if (!res.list || !res.list.length) {
        html += '<div class="bl-empty">没有结果</div>';
        return html;
      }
      html += '<div class="bl-list">';
      res.list.forEach(function (it) { html += rowHtml(it, {}); });
      html += '</div>';
      return html;
    }

    function renderCoupon() {
      var s = state;
      if (s.status === 'loading') return '<div class="bl-skeleton"><div class="bl-sk w40"></div><div class="bl-sk w90"></div></div>';
      var list = (s.result && s.result.coupons) || [];
      if (!list.length) {
        return '<div class="bl-empty">当前商品没查到隐藏券<br><span style="font-size:11px">换个平台或稍后再试</span></div>';
      }
      var html = '<div class="bl-sec">可用券 ' + list.length + ' 张 · 按面额排序</div>';
      list.forEach(function (c) {
        html += '<div class="bl-cpn">' +
          '<div class="bl-cpn-amt">¥' + c.amount + '<span> 券</span></div>' +
          '<div class="bl-cpn-main"><div class="bl-cpn-desc">' + esc(c.platformName) + ' · ' + esc(c.desc) + '</div>' +
            '<div class="bl-cpn-sub">券后 ' + money(c.finalPrice) + ' · 约省 ' + c.rate + '%' +
            (c.end ? ' · ' + esc(c.end) + ' 到期' : '') + '</div></div>' +
          '<div class="bl-cpn-btns">' +
            '<button class="bl-btn" data-act="copy" data-text="' + esc(c.url) + '">复制</button>' +
            '<button class="bl-btn pri" data-act="open" data-url="' + esc(c.url) + '">领券</button>' +
          '</div></div>';
      });
      return html;
    }

    function renderSettings() {
      var s = state;
      var h = s.health;
      var healthRows = '';
      if (h) {
        healthRows = '<div class="bl-kv"><span>服务版本</span><b>' + esc(h.version) + '</b></div>' +
          '<div class="bl-kv"><span>运行模式</span><b>' + esc(h.mode) + '</b></div>' +
          '<div class="bl-kv"><span>已采集</span><b>' + (h.stats ? h.stats.collected : 0) + ' 条</b></div>' +
          '<div class="bl-kv"><span>数据源</span><b>' + esc((h.providers && h.providers.active || []).join(' / ') || 'none') + '</b></div>';
      }
      return '<div class="bl-setting">' +
        '<div class="bl-field"><label>后端地址（仅限本机）</label>' +
          '<input id="bl-api" class="bl-input" type="text" value="' + esc(s.apiBase || '') + '" placeholder="http://127.0.0.1:8787">' +
        '</div>' +
        '<label class="bl-check"><input id="bl-auto" type="checkbox"' + (s.auto ? ' checked' : '') + '> 打开商详页自动比价</label>' +
        '<div class="bl-row-btns"><button class="bl-btn pri" data-act="save">保存并测试</button>' +
          '<button class="bl-btn" data-act="refresh">重新识别</button></div>' +
        (healthRows ? '<div class="bl-sec">服务状态</div>' + healthRows : '<div class="bl-sec">服务状态 · 未连接</div>') +
        '<div class="bl-sec" style="line-height:1.7">只允许 127.0.0.1 / localhost。面板数据来自本机聚合服务，采集到的商品标题、价格和链接只写入本机，不会上传到其它服务器。未配置联盟密钥时展示模拟价并标注「模拟」。</div>' +
      '</div>';
    }

    function render() {
      var s = state;
      panel.classList.toggle('hide', !!s.closed);
      panel.classList.toggle('min', !!s.collapsed);
      fab.classList.toggle('show', !!s.closed);
      subEl.textContent = s.site
        ? (s.site.channel && s.site.channel !== s.site.platformName
          ? s.site.platformName + ' · ' + s.site.channel
          : s.site.platformName)
        : '正在识别…';
      Array.prototype.forEach.call(shadow.querySelectorAll('.bl-tab'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === s.tab);
      });
      if (s.collapsed) return;
      chartGeom = null;
      if (s.tab === 'trend') {
        swapBody(renderTrend());
        bindChart();
      } else if (s.tab === 'search') swapBody(renderSearch());
      else if (s.tab === 'coupon') swapBody(renderCoupon());
      else if (s.tab === 'settings') swapBody(renderSettings());
      else swapBody(renderCompare());

      var online = s.health && s.health.ok;
      dotEl.className = 'bl-dot ' + (online ? (s.result && s.result.mock ? 'mock' : 'ok') : 'err');
      var st = s.statusText || '';
      if (!st) {
        if (!online) st = '未连接后端';
        else if (s.tab === 'trend' && s.history && s.history.stats && s.history.stats.count) {
          st = s.history.stats.count + ' 天采样 · ' + (s.history.mock ? '含演示' : sourceText(s.history));
        } else if (s.result) st = '匹配 ' + (s.result.items ? s.result.items.length : 0) + ' 条 · ' + (s.result.stats ? s.result.stats.elapsedMs : 0) + 'ms';
        else st = '就绪';
      }
      statusEl.textContent = st;
    }

    function openUrl(url) {
      if (!url) return;
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: false, insert: true });
        return;
      }
      root.open(url, '_blank', 'noopener');
    }

    function copyText(text) {
      if (!text) return;
      var done = function () { toast('已复制'); };
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        done();
        return;
      }
      if (root.navigator && root.navigator.clipboard) {
        root.navigator.clipboard.writeText(text).then(done).catch(function () { toast('复制失败'); });
      } else {
        toast('复制失败');
      }
    }

    shadow.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!target) return;
      var act = target.getAttribute('data-act');
      if (act === 'open') {
        e.preventDefault();
        e.stopPropagation();
        openUrl(target.getAttribute('data-url'));
        return;
      }
      if (act === 'copy') {
        e.preventDefault();
        copyText(target.getAttribute('data-text'));
        return;
      }
      if (act === 'tab') {
        e.preventDefault();
        var tab = target.getAttribute('data-tab');
        if (state.collapsed) opts.onCollapse(false);
        opts.onTab(tab);
        return;
      }
      if (act === 'sort') {
        e.preventDefault();
        opts.onSort(target.getAttribute('data-sort'));
        return;
      }
      if (act === 'range') {
        e.preventDefault();
        opts.onRange(Number(target.getAttribute('data-days')) || 180);
        return;
      }
      if (act === 'history-refresh') {
        e.preventDefault();
        opts.onHistoryRefresh();
        return;
      }
      if (act === 'platform') {
        e.preventDefault();
        opts.onPlatform(target.getAttribute('data-platform'));
        return;
      }
      if (act === 'search') {
        e.preventDefault();
        var kw = shadow.getElementById('bl-kw');
        opts.onSearch((kw && kw.value || '').trim());
        return;
      }
      if (act === 'refresh') {
        e.preventDefault();
        opts.onRefresh();
        return;
      }
      if (act === 'collapse') {
        e.preventDefault();
        opts.onCollapse(!state.collapsed);
        return;
      }
      if (act === 'close') {
        e.preventDefault();
        opts.onClose();
        return;
      }
      if (act === 'reopen') {
        e.preventDefault();
        opts.onClose(false);
        return;
      }
      if (act === 'save') {
        e.preventDefault();
        var apiEl = shadow.getElementById('bl-api');
        var autoEl = shadow.getElementById('bl-auto');
        opts.onSave({
          apiBase: (apiEl && apiEl.value || '').trim(),
          auto: Boolean(autoEl && autoEl.checked)
        });
        return;
      }
      if (act === 'dashboard') {
        e.preventDefault();
        openUrl((state.apiBase || '').replace(/\/+$/, '') + '/');
      }
    });

    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'bl-kw') {
        e.preventDefault();
        opts.onSearch(String(e.target.value || '').trim());
      }
    });

    // 拖动：只认标题栏，按钮上不触发
    var drag = null;
    panel.addEventListener('pointerdown', function (e) {
      var head = e.target.closest && e.target.closest('.bl-head');
      if (!head || (e.target.closest && e.target.closest('button'))) return;
      if (root.matchMedia && root.matchMedia('(max-width: 640px)').matches) return;
      var rect = panel.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        right: root.innerWidth - rect.right,
        top: rect.top
      };
      panel.style.transition = 'none';
      if (panel.setPointerCapture) {
        try { panel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    });
    panel.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var right = Math.max(4, Math.min(root.innerWidth - 120, drag.right - (e.clientX - drag.startX)));
      var top = Math.max(4, Math.min(root.innerHeight - 80, drag.top + (e.clientY - drag.startY)));
      panel.style.right = right + 'px';
      panel.style.top = top + 'px';
      panel.dataset.right = String(right);
      panel.dataset.top = String(top);
    });
    panel.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      panel.style.transition = '';
      var right = Number(panel.dataset.right || 18);
      var top = Number(panel.dataset.top || 96);
      opts.onMove({ right: right, top: top });
    });

    return {
      render: function (next) {
        state = next;
        applyPosition(next.panelPos);
        render();
      },
      toast: toast,
      destroy: function () { host.remove(); }
    };
  }

  return { mount: mount };
});
