/**
 * Pixora Lite —— 中转站协议适配层（纯浏览器直连，key 不经过 Pixora 服务器）
 * Copyright (c) 2026 Pixora (https://pixoraai.cc)
 * 依照 Pixora Lite 开源许可协议授权（Apache-2.0 + 品牌保留附加条件），详见 LICENSE、TRADEMARK.md
 *
 * 聊天：OpenAI /v1/chat/completions（流式 + function calling）
 * 图片：/v1/images/generations、/v1/images/edits、chat 出图（Gemini / Nano Banana 一类）自动探测
 * 视频：new-api 统一视频接口、OpenAI /v1/videos、火山方舟 /api/v3/contents/generations/tasks 自动探测
 */
(function (g) {
    'use strict';

    // 自部署版会包装 window.fetch 来模拟站内接口；直连中转站一律走原始 fetch，避免与同域中转站路径冲突
    const _fetch = (...a) => (g.__pxlRealFetch || g.fetch)(...a);

    // 部署者可选的同源转发通道（config.js 的 relayProxy，如 '/api-relay'）：
    // 用户随便填中转站，真实目标放在 X-Relay-Target 头里，由部署者的 nginx 白名单校验后转发（见 docs/relay-proxy.md）
    const PROXY = String((g.LITE_CONFIG || {}).relayProxy || '').replace(/\/+$/, '');

    // 外部 http(s) 地址 → { url: 同源代理地址, headers }；无需代理（未配置/同源/非 http）返回 null
    function proxyWrap(u) {
        if (!PROXY) return null;
        let t;
        try { t = new URL(u, g.location.href); } catch (_) { return null; }
        if (t.protocol !== 'https:' || t.origin === g.location.origin) return null;
        return { url: PROXY + '/' + t.pathname.replace(/^\//, '') + t.search, headers: { 'X-Relay-Target': t.host } };
    }

    class ApiError extends Error {
        constructor(msg, status, body) { super(msg); this.status = status || 0; this.body = body; }
    }

    function normBase(u) {
        u = String(u || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        u = u.replace(/[?#].*$/, '').replace(/\/+$/, '');
        // 用户常填到 /v1 或 /v1/chat/completions，统一截到站点根
        u = u.replace(/\/v1(\/.*)?$/i, '').replace(/\/api\/v3(\/.*)?$/i, '');
        return u;
    }

    function errMsgOf(data, text, status) {
        let m = '';
        if (data) {
            const e = data.error;
            m = (e && (typeof e === 'string' ? e : (e.message || e.msg))) || data.message || data.msg || data.detail || '';
            // 火山 OpenAPI 信封（素材库 Action 面）：ResponseMetadata.Error{Code, Message}
            const re = data.ResponseMetadata && data.ResponseMetadata.Error;
            if (!m && re) m = (re.Code ? re.Code + '：' : '') + (re.Message || '');
            if (typeof m !== 'string') m = JSON.stringify(m);
            const param = e && typeof e === 'object' && e.param;
            if (param) m += '（字段：' + param + '）';
        }
        if (!m && text) m = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        return (status ? 'HTTP ' + status + '：' : '') + (m || '请求失败');
    }
    // 上游在报错里明确给出参数要求时按要求改请求（通用，不针对具体模型/中转站）：
    //   「`duration` must be -1」→ 改成要求的值；「The parameter(s) `ratio` … (is|are) not valid」→ 去掉这些参数
    function fixRejectedParams(body, text) {
        const t = String(text || '');
        if (!body || !t) return null;
        const ALIAS = { ratio: ['ratio', 'aspect_ratio'], aspect_ratio: ['aspect_ratio', 'ratio'] };
        const PROTECT = { model: 1, prompt: 1, content: 1 };
        const keysFor = (b, n) => { const c = ALIAS[n] || [n]; const h = c.filter((k) => k in b); return h.length ? h : [c[0]]; };
        const val = (v) => { v = String(v).trim().replace(/^["'`]|["'`]$/g, ''); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v; };
        const b2 = Object.assign({}, body), names = [], must = {};
        const reMust = /`([A-Za-z_]+)`\s+must\s+be\s+(-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[A-Za-z0-9_:.-]+)/g;
        let m;
        while ((m = reMust.exec(t))) {
            if (PROTECT[m[1]]) continue;
            must[m[1]] = 1;
            const v = val(m[2]);
            keysFor(b2, m[1]).forEach((k) => { if (b2[k] !== v) { b2[k] = v; names.push(k + '=' + v); } });
        }
        if (names.length) return { body: b2, names };
        const bad = /parameters?\s+((?:`[A-Za-z_]+`[\s,]*(?:and\s+)?)+)[^.]*?(?:is|are)\s+not\s+valid/i.exec(t);
        if (bad) {
            (bad[1].match(/`([A-Za-z_]+)`/g) || []).map((x) => x.replace(/`/g, '')).forEach((n) => {
                if (PROTECT[n] || must[n]) return;
                (ALIAS[n] || [n]).forEach((k) => { if (k in b2) { delete b2[k]; names.push('-' + k); } });
            });
        }
        return names.length ? { body: b2, names } : null;
    }
    // 400 错误里中转站指出的问题字段（MuseReel 等会给 error.param）
    function errParamOf(e) {
        const b = e && e.body;
        const p = b && b.error && typeof b.error === 'object' && b.error.param;
        return p ? String(p) : '';
    }

    async function request(cfg, path, opts) {
        opts = opts || {};
        const headers = Object.assign({ Authorization: 'Bearer ' + cfg.key }, opts.headers || {});
        let body = opts.body;
        if (body && !(body instanceof FormData) && typeof body !== 'string') {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }
        let res;
        try {
            let url = cfg.base + path;
            const headers = Object.assign({ Authorization: 'Bearer ' + cfg.key }, opts.headers || {});
            const pw = proxyWrap(url);
            if (pw) { url = pw.url; Object.assign(headers, pw.headers); }
            res = await _fetch(url, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            // https 页面 → http 中转站：浏览器禁止混合内容，报错要和 CORS 区分开
            if (g.isSecureContext && /^http:\/\//i.test(String(cfg.base))) {
                throw new ApiError('当前页面是 https，而中转站地址是 http://：浏览器禁止这种混合请求。请把地址换成中转站的 https:// 入口后重试。', 0);
            }
            throw new ApiError('无法连接中转站：网络错误，或该站点不允许浏览器直接访问（CORS）。若 Lite 部署在你自己的服务器上，可按 docs/relay-proxy.md 加一段 nginx 转发解决。', 0);
        }
        if (opts.raw) {
            if (!res.ok) {
                const t = await res.text().catch(() => '');
                let d = null; try { d = JSON.parse(t); } catch (_) {}
                throw new ApiError(errMsgOf(d, t, res.status), res.status, d);
            }
            return res;
        }
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) {}
        if (!res.ok) {
            if (res.status === 403 && PROXY) throw new ApiError('中转站拒绝了请求（403）：请检查 Key、模型权限，或该中转站是否限制了来源。', 403);
            throw new ApiError(errMsgOf(data, text, res.status), res.status, data);
        }
        if (data === null) throw new ApiError('中转站返回的不是 JSON：' + text.slice(0, 120), res.status);
        // 部分中转站 HTTP 200 但 body 里带错误
        if (data && data.error && !data.data && !data.choices && !data.id && !data.task_id) {
            throw new ApiError(errMsgOf(data, '', 0), res.status, data);
        }
        if (data && data.ResponseMetadata && data.ResponseMetadata.Error && !data.Result) {
            throw new ApiError(errMsgOf(data, '', 0), res.status, data);
        }
        return data;
    }

    // ===== 模型分类 =====
    const RE_SKIP = /(embed|whisper|tts|speech|transcri|rerank|moderation|realtime|audio)/i;
    const RE_VIDEO = /(video|seedance|kling|veo|sora|hailuo|minimax-h|vidu|runway|pika|luma|t2v|i2v|wan2|wanx|cogvideo|pixverse|jimeng-v)/i;
    const RE_IMAGE = /(image|imagine|dall-?e|flux|seedream|midjourney|^mj[-_]|imagen|banana|sdxl|stable-diffusion|^sd3|ideogram|recraft|kolors|jimeng|hidream|playground|qwen-image)/i;
    function classify(id) {
        id = String(id || '');
        if (RE_SKIP.test(id)) return null;
        // 名字带明确 image 词且不含 video 时优先归图片（避免 wan2.7-image 被 wan2 抢先匹配成视频）
        if (/image/i.test(id) && !/video/i.test(id)) return 'image';
        if (RE_VIDEO.test(id)) return 'video';
        if (RE_IMAGE.test(id)) return 'image';
        return 'chat';
    }

    // 官网模型页兜底：部分中转站的 /v1/models 只列对话模型，图片/视频模型只在其官网模型页公布。
    // 部署者可在 config.js 配 modelsPage 指定官网模型列表页；未配置时从中转站地址自动推断
    // （api.xxx.com → www.xxx.com/models、xxx.com/models 等候选），抓取失败静默跳过。
    function modelsPageCandidates(cfg) {
        const manual = String((cfg || {}).modelsPage || '').trim();
        if (manual) return [manual];
        let host = '';
        try { host = new URL((cfg || {}).base || '').hostname.toLowerCase() || ''; } catch (_) {}
        host = host.replace(/^www\./, '').replace(/^api\./, '');
        if (!host || host.indexOf('.') < 0) return [];
        const out = [];
        for (const h of ['www.' + host, host]) {
            for (const p of ['/models', '/zh-CN/models', '/en/models']) out.push('https://' + h + p);
        }
        return out;
    }
    async function fetchModelsPage(cfg) {
        const pages = modelsPageCandidates(cfg).slice(0, 5);
        if (!pages.length) return null;
        const results = await Promise.all(pages.map(async (page) => {
            try {
                let u = page, headers = {};
                const pw = proxyWrap(u);
                if (pw) { u = pw.url; headers = pw.headers; }
                const res = await _fetch(u, { headers, signal: (g.AbortSignal && g.AbortSignal.timeout) ? g.AbortSignal.timeout(15000) : undefined });
                if (!res.ok) return null;
                const html = await res.text();
                const seen = new Set();
                const re = /\/models\/([a-z0-9][a-z0-9._-]{1,80})/gi;
                let m;
                while ((m = re.exec(html))) seen.add(m[1].toLowerCase());
                if (!seen.size) return null;
                const out = { image: [], video: [] };
                seen.forEach((id) => {
                    const t = classify(id);
                    if (t === 'image' || t === 'video') out[t].push(id);
                });
                return (out.image.length || out.video.length) ? out : null;
            } catch (_) { return null; }
        }));
        for (const r of results) { if (r) return r; }
        return null;
    }

    async function listModels(cfg) {
        const d = await request(cfg, '/v1/models');
        const arr = Array.isArray(d) ? d : (Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []));
        const out = { chat: [], image: [], video: [] };
        const seen = new Set();
        arr.forEach((m) => {
            const id = typeof m === 'string' ? m : (m && (m.id || m.name));
            if (!id || seen.has(id)) return;
            seen.add(id);
            const t = classify(id);
            if (t) out[t].push(id);
        });
        // /v1/models 缺图片或视频模型时，从官网模型页补充（手动配置的 modelsPage 优先，否则按中转站域名自动推断）
        if (!out.image.length && !out.video.length && cfg && cfg.base) {
            const fb = await fetchModelsPage(cfg);
            if (fb) {
                if (!out.image.length && fb.image.length) out.image = fb.image;
                if (!out.video.length && fb.video.length) out.video = fb.video;
            }
        }
        Object.keys(out).forEach((k) => out[k].sort());
        return out;
    }

    // ===== AI 协议适配：从中转站文档页自动解析私有协议（任务型协议的参数化）=====
    // 协议描述 schema：
    // { image?: { submit:{method,path,body:{字段:占位符或固定值}}, taskIdPath?, poll:{method,path}, resultUrlsPath },
    //   video?: { 同上 } }
    // 占位符：{model} {prompt} {refs} {image} {duration} {ratio}；path 必须是站内相对路径（防外发）
    function getPath(obj, path) {
        if (!path || obj == null) return undefined;
        const parts = String(path).split('.');
        let cur = obj;
        for (let i = 0; i < parts.length; i++) {
            if (cur == null) return undefined;
            const m = /^(.*?)\[\]$/.exec(parts[i]);
            if (m) {
                cur = cur[m[1]];
                if (!Array.isArray(cur)) return undefined;
                const rest = parts.slice(i + 1).join('.');
                return rest ? cur.map((x) => getPath(x, rest)).filter(Boolean) : cur;
            }
            cur = cur[parts[i]];
        }
        return cur;
    }
    function urlsOf(v) {
        const flat = Array.isArray(v) ? v : (v == null ? [] : [v]);
        return flat.filter((u) => typeof u === 'string' && (/^https?:\/\//.test(u) || /^data:image\//.test(u)));
    }
    const RE_SAFE_PATH = /^\/[a-zA-Z0-9._\-/{}]*$/;
    function validateProtocol(p) {
        if (!p || typeof p !== 'object') throw new Error('AI 未解析出有效协议');
        ['image', 'video'].forEach((kind) => {
            const P = p[kind];
            if (!P) return;
            if (!P.submit || !RE_SAFE_PATH.test(String(P.submit.path || ''))) throw new Error('AI 解析的 ' + kind + ' 提交端点无效');
            if (P.poll && P.poll.path && !RE_SAFE_PATH.test(String(P.poll.path))) throw new Error('AI 解析的 ' + kind + ' 轮询端点无效');
            P.submit.method = String(P.submit.method || 'POST').toUpperCase();
            if (P.poll) P.poll.method = String(P.poll.method || 'GET').toUpperCase();
        });
        if (!p.image && !p.video) throw new Error('AI 没有从文档中找到图片/视频接口');
        return p;
    }
    const DOC_PATHS = ['/docs', '/api-docs', '/doc', '/help', '/about', '/'];
    // 抓一个页面转纯文本：先直连（文档站多有 CORS），被拦再走部署者转发通道；成功返回 ≥200 字符文本
    async function fetchTextSmart(url, ms) {
        for (const via of ['direct', 'proxy']) {
            let u = url, headers = {};
            const pw = via === 'proxy' ? proxyWrap(url) : null;
            if (pw) { u = pw.url; headers = pw.headers; }
            else if (via === 'proxy') continue;
            try {
                const res = await _fetch(u, { headers, signal: (g.AbortSignal && g.AbortSignal.timeout) ? g.AbortSignal.timeout(ms || 12000) : undefined });
                if (!res.ok) continue;
                const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (text.length >= 200) return text;
            } catch (_) { /* 下一种方式 */ }
        }
        return '';
    }
    async function fetchDocPages(cfg) {
        // 用户手动指定的文档页**最高优先**：抓到内容就直接返回（不与自动推断混用）。
        // 全部抓不到（登录页/控制台页是前端渲染的空壳、被反爬等）时不作废整次适配，继续走自动推断——
        // 优先级与拍板一致：AI 联网 → 前端抓用户文档页 → 自动推断 llms.txt/官网路径 → 仍失败才报错
        const manual = String((cfg || {}).docUrls || '').split(/[\n,，\s]+/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x)).slice(0, 3);
        const manualFails = [];
        if (manual.length) {
            const mp = [];
            await Promise.all(manual.map(async (page) => {
                const text = await fetchTextSmart(page, 15000);
                if (text) mp.push({ url: page, text: text.slice(0, 20000) });
                else manualFails.push(page);
            }));
            if (mp.length) return mp;
        }
        let host = '';
        try { host = new URL(cfg.base || '').hostname.toLowerCase().replace(/^www\.|^api\./, '') || ''; } catch (_) {}
        if (!host) {
            if (manualFails.length) throw new Error('手动文档页抓取失败（可能需要登录或是前端渲染的空壳页）：' + manualFails.join('、'));
            return [];
        }
        const hosts = ['www.' + host, host, 'docs.' + host];
        // llms.txt 标准（llmstxt.org）优先：文档索引里挑 API 参考页（.md/.txt/.yaml 纯文本，AI 解析质量最高）。
        // 官网首页的 llms.txt 可能只是营销索引（没有 API 链接）——挑不出参考页就继续试下一个 host
        for (const h of hosts) {
            const idx = await fetchTextSmart('https://' + h + '/llms.txt', 8000);
            if (!idx) continue;
            const abs = (u) => (/^https?:\/\//i.test(u) ? u : ('https://' + h + (u.startsWith('/') ? '' : '/') + u));
            const score = (u) => (/api-reference[^\s)]*\.txt/i.test(u) ? 6 : 0) + (/openapi|api-reference|asynchronous|endpoint/i.test(u) ? 3 : 0) + (/\.(md|txt|yaml)$/i.test(u) && /api|task|endpoint|quickstart/i.test(u) ? 2 : 0);
            const links = (idx.match(/\(([^)\s]+)\)/g) || []).map((m) => m.slice(1, -1));
            const picks = [...new Set(links.filter((u) => score(abs(u)) > 0))].sort((a, b) => score(abs(b)) - score(abs(a))).slice(0, 2);
            if (!picks.length) continue;
            const out = [{ url: 'https://' + h + '/llms.txt', text: idx.slice(0, 4000) }];
            const texts = await Promise.all(picks.map((u) => fetchTextSmart(abs(u), 12000)));
            texts.forEach((t, i) => { if (t) out.push({ url: abs(picks[i]), text: t.slice(0, 20000) }); });
            if (out.length > 1) return out.slice(0, 3);
        }
        // 兜底：常规文档路径
        const pages = [];
        await Promise.all(hosts.slice(0, 2).map(async (h) => {
            for (const p of DOC_PATHS.slice(0, 4)) {
                if (pages.length >= 3) return;
                const text = await fetchTextSmart('https://' + h + p, 12000);
                if (text) {
                    pages.push({ url: 'https://' + h + p, text: text.slice(0, 12000) });
                    if (pages.length >= 3) return;
                }
            }
        }));
        if (!pages.length && manualFails.length) throw new Error('手动文档页抓取失败（可能需要登录或是前端渲染的空壳页，请填公开可访问的文档 URL）：' + manualFails.join('、') + '；自动推断也未找到可用文档页');
        return pages;
    }
    function buildDiscoverPrompt(pages) {
        return [
            '你是 API 协议分析器。下面是一个 AI 中转站的 API 文档内容（可能截断）。',
            '请提取「图片生成」和「视频生成」的接口协议与各模型能力参数，只输出严格 JSON（不要 markdown 代码块、不要解释文字），**models 节点必须输出且放在 JSON 最前面**（防止输出被截断），格式：',
            '{"models":{"<模型id或族前缀*>":{"maxImages":14,"supportedResolutions":["720p"],"durationMin":4,"durationMax":11,"firstLast":true,"refVideoMaxTotalSec":30,"aspectRatios":["16:9"],"audio":true}},"image":{"submit":{"method":"POST","path":"/v1/xx","body":{"字段名":"值"}},"taskIdPath":"data.task_id","poll":{"method":"GET","path":"/v1/xx/{task_id}"},"resultUrlsPath":"data.result[].url"},"video":{"...同结构}}',
            '接口协议规则：同步返回图片的接口省略 taskIdPath 和 poll；找不到图片接口就省略 image 字段，找不到视频接口就省略 video 字段；',
            'body 的值支持占位符 {model}(模型名) {prompt}(提示词) {refs}(参考图URL数组) {image}(单张参考图) {duration}(秒数) {ratio}(比例) {quality}(视频分辨率)，固定值直接写；',
            'path 一律写站内相对路径；taskIdPath/resultUrlsPath 用点路径，数组取全部元素用 []。',
            '如果接口是火山方舟 Ark（路径以 /api/v3/contents/generations 或 /api/v3/images/generations 开头），请省略对应的 image/video 字段——客户端已内置 Ark 适配，不需要自定义协议。',
            '能力参数规则（models 节点，文档里能确认多少写多少，没提到的模型不要编）：',
            '- maxImages=参考图最大张数（0=不支持参考图/仅文字）；文档按模型分别说明时用精确模型 id，同族参数一致时用族前缀加 * （如 "seedance-2.0*"）',
            '- supportedResolutions=支持的分辨率枚举（如 ["480p","720p","1080p"] 或 ["1K","2K","4K"]）',
            '- 视频类：durationMin/durationMax=时长范围（秒）；firstLast=是否支持首尾帧；refVideoMaxTotalSec=参考视频总时长上限；audio=能否生成音频；aspectRatios=画幅比例枚举',
            '注意：不要输出任何模型列表/分类信息，只输出接口协议与能力参数。',
            '文档内容：',
            pages.map((p) => '=== ' + p.url + ' ===\n' + p.text).join('\n\n')
        ].join('\n');
    }
    // 兜底候选：交给对话模型自己去访问的文档地址
    function webCandidateUrls(cfg) {
        let host = '';
        try { host = new URL((cfg || {}).base || '').hostname.toLowerCase().replace(/^www\.|^api\./, '') || ''; } catch (_) {}
        if (!host) return [];
        return ['https://docs.' + host + '/llms.txt', 'https://' + host + '/llms.txt', 'https://www.' + host + '/llms.txt', 'https://docs.' + host, 'https://www.' + host + '/docs'].slice(0, 5);
    }
    function buildWebFallbackPrompt(base, urls) {
        return [
            '你需要分析一个 AI 中转站的 API 文档并提取「图片生成」和「视频生成」的接口协议与各模型能力参数。',
            '中转站地址：' + base,
            '候选文档地址（优先访问 /llms.txt 文档索引，从中找标记 API Reference / api-reference 的页面再访问）：',
            urls.join('\n'),
            '',
            '重要：',
            '- 不要先判断自己有没有浏览能力——立即用你可用的一切方式（网页浏览/搜索工具）实际访问上述地址：先抓 /llms.txt 索引，再挑标记 API Reference / openapi 的页面抓取。部分链路的搜索工具是隐式挂载的，不实际调用就无法知道它是否存在。',
            '- 只有当你确实尝试访问且全部失败/拿不到内容时，才输出 {"error":"no_web_access"}；严禁根据训练记忆编造或猜测任何接口端点和字段——错误的协议会造成用户真实的计费损失。',
            '- 拿到网页内容后，只输出严格 JSON（无 markdown、无解释），**models 节点必须输出且放在最前**：',
            '{"models":{"<模型id或族前缀*>":{"maxImages":14,"supportedResolutions":["720p"],"durationMin":4,"durationMax":11,"firstLast":true,"refVideoMaxTotalSec":30,"aspectRatios":["16:9"],"audio":true}},"image":{"submit":{"method":"POST","path":"/v1/xx","body":{"字段名":"值"}},"taskIdPath":"data.task_id","poll":{"method":"GET","path":"/v1/xx/{task_id}"},"resultUrlsPath":"data.result[].url"},"video":{"...同结构"}}',
            '占位符：{model} {prompt} {refs} {image} {duration} {ratio}；path 一律站内相对路径；同步返回结果的省略 taskIdPath/poll；找不到的类别省略对应字段。'
        ].join('\n');
    }
    // ① AI 联网优先：让对话模型自己去访问文档并解析（有内置浏览工具的模型如 Perplexity/Gemini 可直接完成）
    //    返回协议；模型无联网能力/解析失败返回 null（由调用方回退到前端抓取方案）
    async function tryWebFetchProtocol(cfg, chatModel) {
        try {
            // 用户填的文档页地址优先交给 AI；否则给推断的候选
            const manual = String((cfg || {}).docUrls || '').split(/[\n,，\s]+/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
            const urls = [...new Set(manual.concat(webCandidateUrls(cfg)))].slice(0, 6);
            const r = await chat(cfg, { model: chatModel, messages: [{ role: 'user', content: buildWebFallbackPrompt(cfg.base, urls) }] });
            const m = /\{[\s\S]*\}/.exec(String(r.content || ''));
            if (!m) return null;
            let p;
            try { p = JSON.parse(m[0]); } catch (_) { return null; }
            if (!p || p.error) return null;
            p._source = 'ai_web';
            return validateProtocol(p);
        } catch (_) { return null; }
    }
    // 内置 AI（由主站提供）：中转站没有对话模型时，用内置模型完成协议解析
    async function builtinChat(cfg, messages) {
        const endpoint = String((g.LITE_CONFIG || {}).aiEndpoint || '').trim();
        if (!endpoint) throw new ApiError('未配置内置 AI 地址（config.js 的 aiEndpoint）', 0);
        let res;
        try {
            res = await _fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
        } catch (e) {
            throw new ApiError('内置 AI 无法连接：' + ((e && e.message) || '网络错误'), 0);
        }
        const text = await res.text();
        let d = null; try { d = JSON.parse(text); } catch (_) {}
        if (!res.ok) throw new ApiError('内置 AI 请求失败（HTTP ' + res.status + '）' + (d && d.msg ? '：' + d.msg : ''), res.status, d);
        const content = (d && d.data && d.data.content) || (d && d.content) || '';
        if (!content) throw new ApiError('内置 AI 没有返回内容', 0, d);
        return { content, toolCalls: [], images: [] };
    }
    // 优先用中转站对话模型；失败或没有对话模型时回退到内置 AI
    async function aiChat(cfg, chatModel, messages) {
        if (chatModel) {
            try { return await chat(cfg, { model: chatModel, messages }); } catch (_) { /* 回退内置 AI */ }
        }
        return builtinChat(cfg, messages);
    }
    function parseProtocolContent(r) {
        const m = /\{[\s\S]*\}/.exec(String(r.content || ''));
        if (!m) throw new Error('AI 没有返回协议 JSON');
        let p;
        try { p = JSON.parse(m[0]); } catch (_) { throw new Error('AI 返回的协议 JSON 无法解析，可重试一次'); }
        return validateProtocol(p);
    }
    async function discoverProtocol(cfg, chatModel) {
        // ① 用户粘贴的文档内容最优先：不联网，直接交给 AI 解析（抓不到文档页时最可靠）
        let docText = String((cfg || {}).docText || '').trim();
        if (docText.length >= 200) {
            // 用户可能直接粘贴整页 HTML（如浏览器另存的文档页）：先去脚本/标签，避免把 600KB 的样式塞给模型
            if (/<html|<!doctype|<body|<div/i.test(docText)) {
                docText = docText.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
            }
            const pages = [{ url: '用户粘贴的文档', text: docText.slice(0, 60000) }];
            const p = parseProtocolContent(await aiChat(cfg, chatModel, [{ role: 'user', content: buildDiscoverPrompt(pages) }]));
            p._docPages = ['用户粘贴的文档'];
            return p;
        }
        // ② 有中转站对话模型才尝试 AI 联网（内置模型没有浏览能力，不去编造）
        if (chatModel) {
            const web = await tryWebFetchProtocol(cfg, chatModel);
            if (web) return web;
        }
        // ③ 回退：前端抓取文档页（用户 docUrls 最高优先 → llms.txt 自动推断）→ 用抓到的内容解析
        const pages = await fetchDocPages(cfg);
        if (!pages.length) throw new Error('没有找到可抓取的文档页。可在「文档页地址」填入文档 URL，或把 API 文档内容粘贴到「文档内容」后重试。');
        const p = parseProtocolContent(await aiChat(cfg, chatModel, [{ role: 'user', content: buildDiscoverPrompt(pages) }]));
        p._docPages = pages.map((x) => x.url);
        return p;
    }

    // ===== 结果解析 =====
    function extractImages(content) {
        const urls = [];
        const push = (u) => { if (u && typeof u === 'string' && urls.indexOf(u) === -1) urls.push(u); };
        const scanText = (s) => {
            if (typeof s !== 'string') return;
            let m;
            const md = /!\[[^\]]*\]\(\s*(data:image\/[^)\s]+|https?:\/\/[^)\s]+)\s*\)/g;
            while ((m = md.exec(s))) push(m[1]);
            const dataRe = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;
            while ((m = dataRe.exec(s))) push(m[0]);
            if (!urls.length) {
                const raw = /https?:\/\/[^\s)"'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)"'<>]*)?/gi;
                while ((m = raw.exec(s))) push(m[0]);
            }
        };
        const scanPart = (p) => {
            if (!p) return;
            if (typeof p === 'string') return scanText(p);
            if (p.type === 'text' || p.text) scanText(p.text);
            if (p.image_url) push(typeof p.image_url === 'string' ? p.image_url : p.image_url.url);
            const inl = p.inline_data || p.inlineData;
            if (inl && inl.data) push('data:' + (inl.mime_type || inl.mimeType || 'image/png') + ';base64,' + inl.data);
            if (p.b64_json) push('data:image/png;base64,' + p.b64_json);
        };
        if (Array.isArray(content)) content.forEach(scanPart); else scanPart(content);
        return urls;
    }
    function stripImageMarkdown(s) {
        return String(s || '').replace(/!\[[^\]]*\]\(\s*(data:image\/[^)\s]+|https?:\/\/[^)\s]+)\s*\)/g, '').replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, '').trim();
    }
    function imagesFromImagesApi(d) {
        const arr = (d && (d.data || (d.output && d.output.results) || d.images)) || [];
        const out = [];
        (Array.isArray(arr) ? arr : [arr]).forEach((it) => {
            if (!it) return;
            if (typeof it === 'string') out.push(/^https?:|^data:/.test(it) ? it : 'data:image/png;base64,' + it);
            else if (it.url) out.push(it.url);
            else if (it.b64_json) out.push('data:image/png;base64,' + it.b64_json);
        });
        return out;
    }
    function findVideoUrl(obj) {
        const found = [];
        const walk = (v, key, depth) => {
            if (depth > 6 || v == null) return;
            if (typeof v === 'string') {
                if (/^https?:\/\//.test(v)) found.push({ url: v, key: String(key || '') });
                return;
            }
            if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
            if (typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], k, depth + 1));
        };
        walk(obj, '', 0);
        const score = (f) => (/\.(mp4|mov|webm)(\?|$)/i.test(f.url) ? 4 : 0) + (/video/i.test(f.key) ? 3 : 0) + (/^(url|output|result)/i.test(f.key) ? 1 : 0) - (/(cover|poster|thumb|last_frame|first_frame|image)/i.test(f.key) ? 5 : 0);
        found.sort((a, b) => score(b) - score(a));
        return found.length && score(found[0]) > 0 ? found[0].url : '';
    }
    function statusOf(d) {
        const x = (d && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) ? d.data : d;
        const s = String((x && (x.status || x.task_status || x.state)) || (d && (d.status || d.task_status)) || '').toLowerCase();
        const reason = (x && (x.fail_reason || x.error_message || (x.error && (x.error.message || x.error)))) || (d && d.error && (d.error.message || d.error)) || '';
        const prog = Number((x && (x.progress != null ? x.progress : x.percent)) || 0);
        if (/succe|complet|finish|done/.test(s)) return { state: 'done', progress: 100 };
        if (/fail|error|cancel|reject|expired/.test(s)) return { state: 'failed', reason: typeof reason === 'string' ? reason : JSON.stringify(reason) };
        // 真人素材需要本人核身（MuseReel 扩展）：任务不失败，等核身完成后自动继续
        if (s === 'requires_action') {
            const ra = (x && x.required_action) || (d && d.required_action) || {};
            return { state: 'running', label: '需要真人核身，请打开：' + (ra.action_url || '中转站控制台'), progress: 0, actionUrl: ra.action_url || '' };
        }
        return { state: 'running', label: s || 'processing', progress: isFinite(prog) ? (prog <= 1 && prog > 0 ? prog * 100 : prog) : 0 };
    }
    function taskIdOf(d) {
        const x = d && d.data && typeof d.data === 'object' ? d.data : {};
        return (d && (d.task_id || d.id || d.taskId)) || x.task_id || x.id || x.taskId || '';
    }

    function dataUrlToBlob(u) {
        const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(u);
        if (!m) return null;
        const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: m[1] || 'application/octet-stream' });
    }
    async function toBlob(u) {
        if (/^data:/.test(u)) return dataUrlToBlob(u);
        // 图床 / TOS 直链带 ACAO:*，先直连；直连失败（跨域等）再走同源转发
        try { const r0 = await _fetch(u); if (r0.ok) return r0.blob(); } catch (_) {}
        const pw = proxyWrap(u);
        const r = pw ? await _fetch(pw.url, { headers: pw.headers }) : await _fetch(u);
        if (!r.ok) throw new Error('参考图读取失败');
        return r.blob();
    }

    // ===== 中转站素材库 =====
    // 部分中转站的 Seedance 2.x 参考素材必须先入库，再以 asset://<id> 引用（如 MuseReel）；另一些站直接收图片 URL、没有素材库。
    // 两条入库通道依次尝试：Ark Files（POST /api/v3/files）→ 火山素材 Action 面（CreateAssetGroup + CreateAsset，服务端拉 URL）
    const ASSET_KEY = 'px_lite_asset';
    function assetStore(cfg, k, v) {
        try {
            const o = JSON.parse(localStorage.getItem(ASSET_KEY) || '{}');
            const key = cfg.base + '|' + k;
            if (v === undefined) return o[key] || '';
            if (v === null) delete o[key]; else o[key] = v;
            localStorage.setItem(ASSET_KEY, JSON.stringify(o));
        } catch (_) { return ''; }
        return v;
    }
    const assetCache = new Map();
    const resOf = (d) => (d && (d.Result || (d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : null) || d)) || {};
    async function waitAsset(get, signal) {
        for (let i = 0; i < 40; i++) {
            const x = resOf(await get());
            const s = String(x.Status || x.status || '').toLowerCase();
            if (!s || /active|ready|processed|success|succeeded|uploaded|available/.test(s)) return;
            if (/fail|error|reject|invalid/.test(s)) throw new ApiError('素材入库失败（' + s + '）' + (x.Error ? '：' + JSON.stringify(x.Error) : ''), 0);
            await sleep(1500, signal);
        }
        throw new ApiError('素材入库超时（60 秒仍在处理）', 0);
    }
    async function assetViaFiles(cfg, u, signal) {
        const blob = await toBlob(u);
        const isVideo = /^video\//.test(blob.type || '');
        const fd = new FormData();
        fd.append('purpose', 'user_data');
        fd.append('file', blob, isVideo ? 'ref.mp4' : ('ref.' + (/png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg')));
        const d = await request(cfg, '/api/v3/files', { body: fd, signal });
        const x = resOf(d);
        const id = x.id || x.Id || x.file_id;
        if (!id) throw new ApiError('素材上传未返回 ID', 0, d);
        await waitAsset(() => request(cfg, '/api/v3/files/' + encodeURIComponent(id), { signal }), signal);
        return x.URI || x.uri || ('asset://' + id);
    }
    async function assetViaAction(cfg, u, signal) {
        if (!/^https?:\/\//.test(u)) throw new ApiError('素材库 Action 面只收 http(s) 地址', 0);
        const act = (name, body) => request(cfg, '/?Action=' + name + '&Version=2024-01-01', { body, signal });
        let gid = assetStore(cfg, 'group');
        const create = async () => {
            const x = resOf(await act('CreateAsset', { GroupId: gid, URL: u, AssetType: /\.(mp4|mov|webm)(\?|$)/i.test(u) ? 'Video' : 'Image', Name: 'pixora-' + Date.now() }));
            if (!(x.Id || x.id)) throw new ApiError('素材创建未返回 ID', 0);
            return x;
        };
        if (!gid) {
            const g0 = resOf(await act('CreateAssetGroup', { Name: 'pixora-lite' }));
            gid = g0.Id || g0.id;
            if (!gid) throw new ApiError('素材组创建未返回 ID', 0);
            assetStore(cfg, 'group', gid);
        }
        let x;
        try { x = await create(); } catch (e) {
            if (e.status !== 404 && !/GroupId|group/i.test(e.message || '')) throw e;
            // 缓存的素材组已失效：重建一次
            assetStore(cfg, 'group', null);
            const g1 = resOf(await act('CreateAssetGroup', { Name: 'pixora-lite' }));
            gid = g1.Id || g1.id;
            assetStore(cfg, 'group', gid);
            x = await create();
        }
        const id = x.Id || x.id;
        await waitAsset(() => act('GetAsset', { Id: id }), signal);
        return x.URI || x.uri || ('asset://' + id);
    }
    async function toAsset(cfg, u, signal) {
        if (!u || /^(asset|mm_file):\/\//.test(u)) return u;
        const ck = cfg.base + '|' + u;
        if (assetCache.has(ck)) return assetCache.get(ck);
        const errs = [];
        const via = assetStore(cfg, 'via');
        const order = via === 'action' ? [['action', assetViaAction], ['files', assetViaFiles]] : [['files', assetViaFiles], ['action', assetViaAction]];
        for (const [name, fn] of order) {
            try {
                const uri = await fn(cfg, u, signal);
                assetCache.set(ck, uri);
                assetStore(cfg, 'via', name);
                return uri;
            } catch (e) {
                if (e && e.name === 'AbortError') throw e;
                if (e && (e.status === 401 || e.status === 402 || e.status === 403)) throw e;
                errs.push((name === 'files' ? 'Files' : '素材 Action') + '：' + (e.message || e));
            }
        }
        throw new ApiError('参考图上传到中转站素材库失败（' + errs.join('；') + '）', 0);
    }

    // 协议记忆：同一站点同一模型成功过的协议优先
    const PROTO_KEY = 'px_lite_proto';
    function protoGet(cfg, kind, model) {
        try { return (JSON.parse(localStorage.getItem(PROTO_KEY) || '{}'))[cfg.base + '|' + kind + '|' + model] || ''; } catch (_) { return ''; }
    }
    function protoSet(cfg, kind, model, p) {
        try {
            const o = JSON.parse(localStorage.getItem(PROTO_KEY) || '{}');
            o[cfg.base + '|' + kind + '|' + model] = p;
            localStorage.setItem(PROTO_KEY, JSON.stringify(o));
        } catch (_) {}
    }
    // 认证/余额/限流类错误不是协议不匹配，直接抛出，不再换协议重试
    function isFatal(e) {
        if (!e || e.name === 'AbortError' || e.fatal) return true;
        if (e.status === 401 || e.status === 403 || e.status === 402 || e.status === 429) return true;
        return /(余额|额度|quota|insufficient|balance|invalid.*(api.?key|token)|unauthori|令牌)/i.test(e.message || '');
    }
    async function tryProtocols(cfg, kind, model, order, fns) {
        const remembered = protoGet(cfg, kind, model);
        if (remembered && order.indexOf(remembered) > 0) order = [remembered].concat(order.filter((x) => x !== remembered));
        let firstErr = null, routeErr = null;
        for (const p of order) {
            try {
                const r = await fns[p]();
                protoSet(cfg, kind, model, p);
                return r;
            } catch (e) {
                if (isFatal(e)) throw e;
                // "模型路由不存在"类错误信息量最低（只说明该协议不认这个模型），降级到最后才透出，
                // 避免盖住真正原因（如"该模型需要公网参考图"）
                if (/route is unavailable|no\s+(available\s+)?route|route_unavailable/i.test(e.message || '')) {
                    if (!routeErr) routeErr = e;
                    continue;
                }
                if (!firstErr || (firstErr.status === 404 && e.status !== 404)) firstErr = e;
            }
        }
        throw firstErr || routeErr || new ApiError('该中转站不支持此模型的生成接口');
    }

    // ===== 聊天（流式，支持 tools） =====
    // 三种对话格式自动探测：OpenAI Chat Completions（默认，唯一支持工具调用）→ OpenAI Responses → Anthropic Messages
    function msgText(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map((p) => (p && (p.text || (p.content && String(p.content)))) || '').join('');
        return String(content || '');
    }
    async function sseText(res, onDelta, extract) {
        // 通用 SSE 逐行读取：extract(lineJson, full) 返回本行新增文本（无则 ''）
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '', full = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let j; try { j = JSON.parse(payload); } catch (_) { continue; }
                if (j.error) throw new ApiError(errMsgOf(j, '', 0));
                const piece = extract(j) || '';
                if (piece) { full += piece; if (onDelta) onDelta(piece, full); }
            }
        }
        return full;
    }
    async function chatVia(cfg, o, proto) {
        if (proto === 'responses') {
            // OpenAI Responses：POST /v1/responses（input 简化为拼接文本；SSE 事件 response.output_text.delta）
            const input = o.messages.map((m) => (m.role === 'user' ? 'User: ' : m.role === 'assistant' ? 'Assistant: ' : '') + msgText(m.content)).join('\n\n');
            const res = await request(cfg, '/v1/responses', { body: { model: o.model, input, stream: true }, raw: true, signal: o.signal });
            const ct = res.headers.get('content-type') || '';
            let content = '';
            if (/event-stream/i.test(ct)) {
                content = await sseText(res, o.onDelta, (j) => (j.type === 'response.output_text.delta' ? j.delta : ''));
            } else {
                const j = await res.json();
                (j.output || []).forEach((it) => (it.content || []).forEach((c) => { if (c.text) content += c.text; }));
                if (o.onDelta) o.onDelta(content, content);
            }
            if (!content.trim()) throw new ApiError('模型没有返回内容', 0);
            return { content, toolCalls: [], images: [] };
        }
        if (proto === 'anthropic') {
            // Anthropic Messages：POST /v1/messages（x-api-key + anthropic-version；SSE 事件 content_block_delta）
            const sys = o.messages.filter((m) => m.role === 'system').map((m) => msgText(m.content)).join('\n');
            const msgs = o.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: msgText(m.content) }));
            const body = Object.assign({ model: o.model, max_tokens: 4096, messages: msgs, stream: true }, sys ? { system: sys } : {});
            const headers = { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' };
            const res = await request(cfg, '/v1/messages', { body, raw: true, headers, signal: o.signal });
            const ct = res.headers.get('content-type') || '';
            let content = '';
            if (/event-stream/i.test(ct)) {
                content = await sseText(res, o.onDelta, (j) => (j.type === 'content_block_delta' && j.delta && j.delta.text) ? j.delta.text : '');
            } else {
                const j = await res.json();
                (j.content || []).forEach((c) => { if (c && c.text) content += c.text; });
                if (o.onDelta) o.onDelta(content, content);
            }
            if (!content.trim()) throw new ApiError('模型没有返回内容', 0);
            return { content, toolCalls: [], images: [] };
        }
        // 默认：OpenAI Chat Completions（现有实现，支持工具调用）
        const body = { model: o.model, messages: o.messages, stream: true };
        if (o.tools && o.tools.length) body.tools = o.tools;
        const res = await request(cfg, '/v1/chat/completions', { body, raw: true, signal: o.signal });
        const ct = res.headers.get('content-type') || '';
        if (!/event-stream/i.test(ct)) {
            const j = await res.json();
            const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
            const content = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : '');
            const images = extractImages(msg.content).concat((msg.images || []).map((x) => x.image_url ? x.image_url.url : x.url).filter(Boolean));
            if (content && o.onDelta) o.onDelta(content, content);
            return { content, toolCalls: msg.tool_calls || [], images };
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '', content = '';
        const tools = [];
        const images = [];
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let j; try { j = JSON.parse(payload); } catch (_) { continue; }
                if (j.error) throw new ApiError(errMsgOf(j, '', 0));
                const delta = j.choices && j.choices[0] && j.choices[0].delta;
                if (!delta) continue;
                if (typeof delta.content === 'string' && delta.content) {
                    content += delta.content;
                    if (o.onDelta) o.onDelta(delta.content, content);
                } else if (Array.isArray(delta.content)) {
                    delta.content.forEach((p) => {
                        if (p.text) { content += p.text; if (o.onDelta) o.onDelta(p.text, content); }
                        extractImages([p]).forEach((u) => images.push(u));
                    });
                }
                (delta.images || []).forEach((x) => { const u = x.image_url ? x.image_url.url : x.url; if (u) images.push(u); });
                (delta.tool_calls || []).forEach((tc) => {
                    const i = tc.index != null ? tc.index : tools.length;
                    const t = tools[i] || (tools[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
                    if (tc.id) t.id = tc.id;
                    if (tc.function) {
                        if (tc.function.name) t.function.name += tc.function.name;
                        if (tc.function.arguments) t.function.arguments += tc.function.arguments;
                    }
                });
            }
        }
        extractImages(content).forEach((u) => { if (images.indexOf(u) === -1) images.push(u); });
        return { content, toolCalls: tools.filter(Boolean), images };
    }
    async function chat(cfg, o) {
        // 工具调用只有 completions 支持；其余自动探测顺序：completions → responses → anthropic（含协议记忆）
        let order = (o.tools && o.tools.length) ? ['completions'] : ['completions', 'responses', 'anthropic'];
        // 用户在接口设置里手动锁定的对话格式：只试这一种（失败时直接报真实错误，不再静默回退）
        if (!o.tools && cfg.chatProto && order.indexOf(cfg.chatProto) >= 0) order = [cfg.chatProto];
        const remembered = protoGet(cfg, 'chat', o.model || '*');
        if (!o.tools && remembered && order.indexOf(remembered) > 0) order = [remembered].concat(order.filter((x) => x !== remembered));
        let firstErr = null;
        for (const proto of order) {
            try {
                const r = await chatVia(cfg, o, proto);
                try { protoSet(cfg, 'chat', o.model || '*', proto); } catch (_) {}
                return r;
            } catch (e) {
                if (isFatal(e)) throw e;
                if (!firstErr) firstErr = e;
            }
        }
        throw firstErr || new ApiError('该中转站不支持此模型的对话接口');
    }

    // ===== 图片 =====
    const SIZE_MAP = { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536' };
    // 任务型多模接口（某些自研协议中转站）：POST /v1/images/generations {model, prompt, image_urls:[公网URL]} → 轮询 /v1/images/status/{id}
    // image_urls 必须是公网可访问地址（上游自行下载），本地上传的 data: 图无法使用
    function taskHttpsRefs(refs, max) {
        const out = [];
        for (const r of (refs || []).slice(0, max || 3)) {
            if (/^https:\/\//.test(r)) out.push(r);
        }
        if (!out.length) throw new Error('该模型需要公网可访问的参考图链接（上游会自行下载）；本地上传的图片无法直接使用，可把此前生成结果的图片链接作为参考图');
        return out;
    }
    async function generateImage(cfg, o) {
        const refs = o.refs || [];
        const ratio = o.ratio && o.ratio !== 'auto' ? o.ratio : '';
        const fns = {
            custom: async () => {
                const P = cfg.protocol && cfg.protocol.image;
                if (!P || !P.submit) throw new Error('未配置自定义图片协议');
                const httpsRefs = refs.filter((r) => /^https:\/\//.test(r));
                const body = {};
                Object.entries(P.submit.body || {}).forEach(([k, v]) => {
                    if (v === '{model}') body[k] = o.model;
                    else if (v === '{prompt}') body[k] = o.prompt;
                    else if (v === '{refs}') { if (httpsRefs.length) body[k] = httpsRefs; }  // 无公网参考图时跳过字段（文生图不被卡）
                    else if (v === '{image}') { if (httpsRefs.length) body[k] = httpsRefs[0]; }
                    else if (v === '{ratio}') { if (ratio) body[k] = ratio; }
                    else if (!/^\{[a-zA-Z]+\}$/.test(String(v))) body[k] = v;
                });
                const d = await request(cfg, P.submit.path, { method: P.submit.method || 'POST', body, signal: o.signal });
                const direct = urlsOf(getPath(d, P.resultUrlsPath));
                if (direct.length) return direct;
                const id = taskIdOf(d) || getPath(d, P.taskIdPath);
                if (!id) throw new ApiError('AI 协议：提交响应里没有图片地址也没有任务 ID', 0, d);
                if (o.onStatus) o.onStatus('submitted', 0, 0);
                const pollPath = String((P.poll && P.poll.path) || '').replace('{task_id}', encodeURIComponent(id));
                if (!pollPath) throw new ApiError('AI 协议：缺少轮询端点', 0, d);
                const fin = await poll(o, () => request(cfg, pollPath, { method: (P.poll && P.poll.method) || 'GET', signal: o.signal }));
                const urls = urlsOf(getPath(fin, P.resultUrlsPath));
                if (!urls.length) throw new ApiError('AI 协议：任务完成但没有解析到图片地址', 0, fin);
                return urls;
            },
            task: async () => {
                const images = taskHttpsRefs(refs, 3);
                const d = await request(cfg, '/v1/images/generations', { body: { model: o.model, prompt: o.prompt, image_urls: images }, signal: o.signal });
                const id = taskIdOf(d);
                if (!id) { const u = imagesFromImagesApi(d); if (u.length) return u; throw new ApiError('中转站未返回任务 ID', 0, d); }
                if (o.onStatus) o.onStatus('submitted', 0, 0);
                const fin = await poll(o, () => request(cfg, '/v1/images/status/' + encodeURIComponent(id), { signal: o.signal }));
                const u = findVideoUrl(fin);
                if (!u) throw new ApiError('任务已完成但没有找到图片地址', 0, fin);
                return [u];
            },
            images: async () => {
                // 任务型响应（如 APod：{code:200,data:{task_id}} → 轮询 /v1/images/status/{id}）与同步返回都支持
                const finishTask = async (d) => {
                    const id = taskIdOf(d);
                    if (!id) return null;
                    if (o.onStatus) o.onStatus('submitted', 0, 0);
                    const fin = await poll(o, () => request(cfg, '/v1/images/status/' + encodeURIComponent(id), { signal: o.signal }));
                    const u = urlsOf([].concat(getPath(fin, 'data.result[].url'), getPath(fin, 'data.result[].image_url'), getPath(fin, 'data.result')))[0] || findVideoUrl(fin);
                    if (!u) throw new ApiError('任务已完成但没有找到图片地址', 0, fin);
                    return [u];
                };
                if (refs.length) {
                    // 先试 JSON 传参考图（Seedream / Qwen-Image-Edit / APod 等），再试 OpenAI edits（multipart）
                    try {
                        const body = Object.assign({ model: o.model, prompt: o.prompt, n: 1, image: refs.length === 1 ? refs[0] : refs }, ratio ? { size: SIZE_MAP[ratio], aspect_ratio: ratio } : {});
                        // 任务型站点用 image_urls 数组收参考图（必须公网 https）；与 image 字段并存，各站各取所需
                        const httpsRefs = refs.filter((r) => /^https:\/\//.test(r));
                        if (httpsRefs.length && httpsRefs.length === refs.length) body.image_urls = httpsRefs;
                        const d = await request(cfg, '/v1/images/generations', { body, signal: o.signal });
                        const u = imagesFromImagesApi(d);
                        if (u.length) return u;
                        const t = await finishTask(d);
                        if (t) return t;
                    } catch (e) { if (isFatal(e)) throw e; }
                    const fd = new FormData();
                    fd.append('model', o.model);
                    fd.append('prompt', o.prompt);
                    for (let i = 0; i < refs.length; i++) fd.append(refs.length > 1 ? 'image[]' : 'image', await toBlob(refs[i]), 'ref' + i + '.png');
                    if (ratio) fd.append('size', SIZE_MAP[ratio]);
                    const d2 = await request(cfg, '/v1/images/edits', { body: fd, signal: o.signal });
                    const u2 = imagesFromImagesApi(d2);
                    if (!u2.length) throw new ApiError('中转站未返回图片', 0, d2);
                    return u2;
                }
                const d = await request(cfg, '/v1/images/generations', { body: Object.assign({ model: o.model, prompt: o.prompt, n: 1 }, ratio ? { size: SIZE_MAP[ratio], aspect_ratio: ratio } : {}), signal: o.signal });
                const u = imagesFromImagesApi(d);
                if (u.length) return u;
                const t = await finishTask(d);
                if (t) return t;
                throw new ApiError('中转站未返回图片', 0, d);
            },
            chat: async () => {
                const parts = [{ type: 'text', text: o.prompt + (ratio ? '\n\n画面比例：' + ratio : '') }];
                refs.forEach((u) => parts.push({ type: 'image_url', image_url: { url: u } }));
                const d = await request(cfg, '/v1/chat/completions', { body: { model: o.model, messages: [{ role: 'user', content: parts }], stream: false }, signal: o.signal });
                const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
                const u = extractImages(msg.content).concat((msg.images || []).map((x) => x.image_url ? x.image_url.url : x.url).filter(Boolean));
                if (!u.length) {
                    const txt = typeof msg.content === 'string' ? msg.content.slice(0, 120) : '';
                    throw new ApiError('模型没有返回图片' + (txt ? '：' + txt : ''), 0, d);
                }
                return u;
            }
        };
        // 协议顺序：AI 解析的自定义协议最优先 → 部署者 relayHints 关键词命中 → 任务型优先；名称含编辑族 → 任务型优先
        const hints = (g.LITE_CONFIG || {}).relayHints || {};
        const hitHint = (t, m) => (hints[t] || []).some((k) => { try { return new RegExp(k, 'i').test(m); } catch (_) { return false; } });
        let order = (hitHint('image', o.model) || /(qwen-image|edit)/i.test(o.model)) ? ['task', 'images', 'chat'] : ['images', 'chat', 'task'];
        if (cfg.protocol && cfg.protocol.image) order = ['custom'].concat(order);
        return tryProtocols(cfg, 'image', o.model, order, fns);
    }

    // ===== 视频 =====
    const sleep = (ms, signal) => new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
    // 火山方舟 Ark（Seedance 2.0 / 2.5）：把画布的分辨率档位统一成官方枚举，越界取值宁可不传也不让中转站 400
    function arkResolution(v, model) {
        const s = String(v || '').trim().toLowerCase();
        const map = { '1k': '720p', '2k': '1080p', '1024p': '1080p', '2160p': '4k' };
        let x = map[s] || s;
        const rank = { '480p': 0, '720p': 1, '1080p': 2, '4k': 3 };
        if (!(x in rank)) return '';
        let max = 2;   // 默认最多 1080p
        if (/(fast|mini|极速|轻量|lite)/i.test(String(model || ''))) max = 1;   // 极速/轻量最高 720p
        if (rank[x] > max) x = ['480p', '720p', '1080p', '4k'][max];
        return x;
    }
    function arkDuration(v, model) {
        let n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 0;
        n = Math.round(n);
        const max = /(2[._-]5|seedance-2-5)/i.test(String(model || '')) ? 30 : 15;
        if (n < 4) n = 4;
        if (n > max) n = max;
        return n;
    }
    function arkRatio(v) {
        const s = String(v || '').trim().toLowerCase();
        if (!s || s === 'auto' || s === 'adaptive') return '';
        return /^(16:9|4:3|1:1|3:4|9:16|21:9)$/.test(s) ? s : '';
    }
    // MiniMax 视频 V2（公开 ID 也可能是 Seedance 等非 MiniMax 模型）：分辨率要用大写枚举
    function mmResolution(v, model) {
        const x = arkResolution(v, model);
        return x ? x.replace(/p$/i, 'P').replace(/k$/i, 'K') : '';
    }
    async function poll(o, getOnce) {
        const started = Date.now();
        for (;;) {
            if (Date.now() - started > 20 * 60 * 1000) throw new ApiError('视频生成超时（超过 20 分钟）');
            await sleep(4000, o.signal);
            let d;
            try { d = await getOnce(); } catch (e) { if (isFatal(e) || e.status === 404) throw e; continue; }
            const st = statusOf(d);
            if (st.state === 'failed') throw new ApiError('视频生成失败' + (st.reason ? '：' + st.reason : ''), 0, d);
            if (st.state === 'done') return d;
            if (o.onStatus) o.onStatus(st.label, st.progress, Math.round((Date.now() - started) / 1000));
        }
    }
    // 各协议的「查询任务」与「取结果」，提交与续查共用（页面刷新 / 切换页面后可凭上游任务 ID 继续查询）
    const VIDEO_POLL = {
        newapi: (cfg, id, o) => request(cfg, '/v1/video/generations/' + encodeURIComponent(id), { signal: o.signal }),
        openai: (cfg, id, o) => request(cfg, '/v1/videos/' + encodeURIComponent(id), { signal: o.signal }),
        ark: (cfg, id, o) => request(cfg, '/api/v3/contents/generations/tasks/' + encodeURIComponent(id), { signal: o.signal }),
        arkFlags: (cfg, id, o) => request(cfg, '/api/v3/contents/generations/tasks/' + encodeURIComponent(id), { signal: o.signal }),
        arkDefault: (cfg, id, o) => request(cfg, '/api/v3/contents/generations/tasks/' + encodeURIComponent(id), { signal: o.signal }),
        minimax: (cfg, id, o) => request(cfg, '/v2/query/video_generation/' + encodeURIComponent(id), { signal: o.signal }),
        task: (cfg, id, o) => request(cfg, '/v1/videos/status/' + encodeURIComponent(id), { signal: o.signal }),
        custom: (cfg, id, o) => {
            const P = cfg.protocol && cfg.protocol.video;
            const path = P && String((P.poll && P.poll.path) || '').replace('{task_id}', encodeURIComponent(id));
            if (!path) throw new ApiError('AI 协议：缺少视频轮询端点', 0);
            return request(cfg, path, { method: (P.poll && P.poll.method) || 'GET', signal: o.signal });
        }
    };
    async function finishVideo(cfg, proto, id, o) {
        const fin = await poll(o, () => VIDEO_POLL[proto](cfg, id, o));
        const u = findVideoUrl(fin);
        if (u) return u;
        if (proto === 'custom' && cfg.protocol && cfg.protocol.video && cfg.protocol.video.resultUrlsPath) {
            const urls = urlsOf(getPath(fin, cfg.protocol.video.resultUrlsPath));
            if (urls.length) return urls[0];
        }
        if (proto === 'openai') {
            // 官方 Sora 形态：内容需带 key 下载，转成本地 blob 地址
            const res = await request(cfg, '/v1/videos/' + encodeURIComponent(id) + '/content', { raw: true, signal: o.signal });
            return URL.createObjectURL(await res.blob());
        }
        throw new ApiError('任务已完成但没有找到视频地址', 0, fin);
    }
    async function resumeVideo(cfg, proto, id, o) {
        if (!VIDEO_POLL[proto]) throw new ApiError('未知的视频接口类型：' + proto);
        return finishVideo(cfg, proto, id, o || {});
    }
    async function generateVideo(cfg, o) {
        const dur = Number(o.duration) || 5;
        const ratio = o.ratio && o.ratio !== 'auto' ? o.ratio : '';
        const img = o.image || '';
        // body/path：JSON 提交体与提交端点（可选）。任务阶段失败且报错明确要求改参数时（如被判为视频编辑：duration 必须 -1），
        // 同协议按要求调整后重提，最多 3 次；其他错误不换协议重试（避免重复提交、重复计费）
        const submitted = (proto, id, body, path) => {
            if (o.onTask) { try { o.onTask(proto, id); } catch (_) {} }
            if (o.onStatus) o.onStatus('submitted', 0, 0);
            const run = async () => {
                let cur = id, b = body;
                for (let n = 0; ; n++) {
                    try { return await finishVideo(cfg, proto, cur, o); }
                    catch (e) {
                        const fix = (b && path && n < 3 && e && !e.status && e.name !== 'AbortError') ? fixRejectedParams(b, (e.message || '') + ' ' + JSON.stringify(e.body || '')) : null;
                        if (!fix) throw e;
                        b = fix.body;
                        const nid = taskIdOf(await request(cfg, path, { body: b, signal: o.signal }));
                        if (!nid) throw e;
                        cur = nid;
                        if (o.onTask) { try { o.onTask(proto, nid); } catch (_) {} }
                    }
                }
            };
            return run().catch((e) => { if (e && typeof e === 'object') e.fatal = true; throw e; });
        };
        const fns = {
            custom: async () => {
                const P = cfg.protocol && cfg.protocol.video;
                if (!P || !P.submit) throw new Error('未配置自定义视频协议');
                const httpsRefs = [img].concat(o.lastImage ? [o.lastImage] : []).filter((r) => /^https:\/\//.test(r));
                const body = {};
                Object.entries(P.submit.body || {}).forEach(([k, v]) => {
                    if (v === '{model}') body[k] = o.model;
                    else if (v === '{prompt}') body[k] = o.prompt;
                    else if (v === '{refs}') { if (httpsRefs.length) body[k] = httpsRefs; }
                    else if (v === '{image}') { if (httpsRefs.length) body[k] = httpsRefs[0]; }
                    else if (v === '{duration}') body[k] = dur;
                    else if (v === '{quality}') { if (o.resolution) body[k] = o.resolution; }
                    else if (v === '{resolution}') { if (o.resolution) body[k] = o.resolution; }
                    else if (v === '{ratio}') { if (ratio) body[k] = ratio; }
                    else if (!/^\{[a-zA-Z]+\}$/.test(String(v))) body[k] = v;
                });
                const d = await request(cfg, P.submit.path, { method: P.submit.method || 'POST', body, signal: o.signal });
                const direct = urlsOf(getPath(d, P.resultUrlsPath));
                if (direct.length) return direct[0];
                const id = taskIdOf(d) || getPath(d, P.taskIdPath);
                if (!id) throw new ApiError('AI 协议：提交响应里没有视频地址也没有任务 ID', 0, d);
                return submitted('custom', id);
            },
            newapi: async () => {
                const body = { model: o.model, prompt: o.prompt, duration: dur, seconds: dur };
                if (ratio) { body.aspect_ratio = ratio; body.ratio = ratio; }
                if (img) { body.image = img; body.images = [img]; }
                if (o.lastImage) { body.last_image = o.lastImage; body.images = [img, o.lastImage].filter(Boolean); }
                if (o.resolution) body.resolution = o.resolution;
                const d = await request(cfg, '/v1/video/generations', { body, signal: o.signal });
                const id = taskIdOf(d);
                if (!id) { const u = findVideoUrl(d); if (u) return u; throw new ApiError('中转站未返回任务 ID', 0, d); }
                return submitted('newapi', id);
            },
            openai: async () => {
                let body;
                if (img) {
                    body = new FormData();
                    body.append('model', o.model);
                    body.append('prompt', o.prompt);
                    body.append('seconds', String(dur));
                    body.append('input_reference', await toBlob(img), 'ref.png');
                } else {
                    body = { model: o.model, prompt: o.prompt, seconds: String(dur) };
                    if (ratio) body.size = ratio === '9:16' ? '720x1280' : '1280x720';
                }
                const d = await request(cfg, '/v1/videos', { body, signal: o.signal });
                const id = taskIdOf(d);
                if (!id) throw new ApiError('中转站未返回任务 ID', 0, d);
                return submitted('openai', id);
            },
            ark: async () => {
                // 官方推荐写法（强校验）：参数放 body 顶层。中转站按模型目录逐字段校验，
                // 400 且 error.param 指明字段时只调整该字段重试（扣费前拒绝，重试不计费）
                const res = arkResolution(o.resolution, o.model);
                const ratio = arkRatio(o.ratio);
                const dur = arkDuration(o.duration, o.model);
                const content = [{ type: 'text', text: o.prompt }];
                // 与主站一致：2.5 单张参考图走 reference_image + omni 自动；首尾帧才用 first/last_frame
                const omni = !!img && !o.lastImage && /2[.-]5/.test(o.model || '');
                if (img) content.push({ type: 'image_url', image_url: { url: img }, role: omni ? 'reference_image' : 'first_frame' });
                if (o.lastImage) content.push({ type: 'image_url', image_url: { url: o.lastImage }, role: 'last_frame' });
                const body = { model: o.model, content };
                if (dur) body.duration = dur;
                if (res) body.resolution = res;
                if (ratio) body.ratio = o.lastImage ? 'adaptive' : ratio;
                if (omni) body.omni_reference_task_type = 'auto';
                // 每个字段的备选值（依次尝试，最后一项 undefined = 省略该字段交给模型默认）
                const alt = {
                    duration: [5, 10, undefined].filter((v) => v !== body.duration),
                    resolution: ['720p', '1080p', undefined].filter((v) => v !== body.resolution),
                    ratio: [undefined],
                    omni_reference_task_type: [undefined]
                };
                const tried = [];
                let d = null, lastErr = null, assetErr = null, assetTried = false;
                // 参考图传法：设置里手动指定 > 本站记住的方式 > 自动（先直链，素材相关字段被拒再入库）
                const refMode = cfg.assetMode || assetStore(cfg, 'mode');
                const hasImg = content.some((c) => c.type === 'image_url');
                const useAssets = async () => {
                    assetTried = true;
                    for (const c of content) {
                        if (c.type === 'image_url' && c.image_url && c.image_url.url) c.image_url.url = await toAsset(cfg, c.image_url.url, o.signal);
                    }
                };
                if (hasImg && refMode === 'asset') {
                    try { await useAssets(); } catch (e) { if (cfg.assetMode === 'asset') throw e; assetErr = e; assetStore(cfg, 'mode', null); }
                }
                let msgFixes = 0;
                for (let attempt = 0; attempt < 12; attempt++) {
                    tried.push('duration=' + (body.duration != null ? body.duration : '默认') + ' ratio=' + (body.ratio || '默认') + ' resolution=' + (body.resolution || '默认')
                        + (hasImg ? ' 图=' + (assetTried && !assetErr ? '素材库' : '直链') + '/' + (content.filter((c) => c.type === 'image_url').map((c) => c.role || '无角色').join('+')) : '')
                        + (body.omni_reference_task_type ? ' omni' : ''));
                    try {
                        d = await request(cfg, '/api/v3/contents/generations/tasks', { body, signal: o.signal });
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                        if (!e || e.status !== 400) break;
                        const param = errParamOf(e);
                        tried[tried.length - 1] += ' ✗' + (param || '?');
                        // 报错里明确给出要求（「`duration` must be -1」/「parameters `ratio` … not valid」）：照做后重提
                        const mf = msgFixes < 3 ? fixRejectedParams(body, JSON.stringify(e.body || '') + ' ' + (e.message || '')) : null;
                        if (mf) {
                            msgFixes++;
                            Object.keys(body).forEach((k) => { if (!(k in mf.body)) delete body[k]; });
                            Object.assign(body, mf.body);
                            tried[tried.length - 1] += '→' + mf.names.join(',');
                            continue;
                        }
                        if (alt[param] && alt[param].length) {
                            const next = alt[param].shift();
                            if (next === undefined) delete body[param]; else body[param] = next;
                            continue;
                        }
                        const isMat = /(role|material|image|asset|url|reference)/i.test(param);
                        // 1) 素材类字段被拒（material_role / image_url / asset…）：图片转存中转站素材库再试，角色写法不变
                        if (hasImg && isMat && !assetTried && refMode !== 'url') {
                            try { await useAssets(); continue; } catch (ae) { if (ae && ae.name === 'AbortError') throw ae; assetErr = ae; }
                        }
                        // 2) 规格组合不兼容（video_fields / 未指明字段）：先去掉扩展字段 omni，再逐个省略可选规格，交给模型默认（官方允许全部省略）
                        if (!isMat) {
                            if (body.omni_reference_task_type) { delete body.omni_reference_task_type; continue; }
                            const k = ['ratio', 'duration', 'resolution'].find((x) => body[x] !== undefined);
                            if (k) { delete body[k]; continue; }
                            if (hasImg && !assetTried && refMode !== 'url') {
                                try { await useAssets(); continue; } catch (ae) { if (ae && ae.name === 'AbortError') throw ae; assetErr = ae; }
                            }
                        }
                        // 3) 图片角色降级：参考图 → 首帧 → 不标角色（官方：单图无 role 即首帧）
                        if (hasImg && content.some((c) => c.role === 'reference_image')) {
                            delete body.omni_reference_task_type;
                            content.forEach((c) => { if (c.role === 'reference_image') c.role = 'first_frame'; });
                            continue;
                        }
                        if (hasImg && content.some((c) => c.role)) {
                            content.forEach((c) => { delete c.role; });
                            continue;
                        }
                        if (hasImg && isMat) lastErr.roleRejected = true;
                        break;
                    }
                }
                if (lastErr) {
                    if (lastErr.roleRejected) {
                        lastErr.message = 'Ark：该中转站的模型 ' + o.model + ' 不接受这张图片（' + (assetTried && !assetErr ? '已转存素材库，' : '') + '参考图 / 首帧 / 无角色写法均被拒绝，字段 ' + (errParamOf(lastErr) || 'material_role') + '）。'
                            + (assetErr ? '转存中转站素材库也失败了：' + assetErr.message + '。' : '')
                            + '请确认该模型支持图生视频，或去掉参考图。';
                        lastErr.fatal = true;
                        throw lastErr;
                    }
                    lastErr.message = 'Ark：' + lastErr.message + (lastErr.status === 400 ? '（model=' + o.model + '；已尝试：' + tried.join(' / ') + (assetErr ? '；素材库：' + assetErr.message : '') + '）' : '');
                    throw lastErr;
                }
                // 记住本站参考图传法：素材库成功 → 以后直接入库（只记这一种，直链成功不锁定，其他模型仍可自动入库）
                if (hasImg && !cfg.assetMode && assetTried && !assetErr) assetStore(cfg, 'mode', 'asset');
                const id = taskIdOf(d);
                if (!id) throw new ApiError('中转站未返回任务 ID', 0, d);
                return submitted('ark', id, body, '/api/v3/contents/generations/tasks');
            },
            arkDefault: async () => {
                // 不带 duration：部分 2.5 模型目录只接受省略时长（按官方 -1/自动处理），用于 duration 被 400 拒绝时兜底
                const res = arkResolution(o.resolution, o.model);
                const ratio = arkRatio(o.ratio);
                const content = [{ type: 'text', text: o.prompt }];
                if (img) content.push({ type: 'image_url', image_url: { url: img }, role: 'first_frame' });
                if (o.lastImage) content.push({ type: 'image_url', image_url: { url: o.lastImage }, role: 'last_frame' });
                const body = { model: o.model, content };
                if (res) body.resolution = res;
                if (ratio) body.ratio = ratio;
                let d;
                try {
                    d = await request(cfg, '/api/v3/contents/generations/tasks', { body, signal: o.signal });
                } catch (e) {
                    if (e) e.message = 'Ark 默认时长：' + e.message;
                    throw e;
                }
                const id = taskIdOf(d);
                if (!id) throw new ApiError('中转站未返回任务 ID', 0, d);
                return submitted('arkDefault', id);
            },
            arkFlags: async () => {
                // 旧式写法：参数追加在提示词后（少数只兼容旧写法的中转站）
                const res = arkResolution(o.resolution, o.model);
                const ratio = arkRatio(o.ratio);
                const dur = arkDuration(o.duration, o.model);
                const flags = (res ? ' --resolution ' + res : '') + (ratio ? ' --ratio ' + ratio : '') + (dur ? ' --duration ' + dur : '');
                const content = [{ type: 'text', text: o.prompt + flags }];
                if (img) content.push({ type: 'image_url', image_url: { url: img }, role: 'first_frame' });
                if (o.lastImage) content.push({ type: 'image_url', image_url: { url: o.lastImage }, role: 'last_frame' });
                let d;
                try {
                    d = await request(cfg, '/api/v3/contents/generations/tasks', { body: { model: o.model, content }, signal: o.signal });
                } catch (e) {
                    if (e) e.message = 'Ark 旧写法：' + e.message;
                    throw e;
                }
                const id = taskIdOf(d);
                if (!id) throw new ApiError('中转站未返回任务 ID', 0, d);
                return submitted('arkFlags', id);
            },
            minimax: async () => {
                // MiniMax 视频 V2（/v2/video_generation）：content 数组 + 大写的 resolution + 必填 duration
                const res = mmResolution(o.resolution, o.model);
                const dur = arkDuration(o.duration, o.model);
                const ratio = arkRatio(o.ratio);
                const content = [{ type: 'text', text: o.prompt }];
                if (img) content.push({ type: 'image_url', image_url: { url: img }, role: 'first_frame' });
                if (o.lastImage) content.push({ type: 'image_url', image_url: { url: o.lastImage }, role: 'last_frame' });
                const body = {
                    model: o.model,
                    content,
                    resolution: res || '720P',
                    duration: dur || 5,
                    // 文生视频必须给具体画幅；图生视频由首帧决定，可省略
                    ratio: img ? 'adaptive' : (ratio || '16:9')
                };
                let d;
                try {
                    d = await request(cfg, '/v2/video_generation', { body, signal: o.signal });
                } catch (e) {
                    if (e) e.message = 'MiniMax V2：' + e.message + (e.status === 400 ? '（请求：model=' + o.model + '，duration=' + body.duration + '，ratio=' + body.ratio + '，resolution=' + body.resolution + '）' : '');
                    throw e;
                }
                const id = taskIdOf(d);
                if (!id) throw new ApiError('中转站未返回任务 ID', 0, d);
                return submitted('minimax', id);
            },
            task: async () => {
                // 任务型多模接口：模型名常带 -t2v/-i2v/-r2v 后缀；image_urls 必须公网 https（首帧 1 张 / 首尾帧 2 张）
                let model = o.model;
                if (!/-t2v|-i2v|-r2v$/i.test(model)) model += (img ? '-i2v' : '-t2v');
                const images = img ? taskHttpsRefs([img].concat(o.lastImage ? [o.lastImage] : []), 2) : [];
                if (img && !images.length) throw new Error('该模型需要公网可访问的首帧图链接；本地上传的图片无法直接使用');
                const body = { model, prompt: o.prompt, duration: dur, resolution: o.resolution || '720p' };
                if (!img) body.aspect_ratio = ratio === 'auto' || !ratio ? 'adaptive' : ratio;
                if (images.length) body.image_urls = images;
                const d = await request(cfg, '/v1/videos/generations', { body, signal: o.signal });
                const id = taskIdOf(d);
                if (!id) { const u = findVideoUrl(d); if (u) return u; throw new ApiError('中转站未返回任务 ID', 0, d); }
                return submitted('task', id);
            }
        };
        // 协议顺序：AI 解析的自定义协议最优先 → 用户手动锁定 → 部署者 relayHints 命中 → 任务型优先；否则按模型族常规顺序
        const hints = (g.LITE_CONFIG || {}).relayHints || {};
        const hitHint = (t, m) => (hints[t] || []).some((k) => { try { return new RegExp(k, 'i').test(m); } catch (_) { return false; } });
        let order;
        if (/(seedance|doubao|jimeng)/i.test(o.model)) {
            // Seedance / 即梦：Ark 官方写法 → 省略时长（2.5 只接受默认时用）→ 旧写法 → MiniMax V2
            order = ['ark', 'arkDefault', 'arkFlags', 'minimax', 'newapi', 'openai', 'task'];
        } else if (/(minimax|hailuo)/i.test(o.model)) {
            order = ['minimax', 'newapi', 'openai', 'ark', 'arkDefault', 'arkFlags', 'task'];
        } else {
            order = hitHint('video', o.model) ? ['task', 'newapi', 'minimax', 'ark', 'arkDefault', 'arkFlags', 'openai']
                : ['newapi', 'openai', 'ark', 'arkDefault', 'arkFlags', 'minimax', 'task'];
        }
        if (cfg.protocol && cfg.protocol.video) order = ['custom'].concat(order);
        // Seedance / 即梦：内置适配优先，再退到 AI 自定义协议
        if (/(seedance|doubao|jimeng)/i.test(o.model) && cfg.protocol && cfg.protocol.video) {
            order = ['ark', 'arkDefault', 'arkFlags', 'minimax', 'custom'].concat(order.filter((x) => x !== 'ark' && x !== 'arkDefault' && x !== 'arkFlags' && x !== 'minimax' && x !== 'custom'));
        }
        // 用户手动锁定视频接口（设置里选「火山方舟 Ark」「MiniMax V2」等）：只试锁定的协议，失败就报真实错误
        if (cfg.videoProto && fns[cfg.videoProto]) order = (cfg.videoProto === 'ark') ? ['ark', 'arkDefault', 'arkFlags'] : [cfg.videoProto];
        return tryProtocols(cfg, 'video', o.model, order, fns);
    }

    g.LiteAPI = { ApiError, normBase, classify, listModels, fetchModelsPage, discoverProtocol, validateProtocol, chat, generateImage, generateVideo, resumeVideo, extractImages, stripImageMarkdown, findVideoUrl, statusOf, dataUrlToBlob, proxyWrap };
})(window);
