'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  port: 8787,
  host: '127.0.0.1',
  mode: 'hybrid', // mock | live | hybrid
  dataDir: './data',
  requestTimeoutMs: 8000,
  cacheTtlMs: 600000,
  matching: { threshold: 52, maxCandidates: 60, maxPerPlatform: 4 },
  history: {
    enabled: true,
    days: 180,
    maxDays: 730,
    cacheTtlMs: 1800000,
    upstreamTimeoutMs: 4500,
    // 真实采样不足 3 天时用演示序列铺底，响应带 mock 标记；live 模式强制关闭
    mockFill: true,
    upstreams: [
      // 慢慢买旧接口已下线（404），类型保留，接口恢复后把 enabled 改 true 即可
      { name: 'manmanbuy', type: 'manmanbuy', enabled: false, endpoint: 'https://apapia-history.manmanbuy.com/HistoryDataNew.ashx', priceInCents: false },
      // 自建/第三方历史价接口：endpoint 里用 {url} {platform} {itemId} {title} {days} 占位
      { name: 'custom', type: 'generic', enabled: false, endpoint: '', headers: {}, priceInCents: false }
    ]
  },
  providers: {
    taobao: { enabled: true, appKey: '', appSecret: '', adzoneId: '', endpoint: 'https://eco.taobao.com/router/rest', pageSize: 20 },
    jd: { enabled: true, appKey: '', appSecret: '', siteId: '', endpoint: 'https://api.jd.com/routerjson', pageSize: 20 },
    pdd: { enabled: true, clientId: '', clientSecret: '', pid: '', endpoint: 'https://gw-api.pinduoduo.com/api/router', pageSize: 20 },
    vip: { enabled: true, appKey: '', appSecret: '', endpoint: '', pageSize: 20 },
    collected: { enabled: true }
  },
  mock: { enabled: true, fallback: true, latencyMs: 40 }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isPlainObject(extra)) return out;
  for (const key of Object.keys(extra)) {
    const bv = out[key];
    const ev = extra[key];
    out[key] = isPlainObject(bv) && isPlainObject(ev) ? deepMerge(bv, ev) : ev;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`配置文件解析失败 ${file}: ${err.message}`);
    }
    return null;
  }
}

function envOverrides() {
  const out = {};
  if (process.env.BL_PORT) out.port = Number(process.env.BL_PORT);
  if (process.env.BL_HOST) out.host = process.env.BL_HOST;
  if (process.env.BL_MODE) out.mode = process.env.BL_MODE;
  if (process.env.BL_DATA_DIR) out.dataDir = process.env.BL_DATA_DIR;
  return out;
}

function loadConfig(explicitPath) {
  const file = explicitPath || process.env.BL_CONFIG || path.join(ROOT, 'config.json');
  let cfg = deepMerge(DEFAULTS, readJson(file) || {});
  cfg = deepMerge(cfg, envOverrides());
  cfg.root = ROOT;
  cfg.dataDir = path.isAbsolute(cfg.dataDir) ? cfg.dataDir : path.join(ROOT, cfg.dataDir);
  cfg.configFile = file;
  cfg.hasConfigFile = fs.existsSync(file);
  if (!['mock', 'live', 'hybrid'].includes(cfg.mode)) cfg.mode = 'hybrid';
  return cfg;
}

/** 判断某个 provider 是否具备真实调用条件（缺 key 就走 mock/采集缓存） */
function providerReady(cfg, name) {
  const p = cfg.providers[name] || {};
  if (!p.enabled) return false;
  if (name === 'taobao') return Boolean(p.appKey && p.appSecret && p.adzoneId);
  if (name === 'jd') return Boolean(p.appKey && p.appSecret);
  if (name === 'pdd') return Boolean(p.clientId && p.clientSecret);
  if (name === 'vip') return Boolean(p.appKey && p.appSecret && p.endpoint);
  return true;
}

module.exports = { loadConfig, providerReady, deepMerge, DEFAULTS, ROOT };
