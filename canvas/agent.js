/**
 * agent.js —— 无限画布 · AI 助手（第三期 AI Agent）
 *   对话式助手：用自然语言让 AI 在画布上创建节点、写提示词、连线、使用角色库与导演台、发起生成
 *   - 后端 /api/agent/chat（SSE）只负责模型推理；工具在前端执行（画布状态在前端），结果作为 functionResponse 回传继续推理
 *   - 所有写操作经 CanvasAPI 适配层：静默执行（拦截 alert/toast），一次用户请求（回合）结束时只记一次撤销快照
 *   - 消耗积分的生成只能经 request_generation：对话内确认卡片（模型/数量/提示词/参考图/单价/总积分/余额），用户批准后才执行
 *   - 对话随画布保存（文档 agent 字段：最近 50 条消息、≤300KB）；用户内容/AI 回复放在 px-no-i18n 内不参与界面翻译
 *   - AI 文本经「先转义再解析」的 Markdown 渲染（不信任任何 HTML），链接只允许 https: 与当前画布中存在的 node:id
 */
(function (global) {
    'use strict';

    const API_PATH = '/api/agent/chat';
    const MAX_ROUNDS = 12;            // 单次用户请求最多工具循环轮数
    const MAX_STORE = 50;             // 随画布保存的最近消息数
    const MAX_STORE_BYTES = 300 * 1024;
    const MAX_SEND = 40;              // 每次请求携带的最近消息数（服务端另做体积截断）
    const MAX_INPUT = 4000;
    const REQ_TIMEOUT = 100000;
    const GEN_CONCURRENCY = 3;
    const W_MIN = 340, W_MAX = 640, W_DEF = 400;
    const IMAGE_ASPECTS = ['auto', '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '5:4', '4:5', '9:16'];
    const VIDEO_ASPECTS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
    const LIM = { create: 16, update: 32, edges: 32, del: 32, ids: 64, gen: 16, prompt: 4000, name: 40, text: 2000 };

    // ================= 工具函数 =================
    const svg = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const SPARK_PATH = 'M12 2.5c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z';
    const IC = {
        spark: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${SPARK_PATH}"/><path d="M19 15.5c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z" opacity=".6"/></svg>`,
        sparkGrad: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="agRailGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eefbc4"/><stop offset=".5" stop-color="#c4f17b"/><stop offset="1" stop-color="#8fd13f"/></linearGradient></defs><path fill="url(#agRailGrad)" d="${SPARK_PATH}"/><path fill="url(#agRailGrad)" d="M19 15.5c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z" opacity=".75"/></svg>`,
        send: svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>', 2.2),
        stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>',
        newChat: svg('<path d="M20 12.5V17a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3v-3A2.5 2.5 0 0 1 2 17V7a2.5 2.5 0 0 1 2.5-2.5H12"/><path d="M18 2.5v6M15 5.5h6"/>'),
        max: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
        min: svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
        x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
        clip: svg('<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>'),
        at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>'),
        eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
        search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
        plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
        edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
        link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
        unlink: svg('<path d="M9 15 15 9"/><path d="M10.5 5.5 12 4a4 4 0 0 1 5.7 5.7l-1.5 1.5M13.5 18.5 12 20a4 4 0 0 1-5.7-5.7l1.5-1.5"/>'),
        trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'),
        grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
        cursor: svg('<path d="M5 3.5 18.5 10l-6 1.8-2.6 5.7z"/>'),
        target: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>'),
        group: svg('<rect x="3" y="3" width="18" height="18" rx="2.5" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>'),
        user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'),
        clap: svg('<path d="M4 10h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 10 3.3 7.1a1.5 1.5 0 0 1 1.1-1.8l13-3.2a1.5 1.5 0 0 1 1.8 1.1L19.9 6 4 10z"/>', 1.7),
        coin: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>`,
        list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
        help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17h.01"/>'),
        pulse: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
        check: svg('<path d="m5.5 12.5 4.2 4 8.8-9"/>', 2.6),
        warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
        down: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
        right: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
        copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
        retry: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
        image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
        video: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M10.2 9.3l5 2.7-5 2.7z"/>'),
        text: svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
        audio: svg('<path d="M4.5 9.5v5h3.5l4.5 3.5v-12L8 9.5H4.5z"/><path d="M16 9a4.2 4.2 0 010 6"/>'),
        node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>',
        wand: svg('<path d="m15 4 5 5L9 20H4v-5z"/><path d="M13 6l5 5"/>'),
        film: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
        layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
        bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function safeImg(u) { u = String(u || ''); return (/^\/api\/img[/?]/.test(u) || /^https:\/\//.test(u) || /^blob:/.test(u)) ? u : ''; }
    function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function lang() { return (typeof global.getCurrentLang === 'function') ? global.getCurrentLang() : 'zh'; }
    function L(zh, en) { return lang() === 'en' ? en : zh; }
    function PL(n, one, many) { return n + ' ' + (n === 1 ? one : many); } // 英文单复数
    // 技能 name 规范化（与后端 normName 一致）：小写、下划线/空格/点转连字符、去非法字符、合并连字符、截断 64
    function skName(raw) {
        return String(raw || '').normalize('NFKC').toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
    }
    // 行级 diff（LCS，去掉公共前后缀后计算；规模过大时退化为整段替换）→ [{k:'='|'+'|'-', t}]
    function lineDiff(a, b) {
        const A = String(a || '').split(/\r?\n/), B = String(b || '').split(/\r?\n/);
        let s = 0;
        while (s < A.length && s < B.length && A[s] === B[s]) s++;
        let ea = A.length, eb = B.length;
        while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
        const out = A.slice(0, s).map(t => ({ k: '=', t }));
        const a2 = A.slice(s, ea), b2 = B.slice(s, eb), n = a2.length, m = b2.length;
        if (n * m > 4e6) { a2.forEach(t => out.push({ k: '-', t })); b2.forEach(t => out.push({ k: '+', t })); }
        else {
            const W = m + 1, dp = new Uint32Array((n + 1) * W);
            for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a2[i] === b2[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
            let i = 0, j = 0;
            while (i < n && j < m) {
                if (a2[i] === b2[j]) { out.push({ k: '=', t: a2[i] }); i++; j++; }
                else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) out.push({ k: '-', t: a2[i++] });
                else out.push({ k: '+', t: b2[j++] });
            }
            while (i < n) out.push({ k: '-', t: a2[i++] });
            while (j < m) out.push({ k: '+', t: b2[j++] });
        }
        A.slice(ea).forEach(t => out.push({ k: '=', t }));
        return out;
    }
    function base() { return (global.API_CONFIG && global.API_CONFIG.baseUrl) || ''; }
    function authJson() { return Object.assign({ 'Content-Type': 'application/json' }, typeof global.authHeaders === 'function' ? global.authHeaders() : {}); }
    function toast(msg, type, action) {
        if (typeof global.pxToast === 'function') global.pxToast(msg, Object.assign(type ? { type } : {}, action ? { action } : {}));
    }
    function fmtNum(n) { return Math.round(n || 0).toLocaleString('en-US'); }
    function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
    function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function aspectNum(a) { const m = /^(\d+):(\d+)$/.exec(a || ''); return m ? (+m[1] / +m[2]) : 0; }
    function uniq(a) { return Array.from(new Set(a)); }
    function scaleVar() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1; }

    // ================= Markdown（先转义再解析：不信任任何 HTML） =================
    function linkHtml(text, url) {
        if (/^node:/i.test(url)) {
            const id = url.slice(5);
            const b = global.CanvasBlocks && global.CanvasBlocks.getById(id);
            if (b) return `<button type="button" class="ag-nchip" data-node="${esc(id)}" title="${esc(L('在画布上定位', 'Locate on canvas'))}">${IC.node}<span>${esc(text)}</span></button>`;
            return `<span class="ag-nchip dead">${esc(text)}</span>`;
        }
        if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(text)}</a>`;
        return esc(text);
    }
    function mdInline(raw, depth) {
        raw = String(raw || '');
        if ((depth || 0) > 3) return esc(raw);
        const re = /`([^`\n]+)`|\[([^\]\n]{1,200})\]\(([^()\s]{1,600})\)|\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|~~([^~\n]+)~~/g;
        let out = '', last = 0, m;
        while ((m = re.exec(raw))) {
            out += esc(raw.slice(last, m.index));
            if (m[1] != null) out += `<code>${esc(m[1])}</code>`;
            else if (m[2] != null) out += linkHtml(m[2], m[3]);
            else if (m[4] != null) out += `<strong>${mdInline(m[4], (depth || 0) + 1)}</strong>`;
            else if (m[5] != null) out += `<em>${mdInline(m[5], (depth || 0) + 1)}</em>`;
            else if (m[6] != null) out += `<del>${esc(m[6])}</del>`;
            last = re.lastIndex;
        }
        return out + esc(raw.slice(last));
    }
    // 卡片内 AI 文本（提问/计划/生成理由）：行内 Markdown（节点链接 → 可定位 chip），换行转 <br>，同样先转义再解析
    function mdLine(raw) { return String(raw || '').replace(/\r\n?/g, '\n').split('\n').map(x => mdInline(x)).join('<br>'); }
    function md(src, streaming) {
        const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        let html = '', para = [], list = null, i = 0;
        const flushPara = () => { if (para.length) { html += '<p>' + para.map(x => mdInline(x)).join('<br>') + '</p>'; para = []; } };
        const flushList = () => { if (list) { html += `<${list.t}>` + list.items.map(it => `<li${it.sub ? ' class="sub"' : ''}>${mdInline(it.s)}</li>`).join('') + `</${list.t}>`; list = null; } };
        const flush = () => { flushPara(); flushList(); };
        while (i < lines.length) {
            const l = lines[i];
            let m;
            if (/^\s*```/.test(l)) {
                flush();
                const buf = [];
                i++;
                while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
                i++;
                html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
                continue;
            }
            if ((m = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(l))) { flush(); html += `<h4 class="ag-h${m[1].length <= 2 ? ' big' : ''}">${mdInline(m[2])}</h4>`; i++; continue; }
            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); html += '<hr>'; i++; continue; }
            if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
                flush();
                const rows = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())); i++; }
                html += '<div class="ag-tbl"><table>' + rows.map((r, k) => '<tr>' + r.map(c => k === 0 ? `<th>${mdInline(c)}</th>` : `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') + '</table></div>';
                continue;
            }
            if ((m = /^\s*>\s?(.*)$/.exec(l))) {
                flush();
                const buf = [];
                while (i < lines.length && (m = /^\s*>\s?(.*)$/.exec(lines[i]))) { buf.push(m[1]); i++; }
                html += '<blockquote>' + buf.map(x => mdInline(x)).join('<br>') + '</blockquote>';
                continue;
            }
            if ((m = /^(\s*)(?:[-*+•])\s+(.*)$/.exec(l)) || (m = /^(\s*)\d{1,3}[.)、]\s+(.*)$/.exec(l))) {
                flushPara();
                const t = /^\s*\d/.test(l) ? 'ol' : 'ul';
                if (list && list.t !== t && m[1].length < 2) flushList();
                if (!list) list = { t, items: [] };
                list.items.push({ s: m[2], sub: m[1].length >= 2 });
                i++;
                continue;
            }
            if (!l.trim()) { flush(); i++; continue; }
            flushList();
            para.push(l);
            i++;
        }
        flush();
        if (streaming) {
            const cur = '<span class="ag-cursor"></span>';
            if (/<\/p>$/.test(html)) html = html.slice(0, -4) + cur + '</p>';
            else if (/<\/li><\/(ul|ol)>$/.test(html)) html = html.replace(/<\/li><\/(ul|ol)>$/, cur + '</li></$1>');
            else html += cur;
        }
        return html;
    }
    // _TEXTASK_BEGIN _TEXTASK_20261029 兜底：AI 没调用 ask_user，而是把提问写进了正文
    //   ① 明确标记行「[ ask_user options: ]」/「[ask_user options]」/「ask_user:」+ 其后列表（可在 ``` 代码块内）
    //   ② 列表项为「[选项](ask_user)」伪链接（≥2 条）
    //   ③ 正文以问句结尾，问句后紧跟 2-4 条短列表（每条 ≤60 字）且列表就是回复结尾
    // 返回 { text: 去掉标记/选项后的正文, options: [...], kind } 或 null；保守匹配，普通说明列表不触发
    function parseTextAsk(src) {
        const text = String(src || '').replace(/\r\n?/g, '\n');
        if (!text.trim() || text.length > 8000 || !/\n/.test(text)) return null;
        const lines = text.split('\n');
        const MARK = /^\s*(?:`{3,}\s*\w*\s*)?(?:\[\s*ask[\s_-]?user\b[^\]\n]{0,24}\]|ask_user(?:[\s_]*options?)?)\s*[:：]?\s*$/i;
        const FENCE = /^\s*`{3,}\s*\w*\s*$/;
        const ITEM = /^\s*(?:[-*+]\s+|[•·●▪◦]\s*|(?:\d{1,2}[.)．]|\d{1,2}、|[（(]\d{1,2}[)）])\s*)(\S.*?)\s*$/;
        const LINK = /^\[([^\]\n]{1,120})\]\(\s*ask[\s_-]?user[^)\n]*\)\s*[。；;]?$/i;
        const clean = (s) => {
            s = String(s || '').trim();
            const lk = LINK.exec(s);
            if (lk) s = lk[1];
            s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^["“「『]([^"”」』]+)["”」』]$/, '$1').replace(/[。；;，,]+$/, '').trim();
            return s;
        };
        const join = (a) => a.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        // ① 明确标记
        for (let i = 0; i < lines.length; i++) {
            if (!MARK.test(lines[i])) continue;
            let s = i, j = i + 1;
            const inlineFence = /^\s*`{3,}/.test(lines[i]);
            let fenced = inlineFence;
            if (!fenced && i > 0 && FENCE.test(lines[i - 1])) { s = i - 1; fenced = true; }
            const opts = [];
            while (j < lines.length) {
                const l = lines[j];
                if (!l.trim()) { j++; continue; }
                const m = ITEM.exec(l);
                if (m) { const o = clean(m[1]); if (o && o.length <= 80 && opts.length < 6) opts.push(o); j++; continue; }
                break;
            }
            if (fenced && j < lines.length && FENCE.test(lines[j])) j++;
            return { text: join(lines.slice(0, s).concat(lines.slice(j))), options: opts.length >= 2 ? opts : [], kind: 'marker' };
        }
        // ② 「[选项](ask_user)」伪链接列表
        for (let i = 0; i < lines.length; i++) {
            const m0 = ITEM.exec(lines[i]);
            if (!m0 || !LINK.test(m0[1].trim())) continue;
            let j = i;
            const opts = [];
            while (j < lines.length) {
                const m = ITEM.exec(lines[j]);
                if (m && LINK.test(m[1].trim())) { if (opts.length < 6) opts.push(clean(m[1])); j++; continue; }
                if (!lines[j].trim() && j + 1 < lines.length && ITEM.exec(lines[j + 1]) && LINK.test(ITEM.exec(lines[j + 1])[1].trim())) { j++; continue; }
                break;
            }
            if (opts.length >= 2) return { text: join(lines.slice(0, i).concat(lines.slice(j))), options: opts, kind: 'link' };
        }
        // ③ 问句 + 紧随其后的 2-4 条短列表（必须是回复结尾）
        let e = lines.length - 1;
        while (e >= 0 && !lines[e].trim()) e--;
        let k = e;
        const items = [];
        while (k >= 0) {
            const m = ITEM.exec(lines[k]);
            if (!m || /^\s{2,}/.test(lines[k])) break;
            items.unshift({ raw: m[1], num: /^\s*[\d（(]/.test(lines[k]) });
            k--;
        }
        if (items.length < 2 || items.length > 4) return null;
        if (items.some(x => x.num !== items[0].num)) return null;
        let q = k;
        if (q >= 0 && !lines[q].trim()) q--;
        if (q < 0) return null;
        const ql = lines[q].replace(/[\s*_`]+$/, '');
        if (!/[?？]$/.test(ql) || ITEM.test(lines[q])) return null;
        const opts = items.map(x => clean(x.raw));
        if (opts.some(o => !o || o.length > 60 || /[?？]$/.test(o) || /\]\(node:/.test(o))) return null;
        if (new Set(opts).size !== opts.length) return null;
        return { text: join(lines.slice(0, q + 1)), options: opts, kind: 'question' };
    }
    // 流式输出中：标记行一出现就把其后内容隐藏（结束后再渲染为按钮）
    function hideTextAskTail(src) {
        const lines = String(src || '').split('\n');
        const i = lines.findIndex(l => /^\s*(?:`{3,}\s*\w*\s*)?\[\s*ask[\s_-]?user\b/i.test(l));
        if (i === -1) return src;
        let s = i;
        if (s > 0 && /^\s*`{3,}\s*\w*\s*$/.test(lines[s - 1])) s--;
        return lines.slice(0, s).join('\n').replace(/\s+$/, '');
    }
    // _TEXTASK_END

    // ================= 画布适配层（所有工具统一经此调用现有对象） =================
    const CanvasAPI = {
        CB() { return global.CanvasBlocks; },
        CE() { return global.CanvasEdges; },
        PB() { return global.PromptBar; },
        get(id) { return (typeof id === 'string' && id && this.CB()) ? this.CB().getById(id) || null : null; },
        typeOf(b) {
            if (!b) return '';
            if (b.nodeType === 'gen') return this.CB()._genCategoryOf(b) === 'video' ? 'video_gen' : 'image_gen';
            if (b.nodeType === 'text') return 'text';
            if (b.subType === 'character') return 'character';
            if (b.mediaType === 'video') return 'video_ref';
            if (b.mediaType === 'audio') return 'audio_ref';
            return 'image_ref';
        },
        hasResult(b) { return !!(b && (b.videoUrl || b.imageUrl || (b.mediaType && b.mediaUrl))); },
        statusOf(b) {
            if (!b) return '';
            if (b.nodeType === 'gen') {
                if (b.status === 'generating') return 'generating';
                if (b.status === 'failed') return 'failed';
                return this.hasResult(b) ? 'done' : 'idle';
            }
            if (b.status === 'loading') return 'loading';
            return 'ready';
        },
        edgesIn(id) { return (this.CE().edges || []).filter(e => e.to === id); },
        edgesOut(id) { return (this.CE().edges || []).filter(e => e.from === id); },
        brief(b, plen) {
            const o = { id: b.id, type: this.typeOf(b), name: str(b.name, 60), status: this.statusOf(b), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
            if (b.nodeType === 'gen') {
                o.prompt = clip(b.prompt || '', plen == null ? 200 : plen);
                o.model = b.model || '';
                o.hasResult = this.hasResult(b);
            } else if (b.nodeType === 'text') o.text = clip(b.text || '', plen == null ? 200 : plen);
            if (b.subType === 'character') o.characterId = b.characterId || '';
            const ins = this.edgesIn(b.id).map(e => e.from), outs = this.edgesOut(b.id).map(e => e.to);
            if (ins.length) o.upstream = ins.slice(0, 20);
            if (outs.length) o.downstream = outs.slice(0, 20);
            if (b.directorShotId) o.directorShot = true;
            if (b.panorama || b.isPanorama) o.panorama = true;
            if (b.subType === 'stage3d' && global.Stage3DCore) { o.stage3d = global.Stage3DCore.stats(b.stage3d || {}); o.tip = '3D 片场节点：用 stage_read / stage_apply_ops / stage_snapshot 操作'; }
            if (b.turnaround) o.turnaround = b.turnaround.mode;
            if (b.panoShot) o.panoShot = true;
            return o;
        },
        detail(b) {
            const o = this.brief(b, LIM.prompt);
            if (b.nodeType === 'gen') {
                Object.assign(o, { aspectRatio: b.aspectRatio || '', size: b.size || '', quality: b.quality || '' });
                if (o.type === 'video_gen') Object.assign(o, { duration: b.duration || 5, resolution: b.resolution || '', videoMode: b.videoMode || 'reference' });
                o.price = this.priceOf(b);
                o.refImages = this.CE().getUpstreamImages(b.id).length;
                if (b.errorMsg) o.error = str(b.errorMsg, 200);
            }
            if (b.nodeType === 'text') o.text = str(b.text, LIM.text);
            o.upstreamNodes = this.edgesIn(b.id).map(e => this.get(e.from)).filter(Boolean).map(n => ({ id: n.id, type: this.typeOf(n), name: str(n.name, 60) }));
            if (this.hasResult(b)) o.resultUrl = safeImg(b.videoUrl || b.imageUrl || b.mediaUrl);
            return o;
        },
        allowAspects(isVideo, fl, model) {
            if (fl) return ['auto'];
            if (!isVideo) return IMAGE_ASPECTS;
            // 模型限定比例（如稳定版仅 16:9 / 9:16）：与通用视频比例取交集
            const vc = model ? this.caps(model) : null;
            return (vc && vc.aspectRatios) ? VIDEO_ASPECTS.filter(a => vc.aspectRatios.indexOf(a) !== -1) : VIDEO_ASPECTS;
        },
        // ---- 模型 ----
        modelCfg(id) { const PB = this.PB(); return (PB && PB.modelConfigMap && PB.modelConfigMap[id]) || null; },
        isVideoModel(id) { const PB = this.PB(); return !!(PB && PB._isVideoModel && PB._isVideoModel(id)); },
        caps(id) { const PB = this.PB(); return (PB && PB.videoCaps) ? PB.videoCaps(id) : null; },
        supportsFL(id) { const c = this.caps(id); return c ? c.firstLast : /seedance-2|minimax-h3/i.test(String(id || '')); },
        defaultImageModel() {
            const PB = this.PB();
            if (!PB) return '';
            if (PB.lastImageModel && PB.modelConfigMap[PB.lastImageModel] && !this.isVideoModel(PB.lastImageModel)) return PB.lastImageModel;
            if (PB.currentModel && PB.modelConfigMap[PB.currentModel] && !this.isVideoModel(PB.currentModel)) return PB.currentModel;
            return (PB._firstModelOfMode && PB._firstModelOfMode(false)) || '';
        },
        defaultVideoModel() {
            const PB = this.PB();
            if (!PB) return '';
            if (PB.lastVideoModel && this.isVideoModel(PB.lastVideoModel)) return PB.lastVideoModel;
            return (PB._firstModelOfMode && PB._firstModelOfMode(true)) || '';
        },
        imageSizes(id) { const c = this.modelCfg(id); return (c && Array.isArray(c.supportedResolutions) && c.supportedResolutions.length) ? c.supportedResolutions.map(String) : ['1K', '2K', '4K']; },
        videoRes(id) { const c = this.modelCfg(id); return (c && Array.isArray(c.supportedResolutions) && c.supportedResolutions.length) ? c.supportedResolutions.map(String) : ['720p']; },
        durRange(id) { const c = this.modelCfg(id) || {}; return [c.durationMin || 4, c.durationMax || 15]; },
        defaultRes(id) { const l = this.videoRes(id); return l.find(r => /^(720|768)/i.test(r)) || l[0]; },
        maxRefs(id, mode) { const m = String(id || ''); if (m.startsWith('mj-')) return 3; if (this.isVideoModel(m)) { if (mode === 'first_last') return 2; const c = this.caps(m); return c ? c.maxImages : (/seedance-2-5/i.test(m) ? 30 : 9); } return 8; },
        models() {
            const PB = this.PB();
            const out = { image: [], video: [] };
            if (!PB || !PB.apiConfig || !PB.modelConfigMap) return out;
            const di = this.defaultImageModel(), dv = this.defaultVideoModel();
            const seen = new Set();
            Object.values(PB.apiConfig.apis || {}).forEach(api => {
                if (!api || api.enabled === false) return;
                (api.frontend && api.frontend.models || api.models || []).forEach(m => {
                    if (!m || !m.id || seen.has(m.id) || this.isVideoModel(m.id)) return;
                    seen.add(m.id);
                    const sizes = this.imageSizes(m.id);
                    out.image.push({ id: m.id, name: m.name || m.id, default: m.id === di || undefined, sizes, maxRefs: this.maxRefs(m.id), price: this.priceOf({ nodeType: 'gen', model: m.id, size: sizes.indexOf('2K') !== -1 ? '2K' : sizes[0] }) });
                });
            });
            ((PB.apiConfig.videoApis && PB.apiConfig.videoApis.models) || []).forEach(m => {
                if (!m || !m.id || seen.has(m.id)) return;
                seen.add(m.id);
                const [a, b] = this.durRange(m.id);
                const vc = this.caps(m.id);
                const ent = { id: m.id, name: m.name || m.id, default: m.id === dv || undefined, durationMin: a, durationMax: b, resolutions: this.videoRes(m.id), firstLast: this.supportsFL(m.id) || undefined, maxRefs: this.maxRefs(m.id), price5s: this.priceOf({ nodeType: 'gen', genCategory: 'video', model: m.id, duration: 5, resolution: this.defaultRes(m.id) }) };
                // 特价线路：标注徽标/计价说明与限定比例，供 AI 助手选模型时参考
                if (vc && vc.badge) { ent.badge = vc.badge; if (vc.tagline) ent.note = vc.tagline; }
                if (vc && vc.aspectRatios) ent.aspects = this.allowAspects(true, false, m.id);
                if (vc && typeof m.maxVideos === 'number') { ent.maxRefVideos = vc.maxVideos; ent.maxRefAudios = vc.maxAudios; }
                out.video.push(ent);
            });
            out.imageAspects = IMAGE_ASPECTS; out.videoAspects = VIDEO_ASPECTS;
            if (global.CanvasPano) { out.panoramaModels = global.CanvasPano.PANO_MODELS.filter(m => PB.modelConfigMap[m]); out.turnaroundModels = global.CanvasPano.TURN_MODELS.filter(m => PB.modelConfigMap[m]); }
            return out;
        },
        // 与 PromptBar.updatePriceDisplay / CanvasGenerate.runNode / 服务端 /api/tasks 预扣同源
        priceOf(n) {
            const PB = this.PB();
            if (!PB || !n || !n.model) return 0;
            const model = n.model;
            const isVideo = this.isVideoModel(model);
            const actual = PB.getActualModel ? PB.getActualModel(model, n.size) : model;
            let cfg = null;
            const dApi = PB.apiConfig && PB.apiConfig.defaultApi;
            const api = dApi && PB.apiConfig.apis && PB.apiConfig.apis[dApi];
            if (api && api.frontend && api.frontend.models) cfg = api.frontend.models.find(m => m.id === actual) || null;
            if (!cfg && api && api.models) cfg = api.models.find(m => m.id === actual) || null;
            if (!cfg) cfg = PB.modelConfigMap[actual] || null;
            if (!cfg) return 0;
            let price = cfg.price;
            const pm = cfg.priceMatrix || {};
            if (isVideo) {
                const mc = PB.modelConfigMap[model] || {};
                const q = String(n.resolution || (mc.supportedResolutions && mc.supportedResolutions[0]) || '720p').toLowerCase();
                let billSec = parseInt(n.duration, 10) || 5;
                const _c = this.caps(model);
                const _vk = _c ? _c.refVideoBillFactor : (/minimax-h3/i.test(model) ? 0 : (/seedance-?2[._-]?5|2\.5/i.test(model) ? 0.6 : 0.65));
                if (_vk > 0 && n.id) {
                    const vid = this.edgesIn(n.id).map(e => this.get(e.from)).filter(s => s && s.mediaType === 'video').reduce((t, s) => t + (s.mediaDuration || s.duration || 0), 0);
                    if (vid > 0) billSec += Math.round(vid * _vk);
                }
                const r = String(billSec);
                if (pm[q]) {
                    if (typeof pm[q][r] === 'number') price = pm[q][r];
                    else {
                        const ks = Object.keys(pm[q]).map(Number).filter(x => isFinite(x) && x > 0);
                        const mx = ks.length ? Math.max.apply(null, ks) : 0;
                        if (mx && billSec > mx && typeof pm[q][String(mx)] === 'number') price = Math.round(pm[q][String(mx)] / mx * billSec);
                    }
                }
            } else {
                const qcfg = PB.modelConfigMap[model] || cfg;
                const qOpts = Array.isArray(qcfg.qualityOptions) ? qcfg.qualityOptions : [];
                let q = 'medium';
                if (qOpts.length) { q = n.quality; if (qOpts.indexOf(q) === -1) q = qOpts.indexOf('medium') !== -1 ? 'medium' : qOpts[0]; }
                const r = n.size || '1K';
                if (pm[q] && typeof pm[q][r] === 'number') price = pm[q][r];
                else if (pm.medium && typeof pm.medium[r] === 'number') price = pm.medium[r];
            }
            return typeof price === 'number' ? Number(price.toFixed(2)) : 0;
        },
        // ---- 提示词栏同步（当前激活节点：读前先回写，改后重新载入） ----
        syncFromBar() { const CM = global.CanvasMain; if (CM && CM._activeNodeId && CM._savePromptBarToNode) { try { CM._savePromptBarToNode(CM._activeNodeId); } catch (_) { /* 忽略 */ } } },
        reloadBar(ids) { const CM = global.CanvasMain; if (CM && CM._activeNodeId && ids.indexOf(CM._activeNodeId) !== -1 && CM._loadNodeToPromptBar) { try { CM._loadNodeToPromptBar(CM._activeNodeId); } catch (_) { /* 忽略 */ } } },
        // ---- 静默写入：暂停撤销快照、拦截 alert/toast 收集提示；回合结束时统一记一次快照 ----
        write(fn) {
            const CH = global.CanvasHistory, CM = global.CanvasMain;
            const msgs = [];
            const a = global.alert, hadToast = CM && Object.prototype.hasOwnProperty.call(CM, 'toast'), t = CM && CM.toast;
            const prev = CH ? CH._suspended : false;
            if (CH) CH._suspended = true;
            global.alert = (m) => { msgs.push(String(m || '')); };
            if (CM) CM.toast = (m) => { msgs.push(String(m || '')); };
            try { return fn(msgs); }
            finally {
                global.alert = a;
                if (CM) { if (hadToast) CM.toast = t; else delete CM.toast; }
                if (CH) CH._suspended = prev;
                Agent._markDirty();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            }
        },
        // ---- 位置 ----
        visibleRect() {
            const vp = global.CanvasCore.viewportEl.getBoundingClientRect();
            let right = vp.right;
            if (Agent._open && Agent._el) { const r = Agent._el.getBoundingClientRect(); if (r.width) right = Math.min(right, r.left - 12); }
            const tl = global.CanvasCore.screenToWorld(vp.left, vp.top + 60), br = global.CanvasCore.screenToWorld(right, vp.bottom - 120);
            return { x: tl.x, y: tl.y, w: Math.max(100, br.x - tl.x), h: Math.max(100, br.y - tl.y), sx: vp.left, sw: Math.max(200, right - vp.left), sh: vp.height };
        },
        boundsOf(ids) {
            let b = null;
            ids.map(id => this.get(id)).filter(Boolean).forEach(n => {
                if (!b) b = { minX: n.x, minY: n.y, maxX: n.x + n.w, maxY: n.y + n.h };
                else { b.minX = Math.min(b.minX, n.x); b.minY = Math.min(b.minY, n.y); b.maxX = Math.max(b.maxX, n.x + n.w); b.maxY = Math.max(b.maxY, n.y + n.h); }
            });
            return b;
        },
        inView(n) { const r = this.visibleRect(); return n.x + n.w > r.x && n.x < r.x + r.w && n.y + n.h > r.y && n.y < r.y + r.h; },
        // 定位：在未被助手抽屉遮挡的可见区域内居中（多个节点时缩放到全部可见）
        focus(ids, soft) {
            const b = this.boundsOf(ids);
            if (!b) return false;
            const CC = global.CanvasCore;
            const vr = this.visibleRect();
            const vp = CC.viewportEl.getBoundingClientRect();
            if (soft && ids.every(id => { const n = this.get(id); return n && this.inView(n); })) { this.flash(ids); return true; }
            const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
            let s = CC.viewport.scale;
            const fit = Math.min((vr.sw - 160) / Math.max(bw, 1), (vr.sh - 220) / Math.max(bh, 1));
            if (ids.length > 1 || s > fit) s = Math.max(CC.minScale, Math.min(1.1, fit));
            if (s < 0.25 && ids.length === 1) s = Math.min(0.8, fit);
            CC.viewport.scale = s;
            const cx = (vr.sx - vp.left) + vr.sw / 2, cy = vr.sh / 2 + 10;
            CC.viewport.x = cx - (b.minX + bw / 2) * s;
            CC.viewport.y = cy - (b.minY + bh / 2) * s;
            CC.applyTransform();
            this.flash(ids);
            return true;
        },
        flash(ids) {
            const layer = this.CB().layerEl;
            ids.slice(0, 32).forEach(id => {
                const el = layer && layer.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
                if (!el) return;
                el.classList.remove('ag-flash'); void el.offsetWidth; el.classList.add('ag-flash');
                setTimeout(() => el.classList.remove('ag-flash'), 1600);
            });
        },
        // 新节点锚点：附近节点右侧 > 选中节点右侧 > 可见区域中央偏左上
        anchor(nearId) {
            const near = this.get(nearId);
            if (near) return { x: Math.round(near.x + near.w + 90), y: Math.round(near.y) };
            const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            const sb = this.boundsOf(sel);
            if (sb) return { x: Math.round(sb.maxX + 90), y: Math.round(sb.minY) };
            const r = this.visibleRect();
            return { x: Math.round(r.x + Math.min(120, r.w * 0.1)), y: Math.round(r.y + Math.min(120, r.h * 0.15)) };
        }
    };

    // ================= 参数校验 =================
    function vErr(msg) { const e = new Error(msg); e.agent = true; return e; }
    function needIds(ids, max, what) {
        if (!Array.isArray(ids) || !ids.length) throw vErr(`${what || 'ids'} 不能为空`);
        if (ids.length > max) throw vErr(`一次最多 ${max} 个，当前 ${ids.length} 个，请分批`);
        const bad = ids.filter(id => !CanvasAPI.get(id));
        if (bad.length) throw vErr(`节点不存在：${bad.slice(0, 5).join(', ')}（请先用 find_nodes / get_canvas_summary 获取真实 id，不要编造）`);
        return uniq(ids);
    }
    // 生成节点参数（创建 / 修改共用）：返回规范化后的 patch
    function genParams(isVideo, p, cur) {
        const out = {};
        const model = p.model !== undefined ? p.model : (cur ? cur.model : (isVideo ? CanvasAPI.defaultVideoModel() : CanvasAPI.defaultImageModel()));
        if (typeof model !== 'string' || !model || !CanvasAPI.modelCfg(model)) throw vErr(`模型「${clip(model, 40)}」不在可用模型列表中，请从上下文 models 中选择`);
        if (CanvasAPI.isVideoModel(model) !== isVideo) throw vErr(isVideo ? `「${model}」是图片模型，视频生成节点请使用视频模型` : `「${model}」是视频模型，图片生成节点请使用图片模型（或改用 video_gen）`);
        if (p.model !== undefined || !cur) out.model = model;
        if (isVideo) {
            const [mn, mx] = CanvasAPI.durRange(model);
            if (p.duration !== undefined) {
                const d = Number(p.duration);
                if (!Number.isInteger(d) || d < mn || d > mx) throw vErr(`时长须为 ${mn}-${mx} 秒的整数（模型 ${model}）`);
                out.duration = d;
            } else if (!cur) out.duration = Math.max(mn, Math.min(mx, 5));
            else if (cur.duration < mn || cur.duration > mx) out.duration = Math.max(mn, Math.min(mx, cur.duration || 5));
            const resList = CanvasAPI.videoRes(model);
            if (p.resolution !== undefined) {
                const r = resList.find(x => x.toLowerCase() === String(p.resolution).toLowerCase());
                if (!r) throw vErr(`分辨率须为 ${resList.join(' / ')} 之一（模型 ${model}）`);
                out.resolution = r;
            } else if (!cur || (cur.resolution && resList.indexOf(cur.resolution) === -1) || (p.model !== undefined && !cur.resolution)) out.resolution = CanvasAPI.defaultRes(model);
            let mode = p.videoMode !== undefined ? p.videoMode : (cur ? cur.videoMode || 'reference' : 'reference');
            if (mode !== 'reference' && mode !== 'first_last') throw vErr('videoMode 只能是 reference 或 first_last');
            if (mode === 'first_last' && !CanvasAPI.supportsFL(model)) { if (p.videoMode === 'first_last') throw vErr(`模型 ${model} 不支持首尾帧模式`); mode = 'reference'; }
            if (p.videoMode !== undefined || !cur || mode !== (cur.videoMode || 'reference')) out.videoMode = mode;
            const aspects = CanvasAPI.allowAspects(true, mode === 'first_last', model);
            if (p.aspectRatio !== undefined) {
                if (aspects.indexOf(p.aspectRatio) === -1) throw vErr(`比例须为 ${aspects.join(' / ')} 之一`);
                out.aspectRatio = p.aspectRatio;
            } else if (mode === 'first_last') out.aspectRatio = 'auto';
            else if (!cur) out.aspectRatio = '16:9';
            else if (aspects.indexOf(cur.aspectRatio) === -1) out.aspectRatio = '16:9';
        } else {
            const sizes = CanvasAPI.imageSizes(model);
            // 容错：图片节点误把分辨率档位写进 resolution（如 2K）时按 size 处理
            if (p.size === undefined && p.resolution !== undefined && sizes.some(x => x.toLowerCase() === String(p.resolution).toLowerCase())) { p = Object.assign({}, p, { size: p.resolution }); delete p.resolution; }
            if (p.size !== undefined) {
                const s = sizes.find(x => x.toLowerCase() === String(p.size).toLowerCase());
                if (!s) throw vErr(`分辨率须为 ${sizes.join(' / ')} 之一（模型 ${model}）`);
                out.size = s;
            } else if (!cur || sizes.indexOf(cur.size) === -1) {
                const PB = CanvasAPI.PB();
                out.size = (PB && sizes.indexOf(PB.currentRes) !== -1) ? PB.currentRes : (sizes.indexOf('2K') !== -1 ? '2K' : sizes[0]);
            }
            if (p.aspectRatio !== undefined) {
                if (IMAGE_ASPECTS.indexOf(p.aspectRatio) === -1) throw vErr(`比例须为 ${IMAGE_ASPECTS.join(' / ')} 之一`);
                out.aspectRatio = p.aspectRatio;
            } else if (!cur) out.aspectRatio = '1:1';
            if (p.duration !== undefined || p.resolution !== undefined || p.videoMode !== undefined) throw vErr('图片节点不支持 duration / resolution / videoMode 参数');
        }
        if (p.prompt !== undefined) {
            if (typeof p.prompt !== 'string') throw vErr('prompt 必须是字符串');
            if (p.prompt.length > LIM.prompt) throw vErr(`提示词不能超过 ${LIM.prompt} 字`);
            out.prompt = p.prompt.trim();
        }
        return out;
    }
    function cleanName(n) { return typeof n === 'string' ? n.replace(/[\r\n\t]+/g, ' ').trim().slice(0, LIM.name) : ''; }
    function siteImageUrl(u) {
        u = String(u || '');
        if (u.length > 2000) return '';
        if (/^\/api\/img\?[\w=&%.\-/]+$/.test(u)) return u;
        const CB = CanvasAPI.CB();
        if (CB.blocks.some(b => b.imageUrl === u || b.previewUrl === u)) return u;
        return '';
    }

    // _FRAMES_20261029 供导演台分镜图计价 / 选模型（与确认卡片同源）
    global.PxCanvasAPI = {
        priceOf: (n) => CanvasAPI.priceOf(n), defaultImageModel: () => CanvasAPI.defaultImageModel(), imageSizes: (m) => CanvasAPI.imageSizes(m),
        maxRefs: (m) => CanvasAPI.maxRefs(m), modelCfg: (m) => CanvasAPI.modelCfg(m), isVideoModel: (m) => CanvasAPI.isVideoModel(m), models: () => CanvasAPI.models()
    };

    // ================= 工具实现 =================
    const Tools = {
        get_canvas_summary() {
            CanvasAPI.syncFromBar();
            const CB = CanvasAPI.CB();
            const byType = {}, byStatus = {};
            CB.blocks.forEach(b => { const t = CanvasAPI.typeOf(b); byType[t] = (byType[t] || 0) + 1; if (b.nodeType === 'gen') { const s = CanvasAPI.statusOf(b); byStatus[s] = (byStatus[s] || 0) + 1; } });
            const sel = global.CanvasSelection.getSelectedIds();
            const vis = CB.blocks.filter(b => CanvasAPI.inView(b));
            const r = CanvasAPI.visibleRect();
            const out = {
                total: CB.blocks.length, byType, genStatus: byStatus,
                selection: sel.map(id => CanvasAPI.get(id)).filter(Boolean).slice(0, 40).map(b => CanvasAPI.brief(b, 120)),
                viewport: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), scale: +global.CanvasCore.viewport.scale.toFixed(2) },
                groups: Object.keys(CB.groups).slice(0, 20).map(gid => ({ id: gid, title: str(CB.groups[gid].title, 40), kind: CB.groups[gid].kind || '', count: CB._nodesInGroup(gid).length })),
                director: Agent._directorSummary(false)
            };
            if (CB.blocks.length <= 60) out.nodes = CB.blocks.map(b => CanvasAPI.brief(b, 120));
            else out.visibleNodes = vis.slice(0, 40).map(b => CanvasAPI.brief(b, 120));
            return out;
        },
        find_nodes(a) {
            CanvasAPI.syncFromBar();
            const q = str(a.query, 100).trim().toLowerCase();
            const type = a.type && a.type !== 'any' ? a.type : '';
            const status = a.status && a.status !== 'any' ? a.status : '';
            const limit = Math.max(1, Math.min(50, parseInt(a.limit, 10) || 20));
            const all = CanvasAPI.CB().blocks.filter(b => {
                if (type && CanvasAPI.typeOf(b) !== type) return false;
                if (status && CanvasAPI.statusOf(b) !== status) return false;
                if (q) { const hay = ((b.name || '') + '\n' + (b.prompt || '') + '\n' + (b.text || '')).toLowerCase(); if (hay.indexOf(q) === -1) return false; }
                return true;
            });
            return { total: all.length, nodes: all.slice(0, limit).map(b => CanvasAPI.brief(b, 200)), truncated: all.length > limit || undefined };
        },
        get_nodes(a) {
            CanvasAPI.syncFromBar();
            const ids = needIds(a.ids, 20);
            return { nodes: ids.map(id => CanvasAPI.detail(CanvasAPI.get(id))) };
        },
        create_nodes(a) {
            const list = a.nodes;
            if (!Array.isArray(list) || !list.length) throw vErr('nodes 不能为空');
            if (list.length > LIM.create) throw vErr(`一次最多创建 ${LIM.create} 个节点，请分批`);
            // 先整批校验，任一失败整批不创建
            const plan = list.map((n, i) => {
                if (!n || typeof n !== 'object') throw vErr(`第 ${i + 1} 个节点参数无效`);
                const kind = n.kind;
                const item = { kind, name: cleanName(n.name) };
                if (n.nearNodeId !== undefined && n.nearNodeId !== '' && !CanvasAPI.get(n.nearNodeId)) throw vErr(`第 ${i + 1} 个节点：nearNodeId「${clip(n.nearNodeId, 30)}」不存在`);
                item.near = n.nearNodeId || '';
                if (isNum(n.x) && isNum(n.y)) item.pos = { x: Math.max(-1e6, Math.min(1e6, Math.round(n.x))), y: Math.max(-1e6, Math.min(1e6, Math.round(n.y))) };
                try {
                    if (kind === 'image_gen' || kind === 'video_gen') item.p = genParams(kind === 'video_gen', n, null);
                    else if (kind === 'text') {
                        if (n.text !== undefined && typeof n.text !== 'string') throw vErr('text 必须是字符串');
                        const t = n.text !== undefined ? n.text : (typeof n.prompt === 'string' ? n.prompt : '');
                        if (t.length > LIM.text) throw vErr(`文本不能超过 ${LIM.text} 字`);
                        item.text = t;
                    } else if (kind === 'image_ref') {
                        const u = siteImageUrl(n.url);
                        if (!u) throw vErr('image_ref 的 url 只允许站内图片地址（/api/img… 或画布中已有图片）');
                        item.url = u;
                    } else throw vErr(`kind 只能是 ${['image_gen', 'video_gen', 'text', 'image_ref'].join(' / ')}`);
                } catch (e) { throw vErr(`第 ${i + 1} 个节点：${e.message}`); }
                return item;
            });
            const CB = CanvasAPI.CB();
            const created = [];
            CanvasAPI.write(() => {
                let cursor = null, rowY = null, rowH = 0, col = 0;
                plan.forEach((it) => {
                    let node;
                    if (it.kind === 'text') node = CB.addText({ x: 0, y: 0, text: it.text, name: it.name || undefined });
                    else if (it.kind === 'image_ref') node = CB.addRef({ x: 0, y: 0, name: it.name || L('参考图', 'Reference'), imageUrl: it.url, previewUrl: it.url, mediumUrl: it.url, status: 'idle' });
                    else {
                        const isV = it.kind === 'video_gen';
                        const ar = it.p.aspectRatio;
                        const opts = Object.assign({ x: 0, y: 0, genCategory: isV ? 'video' : 'image', name: it.name || CB._nextGenName(isV ? '视频节点' : '图片节点'), prompt: it.p.prompt || '' }, it.p);
                        if (aspectNum(ar)) opts.ratio = aspectNum(ar);
                        node = CB.addGen(opts);
                    }
                    // 排布：显式坐标 > 指定附近节点 > 同批横向成行（每行 4 个）；最后找空位避免重叠
                    let x, y;
                    if (it.pos) { x = it.pos.x; y = it.pos.y; }
                    else if (it.near) { const A = CanvasAPI.anchor(it.near); x = A.x; y = A.y; }
                    else {
                        if (!cursor) { const A = CanvasAPI.anchor(''); cursor = { x: A.x, y: A.y, x0: A.x }; rowY = A.y; }
                        if (col === 4) { col = 0; cursor.x = cursor.x0; rowY += rowH + 60; rowH = 0; }
                        x = cursor.x; y = rowY;
                    }
                    const sp = CB._findFreeSpot(x, y, node.w, node.h, node.id);
                    CB.update(node.id, { x: sp.x, y: sp.y });
                    if (!it.pos && !it.near) { cursor.x = sp.x + node.w + 40; rowH = Math.max(rowH, node.h); col++; }
                    created.push(node);
                });
            });
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
            const ids = created.map(n => n.id);
            CanvasAPI.focus(ids, true);
            return { ok: true, created: created.map(n => ({ id: n.id, kind: CanvasAPI.typeOf(n), name: n.name, model: n.model || undefined, price: n.nodeType === 'gen' ? CanvasAPI.priceOf(n) : undefined })) };
        },
        update_nodes(a) {
            const ups = a.updates;
            if (!Array.isArray(ups) || !ups.length) throw vErr('updates 不能为空');
            if (ups.length > LIM.update) throw vErr(`一次最多修改 ${LIM.update} 个节点，请分批`);
            CanvasAPI.syncFromBar();
            const plan = ups.map((u, i) => {
                if (!u || typeof u !== 'object') throw vErr(`第 ${i + 1} 项无效`);
                const n = CanvasAPI.get(u.id);
                if (!n) throw vErr(`第 ${i + 1} 项：节点「${clip(u.id, 30)}」不存在`);
                if (n.status === 'generating') throw vErr(`节点「${n.name}」正在生成中，暂不能修改`);
                const patch = {};
                if (u.name !== undefined) { const nm = cleanName(u.name); if (!nm) throw vErr(`第 ${i + 1} 项：名称不能为空`); patch.name = nm; }
                try {
                    if (n.nodeType === 'gen') {
                        const isV = CanvasAPI.typeOf(n) === 'video_gen';
                        const keys = ['prompt', 'model', 'aspectRatio', 'size', 'duration', 'resolution', 'videoMode'];
                        if (keys.some(k => u[k] !== undefined)) Object.assign(patch, genParams(isV, u, n));
                        if (u.text !== undefined) throw vErr('生成节点请用 prompt 修改提示词');
                    } else if (n.nodeType === 'text') {
                        if (u.text !== undefined || u.prompt !== undefined) {
                            const t = u.text !== undefined ? u.text : u.prompt;
                            if (typeof t !== 'string' || t.length > LIM.text) throw vErr(`文本须为不超过 ${LIM.text} 字的字符串`);
                            patch.text = t;
                        }
                        if (['model', 'aspectRatio', 'size', 'duration', 'resolution', 'videoMode'].some(k => u[k] !== undefined)) throw vErr('文本节点只能修改 name / text');
                    } else if (['prompt', 'model', 'aspectRatio', 'size', 'duration', 'resolution', 'videoMode', 'text'].some(k => u[k] !== undefined)) throw vErr('素材/角色节点只能修改名称');
                } catch (e) { throw vErr(`节点「${n.name}」：${e.message}`); }
                return { n, patch };
            });
            const changed = [];
            CanvasAPI.write(() => {
                plan.forEach(({ n, patch }) => {
                    if (!Object.keys(patch).length) return;
                    if (patch.aspectRatio && !n.imageUrl && !n.previewUrl && aspectNum(patch.aspectRatio)) patch.ratio = aspectNum(patch.aspectRatio);
                    CanvasAPI.CB().update(n.id, patch);
                    changed.push(n.id);
                });
            });
            CanvasAPI.reloadBar(changed);
            return { ok: true, updated: plan.map(({ n, patch }) => ({ id: n.id, name: n.name, changed: Object.keys(patch) })) };
        },
        // 连线整批校验（与 CanvasEdges.add 同一套规则，含同批累计的参考图数量）
        _checkEdges(edges) {
            if (!Array.isArray(edges) || !edges.length) throw vErr('edges 不能为空');
            if (edges.length > LIM.edges) throw vErr(`一次最多 ${LIM.edges} 条连线，请分批`);
            const CE = CanvasAPI.CE();
            const addCnt = {}, addText = {}, seen = new Set();
            const results = edges.map((e) => {
                const r = { from: e && e.from, to: e && e.to };
                const from = CanvasAPI.get(r.from), to = CanvasAPI.get(r.to);
                if (!from || !to) { r.error = `节点不存在：${!from ? r.from : r.to}`; return r; }
                r.fromName = from.name; r.toName = to.name;
                if (from.id === to.id) { r.error = '不能连接到自身'; return r; }
                if (to.nodeType !== 'gen') { r.error = `「${to.name}」不是生成节点，只能连入图片/视频生成节点`; return r; }
                const key = from.id + '>' + to.id;
                if (seen.has(key) || CE.edges.some(x => x.from === from.id && x.to === to.id)) { r.exists = true; seen.add(key); return r; }
                seen.add(key);
                const ce = CE._canConnectTo(from.id, to.id);
                if (ce) { r.error = ce; return r; }
                if (from.nodeType === 'text') {
                    const has = CE.edges.some(x => x.to === to.id && (CanvasAPI.get(x.from) || {}).nodeType === 'text') || addText[to.id];
                    if (has) { r.error = '每个节点最多连接一个文本节点'; return r; }
                    addText[to.id] = true;
                }
                if (CE._wouldCreateCycle(from.id, to.id)) { r.error = '不能形成环形连线'; return r; }
                const isMedia = from.mediaType === 'video' || from.mediaType === 'audio' || (from.nodeType === 'gen' && CanvasAPI.typeOf(from) === 'video_gen');
                if (from.nodeType !== 'text' && !isMedia) {
                    const max = CE._getMaxImagesForNode(to);
                    const cur = CE._countImageInputs(to.id) + (addCnt[to.id] || 0);
                    const w = CE._imageWeight(from);
                    const isChar = from.subType === 'character';
                    if ((isChar && cur >= max) || (!isChar && cur + w > max)) { r.error = `素材已满：该节点最多 ${max} 张参考图`; return r; }
                    addCnt[to.id] = (addCnt[to.id] || 0) + w;
                }
                return r;
            });
            return results;
        },
        connect_nodes(a) {
            const results = this._checkEdges(a.edges);
            const bad = results.filter(r => r.error);
            if (bad.length) return { ok: false, error: `有 ${bad.length} 条连线校验失败，整批未执行`, results: results.map(r => ({ from: r.from, to: r.to, ok: !r.error, error: r.error, alreadyConnected: r.exists || undefined })) };
            const CE = CanvasAPI.CE();
            CanvasAPI.write((msgs) => {
                results.forEach(r => {
                    if (r.exists) return;
                    const e = CE.add(r.from, r.to);
                    if (!e) r.error = CE._lastAddError || msgs[msgs.length - 1] || '连线失败';
                    else if (msgs.length && /已按上限选取前/.test(msgs[msgs.length - 1])) r.note = msgs[msgs.length - 1];
                });
            });
            return { ok: !results.some(r => r.error), results: results.map(r => ({ from: r.from, to: r.to, fromName: r.fromName, toName: r.toName, ok: !r.error, error: r.error, alreadyConnected: r.exists || undefined, note: r.note })) };
        },
        disconnect_nodes(a) {
            const edges = a.edges;
            if (!Array.isArray(edges) || !edges.length) throw vErr('edges 不能为空');
            if (edges.length > LIM.edges) throw vErr(`一次最多 ${LIM.edges} 条，请分批`);
            const CE = CanvasAPI.CE();
            const found = edges.map(e => ({ e, edge: e && CE.edges.find(x => x.from === e.from && x.to === e.to) }));
            const miss = found.filter(f => !f.edge);
            if (miss.length) return { ok: false, error: `${miss.length} 条连线不存在，整批未执行`, missing: miss.map(f => ({ from: f.e && f.e.from, to: f.e && f.e.to })) };
            CanvasAPI.write(() => { found.forEach(f => CE.remove(f.edge.id)); });
            return { ok: true, removed: found.map(f => ({ from: f.edge.from, to: f.edge.to, fromName: (CanvasAPI.get(f.edge.from) || {}).name, toName: (CanvasAPI.get(f.edge.to) || {}).name })) };
        },
        async delete_nodes(a, call) {
            const ids = needIds(a.ids, LIM.del);
            const gen = ids.filter(id => (CanvasAPI.get(id) || {}).status === 'generating');
            if (gen.length) throw vErr(`有 ${gen.length} 个节点正在生成中，不能删除`);
            const names = ids.map(id => CanvasAPI.get(id).name || id);
            const ui = ids.length > 3 ? { names } : undefined;
            if (ui) {
                const ok = await Agent._confirmCard(call, { kind: 'delete', ids, names });
                if (!ok) return { ok: false, approved: false, error: '用户取消了删除', ui };
            }
            const live = ids.filter(id => CanvasAPI.get(id));   // 等待确认期间可能已被手动删除
            CanvasAPI.write(() => {
                global.CanvasSelection.clear();
                live.forEach(id => CanvasAPI.CB().remove(id));
            });
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
            return { ok: true, deleted: live.length, names: names.slice(0, 20), ui };
        },
        arrange_nodes(a) {
            let ids = Array.isArray(a.ids) && a.ids.length ? a.ids : global.CanvasSelection.getSelectedIds();
            if (!ids.length) ids = CanvasAPI.CB().blocks.map(b => b.id);
            if (ids.length > 300) throw vErr('节点过多（>300），请指定 ids 分批整理');
            ids = needIds(ids, 300);
            const mode = { row: 'horizontal', column: 'vertical', grid: 'auto' }[a.layout];
            if (!mode) throw vErr('layout 只能是 row / grid / column');
            if (ids.length < 2) return { ok: true, arranged: ids.length, note: '少于 2 个节点，无需整理' };
            CanvasAPI.write(() => { global.CanvasMain._arrangeNodes(ids, mode); });
            CanvasAPI.focus(ids, false);
            return { ok: true, arranged: ids.length, layout: a.layout };
        },
        select_nodes(a) {
            const ids = needIds(a.ids, LIM.ids);
            global.CanvasSelection.clear();
            ids.forEach((id, i) => global.CanvasSelection.select(id, i > 0));
            Agent._refreshCtx();
            return { ok: true, selected: ids.length };
        },
        focus_nodes(a) {
            const ids = needIds(a.ids, LIM.ids);
            CanvasAPI.focus(ids, false);
            return { ok: true };
        },
        group_nodes(a) {
            const ids = needIds(a.ids, LIM.ids);
            const CB = CanvasAPI.CB();
            const b = CanvasAPI.boundsOf(ids);
            const PAD = CB.GROUP_PAD || 26;
            const gid = 'grp_' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
            const title = cleanName(a.title);
            CanvasAPI.write(() => {
                CB.groups[gid] = { x: b.minX - PAD, y: b.minY - PAD, w: (b.maxX - b.minX) + PAD * 2, h: (b.maxY - b.minY) + PAD * 2 };
                if (title) CB.groups[gid].title = title;
                CB._syncGroupFrames();
            });
            return { ok: true, groupId: gid, count: ids.length, title: title || undefined };
        },
        async list_characters() {
            const CL = global.CharacterLib;
            if (!CL) return { characters: [] };
            if (!CL._loaded) { try { await CL.load(); } catch (_) { /* 忽略 */ } }
            return { characters: (CL.chars || []).slice(0, 50).map(c => ({ id: c.id, name: c.name, description: clip(c.description || '', 160), anchors: (c.anchors || []).slice(0, 5), wardrobe: (c.wardrobe || []).slice(0, 8).map(w => ({ id: w.id, name: w.name })), refImages: (c.refs || []).length, token: CL.charToken(c.name, c.id) })) };
        },
        async use_character(a) {
            const CL = global.CharacterLib;
            if (!CL) throw vErr('角色库不可用');
            if (!CL._loaded) { try { await CL.load(); } catch (_) { /* 忽略 */ } }
            const c = typeof a.characterId === 'string' && CL.get(a.characterId);
            if (!c) throw vErr(`角色「${clip(a.characterId, 40)}」不存在，请先用 list_characters 获取角色 id`);
            const targets = needIds(a.connectTo, 16, 'connectTo（请先用 create_nodes 创建生成节点，再用返回的 id）');
            const notGen = targets.filter(id => CanvasAPI.get(id).nodeType !== 'gen');
            if (notGen.length) throw vErr('connectTo 必须是生成节点：' + notGen.join(', '));
            const wd = a.wardrobeId ? (c.wardrobe || []).find(w => w.id === a.wardrobeId) : null;
            if (a.wardrobeId && !wd) throw vErr(`造型「${clip(a.wardrobeId, 30)}」不属于角色 ${c.name}`);
            const CB = CanvasAPI.CB();
            const wantWd = wd ? wd.id : '';
            const cands = CB.blocks.filter(b => b.subType === 'character' && b.characterId === c.id && (b.wardrobeId || '') === wantWd);
            // 复用：优先已连到目标的角色节点，其次画布上任意同角色同造型节点
            let node = cands.find(b => CanvasAPI.edgesOut(b.id).some(e => targets.indexOf(e.to) !== -1)) || cands[0] || null;
            const reused = !!node;
            CanvasAPI.write(() => {
                if (!node) {
                    const t = CanvasAPI.get(targets[0]);
                    node = CL.insertToCanvas(c.id, t.x - 330, t.y, { center: false, noSelect: true, findSpot: true });
                    if (node && wantWd) { CB.update(node.id, { wardrobeId: wantWd }); CL.refreshNode(node.id); }
                }
            });
            if (!node) throw vErr('创建角色节点失败');
            const res = this._checkEdges(targets.map(t => ({ from: node.id, to: t })));
            const okEdges = res.filter(r => !r.error);
            CanvasAPI.write((msgs) => {
                okEdges.forEach(r => { if (!r.exists && !CanvasAPI.CE().add(r.from, r.to)) r.error = CanvasAPI.CE()._lastAddError || msgs[msgs.length - 1] || '连线失败'; });
            });
            return {
                ok: !res.some(r => r.error), characterNodeId: node.id, characterName: c.name, reused, wardrobe: wd ? wd.name : undefined,
                connected: res.filter(r => !r.error).map(r => r.to), failed: res.filter(r => r.error).map(r => ({ to: r.to, error: r.error })),
                promptToken: CL.charToken(c.name, c.id), tip: '在生成节点提示词中写入 promptToken 来指代该角色'
            };
        },
        director_get() { return Agent._directorSummary(true); },
        async director_write_script(a) {
            const D = global.CanvasDirector;
            if (!D || !D.aiWriteScript) throw vErr('导演台不可用');
            const r = await D.aiWriteScript({ idea: str(a.idea, 2000), genre: a.genre, targetDuration: a.targetDuration, characterIds: Array.isArray(a.characterIds) ? a.characterIds.slice(0, 10) : undefined, tone: str(a.tone, 60) });
            Agent._markDirty();
            if (!r.ok) return { ok: false, error: r.error || '写剧本失败', cancelled: r.cancelled || undefined, partialChars: r.chars || undefined };
            return { ok: true, title: r.title, chars: r.chars, truncated: r.truncated || undefined, scriptPreview: clip(D.d && D.d.script, 600), next: '可调用 director_storyboard 拆分镜（建议先请用户确认剧本）' };
        },
        async director_storyboard() {
            const D = global.CanvasDirector;
            if (!D || !D.aiStoryboardRun) throw vErr('导演台不可用');
            const r = await D.aiStoryboardRun();
            Agent._markDirty();
            if (!r.ok) return { ok: false, error: r.error || '拆分镜失败', cancelled: r.cancelled || undefined };
            const s = Agent._directorSummary(true);
            return { ok: true, shots: r.shots, shotNodeIds: r.nodeIds, totalDuration: (s.shots || []).reduce((t, x) => t + (x.duration || 0), 0), estimatedCredits: (s.shots || []).reduce((t, x) => t + (x.price || 0), 0), list: (s.shots || []).slice(0, 30) };
        },
        director_open(a) {
            const D = global.CanvasDirector;
            if (!D) throw vErr('导演台不可用');
            const tab = ['script', 'timeline', 'render'].indexOf(a.tab) !== -1 ? a.tab : 'timeline';
            if (!D.isOpen()) D.open(tab); else D._setView(tab);
            return { ok: true, tab };
        },
        get_generation_status(a) {
            const ids = needIds(a.nodeIds, LIM.ids, 'nodeIds');
            return { nodes: ids.map(id => { const n = CanvasAPI.get(id); return { id, name: n.name, status: CanvasAPI.statusOf(n), hasResult: CanvasAPI.hasResult(n), queued: Agent._genQueued(id) || undefined, error: n.status === 'failed' ? str(n.errorMsg, 160) || undefined : undefined }; }) };
        },
        async request_generation(a, call) { return Agent._requestGeneration(a, call); },
        // ---- 360 全景 / 角色多视角（第四期；只创建不生成，生成仍须 request_generation） ----
        create_panorama(a) {
            const P = global.CanvasPano;
            if (!P) throw vErr('全景功能不可用');
            const prompt = str(a.prompt, LIM.prompt).trim();
            if (!prompt) throw vErr('prompt（场景描述）不能为空');
            const avail = P.PANO_MODELS.filter(m => CanvasAPI.modelCfg(m));
            if (a.model !== undefined && a.model !== '' && avail.indexOf(a.model) === -1) throw vErr(`模型「${clip(a.model, 40)}」不支持全景，可用：${avail.join(' / ')}`);
            if (a.nearNodeId && !CanvasAPI.get(a.nearNodeId)) throw vErr(`nearNodeId「${clip(a.nearNodeId, 30)}」不存在`);
            if (a.size !== undefined && a.size !== '' && ['1K', '2K', '4K'].indexOf(String(a.size).toUpperCase()) === -1) throw vErr('size 只能是 1K / 2K / 4K');
            const A = CanvasAPI.anchor(a.nearNodeId || '');
            let node;
            CanvasAPI.write(() => { node = P.createPanoNode({ prompt, model: a.model || undefined, size: a.size ? String(a.size).toUpperCase() : undefined, name: cleanName(a.name) || undefined, x: A.x, y: A.y, select: false, pan: false }); });
            CanvasAPI.focus([node.id], true);
            return { ok: true, created: { id: node.id, kind: 'image_gen', panorama: true, name: node.name, model: node.model, size: node.size, aspectRatio: '2:1', price: CanvasAPI.priceOf(node) }, next: '如需生成请调用 request_generation' };
        },
        async open_panorama_viewer(a) {
            const P = global.CanvasPano;
            const n = CanvasAPI.get(a.nodeId);
            if (!P || !n) throw vErr(`节点「${clip(a.nodeId, 30)}」不存在`);
            if (!P.isPano(n)) throw vErr(`「${n.name}」不是 360° 全景节点`);
            if (!P.hasPanoImage(n)) throw vErr(`「${n.name}」还没有生成全景图`);
            const ok = await P.openViewer(n.id);
            return { ok: !!ok, opened: n.id, name: n.name };
        },
        async character_turnaround(a) {
            const P = global.CanvasPano, CL = global.CharacterLib;
            if (!P || !CL) throw vErr('多视角功能不可用');
            if (!CL._loaded) { try { await CL.load(); } catch (_) { /* 忽略 */ } }
            const c = typeof a.characterId === 'string' && CL.get(a.characterId);
            if (!c) throw vErr(`角色「${clip(a.characterId, 40)}」不存在，请先用 list_characters 获取角色 id`);
            if (!(c.refs || []).length) throw vErr(`角色「${c.name}」没有参考图，无法生成多视角`);
            const mode = a.mode === 'sheet' ? 'sheet' : (a.mode === 'grid8' ? 'grid8' : '');
            if (!mode) throw vErr('mode 只能是 sheet 或 grid8');
            const avail = P.TURN_MODELS.filter(m => CanvasAPI.modelCfg(m));
            if (a.model !== undefined && a.model !== '' && avail.indexOf(a.model) === -1) throw vErr(`模型「${clip(a.model, 40)}」不适合多视角，可用：${avail.join(' / ')}`);
            const model = a.model || avail[0];
            const sizes = CanvasAPI.imageSizes(model);
            const size = a.size ? sizes.find(s => s.toLowerCase() === String(a.size).toLowerCase()) : (sizes.indexOf('2K') !== -1 ? '2K' : sizes[0]);
            if (!size) throw vErr(`分辨率须为 ${sizes.join(' / ')} 之一`);
            let node;
            CanvasAPI.write(() => { node = P.createTurnaroundNode(c.id, mode, model, size); });
            if (!node) throw vErr('创建多视角节点失败');
            P._turnWatch[node.id] = true;
            CanvasAPI.focus([node.id], true);
            return { ok: true, created: { id: node.id, kind: 'image_gen', turnaround: mode, name: node.name, model: node.model, size: node.size, aspectRatio: node.aspectRatio, price: CanvasAPI.priceOf(node) }, characterName: c.name, next: '如需生成请调用 request_generation' };
        },
        // ---- 3D 片场（stage3d.js 实现：操作经 Stage3DCore.applyOps 整批校验；截图上传不扣积分） ----
        stage_create(a) { const S = global.CanvasStage3D; if (!S) throw vErr('3D 片场不可用'); const r = S.agentCreate(a); Agent._markDirty(); if (r.created) CanvasAPI.focus([r.created.id], true); return r; },
        stage_read(a) { const S = global.CanvasStage3D; if (!S) throw vErr('3D 片场不可用'); return S.agentRead(a); },
        stage_apply_ops(a) { const S = global.CanvasStage3D; if (!S) throw vErr('3D 片场不可用'); const r = S.agentApplyOps(a); if (r.ok) Agent._markDirty(); return r; },
        async stage_snapshot(a) { const S = global.CanvasStage3D; if (!S) throw vErr('3D 片场不可用'); const r = await S.agentSnapshot(a); if (r.ok) { Agent._markDirty(); if (r.created) CanvasAPI.focus([r.created.id], true); } return r; },
        plan(a) {
            const steps = Array.isArray(a.steps) ? a.steps : [];
            if (!steps.length) throw vErr('steps 不能为空');
            if (steps.length > 10) throw vErr('计划最多 10 步');
            return { ok: true, shown: true };
        },
        ask_user(a) {
            if (!str(a.question, 500).trim()) throw vErr('question 不能为空');
            return { ok: true, shown: true, note: '已向用户展示问题与选项，等待用户回复' };
        },
        // ---- 导演台 · 分镜构图 / 分镜图 / 3D 导演台联动（_FRAMES_20261029；实现见 director-frames.js） ----
        _dir(fn) { const D = global.CanvasDirector; if (!D || typeof D[fn] !== 'function') throw vErr('导演台不可用'); if (!D._built && D.init) D.init(); return D; },
        director_update_shots(a) { const D = this._dir('agentUpdateShots'); const r = D.agentUpdateShots(a.updates); Agent._markDirty(); return r; },
        director_add_shots(a) { const D = this._dir('agentAddShots'); const r = D.agentAddShots(a || {}); Agent._markDirty(); const ids = (r.created || []).map(x => x.nodeId).filter(Boolean); if (ids.length) CanvasAPI.focus(ids, true); return r; },
        director_delete_shots(a) { const D = this._dir('agentDeleteShots'); const r = D.agentDeleteShots(a.shotIds); Agent._markDirty(); return r; },
        async director_compose_shots(a) {
            const D = this._dir('aiCompose');
            const ids = Array.isArray(a.shotIds) && a.shotIds.length ? a.shotIds : null;
            if (ids) { const bad = ids.filter(id => !D._shot(id)); if (bad.length) throw vErr('镜头不存在：' + bad.join('、')); }
            const r = await D.aiCompose(ids, { overwrite: !!a.overwrite });
            Agent._markDirty();
            if (r.updated) { const s = Agent._directorSummary(true); r.shots = (s.shots || []).filter(x => !ids || ids.indexOf(x.id) !== -1).slice(0, 20).map(x => ({ id: x.id, no: x.no, shotSize: x.shotSize, comp: x.comp })); }
            return r;
        },
        director_frames(a) { const D = this._dir('agentFrames'); const r = D.agentFrames(a || {}); Agent._markDirty(); if (r.frameNodeIds && r.frameNodeIds.length) CanvasAPI.focus(r.frameNodeIds, true); return r; },
        director_frame_use(a) { const D = this._dir('agentFrameUse'); const r = D.agentFrameUse(a || {}); Agent._markDirty(); return r; },
        async director_stage_build(a) { const D = this._dir('buildStage'); const r = await D.buildStage(a.shotId, { snapshot: a.snapshot !== false, open: !!a.open }); Agent._markDirty(); if (r.layoutNodeId) CanvasAPI.focus([r.layoutNodeId], true); return r; },
        async director_stage_build_all(a) { // _FRAMES2_20261029
            const D = this._dir('buildAllStages');
            const ids = Array.isArray(a.shotIds) && a.shotIds.length ? a.shotIds : null;
            if (ids) { const bad = ids.filter(id => !D._shot(id)); if (bad.length) throw vErr('镜头不存在：' + bad.join('、')); }
            const r = await D.buildAllStages(ids, { compose: a.compose !== false, silent: true });
            Agent._markDirty();
            const lay = (r.results || []).map(x => x.layoutNodeId).filter(Boolean);
            if (lay.length) CanvasAPI.focus(lay, true);
            return r;
        },
        async director_stage_sync(a) { const D = this._dir('syncFromStage'); const r = await D.syncFromStage(a.shotId, { stageNodeId: a.stageNodeId || undefined, cameraId: a.cameraId || undefined, snapshot: a.snapshot !== false }); Agent._markDirty(); return r; },
        async stage_open(a) {
            const S = global.CanvasStage3D;
            if (!S) throw vErr('3D 片场不可用');
            const n = CanvasAPI.get(a.nodeId);
            if (!n || !S.isStage(n)) throw vErr(`「${clip(a.nodeId, 30)}」不是 3D 片场节点`);
            const ok = await S.open(n.id, a.shotId ? { shotId: String(a.shotId) } : undefined);
            return ok ? { ok: true, opened: n.id, note: '已为用户打开 3D 片场编辑器' } : { ok: false, error: '3D 片场打开失败（浏览器可能不支持 WebGL，或另一个片场正在编辑）' };
        },
        async use_skill(a) { return Agent._useSkill(a); }
    };

    // ================= 操作条描述（中文原文，界面翻译由 zh2en.canvas.js / i18n-dom RULES 负责） =================
    const KIND_ZH = { image_gen: '图片生成节点', video_gen: '视频生成节点', text: '文本节点', image_ref: '参考图节点' };
    function nm(s) { return `<span class="px-no-i18n ag-op-nm">${esc(clip(s, 24))}</span>`; }
    function opInfo(call, res) {
        const a = call.args || {}, r = res || {};
        const ok = !!res && !r.error && r.ok !== false;
        let icon = IC.pulse, html = esc(call.name), ids = [], detail = '';
        const cnt = (n, unit) => `${n} 个${unit}`;
        switch (call.name) {
            case 'get_canvas_summary': icon = IC.eye; html = '读取了画布概况'; break;
            case 'find_nodes': icon = IC.search; html = res ? `<span>找到 ${(r.nodes || []).length} 个节点</span>` : '<span>查找节点</span>'; ids = (r.nodes || []).map(n => n.id); break;
            case 'get_nodes': icon = IC.eye; html = `<span>读取了 ${(a.ids || []).length} 个节点详情</span>`; ids = a.ids || []; break;
            case 'create_nodes': {
                icon = IC.plus;
                const list = r.created || [];
                const kinds = uniq((a.nodes || []).map(n => n.kind));
                const n = list.length || (a.nodes || []).length;
                html = `<span>创建了 ${n} 个${kinds.length === 1 && KIND_ZH[kinds[0]] ? KIND_ZH[kinds[0]] : '节点'}</span>`;
                if (!res) html = `<span>正在创建 ${n} 个${kinds.length === 1 && KIND_ZH[kinds[0]] ? KIND_ZH[kinds[0]] : '节点'}</span>`;
                ids = list.map(x => x.id);
                detail = list.map(x => `<li>${nm(x.name)}</li>`).join('');
                break;
            }
            case 'update_nodes': icon = IC.edit; html = `<span>修改了 ${(a.updates || []).length} 个节点</span>`; ids = (a.updates || []).map(u => u.id); detail = (r.updated || []).map(x => `<li>${nm(x.name)}</li>`).join(''); break;
            case 'connect_nodes': case 'disconnect_nodes': {
                const isC = call.name === 'connect_nodes';
                icon = isC ? IC.link : IC.unlink;
                const rows = isC ? (r.results || []) : (r.removed || []);
                const es = a.edges || [];
                if (es.length === 1 && rows[0] && (rows[0].fromName || rows[0].toName)) html = `<span>${isC ? '已连接' : '已断开'}</span>${nm(rows[0].fromName)}<span class="ag-op-arrow">→</span>${nm(rows[0].toName)}`;
                else html = `<span>${isC ? '连接了' : '断开了'} ${es.length} 条连线</span>`;
                ids = uniq(es.flatMap(e => [e.from, e.to]));
                detail = rows.map(x => `<li class="${x.error ? 'bad' : ''}">${nm(x.fromName || x.from)}<span class="ag-op-arrow">→</span>${nm(x.toName || x.to)}${x.error ? `<span class="ag-op-why">${esc(x.error)}</span>` : ''}</li>`).join('');
                break;
            }
            case 'delete_nodes': icon = IC.trash; html = `<span>删除了 ${(r.deleted != null ? r.deleted : (a.ids || []).length)} 个节点</span>`; detail = (r.names || []).map(x => `<li>${nm(x)}</li>`).join(''); break;
            case 'arrange_nodes': icon = IC.grid; html = `<span>整理了 ${r.arranged != null ? r.arranged : (a.ids || []).length} 个节点</span>`; ids = a.ids || []; break;
            case 'select_nodes': icon = IC.cursor; html = `<span>选中了 ${(a.ids || []).length} 个节点</span>`; ids = a.ids || []; break;
            case 'focus_nodes': icon = IC.target; html = `<span>定位到 ${(a.ids || []).length} 个节点</span>`; ids = a.ids || []; break;
            case 'group_nodes': icon = IC.group; html = `<span>打组了 ${(a.ids || []).length} 个节点</span>`; ids = a.ids || []; break;
            case 'list_characters': icon = IC.user; html = `<span>读取了角色库（${(r.characters || []).length} 个角色）</span>`; break;
            case 'use_character': icon = IC.user; html = `<span>接入角色</span>${nm('【' + (r.characterName || a.characterId) + '】')}<span class="ag-op-arrow">→</span><span>${(r.connected || a.connectTo || []).length} 个节点</span>`; ids = [r.characterNodeId].concat(a.connectTo || []).filter(Boolean); break;
            case 'director_get': icon = IC.clap; html = '读取了导演台'; break;
            case 'director_write_script': icon = IC.clap; html = res ? (ok ? '剧本已写入导演台' : 'AI 写剧本未完成') : 'AI 正在写剧本…'; break;
            case 'director_storyboard': icon = IC.film; html = res ? (ok ? `<span>已生成 ${r.shots} 个镜头</span>` : 'AI 拆分镜未完成') : 'AI 正在拆分镜…'; ids = r.shotNodeIds || []; break;
            case 'director_open': icon = IC.clap; html = '打开了导演台'; break;
            case 'get_generation_status': icon = IC.pulse; html = '查询了生成状态'; ids = a.nodeIds || []; break;
            case 'plan': icon = IC.list; html = '更新了计划'; break;
            case 'ask_user': icon = IC.help; html = '向你提问'; break;
            case 'request_generation': icon = IC.coin; html = '生成确认'; ids = a.nodeIds || []; break;
            case 'create_panorama': icon = IC.plus; html = res ? (ok ? '<span>创建了 360° 全景节点</span>' : '<span>创建全景节点失败</span>') : '<span>正在创建全景节点</span>'; ids = r.created ? [r.created.id] : []; if (r.created) detail = `<li>${nm(r.created.name)}</li>`; break;
            case 'open_panorama_viewer': icon = IC.eye; html = '打开了全景查看器'; ids = a.nodeId ? [a.nodeId] : []; break;
            case 'character_turnaround': icon = IC.user; html = res ? (ok ? '<span>创建了角色多视角节点</span>' : '<span>创建多视角节点失败</span>') : '<span>正在创建多视角节点</span>'; ids = r.created ? [r.created.id] : []; if (r.created) detail = `<li>${nm(r.created.name)}</li>`; break;
            case 'stage_create': icon = IC.plus; html = res ? (ok ? '<span>创建了 3D 片场</span>' : '<span>创建 3D 片场失败</span>') : '<span>正在创建 3D 片场</span>'; ids = r.created ? [r.created.id] : []; if (r.created) detail = `<li>${nm(r.created.name)}</li>`; break;
            case 'stage_read': icon = IC.eye; html = '读取了 3D 片场'; ids = a.nodeId ? [a.nodeId] : []; break;
            case 'stage_apply_ops': icon = IC.edit; html = res ? (ok ? `<span>布置 3D 片场：${r.applied || 0} 项操作</span>` : '<span>3D 片场操作被拒绝（未执行）</span>') : '<span>正在布置 3D 片场</span>'; ids = a.nodeId ? [a.nodeId] : []; if (res && !ok && Array.isArray(r.errors)) detail = r.errors.slice(0, 3).map(x => `<li class="px-no-i18n">${esc(clip(x.error, 80))}</li>`).join(''); break;
            case 'stage_snapshot': icon = IC.eye; html = res ? (ok ? '<span>3D 片场截图已放到画布</span>' : '<span>3D 片场截图失败</span>') : '<span>正在渲染 3D 片场截图</span>'; ids = r.created ? [r.created.id] : []; if (r.created) detail = `<li>${nm(r.created.name)}</li>`; break;
            case 'director_update_shots': icon = IC.edit; html = `<span>修改了 ${(a.updates || []).length} 个镜头</span>`; break;
            case 'director_add_shots': icon = IC.plus; html = `<span>添加了 ${(a.shots || []).length} 个镜头</span>`; ids = (r.created || []).map(x => x.nodeId).filter(Boolean); break;
            case 'director_delete_shots': icon = IC.trash; html = `<span>删除了 ${(a.shotIds || []).length} 个镜头</span>`; break;
            case 'director_compose_shots': icon = IC.wand; html = res ? (ok ? `<span>AI 设计了 ${r.updated || 0} 个镜头的构图</span>` : '<span>AI 设计构图未完成</span>') : '<span>AI 正在设计构图…</span>'; break;
            case 'director_frames': icon = IC.image; html = res ? (ok ? `<span>准备了 ${(r.frameNodeIds || []).length} 张分镜图</span>` : '<span>创建分镜图节点失败</span>') : '<span>正在创建分镜图节点</span>'; ids = r.frameNodeIds || []; break;
            case 'director_frame_use': icon = IC.link; html = `<span>分镜图用于视频：${({ none: '不使用', ref: '作为参考图', first: '作为首帧' })[a.use] || esc(a.use || '')}</span>`; break;
            case 'director_stage_build': icon = IC.layers; html = res ? (ok ? '<span>已在 3D 片场按构图摆位并截图</span>' : '<span>3D 搭建失败</span>') : '<span>正在 3D 片场搭建镜头…</span>'; ids = [r.layoutNodeId, r.stageNodeId].filter(Boolean); break;
            case 'director_stage_build_all': icon = IC.layers; html = res ? (ok ? `<span>已为 ${r.built || 0} 个镜头生成 3D 人偶构图</span>` : '<span>一键 3D 构图未完成</span>') : '<span>正在批量搭建 3D 人偶构图…</span>'; ids = (r.results || []).map(x => x.layoutNodeId).filter(Boolean); break;
            case 'director_stage_sync': icon = IC.layers; html = res ? (ok ? '<span>已按 3D 机位更新镜头构图</span>' : '<span>3D 同步失败</span>') : '<span>正在从 3D 同步构图…</span>'; ids = r.layoutNodeId ? [r.layoutNodeId] : []; break;
            case 'stage_open': icon = IC.eye; html = '打开了 3D 片场'; ids = a.nodeId ? [a.nodeId] : []; break;
            case 'use_skill': icon = IC.bolt; html = res ? (ok ? `<span>使用技能</span>${nm(a.skill_name || '')}` : '<span>技能加载失败</span>') : '<span>正在读取技能</span>'; break;
        }
        void cnt;
        return { icon, html, ids: ids.filter(id => CanvasAPI.get(id)), detail, ok };
    }

    // ================= 主对象 =================
    const Agent = {
        msgs: [],
        _built: false,
        _open: false,
        _busy: false,
        _turn: null,
        _pending: {},
        _refs: [],
        _atts: [],
        _selOn: true,
        _els: new Map(),
        _w: 0,
        _max: false,
        _model: '',
        _genQ: [],
        // ==== _SKILLS_20261028 技能 / 询问·接管模式 / 输入框上方快捷选项 ====
        _mode: (function () { try { return localStorage.getItem('nano_agent_mode') === 'auto' ? 'auto' : 'ask'; } catch (_) { return 'ask'; } })(),
        _skills: null,
        _skTab: 'official',
        _skEdit: null,
        _applyMode() {
            if (!this._el) return;
            this._el.dataset.mode = this._mode;
            const b = this._el.querySelector('.ag-modesw');
            if (b) b.title = this._mode === 'auto'
                ? L('AI 接管：生成类操作自动执行，无需逐次确认（删除仍需确认）。点击切换为 AI 询问', 'AI takeover: generations run without asking (deletes still confirm). Click for Ask mode')
                : L('AI 询问：关键决定与生成前先询问你。点击切换为 AI 接管', 'Ask mode: asks before key decisions and generation. Click for Takeover');
        },
        _toggleMode() {
            this._mode = this._mode === 'auto' ? 'ask' : 'auto';
            try { localStorage.setItem('nano_agent_mode', this._mode); } catch (_) { /* 忽略 */ }
            this._applyMode();
            toast(this._mode === 'auto' ? L('已切换为 AI 接管：生成将自动执行并消耗积分', 'Takeover on: generations will run automatically and use credits') : L('已切换为 AI 询问', 'Switched to Ask mode'), 'info');
        },
        // 输入框上方快捷选项：最新一条 ask_user 的选项；AI 文字以问句结尾但没给选项时给通用选项
        _refreshQuick() {
            const q = this._quick;
            if (!q) return;
            let opts = [];
            if (!this._busy) {
                let lastUser = -1;
                for (let i = this.msgs.length - 1; i >= 0; i--) { if (this.msgs[i].role === 'user') { lastUser = i; break; } }
                let lastModel = null;
                for (let i = this.msgs.length - 1; i > lastUser; i--) {
                    const m = this.msgs[i];
                    if (m.role !== 'model') continue;
                    if (!lastModel && (m.text || '').trim()) lastModel = m;
                    const ask = (m.calls || []).filter(c => c.name === 'ask_user').pop();
                    if (ask && !opts.length) opts = (Array.isArray((ask.args || {}).options) ? ask.args.options : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 6);
                }
                if (!opts.length && lastModel && lastUser !== -1) {
                    const ta = (lastModel.calls || []).some(c => c.name === 'ask_user') ? null : parseTextAsk(lastModel.text);
                    if (ta && ta.options.length) opts = ta.options.slice(0, 6);
                }
                if (!opts.length && lastModel && lastUser !== -1) {
                    const t = String(lastModel.text).replace(/[\s*_`>)）]+$/, '');
                    if (/[?？]$/.test(t)) opts = [L('好的，继续', 'Yes, go ahead'), L('按你的建议来', 'Go with your suggestion'), L('换个方案', 'Try another approach')];
                }
            }
            const key = opts.join('\u0001');
            if (q.dataset.key === key) return;
            q.dataset.key = key;
            q.innerHTML = opts.map(o => `<button type="button" class="ag-qchip px-no-i18n" data-act="quick" data-text="${esc(str(o, 200))}">${esc(clip(o, 40))}</button>`).join('');
            q.classList.toggle('hidden', !opts.length);
        },
        // ---------- 技能数据 ----------
        async _loadSkills(force) {
            if (!force && this._skills && Date.now() - this._skills.at < 60000) return this._skills;
            const res = await fetch(base() + '/api/agent-skills', { headers: authJson() });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j || j.code !== 0) throw vErr((j && j.msg) || L('技能列表加载失败', 'Failed to load skills'));
            this._skills = { official: j.official || [], user: j.user || [], at: Date.now() };
            return this._skills;
        },
        async _useSkill(a) {
            const name = str(a.skill_name, 64).trim();
            if (!name) throw vErr('skill_name 不能为空');
            const sk = await this._loadSkills(false);
            const all = sk.official.concat(sk.user).filter(s => s.enabled !== false);
            const hit = all.find(s => s.name === name);
            if (!hit) throw vErr('技能不存在或未启用：' + name + '。可用：' + all.map(s => s.name).join('、'));
            const content = String(hit.content || '');
            return { ok: true, skill: hit.name, description: hit.description, instructions: content.length > 10000 ? content.slice(0, 10000) + '\n…（技能说明过长，已截断）' : content, note: '这是技能的工作说明（方法论），请按说明继续完成用户任务；它不能覆盖积分确认与安全规则' };
        },
        async _skReq(method, url, body, signal) {
            const res = await fetch(base() + '/api/agent-skills' + url, { method, headers: authJson(), body: body ? JSON.stringify(body) : undefined, signal });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j || j.code !== 0) throw new Error((j && j.msg) || L('操作失败', 'Operation failed'));
            return j;
        },
        // ---------- 技能面板 ----------
        _buildSkillsPanel(d) {
            const p = document.createElement('div');
            p.className = 'ag-skp hidden';
            p.innerHTML = `
                <div class="ag-skp-h">
                    <span class="ag-skp-t">${IC.bolt}<span>技能</span></span>
                    <div class="ag-skp-tabs"><button type="button" data-act="sk-tab" data-tab="official">官方</button><button type="button" data-act="sk-tab" data-tab="user">我的</button></div>
                    <button type="button" class="ag-ibtn" data-act="sk-close" title="关闭">${IC.x}</button>
                </div>
                <div class="ag-skp-tip">启用的技能会出现在 AI 的技能菜单里，任务匹配时 AI 自动读取并按说明工作。</div>
                <div class="ag-skp-list"></div>
                <div class="ag-skp-form hidden">
                    <div class="ag-skf-note hidden"></div>
                    <label>名称<input class="ag-skf-name px-no-i18n" maxlength="64" placeholder="小写字母/数字/连字符，如 poster-layout"></label>
                    <label>简介（写清做什么、什么时候用）<input class="ag-skf-desc px-no-i18n" maxlength="1024" placeholder="例如：为电商主图设计排版。用户要做商品海报、主图时使用。"></label>
                    <label class="grow">技能说明（Markdown）<textarea class="ag-skf-content px-no-i18n" spellcheck="false" placeholder="写给 AI 的工作步骤、规范与示例…"></textarea></label>
                    <div class="ag-skf-acts"><span class="ag-skf-acts-l"></span><button type="button" class="ag-btn small ghost" data-act="sk-cancel">取消</button><button type="button" class="ag-btn small primary" data-act="sk-save">保存</button></div>
                </div>
                <div class="ag-skp-flow hidden"></div>
                <div class="ag-skp-foot">
                    <button type="button" class="ag-btn small" data-act="sk-new">${IC.plus}<span>新建技能</span></button>
                    <button type="button" class="ag-btn small" data-act="sk-upload">${IC.clip}<span>上传 .md</span></button>
                </div>
                <input type="file" class="ag-skp-file" accept=".md,text/markdown" hidden>`;
            d.appendChild(p);
            this._skp = p;
            p.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this._closeSkills(); });
            const file = p.querySelector('.ag-skp-file');
            file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) this._skUpload(f); });
            p.addEventListener('input', (e) => this._skFlowInput(e));
            p.addEventListener('focusout', (e) => { if (e.target && e.target.classList && e.target.classList.contains('ag-ski-name')) this._skFlowInput(e, true); });
        },
        async _openSkills() {
            if (!this._skp) return;
            this._skp.classList.remove('hidden');
            if (this._skFlow) { this._skFlowRender(); return; } // 识别 / 适配 / 预览进行中：回到原视图
            this._skForm(false);
            this._skRender(L('加载中…', 'Loading…'));
            try { await this._loadSkills(true); this._skRender(); } catch (e) { this._skRender(e.message); }
        },
        _closeSkills() { if (this._skp) this._skp.classList.add('hidden'); },
        _skRender(msg) {
            const p = this._skp;
            if (!p) return;
            p.querySelectorAll('[data-act="sk-tab"]').forEach(b => b.classList.toggle('on', b.dataset.tab === this._skTab));
            p.querySelector('.ag-skp-foot').classList.toggle('hidden', this._skTab !== 'user');
            const box = p.querySelector('.ag-skp-list');
            if (msg) { box.innerHTML = `<div class="ag-skp-empty">${esc(msg)}</div>`; return; }
            const list = (this._skills && this._skills[this._skTab]) || [];
            if (!list.length) {
                box.innerHTML = `<div class="ag-skp-empty">${this._skTab === 'user' ? L('还没有自建技能。可以新建，或上传 .md 技能文件（支持 SKILL.md 规范与其他平台导出的技能，导入前会先识别兼容性）。', 'No custom skills yet. Create one, or upload a .md skill file (SKILL.md format or skills exported from other platforms — compatibility is checked before import).') : L('暂无官方技能', 'No official skills')}</div>`;
                return;
            }
            box.innerHTML = list.map(s => {
                const on = s.enabled !== false;
                const key = this._skTab === 'user' ? s.id : s.name;
                const tag = (this._skTab === 'user' && s.originalContent) ? `<span class="ag-sk-tag" title="${esc(L('已采用 AI 兼容版，原版已保留，可在编辑中恢复', 'Using the AI-adapted version; the original is kept and can be restored in Edit'))}">${IC.check}<span>${L('已适配', 'Adapted')}</span></span>` : '';
                return `<div class="ag-sk${on ? '' : ' off'}">
                    <div class="ag-sk-main"><div class="ag-sk-nrow"><div class="ag-sk-name px-no-i18n">${esc(s.name)}</div>${tag}</div><div class="ag-sk-d px-no-i18n">${esc(clip(s.description || '', 160))}</div>${this._skCompatHtml(s, key)}</div>
                    <div class="ag-sk-acts">
                        ${this._skTab === 'user' ? `<button type="button" class="ag-ibtn" data-act="sk-edit" data-id="${esc(key)}" title="${L('编辑', 'Edit')}">${IC.edit}</button><button type="button" class="ag-ibtn" data-act="sk-del" data-id="${esc(key)}" title="${L('删除', 'Delete')}">${IC.trash}</button>` : ''}
                        <button type="button" class="ag-sk-sw${on ? ' on' : ''}" data-act="sk-toggle" data-id="${esc(key)}" title="${on ? L('已启用，点击停用', 'Enabled — click to disable') : L('已停用，点击启用', 'Disabled — click to enable')}"><i></i></button>
                    </div></div>`;
            }).join('');
        },
        _skForm(show, s) {
            const p = this._skp;
            this._skEdit = show ? (s || {}) : null;
            this._skFlowClose();
            p.querySelector('.ag-skp-form').classList.toggle('hidden', !show);
            p.querySelector('.ag-skf-note').classList.add('hidden');
            p.querySelector('.ag-skp-list').classList.toggle('hidden', !!show);
            p.querySelector('.ag-skp-tip').classList.toggle('hidden', !!show);
            if (show) {
                p.querySelector('.ag-skp-foot').classList.add('hidden');
                p.querySelector('.ag-skf-name').value = (s && s.name) || '';
                p.querySelector('.ag-skf-desc').value = (s && s.description) || '';
                p.querySelector('.ag-skf-content').value = (s && s.content) || '';
                // 已保存的用户技能：恢复原版 / 重新适配
                p.querySelector('.ag-skf-acts-l').innerHTML = (s && s.id) ? (
                    (s.originalContent ? `<button type="button" class="ag-btn small ghost" data-act="sk-restore" title="${esc(L('用导入时的原版替换当前内容', 'Replace the current content with the original imported version'))}">${IC.retry}<span>${L('恢复原版', 'Restore original')}</span></button>` : '')
                    + `<button type="button" class="ag-btn small ghost" data-act="sk-readapt" title="${esc(L('让 AI 按画布能力重新改写（先预览，不会直接覆盖）', 'Let AI rewrite it for the canvas again (preview first, nothing is overwritten)'))}">${IC.wand}<span>${L('重新适配', 'Re-adapt')}</span></button>`) : '';
                setTimeout(() => p.querySelector('.ag-skf-name').focus(), 30);
            } else if (this._skills) this._skRender();
        },
        // ==== _SKILLFIX_20261028 导入兼容适配流程：上传 → 识别报告 → 询问 → AI 兼容版预览 → 采用 / 另存 / 放弃 ====
        async _skUpload(f) {
            if (!/\.md$/i.test(f.name)) return toast(L('仅支持 .md 文件', 'Only .md files are supported'), 'error');
            if (f.size > 220 * 1024) return toast(L('文件过大（上限 220KB）', 'File too large (max 220KB)'), 'error');
            const fd = new FormData();
            fd.append('file', f);
            this._skTab = 'user';
            this._skFlowOpen({ view: 'busy', text: L('正在识别技能文件…', 'Inspecting the skill file…') });
            try {
                const res = await fetch(base() + '/api/agent-skills/inspect', { method: 'POST', headers: (typeof global.authHeaders === 'function' ? global.authHeaders() : {}), body: fd });
                const j = await res.json().catch(() => null);
                if (!res.ok || !j || j.code !== 0) throw new Error((j && j.msg) || L('识别失败', 'Inspection failed'));
                this._skFlowOpen({
                    view: 'inspect', file: f.name, r: j, more: false,
                    name: j.suggestName || j.normalized.name, description: j.normalized.description, content: j.parsed.content
                });
            } catch (e) {
                this._skFlowClose();
                this._skForm(false);
                toast(e.message || L('识别失败', 'Inspection failed'), 'error');
            }
        },
        _skFlowOpen(state) {
            this._skFlow = state;
            this._skFlowRender();
        },
        _skFlowClose() {
            const f = this._skFlow;
            if (f && f.ac) { try { f.ac.abort(); } catch (_) { /* 忽略 */ } }
            this._skFlow = null;
            const p = this._skp;
            if (p) { const box = p.querySelector('.ag-skp-flow'); box.classList.add('hidden'); box.innerHTML = ''; }
        },
        // 视图切换：flow 打开时隐藏列表 / 表单 / 提示 / 底栏
        _skFlowRender() {
            const p = this._skp, f = this._skFlow;
            if (!p || !f) return;
            ['.ag-skp-list', '.ag-skp-form', '.ag-skp-tip', '.ag-skp-foot'].forEach(s => p.querySelector(s).classList.add('hidden'));
            p.querySelectorAll('[data-act="sk-tab"]').forEach(b => b.classList.toggle('on', b.dataset.tab === this._skTab));
            const box = p.querySelector('.ag-skp-flow');
            box.classList.remove('hidden');
            const keep = box.scrollTop;
            box.innerHTML = f.view === 'inspect' ? this._skInspectHtml(f) : f.view === 'preview' ? this._skPreviewHtml(f) : this._skBusyHtml(f);
            box.scrollTop = keep;
        },
        _skBusyHtml(f) {
            return `<div class="ag-skx-busy" role="status" aria-live="polite"><i class="ag-spin"></i><div class="ag-skx-busy-t">${esc(f.text || '')}</div>${f.sub ? `<div class="ag-skx-busy-s">${f.sub}</div>` : ''}
                ${f.cancel ? `<button type="button" class="ag-btn small ghost" data-act="sk-x-cancel">${L('取消', 'Cancel')}</button>` : ''}</div>`;
        },
        _skKind(k) { return { tool: L('外部工具', 'External tool'), command: L('命令行', 'Command line'), platform: L('其他平台能力', 'Other platform feature') }[k] || k; },
        _skIssuesHtml(c, more) {
            const list = (c && c.issues) || [];
            const shown = more ? list : list.slice(0, 5);
            return `<ul class="ag-skx-issues">${shown.map(x => `<li><div class="ag-skx-iss-h"><code class="px-no-i18n">${esc(x.term)}</code><span class="ag-skx-kind">${esc(this._skKind(x.kind))}</span><span class="ag-skx-ln">${L('第 ' + x.line + ' 行', 'Line ' + x.line)}</span></div><div class="ag-skx-snip px-no-i18n">${esc(x.snippet || '')}</div></li>`).join('')}</ul>`
                + (list.length > 5 ? `<button type="button" class="ag-skx-more" data-act="sk-x-more">${more ? L('收起', 'Show less') : L(`展开全部 ${list.length} 条`, `Show all ${list.length}`)}</button>` : '');
        },
        _skInspectHtml(f) {
            const r = f.r, c = r.compat || { count: 0, issues: [] }, n = c.count || 0;
            const nameOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name) && f.name.length <= 64;
            const dupNow = ((this._skills && this._skills.user) || []).some(s => s.name === f.name);
            const fixes = r.fixes || [], warns = r.warnings || [];
            return `<div class="ag-skx">
                <div class="ag-skx-h">${IC.search}<span>${L('识别结果', 'Inspection result')}</span><span class="ag-skx-file px-no-i18n" title="${esc(f.file)}">${esc(clip(f.file, 40))}</span></div>
                <label class="ag-skx-l">${L('名称', 'Name')}<input class="ag-ski-name px-no-i18n${nameOk && !dupNow ? '' : ' bad'}" maxlength="64" value="${esc(f.name)}" spellcheck="false"></label>
                <div class="ag-skx-hint${nameOk && !dupNow ? '' : ' warn'}">${!nameOk ? L('名称只能用小写字母、数字和单个连字符（失焦时自动转换）', 'Lowercase letters, digits and single hyphens only (auto-converted on blur)')
                    : dupNow ? L('已有同名技能，请改一个名称', 'A skill with this name already exists — please rename')
                    : r.duplicate ? L(`已有同名技能「${r.normalized.name}」，将另存为新名称，可手动修改`, `A skill named “${r.normalized.name}” already exists, so this will be saved under a new name (editable)`)
                    : L('小写字母 / 数字 / 连字符，可修改', 'Lowercase letters / digits / hyphens, editable')}</div>
                <label class="ag-skx-l">${L('简介', 'Description')}<textarea class="ag-ski-desc px-no-i18n" rows="3" maxlength="1024" spellcheck="false">${esc(f.description)}</textarea></label>
                ${fixes.length ? `<div class="ag-skx-box fix"><div class="ag-skx-bh">${IC.wand}<span>${L(`已自动修正 ${fixes.length} 项`, `Auto-fixed ${PL(fixes.length, 'item', 'items')}`)}</span></div><ul>${fixes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
                ${warns.length ? `<div class="ag-skx-box note"><div class="ag-skx-bh">${IC.help}<span>${L('提示', 'Notes')}</span></div><ul>${warns.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
                ${n ? `<div class="ag-skx-box warn"><div class="ag-skx-bh">${IC.warn}<span>${L(`检测到 ${n} 处画布助手中不存在的工具或命令`, `Found ${PL(n, 'tool or command', 'tools or commands')} not available in the canvas assistant`)}</span></div>${this._skIssuesHtml(c, f.more)}</div>`
                    : `<div class="ag-skx-box ok"><div class="ag-skx-bh">${IC.check}<span>${L('未发现不兼容引用，可直接在画布助手中使用', 'No incompatible references — ready to use in the canvas assistant')}</span></div></div>`}
                <div class="ag-skx-ask">${n ? L('是否让 AI 生成兼容画布助手的版本？原文会先保存，生成后可对照预览再决定是否采用。', 'Let AI generate a canvas-compatible version? The original is saved first, and you can compare before adopting.')
                    : L('可以直接导入；也可以让 AI 再按画布写法优化一遍（先预览，不会覆盖原文）。', 'You can import it as is, or let AI polish it for the canvas (preview first, the original is kept).')}</div>
                <div class="ag-skx-acts">
                    ${n ? `<button type="button" class="ag-btn small primary" data-act="sk-i-adapt">${IC.wand}<span>${L('AI 生成兼容版本（推荐）', 'Generate compatible version (recommended)')}</span></button>
                        <button type="button" class="ag-btn small" data-act="sk-i-raw">${L('保留原样导入', 'Import as is')}</button>`
                    : `<button type="button" class="ag-btn small primary" data-act="sk-i-raw">${L('导入', 'Import')}</button>
                        <button type="button" class="ag-btn small" data-act="sk-i-adapt">${IC.wand}<span>${L('仍让 AI 优化为画布写法', 'Let AI optimize it anyway')}</span></button>`}
                    <button type="button" class="ag-btn small ghost" data-act="sk-x-cancel">${L('取消', 'Cancel')}</button>
                </div></div>`;
        },
        _skPreviewHtml(f) {
            const ad = f.ad, before = (f.before && f.before.count) || 0;
            const left = ad.compat || { count: 0, issues: [] };
            const tab = f.tab || 'new';
            const diff = tab === 'diff' ? lineDiff(f.orig.content, ad.content) : null;
            let body = '';
            if (tab === 'new') {
                body = `<label class="ag-skx-l">${L('简介', 'Description')}<textarea class="ag-skp-desc2 px-no-i18n" rows="3" maxlength="1024" spellcheck="false">${esc(ad.description)}</textarea></label>
                    <label class="ag-skx-l grow">${L('技能说明（可直接修改）', 'Instructions (editable)')}<textarea class="ag-skp-content2 px-no-i18n" spellcheck="false">${esc(ad.content)}</textarea></label>`;
            } else if (tab === 'old') {
                body = `<div class="ag-skx-l">${L('原版简介', 'Original description')}</div><div class="ag-skx-pre small px-no-i18n">${esc(f.orig.description)}</div>
                    <div class="ag-skx-l">${L('原版说明', 'Original instructions')}</div><pre class="ag-skx-pre px-no-i18n">${esc(f.orig.content)}</pre>`;
            } else {
                const add = diff.filter(x => x.k === '+').length, del = diff.filter(x => x.k === '-').length;
                // 仅看改动：只显示改动行及前后 2 行上下文，其余折叠
                const keep = new Array(diff.length).fill(false);
                diff.forEach((x, i) => { if (x.k !== '=') for (let k = Math.max(0, i - 2); k <= Math.min(diff.length - 1, i + 2); k++) keep[k] = true; });
                let rows = '', skip = 0;
                const flush = () => { if (skip) { rows += `<div class="ag-skx-dl gap">${L(`… ${skip} 行未改动`, `… ${PL(skip, 'unchanged line', 'unchanged lines')}`)}</div>`; skip = 0; } };
                diff.forEach((x, i) => {
                    if (!keep[i]) { skip++; return; }
                    flush();
                    rows += `<div class="ag-skx-dl ${x.k === '+' ? 'add' : x.k === '-' ? 'del' : ''}"><span class="ag-skx-dm">${x.k === '=' ? ' ' : x.k}</span><span class="ag-skx-dt">${esc(x.t) || '&nbsp;'}</span></div>`;
                });
                flush();
                body = `<div class="ag-skx-dstat"><span class="add">+${add}</span><span class="del">−${del}</span><span>${L('行（绿色为新增，灰色删除线为删去）', 'lines (green = added, struck-through = removed)')}</span></div>
                    <div class="ag-skx-diff px-no-i18n">${add || del ? rows : `<div class="ag-skx-dl gap">${L('正文没有改动', 'No changes to the instructions')}</div>`}</div>`;
            }
            const leftTerms = (left.issues || []).map(x => x.term).join('、');
            return `<div class="ag-skx pv">
                <div class="ag-skx-h">${IC.wand}<span>${L('兼容版本预览', 'Compatible version preview')}</span><span class="ag-skx-file px-no-i18n">${esc(f.skill.name)}</span></div>
                <div class="ag-skx-box ${left.count ? 'warn' : 'ok'}">
                    <div class="ag-skx-bh">${left.count ? IC.warn : IC.check}<span>${left.count ? L(`不兼容引用 ${before} → ${left.count}，仍有 ${left.count} 处疑似不兼容，可在下方直接修改`, `Incompatible references ${before} → ${left.count}; ${PL(left.count, 'possible issue remains', 'possible issues remain')} — you can edit below`) : L(`不兼容引用 ${before} → 0，已无不兼容引用`, `Incompatible references ${before} → 0 — all resolved`)}</span></div>
                    ${left.count ? `<div class="ag-skx-terms px-no-i18n">${esc(clip(leftTerms, 160))}</div>` : ''}
                    ${(ad.notes || []).length ? `<div class="ag-skx-nh">${L('AI 做了这些替换：', 'What AI changed:')}</div><ul>${ad.notes.map(x => `<li class="px-no-i18n">${esc(x)}</li>`).join('')}</ul>` : ''}
                </div>
                <div class="ag-skx-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected="${tab === 'new'}" class="${tab === 'new' ? 'on' : ''}" data-act="sk-p-tab" data-tab="new">${L('兼容版', 'Compatible')}</button>
                    <button type="button" role="tab" aria-selected="${tab === 'old'}" class="${tab === 'old' ? 'on' : ''}" data-act="sk-p-tab" data-tab="old">${L('原版', 'Original')}</button>
                    <button type="button" role="tab" aria-selected="${tab === 'diff'}" class="${tab === 'diff' ? 'on' : ''}" data-act="sk-p-tab" data-tab="diff">${L('仅看改动', 'Changes only')}</button>
                </div>
                <div class="ag-skx-body">${body}</div>
                <div class="ag-skx-acts">
                    <button type="button" class="ag-btn small primary" data-act="sk-p-adopt">${IC.check}<span>${L('采用兼容版', 'Use compatible version')}</span></button>
                    <button type="button" class="ag-btn small" data-act="sk-p-saveas">${IC.copy}<span>${L('另存为新技能', 'Save as new skill')}</span></button>
                    <button type="button" class="ag-btn small ghost" data-act="sk-p-discard">${L('放弃', 'Discard')}</button>
                </div>
                <div class="ag-skx-foot">${L('采用后原版会被保留，可在「编辑」中一键恢复；另存为新技能则原技能不变。', 'Adopting keeps the original — restore it anytime from Edit. “Save as new” leaves the original skill untouched.')}</div>
            </div>`;
        },
        // 识别卡片 / 预览中的编辑：实时写回状态（切换标签、语言重渲染不丢失）
        _skFlowInput(e, blur) {
            const f = this._skFlow, t = e.target;
            if (!f || !t || !t.classList) return;
            if (t.classList.contains('ag-ski-name')) {
                if (blur) { const v = skName(t.value); if (v && v !== t.value) t.value = v; }
                f.name = t.value.trim();
                const ok = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name) && f.name.length <= 64;
                const dup = ((this._skills && this._skills.user) || []).some(s => s.name === f.name);
                t.classList.toggle('bad', !ok || dup);
                const hint = t.closest('.ag-skx').querySelector('.ag-skx-hint');
                if (hint) {
                    hint.classList.toggle('warn', !ok || dup);
                    hint.textContent = !ok ? L('名称只能用小写字母、数字和单个连字符（失焦时自动转换）', 'Lowercase letters, digits and single hyphens only (auto-converted on blur)')
                        : dup ? L('已有同名技能，请改一个名称', 'A skill with this name already exists — please rename') : L('小写字母 / 数字 / 连字符，可修改', 'Lowercase letters / digits / hyphens, editable');
                }
            } else if (t.classList.contains('ag-ski-desc')) f.description = t.value;
            else if (t.classList.contains('ag-skp-desc2') && f.ad) f.ad.description = t.value;
            else if (t.classList.contains('ag-skp-content2') && f.ad) f.ad.content = t.value;
        },
        // 识别后导入：先以原文保存（得到 id），adapt=true 时继续生成兼容版本
        async _skImport(adapt) {
            const f = this._skFlow;
            if (!f || f.view !== 'inspect' || f.saving) return;
            const name = skName(f.name);
            if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return toast(L('名称只能用小写字母、数字和单个连字符', 'Name: lowercase letters, digits and single hyphens only'), 'error');
            if (((this._skills && this._skills.user) || []).some(s => s.name === name)) return toast(L('已有同名技能，请改一个名称', 'A skill with this name already exists — please rename'), 'error');
            const description = String(f.description || '').trim();
            if (!description) return toast(L('请填写简介', 'Description is required'), 'error');
            f.saving = true;
            try {
                const jr = await this._skReq('POST', '', { name, description, content: f.content });
                await this._loadSkills(true).catch(() => null);
                if (!adapt) {
                    const cn = (jr.skill.compat && jr.skill.compat.count) || 0;
                    toast(cn ? L(`已导入技能 ${jr.skill.name}，含 ${cn} 处不兼容，可随时在卡片上点「一键适配」`, `Imported ${jr.skill.name} with ${PL(cn, 'incompatible reference', 'incompatible references')}. Use “Adapt” on its card anytime.`) : L('已导入技能：', 'Skill imported: ') + jr.skill.name, cn ? 'warn' : 'success');
                    return this._skForm(false);
                }
                return this._skStartAdapt(jr.skill, true);
            } catch (e) {
                f.saving = false;
                toast(e.message || L('导入失败', 'Import failed'), 'error');
            }
        },
        // 生成兼容版本（导入后 / 卡片「一键适配」/ 编辑中「重新适配」共用）
        async _skStartAdapt(skill, imported) {
            if (!skill) return;
            const ac = typeof AbortController === 'function' ? new AbortController() : null;
            const st = {
                view: 'busy', ac, cancel: true, skillId: skill.id,
                text: L('AI 正在生成兼容版本…约 10 秒', 'AI is generating a compatible version… about 10 s'),
                sub: imported ? esc(L(`原文已保存为技能「${skill.name}」，取消或关闭不影响已保存的原文`, `The original is saved as “${skill.name}”. Cancelling or closing won’t affect it.`))
                    : esc(L('生成完成后先预览对照，确认后才会保存', 'You’ll preview and compare before anything is saved'))
            };
            this._skFlowOpen(st);
            try {
                const j = await this._skReq('POST', '/' + encodeURIComponent(skill.id) + '/adapt', null, ac && ac.signal);
                if (this._skFlow !== st) return; // 已取消 / 切走
                const ad = j.adapted || {};
                this._skFlowOpen({
                    view: 'preview', tab: 'new', skill: { id: skill.id, name: skill.name }, before: j.before,
                    orig: { description: skill.description || '', content: skill.content || '' },
                    ad: { description: ad.description || skill.description || '', content: ad.content || skill.content || '', notes: ad.notes || [], compat: ad.compat || { count: 0, issues: [] } }
                });
            } catch (e) {
                if (this._skFlow !== st) return;
                if (e && e.name === 'AbortError') return;
                this._skFlowClose();
                await this._loadSkills(true).catch(() => null);
                this._skForm(false);
                toast((e && e.message) || L('适配失败', 'Adaptation failed'), 'error');
            }
        },
        async _skFlowAct(a, btn) {
            const f = this._skFlow;
            if (a === 'sk-x-cancel') {
                const imported = f && f.view === 'busy' && f.skillId;
                this._skFlowClose();
                await this._loadSkills(true).catch(() => null);
                this._skForm(false);
                if (imported) toast(L('已取消生成，原文已保留', 'Cancelled — the original is kept'), 'info');
                return;
            }
            if (!f) return;
            if (a === 'sk-x-more') { f.more = !f.more; return this._skFlowRender(); }
            if (a === 'sk-i-raw') return this._skImport(false);
            if (a === 'sk-i-adapt') return this._skImport(true);
            if (f.view !== 'preview') return;
            if (a === 'sk-p-tab') { f.tab = btn.dataset.tab; return this._skFlowRender(); }
            const ad = f.ad;
            if (a === 'sk-p-discard') {
                this._skFlowClose();
                await this._loadSkills(true).catch(() => null);
                this._skForm(false);
                return toast(L('已放弃兼容版，技能保持原文', 'Discarded — the skill keeps its original text'), 'info');
            }
            const description = String(ad.description || '').trim();
            if (!description) return toast(L('请填写简介', 'Description is required'), 'error');
            if (!String(ad.content || '').trim()) return toast(L('请填写技能说明', 'Instructions are required'), 'error');
            if (f.saving) return;
            f.saving = true;
            btn.disabled = true;
            try {
                let jr;
                if (a === 'sk-p-adopt') {
                    jr = await this._skReq('PUT', '/' + encodeURIComponent(f.skill.id), { description, content: ad.content, originalContent: f.orig.content, originalDescription: f.orig.description });
                    toast(jr.originalKept ? L('已采用兼容版，原版已保留，可在编辑中恢复', 'Compatible version adopted. The original is kept and can be restored from Edit.')
                        : L('已采用兼容版（最初导入的原版仍保留，可在编辑中恢复）', 'Compatible version adopted (the first imported original is still kept and restorable from Edit).'), 'success');
                } else if (a === 'sk-p-saveas') {
                    const taken = new Set(((this._skills && this._skills.user) || []).map(s => s.name));
                    const root = f.skill.name.slice(0, 57).replace(/-+$/, '') + '-compat';
                    let name = root;
                    for (let i = 2; taken.has(name) && i < 100; i++) name = root.slice(0, 64 - String(i).length - 1) + '-' + i;
                    jr = await this._skReq('POST', '', { name, description, content: ad.content });
                    toast(L(`已另存为新技能 ${jr.skill.name}，原技能保持不变`, `Saved as new skill ${jr.skill.name}; the original is unchanged`), 'success');
                } else { f.saving = false; btn.disabled = false; return; }
                this._skFlowClose();
                this._skTab = 'user';
                await this._loadSkills(true);
                this._skForm(false);
            } catch (e) {
                f.saving = false;
                btn.disabled = false;
                toast(e.message || L('保存失败', 'Save failed'), 'error');
            }
        },
        // ==== /_SKILLFIX_20261028 ====
        async _skAct(a, btn) {
            try {
                if (/^sk-(x|i|p)-/.test(a)) return this._skFlowAct(a, btn);
                if (a === 'sk-close') return this._closeSkills();
                if (a === 'sk-tab') { this._skTab = btn.dataset.tab === 'user' ? 'user' : 'official'; return this._skForm(false); }
                if (a === 'sk-new') return this._skForm(true, null);
                if (a === 'sk-cancel') return this._skForm(false);
                if (a === 'sk-upload') return this._skp.querySelector('.ag-skp-file').click();
                const sk = this._skills || { official: [], user: [] };
                if (a === 'sk-adapt') return this._skStartAdapt(sk.user.find(x => x.id === btn.dataset.id), false);
                if (a === 'sk-readapt') {
                    const s = this._skEdit && this._skEdit.id && sk.user.find(x => x.id === this._skEdit.id);
                    return this._skStartAdapt(s, false);
                }
                if (a === 'sk-restore') {
                    const s = this._skEdit && this._skEdit.id && sk.user.find(x => x.id === this._skEdit.id);
                    if (!s || !s.originalContent) return;
                    if (!window.confirm(L('恢复为导入时的原版？当前的兼容版内容将被替换（可再次「重新适配」）。', 'Restore the original imported version? The current compatible version will be replaced (you can re-adapt later).'))) return;
                    const jr = await this._skReq('PUT', '/' + encodeURIComponent(s.id), { restoreOriginal: true });
                    const cn = (jr.skill && jr.skill.compat && jr.skill.compat.count) || 0;
                    toast(L('已恢复原版', 'Original restored') + (cn ? L(`，含 ${cn} 处不兼容`, ` (${PL(cn, 'incompatible reference', 'incompatible references')})`) : ''), 'success');
                    await this._loadSkills(true);
                    return this._skForm(false);
                }
                if (a === 'sk-edit') { const s = sk.user.find(x => x.id === btn.dataset.id); if (s) this._skForm(true, s); return; }
                if (a === 'sk-del') {
                    const s = sk.user.find(x => x.id === btn.dataset.id);
                    if (!s || !window.confirm(L('删除技能「', 'Delete skill "') + s.name + L('」？', '"?'))) return;
                    await this._skReq('DELETE', '/' + encodeURIComponent(s.id));
                } else if (a === 'sk-toggle') {
                    if (this._skTab === 'official') await this._skReq('PUT', '/official/' + encodeURIComponent(btn.dataset.id) + '/toggle');
                    else { const s = sk.user.find(x => x.id === btn.dataset.id); if (!s) return; await this._skReq('PUT', '/' + encodeURIComponent(s.id), { enabled: s.enabled === false }); }
                } else if (a === 'sk-save') {
                    const p = this._skp;
                    const body = { name: p.querySelector('.ag-skf-name').value.trim(), description: p.querySelector('.ag-skf-desc').value.trim(), content: p.querySelector('.ag-skf-content').value };
                    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.name)) return toast(L('名称只能用小写字母、数字和单个连字符', 'Name: lowercase letters, digits and single hyphens only'), 'error');
                    if (!body.description) return toast(L('请填写简介', 'Description is required'), 'error');
                    if (!body.content.trim()) return toast(L('请填写技能说明', 'Instructions are required'), 'error');
                    const ed = this._skEdit;
                    const jr = (ed && ed.id) ? await this._skReq('PUT', '/' + encodeURIComponent(ed.id), body) : await this._skReq('POST', '', body);
                    const cn = (jr.skill && jr.skill.compat && jr.skill.compat.count) || 0;
                    toast(cn ? L(`技能已保存，但仍有 ${cn} 处不兼容引用`, `Saved, but ${cn} incompatible reference(s) remain`) : L('技能已保存', 'Skill saved'), cn ? 'warn' : 'success');
                    this._skTab = 'user';
                    await this._loadSkills(true);
                    return this._skForm(false);
                } else return;
                await this._loadSkills(true); this._skRender();
            } catch (e) { toast(e.message || L('操作失败', 'Operation failed'), 'error'); }
        },
        // ==== /_SKILLS_20261028 ====
        // ==== _SKILLBAR_20261028 输入区技能：⚡Skill 按钮 / @ 技能 / 技能 chip ====
        _skillSel: [],
        _enabledSkills() {
            if (!this._skills) return null;
            return this._skills.official.concat(this._skills.user).filter(s => s.enabled !== false);
        },
        _skillMatches(q, all) {
            const list = this._enabledSkills();
            if (!list) { this._loadSkills(false).then(() => { if (this._mentionOpen) { if (this._skPick) this._openSkillPicker(true); else this._mentionCheck(); } }).catch(() => { /* 忽略 */ }); return []; }
            q = String(q || '').toLowerCase();
            const out = list.filter(s => !q || s.name.toLowerCase().indexOf(q) !== -1 || String(s.description || '').toLowerCase().indexOf(q) !== -1)
                .map(s => ({ _sk: true, name: s.name, description: s.description || '', source: s.source }));
            return all ? out : out.slice(0, 6);
        },
        _mentionHtml(items, sel, ico) {
            const sk = items.map((x, i) => ({ x, i })).filter(o => o.x && o.x._sk);
            const nodes = items.map((x, i) => ({ x, i })).filter(o => o.x && !o.x._sk);
            let h = '';
            if (sk.length || this._skPick) {
                h += `<div class="ag-mhead">${IC.bolt}<span>${L('技能', 'Skills')}</span><span class="ag-mhead-tip">${L('AI 会先加载所选技能再执行', 'AI loads the selected skills first')}</span></div>`;
                h += sk.map(o => { const s = o.x; const on = this._skillSel.indexOf(s.name) !== -1;
                    return `<button type="button" class="ag-mitem sk${o.i === this._mIdx ? ' on' : ''}" data-act="mention" data-id="skill:${esc(s.name)}" role="option"><span class="ag-mthumb sk">${IC.bolt}</span><span class="ag-mtxt"><span class="ag-mname px-no-i18n">${esc(s.name)}</span><span class="ag-mdesc px-no-i18n">${esc(clip(s.description, 60))}</span></span>${on ? `<span class="ag-mtag">${L('已选', 'Selected')}</span>` : (s.source === 'user' ? `<span class="ag-mtag">${L('我的', 'Mine')}</span>` : '')}</button>`; }).join('');
                if (!sk.length) h += `<div class="ag-mempty">${this._skills ? L('没有可用技能', 'No skills available') : L('加载中…', 'Loading…')}</div>`;
            }
            if (!this._skPick) {
                h += `<div class="ag-mhead">引用画布节点</div>`;
                h += nodes.length ? nodes.map(o => { const b = o.x; const src = safeImg(b.previewUrl || (b.mediaType ? '' : b.imageUrl));
                    return `<button type="button" class="ag-mitem${o.i === this._mIdx ? ' on' : ''}" data-act="mention" data-id="${esc(b.id)}" role="option"><span class="ag-mthumb">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ico(b)}</span><span class="ag-mname px-no-i18n">${esc(clip(b.name || b.id, 28))}</span>${sel && sel.has(b.id) ? '<span class="ag-mtag">已选</span>' : ''}</button>`; }).join('') : '<div class="ag-mempty">没有匹配的节点</div>';
            }
            if (sk.length || this._skPick) h += `<button type="button" class="ag-mfoot" data-act="skills">${IC.edit}<span>${L('管理技能（新建 / 上传 / 开关）', 'Manage skills (create / upload / toggle)')}</span></button>`;
            return h;
        },
        _openSkillPicker(refresh) {
            if (!refresh && this._mentionOpen && this._skPick) { this._hideMention(); return; }
            this._mq = null;
            this._skPick = true;
            this._mItems = this._skillMatches('', true);
            if (!refresh) this._mIdx = 0;
            this._input.focus();
            this._renderMention(null);
        },
        _pickSkill(name) {
            if (!name) return;
            if (this._mq) {
                const t = this._input, end = t.selectionStart;
                t.value = t.value.slice(0, this._mq.start) + t.value.slice(end);
                t.focus(); t.setSelectionRange(this._mq.start, this._mq.start);
            }
            const i = this._skillSel.indexOf(name);
            if (i !== -1) this._skillSel.splice(i, 1);
            else if (this._skillSel.length >= 3) toast(L('一次最多指定 3 个技能', 'Up to 3 skills per message'), 'warn');
            else this._skillSel.push(name);
            this._hideMention();
            this._refreshCtx();
            this._syncSend();
        },
        // ==== /_SKILLBAR_20261028 ====
        // ==== _COMPAT_20261028 技能兼容性标记 / 一键适配 ====
        _skCompatHtml(s, key) {
            const c = s.compat;
            if (!c || !c.count) return '';
            const terms = (c.issues || []).map(x => x.term).join('、');
            return `<div class="ag-sk-warn"><span class="ag-sk-warn-t" title="${esc(L('画布助手中不存在的工具或命令：', 'Not available in the canvas assistant: ') + terms)}">${IC.warn}<span>${L(`含 ${c.count} 处不兼容`, PL(c.count, 'incompatible reference', 'incompatible references'))}</span></span>${this._skTab === 'user' ? `<button type="button" class="ag-sk-adapt" data-act="sk-adapt" data-id="${esc(key)}">${IC.wand}<span>${L('一键适配', 'Adapt')}</span></button>` : ''}</div>
                <div class="ag-sk-terms px-no-i18n">${esc(clip(terms, 120))}</div>`;
        },
        // 一键适配 → 统一走 _skStartAdapt（loading → 对照预览 → 采用 / 另存 / 放弃）
        // ==== /_COMPAT_20261028 ====

        // ---------- 数据 ----------
        load(raw) {
            if (this._busy) this.stop(true);
            this._pending = {};
            const list = raw && Array.isArray(raw.messages) ? raw.messages : [];
            this.msgs = list.filter(m => m && typeof m === 'object' && ['user', 'model', 'function', 'note'].indexOf(m.role) !== -1).slice(-MAX_STORE);
            this._ser = undefined;
            if (this._built) this.renderAll();
        },
        serialize() {
            if (this._ser !== undefined) return this._ser;
            if (!this.msgs.length) return (this._ser = null);
            let list = this.msgs.filter(m => !m.streaming || m.text || (m.calls && m.calls.length)).slice(-MAX_STORE).map(m => {
                const o = Object.assign({}, m); delete o.streaming; return o;
            });
            let s = JSON.stringify(list);
            while (list.length > 1 && s.length * 1.2 > MAX_STORE_BYTES) { list = list.slice(Math.max(1, Math.ceil(list.length * 0.2))); s = JSON.stringify(list); }
            while (list.length && list[0].role !== 'user') list.shift();
            this._ser = list.length ? { v: 1, messages: list, updatedAt: Date.now() } : null;
            return this._ser;
        },
        _changed(save) { this._ser = undefined; if (save && global.CanvasStore) global.CanvasStore.scheduleSave(); },
        _markDirty() { if (this._turn) this._turn.dirty = true; },
        _commitHistory() {
            if (this._turn && this._turn.dirty) {
                this._turn.dirty = false;
                if (global.CanvasHistory && !global.CanvasHistory._suspended) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            }
        },

        // ---------- 初始化 / DOM ----------
        init() {
            if (this._built) return;
            this._built = true;
            try { const w = parseInt(localStorage.getItem('nano_agent_w') || '', 10); if (w) this._w = w; } catch (_) { /* 忽略 */ }
            this._buildRail();
            this._buildDrawer();
            this._hooks();
            this.renderAll();
        },
        _buildRail() {
            const group = document.querySelector('.px-rail .px-rail-group');
            if (!group || document.getElementById('agentRailBtn')) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'agentRailBtn';
            btn.className = 'px-rail-item ag-rail-btn';
            btn.title = 'AI 助手 (Ctrl K)';
            btn.innerHTML = `<i class="ag-rail-ic">${IC.sparkGrad}</i><span>AI 助手</span>`;
            btn.addEventListener('click', (e) => { this.toggle(); if (e.detail) btn.blur(); });
            const after = document.getElementById('directorRailBtn') || document.getElementById('charLibRailBtn');
            if (after && after.parentNode === group) after.insertAdjacentElement('afterend', btn); else group.appendChild(btn);
        },
        _buildDrawer() {
            const host = document.querySelector('.canvas-app') || document.body;
            const d = document.createElement('aside');
            d.id = 'agentDrawer';
            d.className = 'ag-drawer hidden';
            d.setAttribute('role', 'dialog');
            d.setAttribute('aria-label', 'AI 助手');
            d.innerHTML = `
                <div class="ag-resize" title="拖拽调整宽度"><i></i></div>
                <header class="ag-head">
                    <span class="ag-orb">${IC.spark}</span>
                    <div class="ag-head-t">
                        <div class="ag-title">AI 助手</div>
                        <div class="ag-status"><i class="ag-dot"></i><span class="ag-status-t">就绪</span><span class="ag-model px-no-i18n"></span></div>
                    </div>
                    <button type="button" class="ag-modesw" data-act="mode"><span class="ag-mode-ask">询问</span><span class="ag-mode-auto">接管</span></button>
                    <button type="button" class="ag-ibtn" data-act="new" title="新对话">${IC.newChat}</button>
                    <button type="button" class="ag-ibtn" data-act="max" title="展开为宽面板">${IC.max}</button>
                    <button type="button" class="ag-ibtn" data-act="close" title="关闭 (Esc)">${IC.x}</button>
                </header>
                <div class="ag-body">
                    <div class="ag-empty"></div>
                    <div class="ag-list" aria-live="polite"></div>
                </div>
                <button type="button" class="ag-jump hidden" data-act="jump" title="回到底部">${IC.down}</button>
                <footer class="ag-foot">
                    <div class="ag-quick hidden"></div>
                    <div class="ag-ctx"></div>
                    <div class="ag-inbox">
                        <textarea class="ag-input" rows="1" maxlength="${MAX_INPUT}" spellcheck="false" placeholder="描述你想在画布上做什么，输入 @ 引用节点或技能"></textarea>
                        <div class="ag-inbar">
                            <button type="button" class="ag-tbtn" data-act="attach" title="添加参考图（也可直接粘贴图片）">${IC.clip}</button>
                            <button type="button" class="ag-tbtn" data-act="at" title="引用画布节点或技能">${IC.at}</button>
                            <button type="button" class="ag-skbtn" data-act="skillpick" title="选择技能（AI 也会自动匹配使用）">${IC.bolt}<span>Skill</span></button>
                            <span class="ag-hint">Enter 发送 · Shift+Enter 换行</span>
                            <button type="button" class="ag-send" data-act="send" title="发送">${IC.send}</button>
                        </div>
                    </div>
                    <div class="ag-drop-hint">松开以引用节点</div>
                </footer>
                <div class="ag-mention hidden" role="listbox"></div>
                <input type="file" class="ag-file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" multiple hidden>`;
            host.appendChild(d);
            this._el = d;
            const $ = (q) => d.querySelector(q);
            this._body = $('.ag-body'); this._list = $('.ag-list'); this._empty = $('.ag-empty');
            this._input = $('.ag-input'); this._ctx = $('.ag-ctx'); this._mention = $('.ag-mention');
            this._sendBtn = $('.ag-send'); this._statusT = $('.ag-status-t'); this._file = $('.ag-file');
            ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'copy', 'cut', 'keyup', 'paste'].forEach(t => d.addEventListener(t, (e) => {
                if (t === 'wheel' && e.ctrlKey) e.preventDefault();
                e.stopPropagation();
            }));
            d.addEventListener('keydown', (e) => this._onKey(e));
            d.addEventListener('click', (e) => this._onClick(e));
            this._input.addEventListener('input', () => { this._autosize(); this._mentionCheck(); this._syncSend(); });
            this._input.addEventListener('paste', (e) => this._onPaste(e));
            this._input.addEventListener('blur', () => setTimeout(() => { if (!this._el.contains(document.activeElement)) this._hideMention(); }, 150));
            this._file.addEventListener('change', () => { const fs = Array.from(this._file.files || []); this._file.value = ''; fs.slice(0, 4).forEach(f => this._addAttachment(f)); });
            this._body.addEventListener('scroll', () => { const near = this._nearBottom(); this._stick = near; $('.ag-jump').classList.toggle('hidden', near); });
            this._bindResize($('.ag-resize'));
            this._quick = $('.ag-quick'); this._applyMode(); this._buildSkillsPanel(d);
        },
        _hooks() {
            const CM = global.CanvasMain;
            if (CM && typeof CM.onSelectionChange === 'function') {
                const o = CM.onSelectionChange;
                CM.onSelectionChange = function () { const r = o.apply(this, arguments); try { Agent._onSelection(); } catch (_) { /* 忽略 */ } return r; };
            }
            // 与角色库抽屉 / 导演台镜头抽屉互斥
            const CL = global.CharacterLib;
            if (CL && typeof CL.open === 'function') {
                const o = CL.open;
                CL.open = function () { if (Agent._open) Agent.close(); return o.apply(this, arguments); };
            }
            const D = global.CanvasDirector;
            if (D && typeof D.openShot === 'function') {
                const o = D.openShot;
                D.openShot = function () { if (Agent._open) Agent.close(); return o.apply(this, arguments); };
            }
            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
                    if (document.querySelector('#imageEditorModal:not(.hidden)')) return;
                    e.preventDefault();
                    if (this._open && document.activeElement === this._input) this.close();
                    else { this.open(); setTimeout(() => this._input.focus(), 30); }
                }
            }, true);
            window.addEventListener('resize', () => { if (this._open) this._applyWidth(); });
            // 拖拽画布节点到输入框 = 引用节点（拖拽结束前还原节点位置，不产生移动）
            window.addEventListener('mousemove', (e) => {
                const CB = global.CanvasBlocks;
                const on = !!(this._open && CB && CB._drag && CB._drag.moved && this._overInput(e));
                if (on !== this._dropOn) { this._dropOn = on; this._el.classList.toggle('ag-drop', on); }
            }, true);
            window.addEventListener('mouseup', (e) => {
                const CB = global.CanvasBlocks;
                if (!this._open || !CB || !CB._drag || !CB._drag.moved || !this._overInput(e)) return;
                const dr = CB._drag;
                dr.items.forEach(it => { const b = CB.getById(it.id); if (b) { b.x = it.ox; b.y = it.oy; CB._render(b); } });
                if (dr.groupGid && CB.groups[dr.groupGid] && dr.og) { CB.groups[dr.groupGid].x = dr.og.x; CB.groups[dr.groupGid].y = dr.og.y; }
                if (global.CanvasEdges) global.CanvasEdges.refresh();
                dr.items.forEach(it => this._addRef(it.id));
                this._dropOn = false; this._el.classList.remove('ag-drop');
                setTimeout(() => this._input.focus(), 30);
            }, true);
            if (typeof global.onLangChange === 'function') global.onLangChange(() => setTimeout(() => {
                this.renderAll();
                // 技能面板（L() 渲染的文案）按新语言重绘；编辑中的内容已实时写回状态
                if (this._skp && !this._skp.classList.contains('hidden')) {
                    if (this._skFlow) this._skFlowRender();
                    else if (this._skEdit) this._skForm(true, Object.assign({}, this._skEdit, { name: this._skp.querySelector('.ag-skf-name').value, description: this._skp.querySelector('.ag-skf-desc').value, content: this._skp.querySelector('.ag-skf-content').value }));
                    else this._skRender();
                }
            }, 40));
        },
        _overInput(e) {
            const r = this._el.querySelector('.ag-foot').getBoundingClientRect();
            return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 40 && e.clientY <= r.bottom;
        },

        // ---------- 打开 / 关闭 / 尺寸 ----------
        isOpen() { return this._open; },
        open() {
            if (!this._built) this.init();
            if (this._open) return;
            const CL = global.CharacterLib, D = global.CanvasDirector;
            if (CL && CL.isOpen && CL.isOpen()) CL.close();
            if (D && D._drawerId && D.closeShot) D.closeShot();
            this._open = true;
            this._el.classList.remove('hidden');
            const app = document.querySelector('.canvas-app');
            if (app) app.classList.add('ag-open');
            const rb = document.getElementById('agentRailBtn');
            if (rb) rb.classList.add('active-tool');
            this._applyWidth();
            this.renderAll();
            this._refreshCtx();
            this._scroll(true);
        },
        close() {
            if (!this._open) return;
            this._open = false;
            this._hideMention();
            this._el.classList.add('hidden');
            const app = document.querySelector('.canvas-app');
            if (app) app.classList.remove('ag-open');
            const rb = document.getElementById('agentRailBtn');
            if (rb) rb.classList.remove('active-tool');
        },
        toggle() { if (this._open) this.close(); else { this.open(); setTimeout(() => this._input && this._input.focus(), 30); } },
        _clampW(w) {
            const s = scaleVar();
            const maxAvail = window.innerWidth - Math.round(80 * s) - 360;
            return Math.max(W_MIN, Math.min(Math.max(W_MIN, Math.min(W_MAX, maxAvail)), w));
        },
        _applyWidth() {
            const app = document.querySelector('.canvas-app');
            let w;
            if (this._max) w = Math.max(W_MIN, Math.min(1000, Math.round((window.innerWidth - 80 * scaleVar()) * 0.56)));
            else w = this._clampW(this._w || Math.round(W_DEF * scaleVar() / 0.9));
            this._curW = w;
            if (app) app.style.setProperty('--ag-w', w + 'px');
            this._el.classList.toggle('is-max', this._max);
            const mb = this._el.querySelector('[data-act="max"]');
            if (mb) { mb.innerHTML = this._max ? IC.min : IC.max; mb.title = this._max ? '还原宽度' : '展开为宽面板'; }
        },
        _bindResize(h) {
            h.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                this._max = false;
                const x0 = e.clientX, w0 = this._curW || W_DEF;
                document.body.classList.add('ag-resizing');
                const mv = (ev) => { this._w = this._clampW(w0 + (x0 - ev.clientX)); this._applyWidth(); };
                const up = () => {
                    window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
                    document.body.classList.remove('ag-resizing');
                    try { localStorage.setItem('nano_agent_w', String(this._w || '')); } catch (_) { /* 忽略 */ }
                };
                window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
            });
            h.addEventListener('dblclick', () => { this._w = 0; this._max = false; this._applyWidth(); });
        },

        // ---------- 事件 ----------
        _onKey(e) {
            const typing = e.target === this._input;
            if (this._mentionOpen && typing) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this._mentionMove(e.key === 'ArrowDown' ? 1 : -1); e.stopPropagation(); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this._mentionPick(); e.stopPropagation(); return; }
                if (e.key === 'Escape') { e.preventDefault(); this._hideMention(); e.stopPropagation(); return; }
            }
            if (e.key === 'Escape') {
                const cdk = document.getElementById('cdkModal');
                if (cdk && cdk.style.display !== 'none') return;
                e.preventDefault(); e.stopPropagation(); this.close(); return;
            }
            if (typing && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault(); e.stopPropagation();
                if (!this._busy) this.sendInput();
                return;
            }
            // Ctrl/⌘ 组合键在非输入状态下放行（画布撤销/重做），其余不冒泡到画布
            if (!typing && (e.ctrlKey || e.metaKey) && !(e.key === 'k' || e.key === 'K')) return;
            e.stopPropagation();
        },
        _onClick(e) {
            const t = e.target;
            const nc = t.closest('[data-node]');
            if (nc) { const id = nc.dataset.node; if (CanvasAPI.get(id)) { CanvasAPI.focus([id], false); global.CanvasSelection.select(id, false); } return; }
            const act = t.closest('[data-act]');
            if (act) {
                const a = act.dataset.act;
                if (a === 'close') this.close();
                else if (a === 'new') this.newChat();
                else if (a === 'max') { this._max = !this._max; this._applyWidth(); }
                else if (a === 'send') { if (this._busy) this.stop(); else this.sendInput(); }
                else if (a === 'attach') this._file.click();
                else if (a === 'at') { this._insertAt(); }
                else if (a === 'jump') this._scroll(true);
                else if (a === 'unsel') { this._selOn = false; this._refreshCtx(); }
                else if (a === 'unref') { this._refs = this._refs.filter(r => r.id !== act.dataset.id); this._refreshCtx(); }
                else if (a === 'unatt') { this._atts = this._atts.filter(r => r.key !== act.dataset.key); this._refreshCtx(); this._syncSend(); }
                else if (a === 'suggest') { if (!this._busy) this.send(act.dataset.text || act.textContent); }
                else if (a === 'option') { if (!this._busy && !act.disabled) this.send(act.dataset.text || act.textContent); }
                else if (a === 'retry') { if (!this._busy) this._retry(); }
                else if (a === 'copy') this._copy(act);
                else if (a === 'ops') { const g = act.closest('.ag-ops'); if (g) g.classList.toggle('open'); }
                else if (a === 'op') {
                    const row = act.closest('.ag-op');
                    const ids = (row && row.dataset.ids || '').split(',').filter(id => CanvasAPI.get(id));
                    if (ids.length) CanvasAPI.focus(ids, false);
                    if (row && row.querySelector('.ag-op-detail')) row.classList.toggle('open');
                }
                else if (a === 'mention') { this._mentionPick(act.dataset.id); }
                else if (a === 'card') this._onCardAct(act);
                else if (a === 'step') this._toggleStep(act);
                else if (a === 'recharge') { if (typeof global.showCdkModal === 'function') global.showCdkModal(); }
                else if (a === 'mode') this._toggleMode();
                else if (a === 'skills') { this._hideMention(); this._openSkills(); }
                else if (a === 'skillpick') this._openSkillPicker();
                else if (a === 'unskill') { this._skillSel = this._skillSel.filter(n => n !== act.dataset.id); this._refreshCtx(); }
                else if (a === 'quick') { if (!this._busy) this.send(act.dataset.text || act.textContent); }
                else if (a.indexOf('sk-') === 0) this._skAct(a, act);
                return;
            }
        },

        // ---------- 渲染 ----------
        renderAll() {
            if (!this._built) return;
            this._list.innerHTML = '';
            this._els = new Map();
            setTimeout(() => this._refreshQuick(), 0);
            this._resIndex();
            this.msgs.forEach(m => { const el = this._renderMsg(m); if (el) this._list.appendChild(el); });
            this._renderEmpty();
            this._syncStatus();
            this._syncSend();
            this._input.placeholder = this._input.placeholder; // 触发属性翻译观察
            this._scroll(true);
        },
        _resIndex() {
            this._res = new Map();
            this._turnOf = new Map();
            let turn = 0;
            const planFirst = new Map(), planLast = new Map();
            this.msgs.forEach(m => {
                if (m.role === 'user') turn++;
                if (m.role === 'function') (m.results || []).forEach(r => this._res.set(r.id, r));
                if (m.role === 'model') (m.calls || []).forEach(c => {
                    this._turnOf.set(c.id, turn);
                    if (c.name === 'plan') { if (!planFirst.has(turn)) planFirst.set(turn, c.id); planLast.set(turn, c); }
                });
            });
            this._planFirst = planFirst; this._planLast = planLast;
            // 最近一条用户消息之后的 ask_user 选项仍可点
            let lastUser = -1;
            this.msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
            this._lastUserIdx = lastUser;
        },
        _renderEmpty() {
            const show = !this.msgs.length;
            this._empty.classList.toggle('hidden', !show);
            if (!show) { this._empty.innerHTML = ''; return; }
            const sug = this._suggestions();
            this._empty.innerHTML = `
                <div class="ag-hero">
                    <div class="ag-hero-orb"><i></i>${IC.spark}</div>
                    <div class="ag-hero-t">嗨，我是 Pixora 画布助手</div>
                    <div class="ag-hero-s">告诉我你想做什么，我会在画布上搭好节点、写好提示词、连好角色与参考图；所有消耗积分的生成都会先请你确认。</div>
                </div>
                <div class="ag-sug-lb">${sug.sel ? '针对选中的节点' : '试试这样说'}</div>
                <div class="ag-sugs">${sug.list.map(s => `<button type="button" class="ag-sug" data-act="suggest" data-text="${esc(s.t)}"><span class="ag-sug-ic">${s.ic}</span><span class="ag-sug-t px-no-i18n">${esc(s.t)}</span><span class="ag-sug-go">${IC.right}</span></button>`).join('')}</div>
                <div class="ag-tips"><span><kbd>Ctrl</kbd><kbd>K</kbd> 随时唤起</span><span><kbd>@</kbd> 引用节点</span><span>可粘贴图片作为参考</span></div>`;
        },
        _suggestions() {
            const CB = CanvasAPI.CB();
            const sel = (global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : []).map(id => CanvasAPI.get(id)).filter(Boolean);
            const CL = global.CharacterLib;
            const ch = CL && CL.chars && CL.chars[0];
            const en = lang() === 'en';
            const list = [];
            const add = (zh, e, ic) => list.push({ t: en ? e : zh, ic });
            if (sel.length) {
                const imgs = sel.filter(b => CanvasAPI.hasResult(b) && b.mediaType !== 'video' && b.mediaType !== 'audio' && b.nodeType !== 'text');
                const gens = sel.filter(b => b.nodeType === 'gen');
                if (imgs.length) add('把选中的图片做成 5 秒视频', 'Turn the selected image into a 5-second video', IC.video);
                if (imgs.length) add('基于选中的图片再出 3 个不同角度的变体', 'Make 3 variations of the selected image from different angles', IC.layers);
                if (gens.length) add('帮我优化选中节点的提示词，更有电影感', 'Polish the prompts of the selected nodes to feel more cinematic', IC.wand);
                if (gens.length) add('生成选中的节点', 'Generate the selected nodes', IC.bolt);
                if (sel.length > 1) add('把选中的节点排整齐并打组', 'Arrange the selected nodes neatly and group them', IC.grid);
            }
            const selCount = list.length;
            add('帮我做一组 4 张赛博朋克城市海报', 'Make a set of 4 cyberpunk city posters', IC.image);
            if (ch) add(`用角色【${ch.name}】生成 3 个不同场景`, `Create 3 different scenes with the character "${ch.name}"`, IC.user);
            add('写一个 30 秒咖啡广告剧本并拆分镜', 'Write a 30-second coffee ad script and storyboard it', IC.clap);
            if (CB && CB.blocks.length > 3) add('整理画布，把节点排整齐', 'Tidy up the canvas and arrange the nodes', IC.grid);
            if (CB && CB.blocks.some(b => b.nodeType === 'gen' && b.status === 'failed')) add('检查哪些节点生成失败并重试', 'Find the nodes that failed and retry them', IC.retry);
            else add('把选中的图片做成 5 秒视频', 'Turn the selected image into a 5-second video', IC.video);
            const seen = new Set();
            return { sel: selCount > 0, list: list.filter(x => !seen.has(x.t) && seen.add(x.t)).slice(0, 6) };
        },
        _renderMsg(m) {
            let el;
            if (m.role === 'user') {
                el = document.createElement('div');
                el.className = 'ag-msg user';
                const chips = (m.skills || []).map(n => `<span class="ag-uchip sk">${IC.bolt}<span class="px-no-i18n">${esc(n)}</span></span>`).join('') + (m.refs || []).concat(m.atts || []).map(r => `<button type="button" class="ag-uchip" data-node="${esc(r.id)}">${r.att ? IC.image : IC.node}<span class="px-no-i18n">${esc(clip(r.name, 20))}</span></button>`).join('');
                el.innerHTML = `<div class="ag-ubox">${chips ? `<div class="ag-uchips">${chips}</div>` : ''}<div class="ag-bubble px-no-i18n">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
            } else if (m.role === 'model') {
                el = document.createElement('div');
                el.className = 'ag-msg ai' + (m.streaming ? ' streaming' : '');
                el.innerHTML = this._aiHtml(m);
            } else if (m.role === 'note') {
                el = document.createElement('div');
                el.className = 'ag-msg note ' + (m.kind || '');
                const last = this.msgs[this.msgs.length - 1] === m;
                el.innerHTML = `<div class="ag-note"><span class="ag-note-ic">${m.kind === 'error' ? IC.warn : (m.kind === 'done' ? IC.check : IC.help)}</span><span class="ag-note-t">${esc(m.text)}</span>${m.retry && last && !this._busy ? `<button type="button" class="ag-btn small" data-act="retry">${IC.retry}<span>重试</span></button>` : ''}</div>`;
            } else return null;
            el.dataset.mid = m.id || '';
            if (m.id) this._els.set(m.id, el);
            return el;
        },
        _aiHtml(m) {
            const text = String(m.text || '');
            const calls = m.calls || [];
            let html = `<span class="ag-av">${IC.spark}</span><div class="ag-ai">`;
            if (!text && !calls.length && m.streaming) html += '<div class="ag-think"><i></i><i></i><i></i><span>思考中</span></div>';
            // _TEXTASK_20261029 正文里的伪提问 → 选项按钮（与 ask_user 卡片同风格）
            const ta = text && !m.streaming && !calls.some(c => c.name === 'ask_user') ? parseTextAsk(text) : null;
            const shown = ta ? ta.text : (m.streaming ? hideTextAskTail(text) : text);
            if (shown) html += `<div class="ag-md px-no-i18n">${md(shown, m.streaming && !calls.length)}</div>`;
            if (ta && ta.options.length) html += this._textAskHtml(m, ta.options);
            // 调用：卡片类单独渲染；其余合并为操作条组（>3 条时折叠）
            const ops = [];
            const cards = [];
            calls.forEach(c => {
                if (c.name === 'request_generation' || c.name === 'ask_user' || (c.name === 'delete_nodes' && this._pending[c.id] && this._pending[c.id].kind === 'delete') || (c.name === 'delete_nodes' && (this._res.get(c.id) || {}).response && this._res.get(c.id).ui)) cards.push(c);
                else if (c.name === 'plan' && this._planFirst.get(this._turnOf.get(c.id)) === c.id) cards.push(c);
                else ops.push(c);
            });
            if (ops.length) {
                const rows = ops.map(c => this._opHtml(c)).join('');
                const fail = ops.filter(c => { const r = this._res.get(c.id); return r && r.response && (r.response.error || r.response.ok === false); }).length;
                if (ops.length > 3) html += `<div class="ag-ops grouped"><button type="button" class="ag-ops-head" data-act="ops">${IC.layers}<span>执行了 ${ops.length} 个操作</span>${fail ? `<b class="ag-ops-bad">${fail}</b>` : ''}${IC.down}</button><div class="ag-ops-body">${rows}</div></div>`;
                else html += `<div class="ag-ops">${rows}</div>`;
            }
            cards.forEach(c => { html += this._cardHtml(c); });
            if (m.stopped) html += '<div class="ag-tag">已停止</div>';
            if (text && !m.streaming) html += `<div class="ag-tools"><button type="button" class="ag-mini" data-act="copy" title="复制">${IC.copy}</button></div>`;
            return html + '</div>';
        },
        _opHtml(c) {
            const r = this._res.get(c.id);
            const res = r ? r.response : null;
            const info = opInfo(c, res);
            const state = !r ? (this._busy ? 'run' : 'cut') : (info.ok ? 'ok' : 'err');
            const err = res && (res.error || (res.ok === false && res.results ? '' : ''));
            const detail = info.detail ? `<ul class="ag-op-list">${info.detail}</ul>` : '';
            const why = state === 'err' && err ? `<div class="ag-op-err">${esc(clip(err, 300))}</div>` : '';
            return `<div class="ag-op ${state}${state === 'err' && detail ? ' open' : ''}" data-ids="${esc(info.ids.join(','))}">
                <button type="button" class="ag-op-row" data-act="op"><span class="ag-op-ic">${state === 'run' ? '<i class="ag-spin"></i>' : (state === 'err' ? IC.warn : info.icon)}</span><span class="ag-op-t">${info.html}</span>${state === 'cut' ? '<span class="ag-op-cut">已中断</span>' : ''}${info.ids.length ? `<span class="ag-op-go" title="在画布上定位">${IC.target}</span>` : ''}${detail ? `<span class="ag-op-x">${IC.down}</span>` : ''}</button>
                ${why}${detail ? `<div class="ag-op-detail">${detail}</div>` : ''}</div>`;
        },
        _updateMsg(m) {
            const old = m && m.id && this._els.get(m.id);
            if (!old) return;
            const el = this._renderMsg(m);
            old.replaceWith(el);
        },
        _rerenderOwner(callId) {
            const m = this.msgs.find(x => x.role === 'model' && (x.calls || []).some(c => c.id === callId));
            if (m) { this._resIndex(); this._updateMsg(m); }
        },
        _push(m) {
            m.id = m.id || rid('m');
            m.ts = m.ts || Date.now();
            this.msgs.push(m);
            this._resIndex();
            const el = this._renderMsg(m);
            if (el) this._list.appendChild(el);
            this._renderEmpty();
            this._changed(false);
            this._scroll();
            // 旧的错误提示不再显示重试
            this.msgs.forEach(x => { if (x !== m && x.role === 'note' && x.retry) { x.retry = false; this._updateMsg(x); } });
            return m;
        },
        _nearBottom() { const b = this._body; return b.scrollHeight - b.scrollTop - b.clientHeight < 80; },
        _scroll(force) {
            if (!this._body) return;
            if (force || this._stick !== false) requestAnimationFrame(() => { this._body.scrollTop = this._body.scrollHeight; });
        },
        _syncStatus() {
            if (!this._statusT) return;
            const st = this._status || 'idle';
            const txt = { idle: '就绪', think: '思考中…', act: '正在操作画布…', wait: '等待你确认…' }[st];
            if (this._statusT.textContent !== txt) this._statusT.textContent = txt;
            this._el.dataset.st = st;
            const mdl = this._el.querySelector('.ag-model');
            if (mdl) mdl.textContent = this._model === 'std' ? 'Gemini 2.5 Flash' : 'Gemini 3 Flash';
        },
        _setStatus(s) { this._status = s; this._syncStatus(); },
        _syncSend() {
            if (!this._sendBtn) return;
            const up = this._atts.some(a => a.uploading);
            this._sendBtn.classList.toggle('stop', this._busy);
            this._sendBtn.innerHTML = this._busy ? IC.stop : IC.send;
            this._sendBtn.title = this._busy ? '停止' : '发送';
            this._sendBtn.disabled = !this._busy && (up || (!this._input.value.trim() && !this._atts.length));
            this._refreshQuick();
        },
        _autosize() {
            const t = this._input;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, Math.round(180 * scaleVar())) + 'px';
        },
        _copy(btn) {
            const el = btn.closest('.ag-msg');
            const m = el && this.msgs.find(x => x.id === el.dataset.mid);
            if (!m) return;
            const txt = String(m.text || '').replace(/\[([^\]]+)\]\(node:[^)]+\)/g, '$1');
            const done = () => { btn.classList.add('ok'); btn.innerHTML = IC.check; setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = IC.copy; }, 1200); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => toast('复制失败', 'warn'));
            else done();
        },

        // ---------- 输入上下文：选中胶囊 / @ 引用 / 附件 ----------
        _onSelection() {
            this._selOn = true;
            if (this._open) { this._refreshCtx(); if (!this.msgs.length) this._renderEmpty(); }
        },
        _refreshCtx() {
            if (!this._ctx) return;
            const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds().filter(id => CanvasAPI.get(id)) : [];
            this._refs = this._refs.filter(r => CanvasAPI.get(r.id));
            let html = '';
            this._skillSel.forEach(n => { html += `<span class="ag-cchip sk">${IC.bolt}<span class="px-no-i18n">${esc(n)}</span><button type="button" data-act="unskill" data-id="${esc(n)}" title="移除">${IC.x}</button></span>`; });
            if (sel.length && this._selOn) html += `<span class="ag-cchip sel">${IC.cursor}<span>已选 ${sel.length} 个节点</span><button type="button" data-act="unsel" title="不作为上下文">${IC.x}</button></span>`;
            this._refs.forEach(r => { html += `<span class="ag-cchip">${IC.node}<span class="px-no-i18n">@${esc(clip(r.name, 18))}</span><button type="button" data-act="unref" data-id="${esc(r.id)}" title="移除">${IC.x}</button></span>`; });
            this._atts.forEach(a => {
                const n = a.id && CanvasAPI.get(a.id);
                const src = n ? safeImg(n.previewUrl || n.imageUrl) : '';
                html += `<span class="ag-cchip att${a.uploading ? ' up' : ''}${a.failed ? ' bad' : ''}">${src && !a.uploading ? `<img src="${esc(src)}" alt="">` : (a.uploading ? '<i class="ag-spin"></i>' : IC.image)}<span class="px-no-i18n">${esc(clip(a.name, 16))}</span><button type="button" data-act="unatt" data-key="${esc(a.key)}" title="移除">${IC.x}</button></span>`;
            });
            this._ctx.innerHTML = html;
            this._ctx.classList.toggle('hidden', !html);
        },
        _addRef(id) {
            const n = CanvasAPI.get(id);
            if (!n || this._refs.some(r => r.id === id) || this._refs.length >= 12) return;
            this._refs.push({ id, name: n.name || id });
            this._refreshCtx();
        },
        _insertAt() {
            const t = this._input;
            const pos = t.selectionStart || t.value.length;
            const pre = t.value.slice(0, pos);
            const ins = (pre && !/\s$/.test(pre) ? ' ' : '') + '@';
            t.value = pre + ins + t.value.slice(pos);
            t.focus();
            t.setSelectionRange(pos + ins.length, pos + ins.length);
            this._mentionCheck();
        },
        _mentionCheck() {
            const t = this._input;
            const pos = t.selectionStart;
            const pre = t.value.slice(0, pos);
            const m = /(^|\s)@([^\s@]{0,20})$/.exec(pre);
            if (!m) { this._hideMention(); return; }
            this._mq = { start: pos - m[2].length - 1, q: m[2].toLowerCase() };
            const CB = CanvasAPI.CB();
            const sel = new Set(global.CanvasSelection.getSelectedIds());
            const scored = CB.blocks.map(b => {
                let s = 0;
                if (sel.has(b.id)) s += 100;
                if (CanvasAPI.inView(b)) s += 50;
                const name = String(b.name || '').toLowerCase();
                if (this._mq.q) { if (name.indexOf(this._mq.q) === 0) s += 30; else if (name.indexOf(this._mq.q) !== -1 || String(b.prompt || '').toLowerCase().indexOf(this._mq.q) !== -1) s += 10; else return null; }
                return { b, s };
            }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 30);
            this._skPick = false;
            this._mItems = this._skillMatches(this._mq.q).concat(scored.map(x => x.b));
            this._mIdx = 0;
            this._renderMention(sel);
        },
        _renderMention(sel) {
            const items = this._mItems || [];
            const ico = (b) => ({ image_gen: IC.image, video_gen: IC.video, text: IC.text, character: IC.user, video_ref: IC.video, audio_ref: IC.audio }[CanvasAPI.typeOf(b)] || IC.image);
            if (this._skPick || items.some(x => x && x._sk)) this._mention.innerHTML = this._mentionHtml(items, sel, ico);
            else this._mention.innerHTML = items.length ? `<div class="ag-mhead">引用画布节点</div>` + items.map((b, i) => {
                const src = safeImg(b.previewUrl || (b.mediaType ? '' : b.imageUrl));
                return `<button type="button" class="ag-mitem${i === this._mIdx ? ' on' : ''}" data-act="mention" data-id="${esc(b.id)}" role="option"><span class="ag-mthumb">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ico(b)}</span><span class="ag-mname px-no-i18n">${esc(clip(b.name || b.id, 28))}</span>${sel && sel.has(b.id) ? '<span class="ag-mtag">已选</span>' : ''}</button>`;
            }).join('') : '<div class="ag-mempty">没有匹配的节点</div>';
            this._mention.classList.remove('hidden');
            this._mentionOpen = true;
            const dr = this._el.getBoundingClientRect(), ib = this._el.querySelector('.ag-inbox').getBoundingClientRect();
            this._mention.style.bottom = Math.round(dr.bottom - ib.top + 6) + 'px';
            const sc = this._mention.querySelector('.ag-mitem.on');
            if (sc) sc.scrollIntoView({ block: 'nearest' });
        },
        _mentionMove(d) { const n = (this._mItems || []).length; if (!n) return; this._mIdx = (this._mIdx + d + n) % n; this._renderMention(new Set(global.CanvasSelection.getSelectedIds())); },
        _mentionPick(id) {
            { const it = id ? (String(id).indexOf('skill:') === 0 ? { _sk: true, name: String(id).slice(6) } : null) : (this._mItems || [])[this._mIdx]; if (it && it._sk) return this._pickSkill(it.name); }
            const b = id ? CanvasAPI.get(id) : (this._mItems || [])[this._mIdx];
            if (!b || !this._mq) { this._hideMention(); return; }
            const t = this._input;
            const name = String(b.name || b.id).replace(/\s+/g, '');
            const end = t.selectionStart;
            t.value = t.value.slice(0, this._mq.start) + '@' + name + ' ' + t.value.slice(end);
            const p = this._mq.start + name.length + 2;
            t.focus(); t.setSelectionRange(p, p);
            this._addRef(b.id);
            this._hideMention();
            this._syncSend();
        },
        _hideMention() { if (this._mention) this._mention.classList.add('hidden'); this._mentionOpen = false; this._mq = null; this._skPick = false; },
        _onPaste(e) {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            const files = [];
            for (const it of items) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
            if (!files.length) return;
            e.preventDefault();
            files.slice(0, 4).forEach(f => this._addAttachment(f));
        },
        async _addAttachment(file) {
            const CM = global.CanvasMain;
            if (!CM || !CM._createRefNode) return;
            if (this._atts.length >= 6) return toast('一次最多附带 6 张图片', 'warn');
            const a = { key: rid('a'), name: file.name || 'image.png', uploading: true };
            this._atts.push(a);
            this._refreshCtx(); this._syncSend();
            const A = CanvasAPI.anchor('');
            try {
                const node = await CM._createRefNode(file, A.x, A.y, { noPan: true });
                if (node && CanvasAPI.get(node.id)) { a.id = node.id; a.name = node.name || a.name; }
                else a.failed = true;
            } catch (_) { a.failed = true; }
            a.uploading = false;
            if (a.failed) this._atts = this._atts.filter(x => x !== a);
            this._refreshCtx(); this._syncSend();
        },

        // ---------- 发送 / 回合 ----------
        sendInput() {
            const text = this._input.value.trim();
            if (this._busy) return;
            if (this._atts.some(a => a.uploading)) return toast('图片还在上传，请稍候', 'info');
            if (!text && !this._atts.length) return;
            this.send(text || L('请参考我上传的图片', 'Please use the image(s) I uploaded'));
        },
        send(text) {
            if (this._busy) return;
            text = String(text || '').trim().slice(0, MAX_INPUT);
            if (!text) return;
            if (!this._open) this.open();
            const sel = this._selOn && global.CanvasSelection ? global.CanvasSelection.getSelectedIds().filter(id => CanvasAPI.get(id)).slice(0, 40) : [];
            const m = {
                role: 'user', text,
                refs: this._refs.filter(r => CanvasAPI.get(r.id)).map(r => ({ id: r.id, name: r.name })),
                atts: this._atts.filter(a => a.id && CanvasAPI.get(a.id)).map(a => ({ id: a.id, name: a.name, att: true })),
                skills: this._skillSel.slice(0, 3),
                sel
            };
            this._input.value = ''; this._autosize();
            this._refs = []; this._atts = []; this._skillSel = [];
            this._refreshCtx();
            this._hideMention();
            // _ASKANSWER_20261029 紧跟在 ask_user 之后的用户消息即为对该提问的回答（后端据此把提问结果标记为已回答）
            const tail = this.msgs[this.msgs.length - 1];
            const prevM = tail && tail.role === 'function' ? this.msgs[this.msgs.length - 2] : null;
            const ask = tail && tail.role === 'function' && (tail.results || []).find(r => r.name === 'ask_user' && r.response && r.response.ok);
            if (ask && prevM && prevM.role === 'model') m.answerTo = ask.id;
            this._push(m);
            // 之前的提问卡片选项随新消息失效
            this.msgs.forEach(x => { if (x !== m && x.role === 'model' && ((x.calls || []).some(c => c.name === 'ask_user') || (!x.streaming && parseTextAsk(x.text)))) this._updateMsg(x); });
            this._changed(true);
            this._runTurn();
        },
        _retry() {
            const last = this.msgs[this.msgs.length - 1];
            if (last && last.role === 'note') { this.msgs.pop(); const el = this._els.get(last.id); if (el) el.remove(); }
            const tail = this.msgs[this.msgs.length - 1];
            if (!tail || tail.role === 'model') return;
            this._runTurn();
        },
        stop(silent) {
            const t = this._turn;
            if (!t) return;
            t.stopped = true;
            try { if (t.ctrl) t.ctrl.abort(); } catch (_) { /* 忽略 */ }
            const D = global.CanvasDirector;
            if (this._runningTool === 'director_write_script' && D && D._ai && D._aiStop) D._aiStop();
            Object.keys(this._pending).forEach(id => { const p = this._pending[id]; if (p && p.resolve) p.resolve({ stopped: true }); });
            if (!silent) toast('已停止', 'info');
        },
        newChat() {
            if (this._busy) this.stop(true);
            this.msgs = [];
            this._pending = {};
            this._refs = []; this._atts = [];
            this._changed(true);
            this.renderAll();
            this._refreshCtx();
            setTimeout(() => this._input && this._input.focus(), 30);
        },
        async _runTurn() {
            if (this._busy) return;
            this._busy = true;
            const turn = this._turn = { rounds: 0, stopped: false, ctrl: null, dirty: false };
            if (global.CanvasHistory && !global.CanvasHistory._suspended) global.CanvasHistory.snapshot();
            this._syncSend();
            this.msgs.forEach(x => { if (x.role === 'note' && x.retry) { x.retry = false; this._updateMsg(x); } });
            try {
                for (;;) {
                    if (turn.stopped) break;
                    if (turn.rounds >= MAX_ROUNDS) {
                        this._push({ role: 'note', kind: 'info', text: L(`已连续执行 ${MAX_ROUNDS} 轮操作，先暂停一下。回复「继续」我会接着做。`, `Paused after ${MAX_ROUNDS} rounds of actions. Reply "continue" and I'll keep going.`) });
                        break;
                    }
                    turn.rounds++;
                    this._setStatus('think');
                    const r = await this._request(turn);
                    if (turn.stopped || r.error) {
                        if (r.error && !turn.stopped) this._push({ role: 'note', kind: 'error', text: r.error, retry: true });
                        break;
                    }
                    const calls = r.msg ? r.msg.calls || [] : [];
                    if (!calls.length) {
                        // 工具执行后模型空回复（服务端视为正常结束）：本回合没有任何文字时给一个简短完成提示，避免界面“没反应”
                        if (r.empty) {
                            let k = this.msgs.length - 1;
                            while (k >= 0 && this.msgs[k].role !== 'user') k--;
                            const turnMsgs = this.msgs.slice(k + 1);
                            if (!turnMsgs.some(x => x.role === 'model' && String(x.text || '').trim())) this._push({ role: 'note', kind: 'done', text: L('操作已完成', 'Done') });
                        }
                        break;
                    }
                    this._setStatus('act');
                    const out = await this._execCalls(r.msg, turn);
                    if (out.halt || turn.stopped) break;
                }
            } catch (e) {
                console.error('[AI 助手] 回合异常', e);
                this._push({ role: 'note', kind: 'error', text: L('出了点问题，请重试', 'Something went wrong. Please try again'), retry: true });
            } finally {
                this._fixDangling();
                this._commitHistory();
                this._busy = false;
                this._turn = null;
                this._setStatus('idle');
                this._syncSend();
                this._resIndex();
                // 重新渲染本回合的消息（中断的操作条 / 提问选项可点 / 错误重试按钮）
                for (let i = this.msgs.length - 1; i >= 0; i--) { const x = this.msgs[i]; if (x.role === 'user') break; this._updateMsg(x); }
                this._changed(true);
            }
        },
        // 未回应的调用补 {cancelled}，保证历史合法（每个 functionCall 都有 functionResponse）
        _fixDangling() {
            const got = new Set();
            this.msgs.forEach(m => { if (m.role === 'function') (m.results || []).forEach(r => got.add(r.id)); });
            for (let i = 0; i < this.msgs.length; i++) {
                const m = this.msgs[i];
                if (m.role !== 'model' || !(m.calls || []).length) continue;
                const miss = m.calls.filter(c => !got.has(c.id));
                if (!miss.length) continue;
                const res = miss.map(c => ({ id: c.id, name: c.name, response: { ok: false, cancelled: true, error: '用户已停止，操作未执行' } }));
                const next = this.msgs[i + 1];
                if (next && next.role === 'function') next.results = (next.results || []).concat(res);
                else this.msgs.splice(i + 1, 0, { id: rid('m'), role: 'function', results: res, ts: Date.now() });
                miss.forEach(c => got.add(c.id));
            }
            this.msgs.forEach(m => { if (m.streaming) { delete m.streaming; } });
        },
        _apiMessages() {
            const out = [];
            this.msgs.slice(-MAX_SEND).forEach(m => {
                if (m.role === 'user') {
                    let t = m.text;
                    const refs = (m.refs || []).map(r => `${r.name}(id=${r.id})`);
                    const atts = (m.atts || []).map(r => `${r.name}(id=${r.id})`);
                    const sel = (m.sel || []).filter(id => !(m.refs || []).some(r => r.id === id)).map(id => { const n = CanvasAPI.get(id); return n ? `${n.name}(id=${id})` : id; });
                    if (refs.length) t += `\n\n[引用的画布节点] ${refs.join('，')}`;
                    if (atts.length) t += `\n[我刚上传为参考图节点] ${atts.join('，')}`;
                    if (sel.length) t += `\n[当前选中的节点] ${sel.slice(0, 20).join('，')}`;
                    if ((m.skills || []).length) t += `\n[用户指定使用技能] ${m.skills.join('，')}（请先用 use_skill 加载，再按技能说明完成任务）`;
                    out.push(m.answerTo ? { role: 'user', text: t, answerTo: m.answerTo } : { role: 'user', text: t });
                } else if (m.role === 'model') {
                    if (!m.text && !(m.calls || []).length) return;
                    out.push({ role: 'model', text: m.text || '', calls: (m.calls || []).map(c => ({ id: c.id, name: c.name, args: c.args, sig: c.sig || '' })) });
                } else if (m.role === 'function') {
                    out.push({ role: 'function', results: (m.results || []).map(r => ({ id: r.id, name: r.name, response: r.response })) });
                }
            });
            while (out.length && out[0].role !== 'user') out.shift();
            return out;
        },
        async _credits() {
            try {
                const res = await fetch(base() + '/api/user/credits', { headers: authJson() });
                const j = await res.json();
                if (j && j.code === 0 && j.data && typeof j.data.credits === 'number') return j.data.credits;
            } catch (_) { /* 忽略 */ }
            return null;
        },
        async _context() {
            CanvasAPI.syncFromBar();
            const CB = CanvasAPI.CB();
            const last = [...this.msgs].reverse().find(m => m.role === 'user');
            const sel = (last && last.sel) || [];
            const byType = {};
            CB.blocks.forEach(b => { const t = CanvasAPI.typeOf(b); byType[t] = (byType[t] || 0) + 1; });
            const pick = [];
            const seen = new Set();
            const add = (b) => { if (b && !seen.has(b.id) && pick.length < 40) { seen.add(b.id); pick.push(b); } };
            sel.forEach(id => add(CanvasAPI.get(id)));
            ((last && last.refs) || []).concat((last && last.atts) || []).forEach(r => add(CanvasAPI.get(r.id)));
            CB.blocks.filter(b => CanvasAPI.inView(b)).forEach(add);
            if (CB.blocks.length <= 40) CB.blocks.forEach(add);
            const CL = global.CharacterLib;
            if (this._credit == null || Date.now() - (this._creditAt || 0) > 20000) { this._credit = await this._credits(); this._creditAt = Date.now(); }
            const ctx = {
                lang: lang(),
                canvasSummary: {
                    total: CB.blocks.length, byType,
                    failed: CB.blocks.filter(b => b.nodeType === 'gen' && b.status === 'failed').length || undefined,
                    generating: CB.blocks.filter(b => b.nodeType === 'gen' && b.status === 'generating').length || undefined,
                    groups: Object.keys(CB.groups).length || undefined,
                    nodes: pick.map(b => CanvasAPI.brief(b, 100)),
                    omitted: CB.blocks.length > pick.length ? CB.blocks.length - pick.length : undefined
                },
                selection: sel,
                viewport: (() => { const r = CanvasAPI.visibleRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), scale: +global.CanvasCore.viewport.scale.toFixed(2) }; })(),
                director: this._directorSummary(false),
                characters: ((CL && CL.chars) || []).slice(0, 30).map(c => ({ id: c.id, name: c.name, desc: clip(c.description || '', 60), wardrobe: (c.wardrobe || []).length ? (c.wardrobe || []).slice(0, 6).map(w => ({ id: w.id, name: w.name })) : undefined })),
                models: CanvasAPI.models(),
                credits: this._credit == null ? undefined : Math.round(this._credit)
            };
            // 体积控制（服务端上限 40KB）
            let s = JSON.stringify(ctx);
            while (s.length > 30000 && ctx.canvasSummary.nodes.length > 5) { ctx.canvasSummary.nodes = ctx.canvasSummary.nodes.slice(0, Math.floor(ctx.canvasSummary.nodes.length * 0.7)).map(n => Object.assign(n, { prompt: n.prompt ? clip(n.prompt, 40) : undefined, upstream: undefined, downstream: undefined })); s = JSON.stringify(ctx); }
            if (s.length > 30000) { ctx.characters = ctx.characters.slice(0, 10); ctx.director = { exists: !!(ctx.director && ctx.director.exists) }; }
            return ctx;
        },
        _directorSummary(full) {
            const D = global.CanvasDirector;
            if (!D || !D.d) return { exists: false };
            const d = D.d;
            const shots = d.shots.slice(0, full ? 60 : 12).map((s, i) => {
                const o = { no: i + 1, id: s.id, title: str(s.title, 30), duration: D._durOf(s), state: D._state(s), nodeId: s.genNodeId || undefined };
                if (full) { o.prompt = clip(D._promptOf(s), 300); o.price = D._shotPrice(s); }
                if (D._shotBrief) Object.assign(o, D._shotBrief(s, full));
                return o;
            });
            return {
                exists: true, open: D.isOpen(), title: str(d.title, 40), scriptChars: String(d.script || '').length,
                scriptPreview: clip(d.script || '', full ? 1500 : 160), style: str(d.style, 60), aspectRatio: d.aspectRatio, model: d.model, resolution: d.resolution, targetDuration: d.targetDuration,
                characters: d.characters.map(id => { const c = D._char(id); return c ? { id, name: c.name } : null; }).filter(Boolean),
                shotCount: d.shots.length, shots, aiBusy: !!(D._ai || (D._busy && D._busy.ai)) || undefined,
                composing: !!(D._busy && D._busy.compose) || undefined, frameStyle: d.frameStyle || 'keyframe',
                scenes: (d.scenes || []).map((x, i) => ({ id: x.id, no: i + 1, name: str(x.name, 30), stageNodeId: x.stageNodeId || undefined, refImageNodeId: x.refImageNodeId || undefined }))
            };
        },
        async _request(turn) {
            const ctrl = turn.ctrl = new AbortController();
            const m = this._push({ role: 'model', text: '', calls: [], streaming: true });
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; try { ctrl.abort(); } catch (_) { /* 忽略 */ } }, REQ_TIMEOUT);
            let error = null, done = false, raf = 0, emptyDone = false;
            const paint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; this._updateMsg(m); this._scroll(); }); };
            const drop = () => { const i = this.msgs.indexOf(m); if (i !== -1 && !m.text && !(m.calls || []).length) { this.msgs.splice(i, 1); const el = this._els.get(m.id); if (el) el.remove(); this._resIndex(); } };
            try {
                const body = { messages: this._apiMessages(), context: await this._context(), mode: this._mode };
                if (turn.stopped) { clearTimeout(timer); drop(); return {}; }
                const res = await fetch(base() + API_PATH, { method: 'POST', headers: authJson(), body: JSON.stringify(body), signal: ctrl.signal });
                if (!res.ok || !res.body) {
                    const j = await res.json().catch(() => null);
                    const st = res.status;
                    error = st === 429 ? ((j && j.msg) || L('请求太频繁了，请稍等片刻再试', 'Too many requests. Please wait a moment'))
                        : st === 401 ? L('登录已过期，请重新登录', 'Your session has expired. Please sign in again')
                            : st === 413 ? L('对话内容过长，请点击「新对话」后重试', 'The conversation is too long. Start a new chat and try again')
                                : ((j && j.msg) || L('AI 服务暂时不可用，请稍后再试', 'The AI service is temporarily unavailable. Please try again later'));
                } else {
                    const rd = res.body.getReader();
                    const dec = new TextDecoder();
                    let buf = '';
                    const onEv = (raw) => {
                        const data = raw.split('\n').filter(x => x.indexOf('data:') === 0).map(x => x.slice(5).trim()).join('');
                        if (!data) return;
                        let j;
                        try { j = JSON.parse(data); } catch (_) { return; }
                        if (turn.stopped) return;
                        if (j.type === 'start') { this._model = j.model || ''; this._syncStatus(); }
                        else if (j.type === 'text' && typeof j.t === 'string') { m.text += j.t; paint(); }
                        else if (j.type === 'call' && j.name && typeof j.id === 'string') {
                            if ((m.calls || []).length < 16) m.calls.push({ id: j.id, name: String(j.name).slice(0, 40), args: (j.args && typeof j.args === 'object' && !Array.isArray(j.args)) ? j.args : {}, sig: typeof j.sig === 'string' ? j.sig : '' });
                            this._resIndex(); paint();
                        } else if (j.type === 'done') { done = true; if (j.empty) emptyDone = true; }
                        else if (j.type === 'error') error = String(j.msg || L('AI 服务暂时不可用，请稍后再试', 'The AI service is temporarily unavailable. Please try again later'));
                    };
                    for (;;) {
                        const r = await rd.read();
                        if (r.done) break;
                        buf += dec.decode(r.value, { stream: true }).replace(/\r/g, '');
                        let i;
                        while ((i = buf.indexOf('\n\n')) !== -1) { onEv(buf.slice(0, i)); buf = buf.slice(i + 2); }
                    }
                    buf += dec.decode();
                    if (buf.trim()) onEv(buf);
                    if (!done && !error && !turn.stopped) error = L('AI 连接中断，请重试', 'The AI connection dropped. Please try again');
                }
            } catch (e) {
                if (turn.stopped) { /* 用户停止 */ }
                else if (timedOut) error = L('AI 响应超时，请重试', 'The AI took too long to respond. Please try again');
                else error = L('网络连接失败，请检查网络后重试', 'Network error. Check your connection and try again');
            }
            clearTimeout(timer);
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            delete m.streaming;
            if (turn.stopped && (m.text || m.calls.length)) m.stopped = true;
            // 出错的轮次整条丢弃（不执行半截调用；重试时重新生成）
            if (error && !turn.stopped) { m.text = ''; m.calls = []; }
            drop();
            if (this.msgs.indexOf(m) !== -1) this._updateMsg(m);
            this._changed(false);
            return { msg: this.msgs.indexOf(m) !== -1 ? m : null, error, empty: emptyDone && !m.text && !(m.calls || []).length };
        },
        async _execCalls(m, turn) {
            const fm = this._push({ role: 'function', results: [] });
            let halt = false;
            for (const c of m.calls) {
                let response;
                if (turn.stopped) response = { ok: false, cancelled: true, error: '用户已停止，操作未执行' };
                else {
                    const fn = Tools[c.name];
                    this._runningTool = c.name;
                    try {
                        if (!fn || c.name.charAt(0) === '_') throw vErr('未知工具：' + c.name);
                        response = await fn.call(Tools, c.args || {}, c);
                    } catch (e) {
                        if (!e.agent) console.warn('[AI 助手] 工具异常', c.name, e);
                        response = { ok: false, error: e.agent ? e.message : ('执行失败：' + (e.message || e)) };
                    }
                    this._runningTool = '';
                }
                response = this._capResult(response);
                const r = { id: c.id, name: c.name, response };
                if (response && response.ui) { r.ui = response.ui; delete response.ui; }
                fm.results.push(r);
                if (c.name === 'ask_user' && response && response.ok) halt = true;
                if (response && response.halt) { halt = true; delete response.halt; }
                this._rerenderOwner(c.id);
                this._changed(false);
            }
            return { halt };
        },
        _capResult(r) {
            if (!r || typeof r !== 'object') r = { result: r == null ? null : r };
            let s;
            try { s = JSON.stringify(r); } catch (_) { return { ok: false, error: '结果无法序列化' }; }
            if (s.length <= 12000) return r;
            const o = Object.assign({}, r);
            Object.keys(o).forEach(k => { if (Array.isArray(o[k]) && o[k].length > 10) { o[k] = o[k].slice(0, 10); o.truncated = true; } });
            s = JSON.stringify(o);
            return s.length <= 12000 ? o : { ok: r.ok, truncated: true, preview: s.slice(0, 4000) };
        },

        // ---------- 卡片：计划 / 提问 / 生成确认 / 删除确认 ----------
        _cardHtml(c) {
            const r = this._res.get(c.id);
            const res = r ? r.response : null;
            if (c.name === 'plan') {
                const lastC = this._planLast.get(this._turnOf.get(c.id)) || c;
                const a = lastC.args || {};
                const ui = (r && r.ui) || {};
                const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 10).map((s, i) => {
                    const o = typeof s === 'string' ? { text: s } : (s || {});
                    let st = ['todo', 'doing', 'done'].indexOf(o.status) !== -1 ? o.status : 'todo';
                    if ((ui.checked || []).indexOf(i) !== -1) st = 'done';
                    return { text: str(o.text, 200), st };
                });
                const done = steps.filter(s => s.st === 'done').length;
                return `<div class="ag-card plan" data-cid="${esc(c.id)}">
                    <div class="ag-card-h"><span class="ag-card-ic">${IC.list}</span><span class="ag-card-t px-no-i18n">${str(a.title, 60) ? mdLine(str(a.title, 60)) : esc(L('执行计划', 'Plan'))}</span><span class="ag-prog num">${done}/${steps.length}</span></div>
                    <div class="ag-pbar"><i style="width:${steps.length ? Math.round(done / steps.length * 100) : 0}%"></i></div>
                    <ol class="ag-steps">${steps.map((s, i) => `<li class="${s.st}"><button type="button" class="ag-step-ck" data-act="step" data-cid="${esc(c.id)}" data-i="${i}" title="标记完成">${s.st === 'done' ? IC.check : (s.st === 'doing' ? '<i class="ag-spin"></i>' : '')}</button><span class="px-no-i18n">${mdLine(s.text)}</span></li>`).join('')}</ol></div>`;
            }
            if (c.name === 'ask_user') {
                const a = c.args || {};
                const opts = (Array.isArray(a.options) ? a.options : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 6);
                const idx = this.msgs.findIndex(x => x.role === 'model' && (x.calls || []).some(y => y.id === c.id));
                const live = idx > this._lastUserIdx && !this._busy;
                return `<div class="ag-card ask"><div class="ag-ask-q"><span class="ag-card-ic">${IC.help}</span><span class="px-no-i18n">${mdLine(str(a.question, 500))}</span></div>
                    ${opts.length ? `<div class="ag-opts">${opts.map(o => `<button type="button" class="ag-opt px-no-i18n" data-act="option" data-text="${esc(str(o, 200))}"${live ? '' : ' disabled'}>${esc(str(o, 80))}</button>`).join('')}</div>` : ''}
                    ${live ? '<div class="ag-ask-tip">点选一个选项，或直接输入你的想法</div>' : ''}</div>`;
            }
            if (c.name === 'request_generation') return this._genCardHtml(c, r);
            if (c.name === 'delete_nodes') {
                const p = this._pending[c.id];
                const data = p ? p.data : (r && r.ui) || {};
                const names = data.names || [];
                const state = p ? 'pending' : (res && res.ok ? 'ok' : 'no');
                return `<div class="ag-card del ${state}"><div class="ag-card-h"><span class="ag-card-ic danger">${IC.trash}</span><span class="ag-card-t">删除 ${names.length} 个节点？</span></div>
                    <div class="ag-del-names px-no-i18n">${names.slice(0, 12).map(n => `<span>${esc(clip(n, 20))}</span>`).join('')}${names.length > 12 ? `<span>+${names.length - 12}</span>` : ''}</div>
                    ${state === 'pending' ? `<div class="ag-card-acts"><button type="button" class="ag-btn" data-act="card" data-cid="${esc(c.id)}" data-v="no">取消</button><button type="button" class="ag-btn danger" data-act="card" data-cid="${esc(c.id)}" data-v="ok">删除</button></div>` : `<div class="ag-card-res">${state === 'ok' ? '已删除，可按 Ctrl+Z 撤销' : '已取消删除'}</div>`}</div>`;
            }
            return '';
        },
        // _TEXTASK_20261029 兜底选项卡：点击后作为用户消息发送（与 ask_user 选项相同）；仅最新一轮可点
        _textAskHtml(m, opts) {
            const idx = this.msgs.indexOf(m);
            const live = idx > this._lastUserIdx && !this._busy;
            return `<div class="ag-card ask tfb"><div class="ag-opts">${opts.map(o => `<button type="button" class="ag-opt px-no-i18n" data-act="option" data-text="${esc(str(o, 200))}"${live ? '' : ' disabled'}>${esc(str(o, 80))}</button>`).join('')}</div>
                ${live ? `<div class="ag-ask-tip">${esc(L('点选一个选项，或直接输入你的想法', 'Pick an option, or type your own reply'))}</div>` : ''}</div>`;
        },
        _toggleStep(btn) {
            const cid = btn.dataset.cid, i = parseInt(btn.dataset.i, 10);
            const r = this._res.get(cid);
            if (!r) return;
            r.ui = r.ui || {};
            const set = new Set(r.ui.checked || []);
            if (set.has(i)) set.delete(i); else set.add(i);
            r.ui.checked = Array.from(set);
            this._rerenderOwner(cid);
            this._changed(true);
        },
        _confirmCard(call, data) {
            return new Promise((resolve) => {
                this._pending[call.id] = { kind: data.kind, data, resolve: (v) => { delete this._pending[call.id]; resolve(v); } };
                this._setStatus('wait');
                this._rerenderOwner(call.id);
                this._scroll(true);
            }).then(v => {
                this._setStatus('act');
                if (v && v.stopped) return false;
                return v === 'ok';
            });
        },
        _onCardAct(btn) {
            const p = this._pending[btn.dataset.cid];
            if (!p) return;
            if (btn.dataset.v === 'recharge') { btn.blur(); if (typeof global.showCdkModal === 'function') global.showCdkModal(); return; }
            p.resolve(btn.dataset.v);
        },
        _genQueued(id) { return this._genQ.indexOf(id) !== -1; },
        // 生成确认：校验 → 卡片（单价/总积分/余额与 PromptBar、服务端预扣同源）→ 用户批准后并发 ≤3 提交
        async _requestGeneration(a, call) {
            const raw = Array.isArray(a.nodeIds) ? uniq(a.nodeIds) : [];
            if (!raw.length) throw vErr('nodeIds 不能为空');
            if (raw.length > LIM.gen) throw vErr(`一次最多生成 ${LIM.gen} 个节点，请分批`);
            CanvasAPI.syncFromBar();
            const items = [], skipped = [];
            raw.forEach(id => {
                const n = CanvasAPI.get(id);
                if (!n) return skipped.push({ id, reason: '节点不存在' });
                if (n.nodeType !== 'gen') return skipped.push({ id, name: n.name, reason: '不是生成节点' });
                if (n.status === 'generating' || this._genQueued(id)) return skipped.push({ id, name: n.name, reason: '正在生成中' });
                const imgs = CanvasAPI.CE().getUpstreamImages(id).length;
                const media = CanvasAPI.CE().getUpstreamMedia(id);
                const texts = CanvasAPI.CE().getUpstreamTexts(id);
                if (!String(n.prompt || '').trim() && !imgs && !texts.prepend.length && !texts.append.length) return skipped.push({ id, name: n.name, reason: '提示词为空且没有参考图' });
                const isV = CanvasAPI.typeOf(n) === 'video_gen';
                const cfg = CanvasAPI.modelCfg(n.model);
                if (!cfg) return skipped.push({ id, name: n.name, reason: '模型不可用：' + n.model });
                items.push({
                    id, name: n.name, video: isV, model: n.model, modelName: cfg.name || n.model,
                    params: isV ? `${n.aspectRatio === 'auto' ? L('自适应', 'Auto') : (n.aspectRatio || '16:9')} · ${n.duration || 5}s · ${String(n.resolution || CanvasAPI.defaultRes(n.model)).toUpperCase()}` : `${n.panorama ? L('360° 全景', '360° panorama') + ' · 2:1' : (n.turnaround ? (n.turnaround.mode === 'grid8' ? L('8 视角序列', '8-view turnaround') : L('转身设定图', 'Turnaround sheet')) + ' · ' + (n.aspectRatio || '') : (n.aspectRatio || '1:1'))} · ${n.size || '1K'}`,
                    prompt: clip(n.prompt || '', 80), refs: imgs + (media.videos || []).length + (media.audios || []).length, price: CanvasAPI.priceOf(n)
                });
            });
            if (!items.length) return { ok: false, approved: false, error: '没有可生成的节点', skipped };
            const total = Math.round(items.reduce((t, x) => t + x.price, 0) * 100) / 100;
            const balance = await this._credits();
            if (balance != null) { this._credit = balance; this._creditAt = Date.now(); }
            const data = { items, total, balance, skipped, reason: str(a.reason, 120) };
            const v = await this._confirmCardGen(call, data);
            if (v === 'ok') {
                const started = await this._startGeneration(items.map(x => x.id), call);
                if (this._turn) this._turn.genStarted = true;
                return Object.assign({ ok: true, approved: true, ui: { data, state: 'ok', started } }, started, { totalCredits: total });
            }
            if (v === 'modify') return { ok: true, approved: false, action: 'modify', note: '用户想先修改，请等待用户说明要改什么（不要再次发起生成）', halt: true, ui: { data, state: 'modify' } };
            if (v && v.stopped) return { ok: false, approved: false, cancelled: true, error: '用户已停止', ui: { data, state: 'no' } };
            return { ok: true, approved: false, action: 'cancel', note: '用户取消了生成，简短确认即可，不要再次发起', ui: { data, state: 'no' } };
        },
        _confirmCardGen(call, data) {
            if (this._mode === 'auto' && !(data.balance != null && data.balance < data.total)) return Promise.resolve('ok');
            return new Promise((resolve) => {
                this._pending[call.id] = { kind: 'gen', data, resolve: (v) => { delete this._pending[call.id]; resolve(v); } };
                this._setStatus('wait');
                this._rerenderOwner(call.id);
                this._scroll(true);
            }).then(v => { this._setStatus('act'); if (v === 'modify') setTimeout(() => this._input.focus(), 30); return v; });
        },
        _genCardHtml(c, r) {
            const p = this._pending[c.id];
            const ui = (r && r.ui) || {};
            const data = p ? p.data : ui.data;
            if (!data) {
                const res = r && r.response;
                return `<div class="ag-card gen no"><div class="ag-card-h"><span class="ag-card-ic">${IC.coin}</span><span class="ag-card-t">生成确认</span></div><div class="ag-card-res">${esc((res && res.error) || L('已中断', 'Interrupted'))}</div></div>`;
            }
            const state = p ? 'pending' : (ui.state || 'no');
            const short = data.balance != null && data.balance < data.total;
            const rows = data.items.map(x => `<div class="ag-gi" data-node="${esc(x.id)}">
                <span class="ag-gi-ic${x.video ? ' v' : ''}">${x.video ? IC.video : IC.image}</span>
                <div class="ag-gi-main"><div class="ag-gi-top"><span class="ag-gi-name px-no-i18n">${esc(clip(x.name, 24))}</span><span class="ag-gi-price num">${fmtNum(x.price)}</span></div>
                <div class="ag-gi-meta"><span class="px-no-i18n">${esc(x.modelName)}</span><i>·</i><span class="px-no-i18n">${esc(x.params)}</span>${x.refs ? `<i>·</i><span class="ag-gi-refs">${IC.image}<span>${x.refs}</span></span>` : ''}</div>
                ${x.prompt ? `<div class="ag-gi-prompt px-no-i18n">${esc(x.prompt)}</div>` : ''}</div></div>`).join('');
            const skipped = (data.skipped || []).length ? `<div class="ag-note-mini">${IC.warn}<span>${data.skipped.length} 个节点已跳过</span></div>` : '';
            let foot;
            if (state === 'pending') {
                foot = `${short ? `<div class="ag-short">${IC.warn}<span>余额不足，还差 <b class="num">${fmtNum(data.total - data.balance)}</b> 积分</span><button type="button" class="ag-btn small primary" data-act="card" data-cid="${esc(c.id)}" data-v="recharge">去充值</button></div>` : ''}
                    <div class="ag-card-acts"><button type="button" class="ag-btn ghost" data-act="card" data-cid="${esc(c.id)}" data-v="no">取消</button><button type="button" class="ag-btn" data-act="card" data-cid="${esc(c.id)}" data-v="modify">修改</button><button type="button" class="ag-btn primary" data-act="card" data-cid="${esc(c.id)}" data-v="ok"${short ? ' disabled' : ''}>${IC.spark}<span>确认生成</span></button></div>`;
            } else if (state === 'ok') {
                const st = ui.started || {};
                foot = `<div class="ag-card-res ok">${IC.check}<span>已确认，开始生成</span><span class="num">${(st.started || []).length}/${data.items.length}</span>${(st.queued || []).length ? `<span class="ag-dim">排队 ${(st.queued || []).length}</span>` : ''}${(st.failed || []).length ? `<span class="ag-bad">失败 ${(st.failed || []).length}</span>` : ''}</div>`;
            } else if (state === 'modify') foot = '<div class="ag-card-res">请告诉我需要修改什么</div>';
            else foot = '<div class="ag-card-res">已取消，未消耗积分</div>';
            return `<div class="ag-card gen ${state}">
                <div class="ag-card-h"><span class="ag-card-ic coin">${IC.coin}</span><span class="ag-card-t">确认生成 ${data.items.length} 个任务</span></div>
                ${data.reason ? `<div class="ag-gen-why px-no-i18n">${mdLine(data.reason)}</div>` : ''}
                <div class="ag-gis">${rows}</div>${skipped}
                <div class="ag-gsum"><div><span>合计</span><b class="num ag-gtotal">${fmtNum(data.total)}</b><span>积分</span></div><div class="${short ? 'bad' : ''}"><span>当前余额</span><b class="num">${data.balance == null ? '--' : fmtNum(data.balance)}</b></div></div>
                ${foot}</div>`;
        },
        // 并发队列（与导演台批量生成同款）：并发 ≤3；任务数已满退避 15s；积分不足停止；首轮提交后即返回，其余后台继续
        async _startGeneration(ids, call) {
            const out = { started: [], queued: [], failed: [] };
            ids.forEach(id => { if (this._genQ.indexOf(id) === -1) this._genQ.push(id); });
            const runOne = async (id) => {
                const n = CanvasAPI.get(id);
                if (!n) return { ok: false, error: '节点已被删除' };
                const CM = global.CanvasMain;
                if (CM && CM._activeNodeId === id && CM._savePromptBarToNode) CM._savePromptBarToNode(id);
                const msgs = [];
                const al = global.alert;
                global.alert = (x) => { x = String(x || ''); if (!/已按上限选取前/.test(x)) msgs.push(x); };
                let pr;
                try { pr = global.CanvasGenerate.runNode(id); } finally { global.alert = al; }
                try { await pr; } catch (e) { msgs.push(e.message || String(e)); }
                const cur = CanvasAPI.get(id);
                if (cur && cur.taskId && cur.status === 'generating') return { ok: true };
                const err = (cur && cur.errorMsg) || msgs[0] || '提交失败';
                return { ok: false, error: err, busy: /10个生成中|过于频繁|429/.test(err), credits: /积分不足|余额不足/.test(err) };
            };
            const pump = async (first) => {
                if (this._pumping) return;
                this._pumping = true;
                try {
                    while (this._genQ.length) {
                        if (this._genBackoff && Date.now() < this._genBackoff) break;
                        const active = CanvasAPI.CB().blocks.filter(b => b.nodeType === 'gen' && b.status === 'generating' && b._agGen).length;
                        if (active >= GEN_CONCURRENCY) break;
                        const id = this._genQ[0];
                        const r = await runOne(id);
                        if (r.ok) { this._genQ.shift(); const b = CanvasAPI.get(id); if (b) b._agGen = true; if (first) out.started.push(id); }
                        else if (r.busy) {
                            const b = CanvasAPI.get(id);
                            if (b && b.status === 'failed') CanvasAPI.CB().update(id, { status: 'idle', errorMsg: '' });
                            this._genBackoff = Date.now() + 15000;
                            break;
                        } else if (r.credits) {
                            const left = this._genQ.slice(); this._genQ = [];
                            if (first) left.forEach(x => out.failed.push({ id: x, error: '积分不足' }));
                            toast(`积分不足，已停止生成（${left.length} 个未提交）`, 'warn', typeof global.showCdkModal === 'function' ? { label: '去充值', onClick: global.showCdkModal } : null);
                            break;
                        } else { this._genQ.shift(); if (first) out.failed.push({ id, error: str(r.error, 200) }); }
                    }
                } finally { this._pumping = false; }
                if (this._genQ.length && !this._genTimer) this._genTimer = setInterval(() => { if (!this._genQ.length) { clearInterval(this._genTimer); this._genTimer = 0; return; } pump(false); }, 2500);
            };
            await pump(true);
            out.queued = ids.filter(id => this._genQ.indexOf(id) !== -1);
            void call;
            return out;
        }
    };

    global.CanvasAgent = Agent;
    Agent._parseTextAsk = parseTextAsk; // _TEXTASK_20261029 供测试
    global.CanvasAgentTools = Tools;      // 第四期可复用：工具实现
    global.CanvasAgentAPI = CanvasAPI;    // 第四期可复用：画布适配层
    global.CanvasAgentMd = md;            // 安全 Markdown 渲染
    const boot = () => setTimeout(() => Agent.init(), 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})(window);
