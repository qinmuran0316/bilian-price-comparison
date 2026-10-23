'use strict';

const http = require('node:http');
const fs = require('node:fs');
const nodePath = require('node:path');
const core = require('../userscript/src/core.js');
const { loadConfig } = require('./config');
const { Store } = require('./store');
const { TtlCache } = require('./cache');
const registry = require('./providers');
const historyProvider = require('./providers/history');
const compareService = require('./service/compare');
const searchService = require('./service/search');
const couponService = require('./service/coupon');
const historyService = require('./service/history');
const dashboard = require('./dashboard');
const logger = require('./logger');

const MAX_BODY = 256 * 1024;
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 300;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createApp(config) {
  const cfg = config || loadConfig();
  const store = new Store(cfg.dataDir);
  const cache = new TtlCache(cfg.cacheTtlMs);
  const ctx = { store, cache, cfg };
  const hits = new Map();

  function rateLimited(ip) {
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now > rec.reset) {
      hits.set(ip, { count: 1, reset: now + RATE_WINDOW });
      return false;
    }
    rec.count++;
    return rec.count > RATE_MAX;
  }

  async function route(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '86400'
      });
      res.end();
      return;
    }

    if (path === '/' && req.method === 'GET') {
      sendHtml(res, 200, dashboard.render(cfg, store.stats(), registry.describe(cfg)));
      return;
    }

    if ((path === '/health' || path === '/api/health') && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: core.VERSION,
        uptimeSec: Math.round(process.uptime()),
        mode: cfg.mode,
        mock: Boolean(cfg.mock.enabled),
        providers: registry.describe(cfg),
        history: historyProvider.describe(cfg),
        stats: store.stats()
      });
      return;
    }

    // 控制台的走势图复用同一份 core.js，避免图表逻辑写两遍
    if (path === '/core.js' && req.method === 'GET') {
      const file = nodePath.join(__dirname, '..', 'userscript', 'src', 'core.js');
      const js = fs.readFileSync(file, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': Buffer.byteLength(js),
        'Cache-Control': 'public, max-age=300'
      });
      res.end(js);
      return;
    }

    if (path === '/api/search' && req.method === 'GET') {
      const started = Date.now();
      const result = await searchService.search({
        keyword: url.searchParams.get('keyword') || url.searchParams.get('q') || '',
        sort: url.searchParams.get('sort') || 'renqi',
        page: url.searchParams.get('page') || 1,
        limit: url.searchParams.get('limit') || 20,
        platform: url.searchParams.get('platform') || 'all'
      }, cfg, ctx);
      result.stats.elapsedMs = Date.now() - started;
      result.coupons = couponService.build(result.list);
      sendJson(res, 200, result);
      return;
    }

    if (path === '/api/compare' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      const result = await compareService.compare(body, cfg, ctx);
      sendJson(res, 200, result);
      return;
    }

    if (path === '/api/collect' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      const platform = body.platform || core.detectPlatform(body.host || '');
      const price = core.parsePrice(body.price);
      if (!platform) {
        sendJson(res, 400, { ok: false, error: '未知平台，无法采集' });
        return;
      }
      if (!body.title || !price) {
        sendJson(res, 400, { ok: false, error: '采集需要 title 和有效 price' });
        return;
      }
      const saved = store.recordCollected(Object.assign({}, body, { platform, price }));
      sendJson(res, 200, { ok: true, saved, stats: store.stats() });
      return;
    }

    if (path === '/api/history' && (req.method === 'GET' || req.method === 'POST')) {
      let body = {};
      if (req.method === 'POST') {
        const raw = await readBody(req);
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (err) {
          sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
      }
      const q = url.searchParams;
      const result = await historyService.history({
        key: body.key || q.get('key') || '',
        url: body.url || q.get('url') || '',
        platform: body.platform || q.get('platform') || '',
        itemId: body.itemId || q.get('itemId') || '',
        title: body.title || q.get('title') || '',
        price: body.price !== undefined ? body.price : (q.get('price') || 0),
        host: body.host || q.get('host') || '',
        days: body.days || q.get('days') || 0
      }, cfg, ctx);
      sendJson(res, 200, result);
      return;
    }

    if (path === '/api/stats' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        stats: store.stats(),
        recent: store.recent(30),
        providers: registry.describe(cfg)
      });
      return;
    }

    if (path === '/api/coupons' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword') || '';
      if (!keyword) {
        sendJson(res, 400, { ok: false, error: '缺少 keyword' });
        return;
      }
      const r = await searchService.search({ keyword, sort: 'jiage', limit: 40 }, cfg, ctx);
      sendJson(res, 200, { ok: true, keyword, coupons: couponService.build(r.list) });
      return;
    }

    sendJson(res, 404, { ok: false, error: `未知接口: ${req.method} ${path}` });
  }

  const server = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      sendJson(res, 429, { ok: false, error: '请求过于频繁' });
      return;
    }
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: '非法请求路径' });
      return;
    }
    route(req, res, url).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) logger.error('接口异常:', err.stack || err.message);
      sendJson(res, status, { ok: false, error: err.message || '服务内部错误' });
    });
  });

  return { server, cfg, store, cache, ctx };
}

function start(explicitConfig) {
  const cfg = loadConfig(explicitConfig);
  const { server, store } = createApp(cfg);
  server.listen(cfg.port, cfg.host, () => {
    const desc = registry.describe(cfg);
    logger.info('比价聚合服务已启动');
    logger.info(`  地址: http://${cfg.host}:${cfg.port}`);
    logger.info(`  模式: ${cfg.mode} | 数据源: ${desc.active.join(', ') || 'none'}`);
    logger.info(`  数据目录: ${cfg.dataDir}`);
    if (!cfg.hasConfigFile) logger.warn('  未找到 config.json，使用默认配置（npm run build 前可复制 config.example.json）');
    if (cfg.host === '0.0.0.0') logger.warn('  监听 0.0.0.0，局域网内其他设备也能访问');
  });
  const shutdown = () => {
    logger.info('正在关闭...');
    store.save();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, cfg, store };
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
