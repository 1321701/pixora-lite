/**
 * Pixora 自部署版 —— 浏览器内本地后端
 * Copyright (c) 2026 Pixora (https://pixoraai.cc)
 *
 * 生成页与无限画布原本依赖 Pixora 服务器的 /api/* 与 /v1/* 接口。自部署版没有服务器：
 * 本文件在页面最早期包装 window.fetch，把这些站内接口改为在浏览器里实现——
 *   · 生成任务：直接调用用户填写的中转站（OpenAI 兼容，见 pxl/lite-api.js），结果存入 IndexedDB
 *   · 上传 / 画布 / 历史 / 收藏 / 聊天 / 角色库：全部存 IndexedDB
 *   · 媒体地址形如 pxl-media/<id>，<img>/<video> 由 Service Worker（pxl-sw.js）从 IndexedDB 读取
 * 用户的 Key 只保存在本浏览器，只发往用户自己填写的中转站。
 */
(function (g) {
    'use strict';

    // ===== 基础 =====
    const LC = (g.LITE_CONFIG && typeof g.LITE_CONFIG === 'object') ? g.LITE_CONFIG : {};
    const CFG_KEY = 'pxl_cfg:_';
    const BASE_PATH = location.pathname.replace(/[^/]*$/, '');      // 页面所在目录（支持部署在子路径）
    const MEDIA_PREFIX = BASE_PATH + 'pxl-media/';
    const realFetch = g.fetch.bind(g);
    g.__pxlRealFetch = realFetch;

    // 本地用户：原页面以 nano_user 判断登录态（userId 只用于接口参数）
    try {
        const u = JSON.parse(localStorage.getItem('nano_user') || 'null');
        if (!u || u.token !== 'pxl-local') {
            localStorage.setItem('nano_user', JSON.stringify({ id: 'local', token: 'pxl-local', name: '本地用户', phone: '', avatar: 1 }));
        }
    } catch (_) {
        localStorage.setItem('nano_user', JSON.stringify({ id: 'local', token: 'pxl-local', name: '本地用户', phone: '', avatar: 1 }));
    }

    const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    const UNSUPPORTED = '自部署版暂不支持该功能，请前往 Pixora 主站使用';
    const unsupported = () => json({ code: 1, msg: UNSUPPORTED, data: null });

    // ===== IndexedDB =====
    const DB_NAME = 'pixora-local';
    const STORES = ['media', 'tasks', 'history', 'canvases', 'kv'];
    let dbP = null;
    function db() {
        if (dbP) return dbP;
        dbP = new Promise((resolve, reject) => {
            const r = indexedDB.open(DB_NAME, 1);
            r.onupgradeneeded = () => STORES.forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => { dbP = null; reject(r.error); };
        });
        return dbP;
    }
    const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    async function store(name, mode, fn) {
        const d = await db();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(name, mode);
            let out;
            Promise.resolve(fn(tx.objectStore(name))).then((v) => { out = v; }, reject);
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    const idb = {
        get: (s, k) => store(s, 'readonly', (st) => reqP(st.get(k))),
        put: (s, k, v) => store(s, 'readwrite', (st) => reqP(st.put(v, k))),
        del: (s, k) => store(s, 'readwrite', (st) => reqP(st.delete(k))),
        all: (s) => store(s, 'readonly', (st) => reqP(st.getAll()))
    };

    // ===== 媒体 =====
    function mediaUrl(id) { return MEDIA_PREFIX + id; }
    function mediaIdOf(u) {
        if (typeof u !== 'string') return '';
        const i = u.indexOf('pxl-media/');
        if (i < 0) return '';
        return u.slice(i + 10).split(/[?#&]/)[0];
    }
    async function putMedia(blob, name) {
        const id = uid('m_');
        await idb.put('media', id, { blob, type: blob.type || 'application/octet-stream', name: name || '', size: blob.size, created: Date.now() });
        return id;
    }
    async function getMediaBlob(u) {
        const id = mediaIdOf(u);
        if (!id) return null;
        const rec = await idb.get('media', id);
        return rec ? rec.blob : null;
    }
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
        });
    }
    // 生成缩略图（长边 max，WebP）；失败返回 null（调用方用原图兜底）
    async function makeThumb(blob, max) {
        try {
            if (!/^image\//.test(blob.type || '')) return null;
            const bmp = await createImageBitmap(blob);
            const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
            if (sc >= 1 && blob.size < 400 * 1024) { bmp.close && bmp.close(); return null; }
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(bmp.width * sc));
            c.height = Math.max(1, Math.round(bmp.height * sc));
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            bmp.close && bmp.close();
            return await new Promise((r) => c.toBlob(r, 'image/webp', 0.86));
        } catch (_) { return null; }
    }
    // 远程 / data / 本地地址 → Blob（取不到返回 null）
    async function fetchAsBlob(u) {
        if (!u) return null;
        if (/^data:/.test(u)) return g.LiteAPI.dataUrlToBlob(u);
        if (mediaIdOf(u)) return getMediaBlob(u);
        if (/^blob:/.test(u)) { const r = await realFetch(u); return r.ok ? r.blob() : null; }
        try {
            // 部署者配置了同源转发通道时，跨域素材也走代理（Key/素材不落部署者服务器）
            const pw = g.LiteAPI.proxyWrap(u);
            const r = pw ? await realFetch(pw.url, { headers: pw.headers }) : await realFetch(u, { mode: 'cors' });
            return r.ok ? await r.blob() : null;
        } catch (_) { return null; }
    }
    // 上传到部署者的火山 TOS 图床：返回 { url: 站内展示地址, direct: 7 天直连签名地址 }；未配置或失败返回 null
    async function hostUpload(blob, name) {
        const host = String((g.LITE_CONFIG || {}).mediaHostEndpoint || '').trim();
        if (!host || !blob) return null;
        try {
            const fd = new FormData();
            fd.append('file', blob, name || 'media.png');
            const r = await realFetch(host, { method: 'POST', body: fd });
            const d = await r.json();
            return (d && d.data && d.data.url) ? d.data : null;
        } catch (_) { return null; }
    }
    // 图床的 /api/img 地址 → 直连签名地址（中转站拉取参考图不跟随 302）
    async function hostDirect(u) {
        const host = String((g.LITE_CONFIG || {}).mediaHostEndpoint || '').trim();
        if (!host) return '';
        let x;
        try { x = new URL(u); } catch (_) { return ''; }
        if (!/\/api\/img/.test(x.pathname) || !x.searchParams.get('k')) return '';
        try {
            const signUrl = host.replace(/\/upload$/, '/sign') + '?b=' + encodeURIComponent(x.searchParams.get('b') || '') + '&k=' + encodeURIComponent(x.searchParams.get('k'));
            const r = await realFetch(signUrl);
            const d = await r.json();
            return (d && d.data && d.data.direct) || '';
        } catch (_) { return ''; }
    }
    // 生成结果转存：优先上传部署者的火山 TOS 图床（跨设备可访问），失败再回退本地 IndexedDB
    async function persistResult(u, kind) {
        const blob = await fetchAsBlob(u);
        if (!blob || !blob.size) return { url: u, thumb: u, local: false };
        const typed = (kind === 'video' && !/^video\//.test(blob.type)) ? new Blob([blob], { type: 'video/mp4' }) : blob;
        const up = await hostUpload(typed, kind === 'video' ? 'media.mp4' : 'media.png');
        if (up) {
            if (/^blob:/.test(u)) { try { URL.revokeObjectURL(u); } catch (_) {} }
            return { url: up.url, thumb: up.url, local: false, remote: true };
        }
        const id = await putMedia(typed);
        let thumb = mediaUrl(id);
        if (kind === 'image') {
            const t = await makeThumb(typed, 640);
            if (t) thumb = mediaUrl(await putMedia(t));
        }
        if (/^blob:/.test(u)) { try { URL.revokeObjectURL(u); } catch (_) {} }
        return { url: mediaUrl(id), thumb, local: true };
    }
    // 参考素材 → 中转站可用的形式：优先转成图床的公网 https 直连地址（中转站自行下载），图床不可用才用 data URL
    async function refForRelay(u) {
        if (!u) return '';
        if (/^https?:\/\//.test(u) && !mediaIdOf(u)) {
            const direct = await hostDirect(u);   // 我们自己的 /api/img 地址：换成直连签名，避免中转站不跟 302
            return direct || u;
        }
        const b = await fetchAsBlob(u);
        if (!b) throw new Error('参考素材读取失败');
        let blob = b;
        if (/^image\//.test(b.type || '') && b.size > 3 * 1024 * 1024) {
            const small = await makeThumb(b, 2048);
            if (small) blob = small;
        }
        const up = await hostUpload(blob, /^video\//.test(blob.type || '') ? 'ref.mp4' : 'ref.png');
        if (up && up.direct) return up.direct;
        return blobToDataUrl(blob);
    }
    async function serveMedia(u, request) {
        const blob = await getMediaBlob(u);
        if (!blob) return new Response('Not Found', { status: 404 });
        const range = request && request.headers && request.headers.get && request.headers.get('range');
        const type = blob.type || 'application/octet-stream';
        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            if (m) {
                const size = blob.size;
                let start = m[1] === '' ? Math.max(0, size - Number(m[2] || 0)) : Number(m[1]);
                let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
                end = Math.min(end, size - 1);
                if (start <= end) {
                    return new Response(blob.slice(start, end + 1, type), {
                        status: 206,
                        headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
                    });
                }
            }
        }
        return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' } });
    }

    // ===== 中转站配置 =====
    function readCfg() {
        let o = {};
        try { o = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (_) { o = {}; }
        const lockBase = !!(LC.lockBaseUrl && LC.baseUrl);
        const base = lockBase ? LC.baseUrl : (o.base || LC.baseUrl || '');
        return {
            base: g.LiteAPI ? g.LiteAPI.normBase(base) : base,
            key: o.key || '',
            detected: o.detected || null,
            manual: Object.assign({ chat: [], image: [], video: [] }, o.manual || {}),
            override: o.override || {},
            chatModel: o.chatModel || '',
            protocol: o.protocol || null,      // AI 自动适配的接口协议（含 models 能力）
            docUrls: o.docUrls || '',          // 用户手动指定的文档页地址
            docText: o.docText || '',          // 用户粘贴的文档内容（抓不到文档页时用）
            videoProto: o.videoProto || '',    // 视频接口手动锁定：'' = 自动 / ark / newapi / openai / task
            assetMode: o.assetMode || '',      // 参考图传法：'' = 自动 / url 直链 / asset 先入中转站素材库
            exclude: Array.isArray(o.exclude) ? o.exclude : [],   // AI 适配判定剔除的非生成模型
            capsOverride: (o.capsOverride && typeof o.capsOverride === 'object') ? o.capsOverride : {},       // 用户手改的模型能力（最高优先）
            disabledModels: Array.isArray(o.disabledModels) ? o.disabledModels : [],   // 用户取消启用的模型（不显示不调用）
            chatProto: o.chatProto || ''       // 对话格式手动锁定：'' = 自动探测 / completions / responses / anthropic
        };
    }
    function writeCfg(c) {
        localStorage.setItem(CFG_KEY, JSON.stringify({ base: c.base, key: c.key, detected: c.detected, manual: c.manual, override: c.override || {}, chatModel: c.chatModel, protocol: c.protocol || null, docUrls: c.docUrls || '', docText: c.docText || '', videoProto: c.videoProto || '', assetMode: c.assetMode || '', exclude: Array.isArray(c.exclude) ? c.exclude : [], capsOverride: c.capsOverride || {}, disabledModels: Array.isArray(c.disabledModels) ? c.disabledModels : [], chatProto: c.chatProto || '' }));
        window.dispatchEvent(new CustomEvent('pxl-config-changed'));
    }
    // 模型归类优先级：用户标记 > 部署者预置/手动添加 > /v1/models 自动分类；c.exclude = AI 适配判定剔除的非生成模型；c.disabledModels = 用户取消启用的生成模型（不显示不调用）
    function modelLists(c) {
        c = c || readCfg();
        const pm = LC.models || {};
        const det = c.detected || { chat: [], image: [], video: [] };
        const ex = Array.isArray(c.exclude) ? c.exclude.map(String) : [];
        const dis = Array.isArray(c.disabledModels) ? c.disabledModels.map(String) : [];
        const typeOf = {}, order = [];
        const add = (t, id, prio) => {
            id = String(id || '').trim();
            if (!id || ex.indexOf(id) >= 0) return;
            if ((t === 'image' || t === 'video') && dis.indexOf(id) >= 0) return;   // 禁用的生成模型不进列表
            const cur = typeOf[id];
            if (cur) { if (prio > cur.prio) typeOf[id] = { t, prio }; return; }
            typeOf[id] = { t, prio };
            order.push(id);
        };
        ['chat', 'image', 'video'].forEach((t) => (det[t] || []).forEach((id) => add(t, id, 0)));
        ['chat', 'image', 'video'].forEach((t) => ((pm[t] || [])).forEach((id) => add(t, id, 1)));
        ['chat', 'image', 'video'].forEach((t) => ((c.manual[t] || [])).forEach((id) => add(t, id, 1)));
        Object.entries(c.override || {}).forEach(([id, t]) => { if (['chat', 'image', 'video'].includes(t)) add(t, id, 2); });
        const out = { chat: [], image: [], video: [] };
        order.forEach((id) => out[typeOf[id].t].push(id));
        return out;
    }
    function relayCfg() {
        const c = readCfg();
        if (!c.base || !c.key) {
            const e = new Error('请先点击右上角「接口设置」，填写中转站地址和 API Key');
            e.code = 'NO_CFG';
            throw e;
        }
        return { base: c.base, key: c.key, protocol: c.protocol || null, chatProto: c.chatProto || '', videoProto: c.videoProto || '', assetMode: c.assetMode || '', docUrls: c.docUrls || '', docText: c.docText || '' };
    }
    // 协议库：构建时把 protocols.json 内嵌为 g.PXL_PROTO_HUB（同步可用，/api/config 与生成都能命中）
    // 运行时若 config.js 配了 protocolHubUrl 则异步拉取覆盖（部署者自维护的库）
    let HUB_P = null;
    function hubData() {
        return (g.PXL_PROTO_HUB && g.PXL_PROTO_HUB.protocols) ? g.PXL_PROTO_HUB : (HUB_SYNC || null);
    }
    function hubProto(base) {
        if (!HUB_P && String((g.LITE_CONFIG || {}).protocolHubUrl || '').trim()) {
            HUB_P = fetch(String(g.LITE_CONFIG.protocolHubUrl)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            HUB_P.then((hub) => { if (hub && hub.protocols) HUB_SYNC = hub; }).catch(() => {});
        }
        return Promise.resolve((function () {
            let host = '';
            try { host = new URL(base || '').hostname.toLowerCase() || ''; } catch (_) {}
            const hub = hubData();
            return (hub && hub.protocols && host && hub.protocols[host]) || null;
        })());
    }
    async function cfgWithHub(cfg) {
        if (cfg && !cfg.protocol) {
            try { const hp = await hubProto(cfg.base); if (hp) cfg.protocol = hp; } catch (_) {}
        }
        return cfg;
    }
    function chatModelOf(c) {
        c = c || readCfg();
        const list = modelLists(c).chat;
        if (c.chatModel && list.includes(c.chatModel)) return c.chatModel;
        const pref = [/gpt-4o(?!-mini)/i, /gpt-4\.1/i, /claude.*sonnet/i, /gemini.*pro/i, /deepseek-v3|deepseek-chat/i, /qwen.*max/i, /gpt|claude|gemini|deepseek|qwen|glm|kimi/i];
        for (const re of pref) { const m = list.find((x) => re.test(x)); if (m) return m; }
        return list[0] || '';
    }

    // /api/config：用中转站模型生成主站同结构的模型配置（价格一律 0，不显示积分）
    // 模型能力（参考图张数/分辨率/时长/首尾帧/音频）由 AI 自动适配解析（c.protocol.models）覆盖默认值
    let HUB_SYNC = null;   // protocols.json 加载完成后同步可读（buildConfig 是同步函数）
    function capsOf(protocol, id) {
        if (!protocol || !protocol.models) return null;
        const m = protocol.models;
        if (m[String(id)]) return m[String(id)];
        // 宽松匹配：AI 输出的键名可能有大小写/空格/点划线变体（"Seedance 2.5*" vs "seedance-2.5-pro"）
        const norm = (s) => String(s || '').toLowerCase().replace(/[\s_.]+/g, '-').replace(/-+/g, '-').replace(/-$/, '');
        const nid = norm(id);
        for (const k of Object.keys(m)) {
            if (norm(k) === nid) return m[k];
        }
        let out = null;
        Object.keys(m).forEach((k) => {
            const nk = norm(k);
            const pre = nk.endsWith('*') ? nk.slice(0, -1) : nk;
            if (pre && nid.indexOf(pre) === 0) out = m[k];
        });
        return out;
    }
    function mergeCaps(entry, caps) {
        if (!caps) return entry;
        // 字段名宽容：驼峰与下划线变体都接受（AI 输出格式不可控）
        const g = (a, b) => (caps[a] != null ? caps[a] : (caps[b] != null ? caps[b] : null));
        // 注意 Number(null)===0：缺失字段必须返回 null（跳过），否则会把通用库/默认值覆盖成 0
        const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
        const arr = (v) => (Array.isArray(v) && v.length) ? v.map(String) : null;
        const bo = (v) => (typeof v === 'boolean' ? v : (v === 'true' ? true : (v === 'false' ? false : null)));
        [['maxImages', 'max_images'], ['maxRefVideos', 'max_ref_videos'], ['maxRefAudios', 'max_ref_audios'], ['refVideoMaxTotalSec', 'ref_video_max_total_sec'], ['durationMin', 'duration_min'], ['durationMax', 'duration_max'], ['refVideoBillFactor', 'ref_video_bill_factor']].forEach((p) => {
            const n = num(g(p[0], p[1]));
            if (n != null) entry[p[0]] = n;
        });
        const r = arr(g('supportedResolutions', 'supported_resolutions')); if (r) entry.supportedResolutions = r;
        const a = arr(g('aspectRatios', 'aspect_ratios')); if (a) entry.aspectRatios = a;
        const f = bo(g('firstLast', 'first_last')); if (f != null) entry.firstLast = f;
        const au = bo(caps.audio); if (au != null) entry.audio = au;
        return entry;
    }
    function buildConfig() {
        const c = readCfg();
        const lists = modelLists(c);
        const nameOf = (id) => String(id).replace(/[<>&"']/g, '');
        const imageModels = lists.image.map((id) => mergeCaps({
            id, name: nameOf(id), description: '中转站模型', price: 0,
            supportedResolutions: ['1K', '2K', '4K']
        }, capsFor(c, id)));
        const videoModels = lists.video.map((id) => mergeCaps({
            id, name: nameOf(id), description: '中转站模型', price: 0, isVideo: true,
            durationMin: 4, durationMax: 12, maxImages: 9, maxVideos: 0, maxAudios: 0,
            firstLast: true, refVideoBillFactor: 0,
            aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
            supportedResolutions: ['480p', '720p', '1080p']
        }, capsFor(c, id)));
        return {
            code: 200,
            data: {
                defaultApi: 'relay',
                apis: { relay: { enabled: true, frontend: { models: imageModels } } },
                videoApis: { models: videoModels }
            }
        };
    }
    // 模型能力三级合并：用户手改（capsOverride）> AI 适配（protocol.models）> 通用模型族库（generics，跨站兜底）
    function capsFor(c, id) {
        const genWrap = (g.PXL_PROTO_HUB && g.PXL_PROTO_HUB.generics && g.PXL_PROTO_HUB.generics.models) ? { models: g.PXL_PROTO_HUB.generics.models } : null;
        const merged = mergeCaps({}, capsOf(genWrap, id) || {});
        // Seedance / 豆包视频族以内置通用库为准：AI 从宽泛文档里经常把时长/参考图数量读错，宁可保守也不给中转站 400
        const curated = /seedance|doubao|jimeng\/doubao-seedance/i.test(String(id || ''));
        const ai = curated ? null : capsOf(c.protocol, id);
        if (ai) Object.assign(merged, mergeCaps({}, ai));
        const ov = (c.capsOverride || {})[String(id)];
        if (ov) Object.assign(merged, mergeCaps({}, ov));
        return merged;
    }

    // ===== 任务执行器 =====
    const TAB_ID = uid('tab_');
    const running = new Map();     // taskId -> AbortController
    const MAX_PARALLEL = 4;
    const queue = [];

    async function saveTask(t) { t.updatedAt = Date.now(); await idb.put('tasks', t.id, t); return t; }

    async function createTask(body) {
        const p = Object.assign({}, (body && body.params) || {});
        const t = { id: uid('lt_'), status: 'pending', params: p, result: null, progress: 0, createdAt: Date.now(), updatedAt: Date.now(), owner: TAB_ID, heartbeat: Date.now() };
        await saveTask(t);
        queue.push(t.id);
        pump();
        return t;
    }
    function pump() {
        while (running.size < MAX_PARALLEL && queue.length) {
            const id = queue.shift();
            const ctl = new AbortController();
            running.set(id, ctl);
            runTask(id, ctl).finally(() => { running.delete(id); pump(); });
        }
    }
    // 心跳：其他标签页 / 刷新后据此判断任务是否已无人执行
    setInterval(() => {
        running.forEach((_, id) => {
            idb.get('tasks', id).then((t) => { if (t && t.owner === TAB_ID && (t.status === 'running' || t.status === 'pending')) { t.heartbeat = Date.now(); saveTask(t); } }).catch(() => {});
        });
    }, 5000);

    function isVideoTask(p) {
        if (p.mediaType === 'video') return true;
        const lists = modelLists();
        return lists.video.includes(p.model) || (!lists.image.includes(p.model) && p.duration != null && p.quality && /p$/i.test(String(p.quality)));
    }

    async function runTask(id, ctl, resume) {
        let t = await idb.get('tasks', id);
        if (!t) return;
        const p = t.params || {};
        t.status = 'running';
        t.owner = TAB_ID;
        t.heartbeat = Date.now();
        await saveTask(t);
        try {
            const cfg = await cfgWithHub(relayCfg());
            const isVideo = isVideoTask(p);
            const refs = (p.imageUrls || []).map((im) => (im && (im.highUrl || im.originalUrl || im.previewUrl || im.url)) || '').filter(Boolean);
            let result;
            if (isVideo) {
                if ((p.videoUrls && p.videoUrls.length) || (p.audioUrls && p.audioUrls.length) || (p.promptVideoUrls && p.promptVideoUrls.length) || (p.promptAudioUrls && p.promptAudioUrls.length)) {
                    throw new Error('自部署版暂不支持参考视频 / 参考音频（中转站需要公网可访问的素材地址），请只连入图片');
                }
                const firstLast = p.videoMode === 'first_last';
                const onStatus = (label, progress) => { t.progress = Math.round(progress || 0); };
                let url;
                if (resume && t.upstream) {
                    url = await g.LiteAPI.resumeVideo(cfg, t.upstream.proto, t.upstream.id, { signal: ctl.signal, onStatus });
                } else {
                    const image = refs[0] ? await refForRelay(refs[0]) : '';
                    const lastImage = firstLast && refs[1] ? await refForRelay(refs[1]) : '';
                    url = await g.LiteAPI.generateVideo(cfg, {
                        model: p.model, prompt: p.prompt || '', image, lastImage,
                        duration: p.duration || 5, ratio: p.aspectRatio, resolution: p.quality,
                        signal: ctl.signal, onStatus,
                        onTask: (proto, upId) => { t.upstream = { proto, id: upId }; saveTask(t); }
                    });
                }
                const saved = await persistResult(url, 'video');
                result = { mediaType: 'video', videoUrl: saved.url, imageUrl: saved.url, originalUrl: saved.url, thumbnailUrl: saved.url, url: saved.url, upstreamTaskId: t.upstream ? t.upstream.id : '' };
            } else {
                const relayRefs = [];
                for (const r of refs.slice(0, 10)) relayRefs.push(await refForRelay(r));
                const urls = await g.LiteAPI.generateImage(cfg, { model: p.model, prompt: p.prompt || '', ratio: p.aspectRatio, refs: relayRefs, signal: ctl.signal });
                if (!urls || !urls.length) throw new Error('中转站没有返回图片');
                const saved = await persistResult(urls[0], 'image');
                result = { mediaType: 'image', imageUrl: saved.url, originalUrl: saved.url, thumbnailUrl: saved.thumb, previewUrl: saved.thumb, url: saved.url };
            }
            t = (await idb.get('tasks', id)) || t;
            if (t.status === 'failed') return;   // 期间被取消
            t.status = 'completed';
            t.result = result;
            t.progress = 100;
            t.completedAt = Date.now();
            await saveTask(t);
            await addHistoryForTask(t);
        } catch (e) {
            t = (await idb.get('tasks', id)) || t;
            if (t.status === 'failed') return;
            t.status = 'failed';
            const msg = e && e.name === 'AbortError' ? '已取消' : String((e && e.message) || e || '生成失败');
            t.error = msg;
            t.errorMessage = msg;
            await saveTask(t);
            if (e && e.code === 'NO_CFG' && g.PxlUI && g.PxlUI.openSettings) g.PxlUI.openSettings();
        }
    }

    // 页面加载：恢复无人执行的任务（视频有上游任务 ID 可续查；其余标记中断）
    async function recoverTasks() {
        let list = [];
        try { list = await idb.all('tasks'); } catch (_) { return; }
        const now = Date.now();
        for (const t of list) {
            if (t.status !== 'running' && t.status !== 'pending') continue;
            if (t.heartbeat && now - t.heartbeat < 15000 && t.owner !== TAB_ID) continue;   // 其他标签页正在执行
            if (t.upstream && t.upstream.id) {
                const ctl = new AbortController();
                running.set(t.id, ctl);
                runTask(t.id, ctl, true).finally(() => { running.delete(t.id); pump(); });
            } else {
                t.status = 'failed';
                t.error = t.errorMessage = '页面刷新或关闭导致生成中断，请重新生成';
                await saveTask(t);
            }
        }
        // 清理 7 天前的已结束任务记录（历史记录单独保存，不受影响）
        list.filter((t) => (t.status === 'completed' || t.status === 'failed') && now - (t.updatedAt || 0) > 7 * 86400e3)
            .forEach((t) => idb.del('tasks', t.id).catch(() => {}));
    }

    // ===== 历史记录 =====
    async function addHistoryForTask(t) {
        const p = t.params || {};
        const r = t.result || {};
        const rec = {
            id: uid('h_'), taskId: t.id, prompt: p.prompt || '', model: p.model || '',
            aspectRatio: p.aspectRatio || '', imageSize: p.imageSize || '',
            imageUrl: r.imageUrl || r.videoUrl || '', originalUrl: r.originalUrl || r.imageUrl || '',
            thumbnailUrl: r.thumbnailUrl || r.imageUrl || '', videoUrl: r.videoUrl || '',
            referenceImages: (p.imageUrls || []).map((im) => im && (im.previewUrl || im.highUrl)).filter(Boolean),
            imageUrls: p.imageUrls || [],
            mediaType: r.mediaType || 'image', resolution: p.quality || '', videoResolution: p.quality || '',
            source: p.source || 'main', isFavorited: false, favoritedAt: null,
            timestamp: Date.now(), createdAt: new Date().toISOString(), params: p
        };
        await idb.put('history', rec.id, rec);
        return rec;
    }
    async function historyList(q) {
        let all = [];
        try { all = await idb.all('history'); } catch (_) {}
        const source = q.get('source') || 'main';
        const mt = q.get('mediaType');
        all = all.filter((r) => (r.source || 'main') === source && (!mt || mt === 'all' || (r.mediaType || 'image') === mt));
        all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return all;
    }

    // ===== 聊天（AI 助手面板）=====
    async function chatRoute(body) {
        const cfg = relayCfg();
        const c = readCfg();
        const model = chatModelOf(c);
        if (!model) return json({ code: 1, msg: '请先在「接口设置」中选择对话模型' }, 400);
        const sid = String(body.sessionId || 'default');
        const histKey = 'chat_hist:' + sid;
        const hist = (await idb.get('kv', histKey)) || [];
        const messages = [];
        hist.slice(-12).forEach((h) => {
            messages.push({ role: 'user', content: h.question || '' });
            messages.push({ role: 'assistant', content: String(h.answer || '').slice(0, 8000) });
        });
        const imgs = [];
        for (const u of (body.imageUrls || []).slice(0, 6)) {
            const src = typeof u === 'string' ? u : (u && (u.aiUrl || u.chatUrl || u.url || u.highUrl));
            if (src) imgs.push(await refForRelay(src));
        }
        const text = String(body.message || '');
        messages.push(imgs.length
            ? { role: 'user', content: [{ type: 'text', text: text || '请分析这张图片' }].concat(imgs.map((u) => ({ type: 'image_url', image_url: { url: u } }))) }
            : { role: 'user', content: text });
        const reqBody = { model, messages, stream: true };
        if (body.reasoning_effort) reqBody.reasoning_effort = body.reasoning_effort;
        let up;
        try {
            up = await realFetch(cfg.base + '/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
                body: JSON.stringify(reqBody)
            });
        } catch (_) {
            return json({ code: 1, msg: '无法连接中转站（网络错误或不允许跨域访问）' }, 502);
        }
        if (!up.ok || !up.body) {
            const tx = await up.text().catch(() => '');
            let m = ''; try { const j = JSON.parse(tx); m = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) {}
            return json({ code: 1, msg: '中转站返回错误 ' + up.status + (m ? '：' + m : '') }, 502);
        }
        // 原样透传 SSE，同时累积回答，结束后写入会话历史
        let answer = '', buf = '';
        const dec = new TextDecoder();
        const reader = up.body.getReader();
        const stream = new ReadableStream({
            async pull(controller) {
                const { value, done } = await reader.read();
                if (done) {
                    hist.push({ question: text, answer, think: '', images: (body.imageUrls || []).map((u) => (typeof u === 'string' ? u : (u && (u.previewUrl || u.chatUrl || u.url)) || '')).filter(Boolean), time: Date.now() });
                    idb.put('kv', histKey, hist.slice(-200)).catch(() => {});
                    controller.close();
                    return;
                }
                buf += dec.decode(value, { stream: true });
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const ln = buf.slice(0, i).trim();
                    buf = buf.slice(i + 1);
                    if (!ln.startsWith('data:')) continue;
                    const d = ln.slice(5).trim();
                    if (d === '[DONE]') continue;
                    try { const j = JSON.parse(d); const c2 = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (typeof c2 === 'string') answer += c2; } catch (_) {}
                }
                controller.enqueue(value);
            },
            cancel() { try { reader.cancel(); } catch (_) {} }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }
    async function chatOnce(messages) {
        const cfg = relayCfg();
        const model = chatModelOf();
        if (!model) throw new Error('请先在「接口设置」中选择对话模型');
        let text = '';
        await g.LiteAPI.chat(cfg, { model, messages, onDelta: (d, full) => { text = full; } }).then((r) => { text = r.content || text; });
        return text.trim();
    }

    // ===== 上传 =====
    async function uploadImageForm(form, kind) {
        const file = form.get('file');
        if (!(file instanceof Blob)) return json({ code: 1, msg: '缺少文件' }, 400);
        const id = await putMedia(file, file.name || '');
        const thumbM = form.get('thumb');
        const thumbS = form.get('thumbS');
        let mid = '', sid = '';
        if (thumbM instanceof Blob && thumbM.size) mid = await putMedia(thumbM);
        if (thumbS instanceof Blob && thumbS.size) sid = await putMedia(thumbS);
        if (!mid || !sid) {
            const t = await makeThumb(file, 800);
            if (t) { const tid = await putMedia(t); mid = mid || tid; sid = sid || tid; }
        }
        const full = mediaUrl(id);
        const medium = mid ? mediaUrl(mid) : full;
        const preview = sid ? mediaUrl(sid) : medium;
        if (kind === 'edited') return json({ code: 0, msg: 'ok', data: { fullUrl: full, previewUrl: preview, mediumUrl: medium, fullKey: id } });
        if (kind === 'chat') return json({ code: 0, msg: 'ok', data: { previewUrl: preview, chatUrl: full, aiUrl: full } });
        return json({ code: 0, msg: 'ok', data: { originalUrl: full, highUrl: full, previewUrl: preview, mediumUrl: medium, tempKey: id } });
    }
    async function uploadMediaForm(form) {
        const file = form.get('file');
        if (!(file instanceof Blob)) return json({ code: 1, msg: '缺少文件' }, 400);
        const id = await putMedia(file, file.name || '');
        const mt = /^video\//.test(file.type || '') ? 'video' : (/^audio\//.test(file.type || '') ? 'audio' : 'image');
        return json({ code: 0, msg: 'ok', data: { url: mediaUrl(id), mediaType: mt, tempKey: id, size: file.size } });
    }

    // ===== 通用 CRUD（角色 / 场景 / 道具）=====
    async function crud(kind, method, rest, body) {
        const key = 'lib:' + kind;
        const list = (await idb.get('kv', key)) || [];
        const save = () => idb.put('kv', key, list);
        const [id, action] = rest;
        const now = new Date().toISOString();
        if (!id) {
            if (method === 'GET') return json({ code: 0, data: list });
            if (method === 'POST') {
                const prefix = kind === 'characters' ? 'ch_' : (kind === 'scenes' ? 'sc_' : 'pr_');
                const item = Object.assign({}, body || {}, { id: prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), createdAt: now, updatedAt: now, usedCount: 0 });
                list.unshift(item);
                await save();
                return json({ code: 0, data: item });
            }
        }
        const idx = list.findIndex((x) => x.id === id);
        if (idx < 0) return json({ code: 1, msg: '不存在' }, 404);
        if (action === 'use') { list[idx].usedCount = (list[idx].usedCount || 0) + 1; await save(); return json({ code: 0, data: { usedCount: list[idx].usedCount } }); }
        if (action) return unsupported();
        if (method === 'GET') return json({ code: 0, data: list[idx] });
        if (method === 'PUT') { list[idx] = Object.assign({}, list[idx], body || {}, { id, updatedAt: now }); await save(); return json({ code: 0, data: list[idx] }); }
        if (method === 'DELETE') { list.splice(idx, 1); await save(); return json({ code: 0, data: null }); }
        return unsupported();
    }

    // ===== 路由 =====
    function readBody(init, input) {
        const b = init && init.body !== undefined ? init.body : null;
        if (b == null && input instanceof Request) return input.clone().text().then((s) => { try { return JSON.parse(s); } catch (_) { return s; } });
        if (b instanceof FormData) return Promise.resolve(b);
        if (typeof b === 'string') { try { return Promise.resolve(JSON.parse(b)); } catch (_) { return Promise.resolve(b); } }
        if (b instanceof Blob) return b.text().then((s) => { try { return JSON.parse(s); } catch (_) { return s; } });
        return Promise.resolve(b || {});
    }

    async function route(url, method, init, input) {
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const q = url.searchParams;
        const body = (method === 'GET' || method === 'HEAD') ? null : await readBody(init, input);
        let m;

        // ---- 配置 / 用户 / 杂项 ----
        if (path === '/api/config') return json(buildConfig());
        if (path === '/api/user/credits') return json({ code: 0, data: { credits: 999999, status: 'active' } });
        if (path === '/api/user/avatar') {
            if (method === 'POST' && body && body.avatar) localStorage.setItem('pxl_avatar', String(body.avatar));
            return json({ code: 0, data: { avatar: Number(localStorage.getItem('pxl_avatar') || 1) } });
        }
        if (path === '/api/logs/active') return json({ code: 0, data: [] });
        if (path === '/api/ads/current') return json({ code: 0, data: null });

        // ---- 任务 ----
        if (path === '/api/tasks' && method === 'POST') {
            const t = await createTask(body);
            return json({ code: 200, data: { id: t.id } });
        }
        if (path === '/api/tasks' && method === 'GET') {
            const lim = Number(q.get('limit') || 50);
            const st = q.get('status');
            let list = await idb.all('tasks');
            if (st) list = list.filter((t) => t.status === st);
            list.sort((a, b) => b.createdAt - a.createdAt);
            return json({ code: 200, data: list.slice(0, lim) });
        }
        if ((m = /^\/api\/tasks\/([^/]+)\/upload-status$/.exec(path))) {
            const t = await idb.get('tasks', decodeURIComponent(m[1]));
            const r = (t && t.result) || {};
            return json({ code: 200, data: { status: 'completed', originalUrl: r.originalUrl || r.imageUrl || '', thumbnailUrl: r.thumbnailUrl || r.imageUrl || '' } });
        }
        if ((m = /^\/api\/tasks\/([^/]+)\/cancel$/.exec(path))) {
            const id = decodeURIComponent(m[1]);
            const ctl = running.get(id);
            if (ctl) ctl.abort();
            const t = await idb.get('tasks', id);
            if (t && (t.status === 'running' || t.status === 'pending')) { t.status = 'failed'; t.error = t.errorMessage = '已取消'; await saveTask(t); }
            return json({ code: 200 });
        }
        if ((m = /^\/api\/tasks\/([^/]+)$/.exec(path))) {
            const id = decodeURIComponent(m[1]);
            if (method === 'DELETE') { const ctl = running.get(id); if (ctl) ctl.abort(); await idb.del('tasks', id); return json({ code: 200 }); }
            const t = await idb.get('tasks', id);
            if (!t) return json({ code: 404, msg: '任务不存在' }, 404);
            return json({ code: 200, data: t });
        }

        // ---- 上传 ----
        if (path === '/v1/image/upload-reference' && body instanceof FormData) return uploadImageForm(body, 'ref');
        if (path === '/v1/image/upload-edited-reference' && body instanceof FormData) return uploadImageForm(body, 'edited');
        if (path === '/v1/image/upload-chat' && body instanceof FormData) return uploadImageForm(body, 'chat');
        if (path === '/v1/media/upload' && body instanceof FormData) return uploadMediaForm(body);
        if (path === '/v1/image/upload-for-send') {
            const list = (body && body.imageUrls) || [];
            return json({ code: 0, data: { urls: list.map((x) => ({ highUrl: x.highUrl || x.previewUrl, previewUrl: x.previewUrl || x.highUrl })) } });
        }
        if (path === '/v1/image/proxy') {
            const target = q.get('url') || '';
            if (mediaIdOf(target)) return serveMedia(target, input instanceof Request ? input : null);
            try { return await realFetch(target, { mode: 'cors' }); } catch (_) { return new Response('', { status: 502 }); }
        }

        // ---- 画布 ----
        if (path === '/api/canvas/save' && method === 'POST') {
            const c = (body && body.canvas) || {};
            const id = c.canvasId || uid('c_');
            const prev = await idb.get('canvases', id);
            const version = ((prev && prev.version) || 0) + 1;
            const doc = Object.assign({}, c, { canvasId: id, version, updatedAt: Date.now(), blockCount: Array.isArray(c.blocks) ? c.blocks.length : 0 });
            await idb.put('canvases', id, doc);
            return json({ code: 0, data: { canvasId: id, version } });
        }
        if (path === '/api/canvas' && method === 'GET') {
            const all = await idb.all('canvases');
            all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return json({ code: 0, data: all.map((d) => ({ canvasId: d.canvasId, name: d.name || '未命名画布', blockCount: d.blockCount || 0, updatedAt: d.updatedAt })) });
        }
        if ((m = /^\/api\/canvas\/([^/]+)$/.exec(path))) {
            const id = decodeURIComponent(m[1]);
            if (method === 'DELETE') { await idb.del('canvases', id); return json({ code: 0 }); }
            const d = await idb.get('canvases', id);
            return d ? json({ code: 0, data: d }) : json({ code: 404, msg: '画布不存在' }, 404);
        }

        // ---- 历史 / 收藏 ----
        if (path === '/api/history' && method === 'GET') {
            const all = await historyList(q);
            const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 50);
            return json({ code: 200, data: { records: all.slice(off, off + lim), total: all.length } });
        }
        if (path === '/api/history' && method === 'POST') {
            const rec = Object.assign({ id: uid('h_'), timestamp: Date.now(), source: 'main' }, (body && body.record) || {});
            await idb.put('history', rec.id, rec);
            return json({ code: 200, data: { id: rec.id } });
        }
        if (path === '/api/history' && method === 'DELETE') {
            const rid = q.get('recordId');
            if (rid) await idb.del('history', rid);
            return json({ code: 200 });
        }
        if (path === '/api/history/clear') {
            const source = q.get('source') || 'main';
            const keepFav = q.get('clearFavorites') !== 'true';
            const all = await idb.all('history');
            for (const r of all) if ((r.source || 'main') === source && !(keepFav && r.isFavorited)) await idb.del('history', r.id);
            return json({ code: 200 });
        }
        if (path === '/api/history/favorite' || path === '/api/history/unfavorite') {
            const fav = path.endsWith('/favorite');
            const all = await idb.all('history');
            const hit = all.filter((r) => (body.recordId && r.id === body.recordId) || (body.taskId && r.taskId === body.taskId));
            for (const r of hit) { r.isFavorited = fav; r.favoritedAt = fav ? Date.now() : null; await idb.put('history', r.id, r); }
            return json({ code: 200 });
        }
        if (path === '/api/history/favorites') {
            const all = (await historyList(q)).filter((r) => r.isFavorited);
            return json({ code: 200, data: { records: all } });
        }

        // ---- AI 聊天 ----
        if (path === '/api/chat/chat' && method === 'POST') return chatRoute(body || {});
        if (path === '/api/chat/sessions') {
            let list = (await idb.get('kv', 'chat_sessions')) || [];
            if (method === 'POST') {
                const s = { id: uid('s_'), name: (body && body.name) || '新对话', createdAt: Date.now() };
                list.unshift(s);
                await idb.put('kv', 'chat_sessions', list);
                return json({ code: 0, data: s });
            }
            if (!list.length) { list = [{ id: 'default', name: '默认对话', createdAt: Date.now() }]; await idb.put('kv', 'chat_sessions', list); }
            return json({ code: 0, data: list });
        }
        if ((m = /^\/api\/chat\/sessions\/([^/]+)$/.exec(path))) {
            const id = decodeURIComponent(m[1]);
            const list = ((await idb.get('kv', 'chat_sessions')) || []).filter((s) => s.id !== id);
            if (method === 'DELETE') { await idb.put('kv', 'chat_sessions', list); await idb.del('kv', 'chat_hist:' + id); }
            if (method === 'PUT' && body && body.name) {
                const all = (await idb.get('kv', 'chat_sessions')) || [];
                all.forEach((s) => { if (s.id === id) s.name = body.name; });
                await idb.put('kv', 'chat_sessions', all);
            }
            return json({ code: 0 });
        }
        if (path === '/api/chat/history') {
            const hist = (await idb.get('kv', 'chat_hist:' + (q.get('sessionId') || 'default'))) || [];
            const lim = Number(q.get('limit') || 20), off = Number(q.get('offset') || 0);
            // 与原接口一致：按时间升序返回最近的一页
            const end = Math.max(0, hist.length - off);
            const start = Math.max(0, end - lim);
            return json({ code: 0, hasMore: start > 0, data: hist.slice(start, end) });
        }

        // ---- 角色 / 场景 / 道具库 ----
        if ((m = /^\/api\/(characters|scenes|props)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path))) {
            if (m[3] === 'split-grid') return unsupported();
            return crud(m[1], method, [m[2] ? decodeURIComponent(m[2]) : '', m[3] || ''], body);
        }
        if (path === '/api/director/describe-character' && method === 'POST') {
            try {
                const imgs = [];
                for (const u of ((body && body.images) || []).slice(0, 4)) imgs.push(await refForRelay(u));
                const en = body && body.lang === 'en';
                const prompt = (en
                    ? 'Write a concise visual description of this character for AI image generation (appearance, face, hair, outfit, distinctive features). One paragraph, no more than 120 words.'
                    : '请为这个角色写一段用于 AI 生图的外观描述（长相、发型、服装、显著特征），一段话，不超过 120 字，不要分点。') +
                    (body.name ? '\n角色名：' + body.name : '') + (body.styleTag ? '\n风格：' + body.styleTag : '') + (body.anchors ? '\n已知特征：' + JSON.stringify(body.anchors) : '');
                const content = [{ type: 'text', text: prompt }].concat(imgs.map((u) => ({ type: 'image_url', image_url: { url: u } })));
                const text = await chatOnce([{ role: 'user', content }]);
                return json({ code: 0, data: { description: text } });
            } catch (e) {
                return json({ code: 1, msg: (e && e.message) || 'AI 生成描述失败' });
            }
        }

        // ---- 扩展路由（pxl/agent.js 等注册，需在兜底之前）----
        for (const fn of extraRoutes) {
            const r = await fn(url, method, body, q);
            if (r) return r;
        }

        // ---- 自部署版不提供的服务端能力 ----
        if (/^\/(api\/(director|agent|agent-skills|panorama|midjourney|pay|invite|video\/repair)|v1\/(assets|media\/trim|media\/import-url))(\/|$)/.test(path) ||
            path === '/api/user/redeem-cdk') return unsupported();
        return null;   // 未知路径：交还真实网络
    }
    const extraRoutes = [];

    function isLocalApi(u) {
        if (u.hostname !== location.hostname) return false;
        return /^\/(api|v1)\//.test(u.pathname) || u.pathname.indexOf('/pxl-media/') >= 0;
    }

    g.fetch = async function (input, init) {
        let url;
        try { url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href); } catch (_) { return realFetch(input, init); }
        if (!isLocalApi(url)) return realFetch(input, init);
        const method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        try {
            if (url.pathname.indexOf('/pxl-media/') >= 0) {
                const req = input instanceof Request ? input : new Request(url.href, init);
                return await serveMedia(url.pathname, req);
            }
            const res = await route(url, method, init || {}, input);
            if (res) return res;
        } catch (e) {
            console.error('[Pixora 本地后端]', method, url.pathname, e);
            const msg = (e && e.message) || '本地处理失败';
            return json({ code: 1, msg, data: null }, e && e.code === 'NO_CFG' ? 200 : 500);
        }
        return realFetch(input, init);
    };

    // ===== Service Worker（让 <img>/<video> 能直接显示本地媒体）=====
    if ('serviceWorker' in navigator && g.isSecureContext) {
        navigator.serviceWorker.register(BASE_PATH + 'pxl-sw.js', { scope: BASE_PATH }).catch((e) => console.warn('[Pixora 本地后端] Service Worker 注册失败:', e));
    }

    g.PxlBackend = {
        readCfg, writeCfg, modelLists, chatModelOf, buildConfig, relayCfg, effCaps: (id) => capsFor(readCfg(), id),
        mediaUrl, putMedia, getMediaBlob, idb, LC,
        json, unsupported,
        onRoute: (fn) => extraRoutes.push(fn),
        swReady: () => !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        secure: !!g.isSecureContext
    };

    recoverTasks();
})(window);

// PXL_PROTO_HUB_INJECT
;window.PXL_PROTO_HUB = {
    "version": 4,
    "updated": "2026-11-02",
    "note": "Pixora Lite 协议库。generics=通用模型族默认能力（跨中转站生效，按模型 id/族前缀匹配；AI 适配不到时的兜底，用户可在设置里手改覆盖）。protocols=按站点共享的私有协议（host 为中转站接口域名；image/video={submit:{method,path,body占位符},taskIdPath,poll,resultUrlsPath}，models={模型id或族前缀:{maxImages,supportedResolutions,durationMin,durationMax,firstLast,refVideoMaxTotalSec,aspectRatios,audio}}）。部署者可用 config.js 的 protocolHubUrl 指向自维护的库文件。",
    "generics": {
        "models": {
            "seedance-2.5*": { "maxImages": 30, "durationMin": 4, "durationMax": 30, "supportedResolutions": ["720p", "1080p"], "firstLast": true, "refVideoMaxTotalSec": 30, "audio": true },
            "seedance-2.0*": { "maxImages": 9, "durationMin": 4, "durationMax": 15, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true, "refVideoMaxTotalSec": 30, "audio": true },
            "seedance-1.5*": { "maxImages": 9, "durationMin": 4, "durationMax": 12, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true },
            "seedance-1.0*": { "maxImages": 9, "durationMin": 5, "durationMax": 12, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true },
            "doubao-seedance*": { "maxImages": 9, "durationMin": 5, "durationMax": 12, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true },
            "wan3.0*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["480p", "720p", "1080p"], "audio": true },
            "wan3-*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["480p", "720p", "1080p"], "audio": true },
            "wan2*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["480p", "720p"] },
            "wanx*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["480p", "720p"] },
            "kling*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"], "firstLast": true },
            "kling-v*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"], "firstLast": true },
            "veo3*": { "maxImages": 3, "durationMin": 4, "durationMax": 8, "supportedResolutions": ["720p", "1080p"], "audio": true },
            "veo-3*": { "maxImages": 3, "durationMin": 4, "durationMax": 8, "supportedResolutions": ["720p", "1080p"], "audio": true },
            "veo2*": { "maxImages": 3, "durationMin": 5, "durationMax": 8, "supportedResolutions": ["720p", "1080p"] },
            "sora-2*": { "maxImages": 1, "durationMin": 4, "durationMax": 12, "supportedResolutions": ["720p", "1080p"], "audio": true },
            "sora*": { "maxImages": 1, "durationMin": 4, "durationMax": 12, "supportedResolutions": ["720p", "1080p"], "audio": true },
            "minimax-h*": { "maxImages": 10, "durationMin": 6, "durationMax": 10, "supportedResolutions": ["768p", "1080p"], "audio": true },
            "hailuo*": { "maxImages": 10, "durationMin": 6, "durationMax": 10, "supportedResolutions": ["768p", "1080p"], "audio": true },
            "vidu*": { "maxImages": 7, "durationMin": 4, "durationMax": 16, "supportedResolutions": ["720p", "1080p"] },
            "pixverse*": { "maxImages": 4, "durationMin": 5, "durationMax": 8, "supportedResolutions": ["540p", "720p", "1080p"] },
            "luma*": { "maxImages": 4, "durationMin": 5, "durationMax": 9, "supportedResolutions": ["720p", "1080p"] },
            "ray*": { "maxImages": 4, "durationMin": 5, "durationMax": 9, "supportedResolutions": ["720p", "1080p"] },
            "runway*": { "maxImages": 3, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"] },
            "pika*": { "maxImages": 5, "durationMin": 3, "durationMax": 10, "supportedResolutions": ["720p", "1080p"] },
            "cogvideo*": { "maxImages": 3, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"] },
            "hunyuan-video*": { "maxImages": 3, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"] },
            "jimeng*": { "maxImages": 4, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p", "1080p"] },
            "jimeng/doubao-seedance-2.5*": { "maxImages": 30, "durationMin": 4, "durationMax": 30, "supportedResolutions": ["720p", "1080p"], "firstLast": true, "refVideoMaxTotalSec": 30, "audio": true },
            "jimeng/doubao-seedance-2.0*": { "maxImages": 9, "durationMin": 4, "durationMax": 15, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true, "refVideoMaxTotalSec": 30, "audio": true },
            "jimeng/doubao-seedance*": { "maxImages": 9, "durationMin": 4, "durationMax": 15, "supportedResolutions": ["480p", "720p", "1080p"], "firstLast": true, "audio": true },
            "jimeng/doubao-seedance-2.0-fast*": { "maxImages": 9, "durationMin": 4, "durationMax": 15, "supportedResolutions": ["480p", "720p"], "firstLast": true, "audio": true },
            "jimeng/doubao-seedance-2.0-mini*": { "maxImages": 9, "durationMin": 4, "durationMax": 15, "supportedResolutions": ["480p", "720p"], "firstLast": true, "audio": true },
            "grok-imagine*": { "maxImages": 5, "durationMin": 5, "durationMax": 10, "supportedResolutions": ["720p"], "audio": true },
            "nano-banana*": { "maxImages": 14, "supportedResolutions": ["1K", "2K", "4K"] },
            "gemini-*-image*": { "maxImages": 14, "supportedResolutions": ["1K", "2K", "4K"] },
            "gemini-2.5-flash-image*": { "maxImages": 14, "supportedResolutions": ["1K", "2K", "4K"] },
            "gpt-image*": { "maxImages": 4, "supportedResolutions": ["1024x1024", "1536x1024", "1024x1536"] },
            "seedream*": { "maxImages": 10, "supportedResolutions": ["1K", "2K", "4K"] },
            "qwen-image*": { "maxImages": 3, "supportedResolutions": ["1K", "2K"] },
            "flux*": { "maxImages": 4, "supportedResolutions": ["1K", "2K"] },
            "sd3*": { "maxImages": 2, "supportedResolutions": ["1K"] },
            "stable-diffusion*": { "maxImages": 2, "supportedResolutions": ["1K"] },
            "imagen*": { "maxImages": 3, "supportedResolutions": ["1K", "2K"] },
            "hidream*": { "maxImages": 3, "supportedResolutions": ["1K", "2K"] },
            "kolors*": { "maxImages": 4, "supportedResolutions": ["1K", "2K"] },
            "ideogram*": { "maxImages": 4, "supportedResolutions": ["1K", "2K"] },
            "recraft*": { "maxImages": 4, "supportedResolutions": ["1K", "2K"] },
            "midjourney*": { "maxImages": 3, "supportedResolutions": ["1K", "2K"] },
            "wan2.7-image*": { "maxImages": 4, "supportedResolutions": ["1K", "2K"] }
        }
    },
    "protocols": {}
};
