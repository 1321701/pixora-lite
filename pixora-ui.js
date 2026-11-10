/* Pixora 界面增强：Toast（替代 alert）、左侧导航视图切换、灵感广场
   在 <head> 中加载，早于 script.js，确保 alert 被接管 */
(function () {
    'use strict';

    // ---------------- Toast ----------------
    var stack = null;
    function ensureStack() {
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'px-toast-stack';
            stack.setAttribute('role', 'status');
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        return stack;
    }

    function classify(msg) {
        if (/失败|错误|不足|无法|过期|超时|异常|请先|请输入|请选择|不能|未|禁止|超过|fail|error|invalid/i.test(msg)) return 'warn';
        if (/成功|已复制|已保存|已收藏|已删除|已添加|完成|success/i.test(msg)) return 'ok';
        return 'info';
    }

    function showToast(message, opts) {
        opts = opts || {};
        var msg = String(message == null ? '' : message);
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', function () { showToast(msg, opts); });
            return;
        }
        var type = opts.type || classify(msg);
        var el = document.createElement('div');
        el.className = 'px-toast ' + type;

        var icon = document.createElement('i');
        icon.className = 'px-ti';
        icon.textContent = type === 'warn' ? '!' : type === 'ok' ? '✓' : 'i';
        el.appendChild(icon);

        var text = document.createElement('div');
        text.className = 'px-tmsg';
        text.textContent = msg;
        el.appendChild(text);

        var action = opts.action;
        if (action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'px-tact';
            btn.textContent = action.label;
            btn.addEventListener('click', function () { dismiss(); action.onClick(); });
            el.appendChild(btn);
        }

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'px-tclose';
        close.setAttribute('aria-label', '关闭');
        close.textContent = '×';
        close.addEventListener('click', dismiss);
        el.appendChild(close);

        ensureStack().appendChild(el);
        // 最多同时保留 3 条
        while (stack.children.length > 3) stack.removeChild(stack.firstChild);
        requestAnimationFrame(function () { el.classList.add('show'); });

        var duration = opts.duration || (type === 'warn' ? 5000 : 3000) + Math.min(msg.length * 40, 3000);
        var timer = setTimeout(dismiss, duration);
        el.addEventListener('mouseenter', function () { clearTimeout(timer); });
        el.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, 2000); });

        function dismiss() {
            clearTimeout(timer);
            el.classList.remove('show');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
        }
        return dismiss;
    }

    window.pxToast = showToast;

    // ---------------- 本地缩略图 ----------------
    // 浏览器本地把图片压成 800px（中图）+ 240px（小图）WebP（不支持 WebP 回退 JPG），随原图一起上传，
    // 存储端直接保存，无需服务端实时生成缩略图
    var PxThumb = {
        _decode: function (src) {
            if (window.createImageBitmap) {
                return createImageBitmap(src).catch(function () { return PxThumb._decodeImg(src); });
            }
            return PxThumb._decodeImg(src);
        },
        _decodeImg: function (src) {
            return new Promise(function (resolve, reject) {
                var u = URL.createObjectURL(src);
                var im = new Image();
                im.onload = function () { resolve(im); setTimeout(function () { URL.revokeObjectURL(u); }, 0); };
                im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('图片解码失败')); };
                im.src = u;
            });
        },
        _encode: function (img, w0, h0, edge) {
            var k = Math.min(1, edge / Math.max(w0, h0));
            var w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            return new Promise(function (r) { c.toBlob(r, 'image/webp', 0.82); }).then(function (b) {
                if (b && b.type === 'image/webp') return b;
                // 不支持 WebP：JPG 无透明通道，先铺深色底
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(0, 0, w, h);
                return new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.85); });
            });
        },
        // 返回 { medium, small, w, h }；非图片/解码失败返回 null
        make: function (file) {
            if (!file || !/^image\//.test(file.type || '')) return Promise.resolve(null);
            return PxThumb._decode(file).then(function (img) {
                var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
                if (!w || !h) return null;
                return Promise.all([PxThumb._encode(img, w, h, 800), PxThumb._encode(img, w, h, 240)]).then(function (r) {
                    if (img.close) { try { img.close(); } catch (_) {} }
                    if (!r[0] || !r[1]) return null;
                    return { medium: r[0], small: r[1], w: w, h: h };
                });
            });
        },
        // 往上传表单追加 thumb/thumbS/imgW/imgH；失败静默（服务端回退旧逻辑）
        attach: function (form, file) {
            return PxThumb.make(file).then(function (t) {
                if (!t) return false;
                var ext = t.medium.type === 'image/webp' ? 'webp' : 'jpg';
                form.append('thumb', t.medium, 'thumb.' + ext);
                form.append('thumbS', t.small, 'thumbS.' + ext);
                form.append('imgW', String(t.w));
                form.append('imgH', String(t.h));
                return true;
            }).catch(function (e) {
                console.warn('[本地缩略图] 生成失败，回退服务端处理:', e && e.message);
                return false;
            });
        },
        // 预加载若干图片（进浏览器缓存），全部完成或超时后 resolve；用于上传完成后无缝替换本地图
        preload: function (urls, timeout) {
            var list = (urls || []).filter(function (u, i, a) { return u && a.indexOf(u) === i; });
            if (!list.length) return Promise.resolve();
            var all = Promise.all(list.map(function (u) {
                return new Promise(function (r) { var im = new Image(); im.onload = im.onerror = function () { r(); }; im.src = u; });
            }));
            return Promise.race([all, new Promise(function (r) { setTimeout(r, timeout || 4000); })]);
        }
    };
    window.PxThumb = PxThumb;

    // ---------------- 统一下载 ----------------
    // 后台 fetch 成 Blob 再触发保存：不跳转页面（不触发离开遮罩），顶部提示「下载中…」→「下载成功」
    // pxDownload(url, name) 或 pxDownload([{url, name}, ...])
    function dlExt(type, url) {
        type = String(type || '').toLowerCase();
        var u = String(url || '').toLowerCase();
        if (/mp4/.test(type) || /\.mp4([?&#]|$)/.test(u)) return '.mp4';
        if (/quicktime/.test(type) || /\.mov([?&#]|$)/.test(u)) return '.mov';
        if (/mpeg|mp3/.test(type) || /\.mp3([?&#]|$)/.test(u)) return '.mp3';
        if (/wav/.test(type) || /\.wav([?&#]|$)/.test(u)) return '.wav';
        if (/aac/.test(type) || /\.aac([?&#]|$)/.test(u)) return '.aac';
        if (/audio\/mp4|m4a/.test(type) || /\.m4a([?&#]|$)/.test(u)) return '.m4a';
        if (/jpe?g/.test(type) || /\.jpe?g([?&#]|$)/.test(u)) return '.jpg';
        if (/webp/.test(type) || /\.webp([?&#]|$)/.test(u)) return '.webp';
        return '.png';
    }
    function saveBlob(blob, fname) {
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = u;
        a.download = fname;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    }
    // ---- AI 生成内容标识（《人工智能生成合成内容标识办法》/ GB 45438-2025）----
    // 下载生成的图片时：左下角加「AI 生成」显式标识（文字高度不低于短边 5%），并在 PNG 元数据写入 AIGC 隐式标识。
    // 视频无法在浏览器内重新编码，需由模型服务在生成时自带标识（见 README 合规说明）。
    function pxAiLabelOn() {
        var c = window.LITE_CONFIG || {};
        return c.aiLabel !== false;
    }
    async function pxNeedsAiLabel(url, blob) {
        if (!pxAiLabelOn() || !/^image\/(png|jpe?g|webp)/i.test(blob.type || '')) return false;
        var be = window.PxlBackend;
        return !!(be && be.isGenerated && await be.isGenerated(url));
    }
    function pxPngChunk(type, data) {
        var len = data.length, out = new Uint8Array(12 + len), dv = new DataView(out.buffer);
        dv.setUint32(0, len);
        for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        var crc = -1;
        for (var j = 4; j < 8 + len; j++) {
            crc ^= out[j];
            for (var k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
        dv.setUint32(8 + len, (crc ^ -1) >>> 0);
        return out;
    }
    function pxAigcMeta() {
        var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
        return JSON.stringify({
            Label: '1',                                  // 1 = 人工智能生成合成内容
            ContentProducer: location.host || 'pixora-lite',
            ProduceID: id,
            ReservedCode1: '',
            ContentPropagator: location.host || 'pixora-lite',
            PropagateID: id,
            ReservedCode2: ''
        });
    }
    async function pxAiLabel(blob) {
        var bmp = await PxThumb._decode(blob);
        var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        if (bmp.close) { try { bmp.close(); } catch (_) {} }
        var fs = Math.max(12, Math.ceil(Math.min(w, h) * 0.05));
        var pad = Math.round(fs * 0.45), m = Math.round(fs * 0.6), text = 'AI 生成';
        ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle';
        var tw = ctx.measureText(text).width, bw = tw + pad * 2, bh = fs + pad * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, .5)';
        ctx.fillRect(m, h - m - bh, bw, bh);
        ctx.fillStyle = 'rgba(255, 255, 255, .92)';
        ctx.fillText(text, m + pad, h - m - bh / 2);
        var png = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
        if (!png) throw new Error('导出失败');
        var bytes = new Uint8Array(await png.arrayBuffer());
        var kw = 'AIGC\0' + pxAigcMeta(), data = new Uint8Array(kw.length);
        for (var i = 0; i < kw.length; i++) data[i] = kw.charCodeAt(i) & 0xff;
        // tEXt 块插在 IHDR（8 字节签名 + 25 字节）之后
        return new Blob([bytes.subarray(0, 33), pxPngChunk('tEXt', data), bytes.subarray(33)], { type: 'image/png' });
    }

    async function pxDownload(url, name) {
        var list = Array.isArray(url) ? url : [{ url: url, name: name }];
        list = list.filter(function (x) { return x && (x.url || typeof x.text === 'string'); });
        if (!list.length) return;
        var many = list.length > 1;
        var dismiss = showToast(many ? ('正在下载 ' + list.length + ' 个文件…') : '下载中…', { type: 'info', duration: 3600000 });
        var ok = 0, opened = 0, fail = 0;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            var base = String(it.name || 'download').replace(/\.(png|jpe?g|webp|gif|mp4|mov|mp3|wav|m4a|aac|txt)$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'download';
            if (typeof it.text === 'string') {
                saveBlob(new Blob(['\ufeff' + it.text], { type: 'text/plain;charset=utf-8' }), base + '.txt');
                ok++;
                continue;
            }
            try {
                var res = await fetch(it.url);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var blob = await res.blob();
                if (!blob.size) throw new Error('空文件');
                if (await pxNeedsAiLabel(it.url, blob)) {
                    try { blob = await pxAiLabel(blob); } catch (e) { console.warn('[下载] AI 标识添加失败，保存原图:', e && e.message); }
                }
                saveBlob(blob, base + dlExt(blob.type, it.url));
                ok++;
            } catch (e) {
                // 跨域等拿不到文件：新标签页打开原地址兜底（当前页面不跳转）
                console.warn('[下载] 后台下载失败，改为新标签页打开:', it.url, e && e.message);
                try { window.open(it.url, '_blank', 'noopener'); opened++; } catch (_) { fail++; }
            }
        }
        if (dismiss) dismiss();
        if (!opened && !fail) showToast(many ? ('已下载 ' + ok + ' 个文件') : '下载成功', { type: 'ok' });
        else if (ok) showToast('已下载 ' + ok + ' 个，另有 ' + (opened + fail) + ' 个已在新标签页打开，请在新页面中保存', { type: 'info' });
        else showToast('已在新标签页打开，请在新页面中保存', { type: 'info' });
    }
    window.pxDownload = pxDownload;
    var toastAlert = function (msg) { showToast(msg); };
    try {
        Object.defineProperty(window, 'alert', { value: toastAlert, writable: true, configurable: true });
    } catch (e) {
        window.alert = toastAlert;
    }

    // ---------------- 灵感广场：作品墙 ----------------
    // 数据源按顺序尝试（见 config.js）：
    //   1) LITE_CONFIG.showcaseApi   远程接口 GET ?limit&offset&sort=random&seed&model&q → { code:0, data:{ items, total, models } }
    //   2) LITE_CONFIG.showcaseBase  静态分片目录（tools/showcase-build.js 生成 index.json + page-N.json）
    //   3) 内置示例（assets/inspire）
    var WALL_CFG = (window.LITE_CONFIG && typeof window.LITE_CONFIG === 'object') ? window.LITE_CONFIG : {};
    var WALL_API = String(WALL_CFG.showcaseApi || '').trim();
    var WALL_BASE = WALL_CFG.showcaseBase == null ? 'showcase/' : String(WALL_CFG.showcaseBase).trim();
    if (WALL_BASE && !/\/$/.test(WALL_BASE)) WALL_BASE += '/';
    var LICENSE_URL = {
        'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/deed.zh-hans',
        'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans',
        'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/deed.zh-hans'
    };
    var INSPIRE_FALLBACK = [
        { img: '01', model: 'Nano Banana Pro', p: '白衣修仙剑客立于云海之巅，长发飘逸，手持发光长剑，电影级光影，国风写实，超高细节' },
        { img: '02', model: 'GPT Image 2', p: '极简护肤品产品摄影，磨砂玻璃瓶，柔和晨光，浅绿色背景，商业广告质感' },
        { img: '03', model: 'Seedream 5.0', p: '赛博朋克雨夜街头的少女肖像，霓虹灯反射，浅景深，35mm 胶片质感' },
        { img: '04', model: 'Nano Banana 2', p: '水墨风格的江南古镇，小桥流水，晨雾，留白构图，宣纸纹理' },
        { img: '05', model: 'GPT Image 2.5', p: '可爱的 3D 小狐狸角色，皮克斯风格，柔和的工作室布光，纯色背景' },
        { img: '06', model: 'Nano Banana Pro', p: '复古科幻电影海报，宇航员站在橙色沙丘上仰望巨大行星，颗粒质感' },
        { img: '07', model: 'Seedream 5.0', p: '日式咖啡馆室内设计，原木与亚麻，午后阳光透过百叶窗，安静温暖' },
        { img: '08', model: 'GPT Image 2', p: '东方神话中的青龙穿梭于云层与雷电之间，史诗感，金色高光' }
    ];

    var pxWall = {
        items: [], more: false, models: [], offset: 0, limit: 36,
        model: '', q: '', seed: Math.random().toString(36).slice(2, 8),
        loading: false, loaded: false, failed: false, seq: 0, rendered: 0,
        src: WALL_API ? 'api' : (WALL_BASE ? 'static' : 'builtin')
    };
    var pxWorkEl = null;
    var pxImgIO = null;
    var pxMoreIO = null;

    function pxUseLabel() {
        return typeof window.t === 'function' ? window.t('pxUsePrompt') : '用这个提示词';
    }
    function pxScrollRoot() {
        return document.querySelector('.main-area') || null;
    }
    function pxAbs(u, base) {
        if (!u) return '';
        try { return new URL(u, new URL(base, location.href)).href; } catch (e) { return u; }
    }
    function pxNormItem(it, base) {
        var o = {};
        for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) o[k] = it[k];
        o.img = pxAbs(it.img, base);
        o.thumb = pxAbs(it.thumb || it.img, base);
        return o;
    }
    // 可复现的伪随机（同一 seed 每次刷新前顺序一致，翻页不重复）
    function pxRand(seed) {
        var h = 2166136261;
        for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
        return function () {
            h += 0x6D2B79F5;
            var t = h;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function pxShuffle(arr, seed) {
        var a = arr.slice(), r = pxRand(seed);
        for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
        return a;
    }
    function pxGetJson(url) {
        return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    // ---- 数据源：远程接口 ----
    function pxFetchApi(offset) {
        var sep = WALL_API.indexOf('?') === -1 ? '?' : '&';
        var url = WALL_API + sep + 'limit=' + pxWall.limit + '&offset=' + offset + '&sort=random&seed=' + pxWall.seed +
            (pxWall.model ? '&model=' + encodeURIComponent(pxWall.model) : '') +
            (pxWall.q ? '&q=' + encodeURIComponent(pxWall.q) : '');
        return pxGetJson(url).then(function (j) {
            var d = (j && j.data) || {};
            var items = (Array.isArray(d.items) ? d.items : []).filter(function (it) { return it && it.sfw !== false && it.img; });
            var total = d.total || 0;
            return { items: items.map(function (it) { return pxNormItem(it, WALL_API); }), models: d.models, next: offset + (d.items || []).length, more: !!(d.items || []).length && offset + d.items.length < total };
        });
    }

    // ---- 数据源：静态分片 ----
    var pxStatic = { index: null, pages: {}, all: null };
    function pxStaticIndex() {
        if (pxStatic.index) return Promise.resolve(pxStatic.index);
        return pxGetJson(WALL_BASE + 'index.json').then(function (idx) {
            if (!idx || !idx.pages) throw new Error('index.json 无效');
            pxStatic.index = idx;
            return idx;
        });
    }
    function pxStaticPage(n) {
        if (pxStatic.pages[n]) return pxStatic.pages[n];
        var file = (pxStatic.index.files && pxStatic.index.files[n - 1]) || ('page-' + n + '.json');
        pxStatic.pages[n] = pxGetJson(WALL_BASE + file).then(function (p) {
            var list = Array.isArray(p) ? p : (p && p.items) || [];
            return list.filter(function (it) { return it && it.sfw !== false && it.img; })
                .map(function (it) { return pxNormItem(it, WALL_BASE); });
        }).catch(function (e) { delete pxStatic.pages[n]; throw e; });
        return pxStatic.pages[n];
    }
    function pxStaticAll() {
        if (pxStatic.all) return pxStatic.all;
        var jobs = [];
        for (var i = 1; i <= pxStatic.index.pages; i++) jobs.push(pxStaticPage(i));
        pxStatic.all = Promise.all(jobs).then(function (pages) { return [].concat.apply([], pages); })
            .catch(function (e) { pxStatic.all = null; throw e; });
        return pxStatic.all;
    }
    function pxMatch(it, q) {
        return [it.title, it.prompt, it.author, it.model].join('\n').toLowerCase().indexOf(q) !== -1;
    }
    function pxFetchStatic(offset) {
        return pxStaticIndex().then(function (idx) {
            var models = idx.models || [];
            // 无筛选：按 seed 打乱分片顺序，逐片加载（大数据量也只下载用到的分片）
            if (!pxWall.model && !pxWall.q) {
                var order = pxShuffle(Array.from({ length: idx.pages }, function (_, i) { return i + 1; }), pxWall.seed);
                var per = idx.pageSize || 60;
                var pi = Math.floor(offset / per);
                if (pi >= order.length) return { items: [], models: models, more: false };
                return pxStaticPage(order[pi]).then(function (list) {
                    var start = offset - pi * per;
                    return { items: pxShuffle(list, pxWall.seed + ':' + order[pi]).slice(start), models: models, next: (pi + 1) * per, more: pi + 1 < order.length };
                });
            }
            // 有筛选 / 搜索：加载全部分片后在本地过滤
            return pxStaticAll().then(function (all) {
                var q = pxWall.q.toLowerCase();
                var hit = all.filter(function (it) {
                    return (!pxWall.model || it.model === pxWall.model) && (!q || pxMatch(it, q));
                });
                hit = pxShuffle(hit, pxWall.seed);
                return { items: hit.slice(offset, offset + pxWall.limit), models: models, next: offset + pxWall.limit, more: offset + pxWall.limit < hit.length };
            });
        });
    }

    // ---- 数据源：内置示例 ----
    function pxFetchBuiltin() {
        var items = INSPIRE_FALLBACK.map(function (it, i) {
            return {
                id: 'builtin_' + i, title: '', prompt: it.p, model: it.model, author: 'Pixora',
                img: 'assets/inspire/' + it.img + '.jpg', thumb: 'assets/inspire/' + it.img + '.jpg', width: 0, height: 0
            };
        }).filter(function (it) {
            var q = pxWall.q.toLowerCase();
            return (!pxWall.model || it.model === pxWall.model) && (!q || pxMatch(it, q));
        });
        return Promise.resolve({ items: items, models: [], more: false });
    }

    function pxFetchWall(offset) {
        if (pxWall.src === 'api') return pxFetchApi(offset);
        if (pxWall.src === 'static') return pxFetchStatic(offset);
        return pxFetchBuiltin();
    }

    // 真正的懒加载：图片先只写 data-src，进入视口前 500px 才挂 src
    function pxSetupImgLazy() {
        if (pxImgIO || !('IntersectionObserver' in window)) return;
        pxImgIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                var img = en.target;
                var src = img.getAttribute('data-src');
                if (src) {
                    img.removeAttribute('data-src');
                    img.src = src;
                }
                pxImgIO.unobserve(img);
            });
        }, { root: pxScrollRoot(), rootMargin: '500px 0px' });
    }

    function pxLazyImg(src, alt, fallback) {
        var img = document.createElement('img');
        img.alt = alt || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.setAttribute('data-src', src);
        img.addEventListener('error', function () {
            if (img.dataset.pxFallback) return;
            img.dataset.pxFallback = '1';
            if (fallback && fallback !== src) img.src = fallback;
        });
        if (pxImgIO) pxImgIO.observe(img);
        else img.src = src;
        return img;
    }

    function pxWallSkeleton(n) {
        var html = '';
        for (var i = 0; i < n; i++) html += '<span class="px-skel"></span>';
        return html;
    }

    function pxRenderWallBar() {
        var bar = document.getElementById('pxInspireBar');
        if (!bar) return;
        bar.innerHTML = '';
        if (!pxWall.loaded || !(pxWall.models || []).length) return;

        var all = document.createElement('button');
        all.type = 'button';
        all.className = 'px-chip' + (pxWall.model ? '' : ' active');
        all.textContent = '全部';
        all.addEventListener('click', function () {
            if (!pxWall.model) return;
            pxWall.model = '';
            pxResetWall();
        });
        bar.appendChild(all);

        (pxWall.models || []).forEach(function (m) {
            var name = typeof m === 'string' ? m : m && m.name;
            if (!name) return;
            var c = document.createElement('button');
            c.type = 'button';
            c.className = 'px-chip' + (pxWall.model === name ? ' active' : '');
            c.textContent = name;
            c.addEventListener('click', function () {
                if (pxWall.model === name) return;
                pxWall.model = name;
                pxResetWall();
            });
            bar.appendChild(c);
        });
    }

    // 固定列宽 + 变高：按原图比例算高，最长边最多 1.62 倍宽、最矮 0.72 倍宽
    function pxSpanFor(width, ar) {
        var h = width / (ar || 1);
        var max = width * 1.62;
        var min = width * 0.72;
        if (h > max) h = max; else if (h < min) h = min;
        return Math.max(1, Math.ceil((h + 4) / 8));
    }

    function pxLayoutCards() {
        var grid = document.getElementById('pxInspireGrid');
        if (!grid) return;
        var cards = grid.querySelectorAll('.px-card');
        if (!cards.length) return;
        var w = cards[0].getBoundingClientRect().width;
        if (!w) return;
        for (var i = 0; i < cards.length; i++) {
            var ar = parseFloat(cards[i].getAttribute('data-ar')) || 1;
            cards[i].style.gridRowEnd = 'span ' + pxSpanFor(w, ar);
        }
    }

    var pxWallResizeTimer = null;
    window.addEventListener('resize', function () {
        if (pxWallResizeTimer) clearTimeout(pxWallResizeTimer);
        pxWallResizeTimer = setTimeout(pxLayoutCards, 120);
    });

    function pxRenderWallCards(full) {
        var grid = document.getElementById('pxInspireGrid');
        if (!grid) return;
        if (full) {
            grid.innerHTML = '';
            pxWall.rendered = 0;
        }
        if (!pxWall.items.length) {
            grid.innerHTML = '<div class="px-wall-empty">' + (pxWall.q || pxWall.model ? '没有找到相关作品' : '暂无作品') + '</div>';
        }
        for (var i = pxWall.rendered; i < pxWall.items.length; i++) {
            grid.appendChild(pxWallCard(pxWall.items[i]));
        }
        pxWall.rendered = pxWall.items.length;
        pxRenderWallMore();
        requestAnimationFrame(pxLayoutCards);
    }

    function pxRenderWallMore() {
        var box = document.getElementById('pxInspireMore');
        if (!box) return;
        var has = pxWall.loaded && !pxWall.failed && pxWall.more;
        box.hidden = !has;
        box.innerHTML = '';
        if (!has) return;
        var sp = document.createElement('span');
        sp.className = 'px-wall-loading';
        sp.innerHTML = '<i></i>加载中';
        box.appendChild(sp);
    }

    function pxWatchMore() {
        var box = document.getElementById('pxInspireMore');
        if (!box || !('IntersectionObserver' in window)) return;
        if (pxMoreIO) pxMoreIO.disconnect();
        pxMoreIO = new IntersectionObserver(function (entries) {
            if (entries[0] && entries[0].isIntersecting) pxMaybeLoadMore();
        }, { root: pxScrollRoot(), rootMargin: '600px 0px' });
        pxMoreIO.observe(box);
    }

    function pxMaybeLoadMore() {
        if (!pxWall.loaded || pxWall.loading || pxWall.failed) return;
        if (!pxWall.more) return;
        pxLoadWall(false);
    }

    // 追加后如果哨兵仍在视口附近，继续自动补一页
    function pxKickMore() {
        setTimeout(function () {
            var box = document.getElementById('pxInspireMore');
            if (!box || box.hidden) return;
            var r = box.getBoundingClientRect();
            if (r.top <= (window.innerHeight || 0) + 600) pxMaybeLoadMore();
        }, 80);
    }

    function pxWallCard(item) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'px-card';
        card.setAttribute('aria-label', item.title || item.prompt || '作品');
        var ar = (item.width && item.height) ? (item.width / item.height) : 1;
        card.setAttribute('data-ar', ar.toFixed(3));

        var fig = document.createElement('span');
        fig.className = 'px-card-fig';
        fig.appendChild(pxLazyImg(item.thumb || item.img, item.title || '', item.img));

        var meta = document.createElement('span');
        meta.className = 'px-card-meta';
        var title = document.createElement('strong');
        title.className = 'px-title';
        title.textContent = item.title || (item.prompt || '').slice(0, 40);
        meta.appendChild(title);
        var author = document.createElement('span');
        author.className = 'px-author';
        author.textContent = [item.author ? '@' + item.author : '', item.model || ''].filter(Boolean).join(' · ');
        meta.appendChild(author);
        fig.appendChild(meta);

        card.appendChild(fig);
        card.addEventListener('click', function () { pxOpenWork(item); });
        return card;
    }

    function pxResetWall() {
        pxWall.loaded = false;
        pxWall.items = [];
        pxWall.offset = 0;
        pxWall.more = false;
        pxWall.rendered = 0;
        pxWall.failed = false;
        var grid = document.getElementById('pxInspireGrid');
        if (grid) grid.innerHTML = pxWallSkeleton(18);
        pxRenderWallBar();
        pxRenderWallMore();
        pxLoadWall(true);
    }

    function pxLoadWall(reset) {
        if (pxWall.loading) return;
        pxWall.loading = true;
        var seq = ++pxWall.seq;
        if (reset) pxWall.offset = 0;
        pxFetchWall(pxWall.offset)
            .then(function (r) {
                if (seq !== pxWall.seq) return;
                var items = r.items || [];
                if (reset && !items.length && !pxWall.q && !pxWall.model && pxWall.src !== 'builtin') throw new Error('empty');
                pxWall.models = Array.isArray(r.models) ? r.models : pxWall.models;
                pxWall.items = reset ? items : pxWall.items.concat(items);
                pxWall.offset = r.next != null ? r.next : pxWall.offset + items.length;
                pxWall.more = !!r.more;
                pxWall.loaded = true;
                pxWall.failed = false;
                pxRenderWallBar();
                pxRenderWallCards(!!reset);
                pxKickMore();
            })
            .catch(function (e) {
                if (seq !== pxWall.seq) return;
                // 当前数据源不可用：降级到下一级（接口 → 静态分片 → 内置示例）
                var next = pxWall.src === 'api' && WALL_BASE ? 'static' : 'builtin';
                if (pxWall.src !== 'builtin') {
                    console.warn('[作品墙] 数据源 ' + pxWall.src + ' 不可用，改用 ' + next + '：', e && e.message);
                    pxWall.src = next;
                    pxWall.loading = false;
                    pxResetWall();
                    return;
                }
                pxWall.loaded = true;
                pxWall.failed = true;
                pxRenderWallBar();
                pxRenderWallCards(true);
            })
            .then(function () {
                if (seq === pxWall.seq) pxWall.loading = false;
            });
    }

    function pxInitWallSearch() {
        var input = document.getElementById('pxInspireSearch');
        if (!input || input.dataset.pxReady) return;
        input.dataset.pxReady = '1';
        var timer = null;
        input.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                var v = input.value.trim();
                if (v === pxWall.q) return;
                pxWall.q = v;
                pxResetWall();
            }, 300);
        });
    }

    function pxInitTopBtn() {
        var main = pxScrollRoot();
        if (!main) return;
        var btn = document.getElementById('pxTopBtn');
        if (btn) return;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'pxTopBtn';
        btn.className = 'px-top-btn';
        btn.title = '回到顶部';
        btn.textContent = '↑';
        btn.addEventListener('click', function () {
            if (main.scrollTo) main.scrollTo({ top: 0, behavior: 'smooth' });
            else main.scrollTop = 0;
        });
        document.body.appendChild(btn);
        var upd = function () { btn.classList.toggle('show', document.body.classList.contains('px-view-inspire') && (main.scrollTop || 0) > 400); };
        main.addEventListener('scroll', upd, { passive: true });
        upd();
    }

    function renderInspire() {
        var grid = document.getElementById('pxInspireGrid');
        if (!grid) return;
        pxSetupImgLazy();
        pxWatchMore();
        pxInitWallSearch();
        pxInitTopBtn();
        if (pxWall.loaded) {
            pxRenderWallBar();
            pxRenderWallCards(true);
            return;
        }
        if (pxWall.loading) return;
        grid.innerHTML = pxWallSkeleton(18);
        pxRenderWallBar();
        pxRenderWallMore();
        pxLoadWall(true);
    }

    // ---------------- 作品详情弹窗 ----------------
    function pxCopyText(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return pxCopyFallback(text); });
        }
        return Promise.resolve(pxCopyFallback(text));
    }

    function pxCopyFallback(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) { return false; }
    }

    function pxCloseWork() {
        if (!pxWorkEl) return;
        var el = pxWorkEl;
        pxWorkEl = null;
        document.body.classList.remove('px-work-open');
        document.removeEventListener('keydown', pxWorkKey);
        if (el.parentNode) el.parentNode.removeChild(el);
    }

    function pxWorkKey(e) {
        if (e.key === 'Escape' || e.keyCode === 27) pxCloseWork();
    }

    function pxSafeUrl(u) {
        return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
    }

    // 署名信息（CC BY 等许可要求：作者、来源、许可证链接、是否修改）
    function pxCredit(item) {
        var box = document.createElement('div');
        box.className = 'px-work-credit';
        var add = function (label, text, href) {
            if (!text) return;
            var row = document.createElement('div');
            var k = document.createElement('span');
            k.textContent = label;
            row.appendChild(k);
            var v;
            if (href) {
                v = document.createElement('a');
                v.href = href;
                v.target = '_blank';
                v.rel = 'noopener noreferrer nofollow';
            } else {
                v = document.createElement('b');
            }
            v.textContent = text;
            row.appendChild(v);
            box.appendChild(row);
        };
        add('作者', item.author ? '@' + item.author : '', pxSafeUrl(item.authorUrl));
        add('模型', item.model && item.modelRaw && item.modelRaw !== item.model ? item.model + '（' + item.modelRaw + '）' : item.model);
        add('来源', item.source || (pxSafeUrl(item.sourceUrl) ? '原帖' : ''), pxSafeUrl(item.sourceUrl) || pxSafeUrl(item.sourceRepo));
        add('许可', item.license, pxSafeUrl(item.licenseUrl) || LICENSE_URL[item.license] || '');
        if (item.license) {
            var note = document.createElement('p');
            note.className = 'px-work-note';
            note.textContent = 'AI 生成内容。本站展示的是按原许可转载的缩放/WebP 转码版本，版权归原作者所有。';
            box.appendChild(note);
        }
        return box;
    }

    function pxOpenWork(item) {
        pxCloseWork();
        var root = document.createElement('div');
        root.className = 'px-work';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        var backdrop = document.createElement('div');
        backdrop.className = 'px-work-backdrop';
        backdrop.addEventListener('click', pxCloseWork);
        root.appendChild(backdrop);

        var panel = document.createElement('div');
        panel.className = 'px-work-panel';

        var figure = document.createElement('div');
        figure.className = 'px-work-figure';
        var big = document.createElement('img');
        big.alt = item.title || '';
        var thumb = item.thumb || item.img;
        var full = item.img || thumb;
        if (thumb) {
            big.src = thumb;
            if (thumb !== full) big.classList.add('px-img-preview');
        }
        if (full && full !== thumb) {
            var pre = new Image();
            var clearBlur = function () { big.classList.remove('px-img-preview'); };
            pre.onload = function () {
                big.src = full;
                if (big.decode) big.decode().then(clearBlur).catch(clearBlur);
                else setTimeout(clearBlur, 120);
            };
            pre.onerror = clearBlur;
            pre.src = full;
        }
        figure.appendChild(big);
        var aiTag = document.createElement('span');
        aiTag.className = 'px-ai-tag';
        aiTag.textContent = 'AI 生成';
        figure.appendChild(aiTag);
        panel.appendChild(figure);

        var side = document.createElement('div');
        side.className = 'px-work-side';

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'px-work-close';
        close.setAttribute('aria-label', '关闭');
        close.innerHTML = '&times;';
        close.addEventListener('click', pxCloseWork);
        side.appendChild(close);

        var h = document.createElement('h3');
        h.className = 'px-work-title';
        h.textContent = item.title || '未命名作品';
        side.appendChild(h);
        side.appendChild(pxCredit(item));

        var prompt = document.createElement('div');
        prompt.className = 'px-work-prompt';
        prompt.textContent = item.prompt || '（该作品未提供提示词）';
        side.appendChild(prompt);

        var actions = document.createElement('div');
        actions.className = 'px-work-actions';
        var use = document.createElement('button');
        use.type = 'button';
        use.className = 'px-work-btn primary';
        use.textContent = pxUseLabel();
        use.disabled = !item.prompt;
        use.addEventListener('click', function () {
            if (!item.prompt) return;
            pxCloseWork();
            usePrompt(item.prompt);
        });
        actions.appendChild(use);

        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'px-work-btn';
        copy.textContent = '复制提示词';
        copy.disabled = !item.prompt;
        copy.addEventListener('click', function () {
            pxCopyText(item.prompt || '').then(function (ok) {
                showToast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', { type: ok ? 'ok' : 'info' });
            });
        });
        actions.appendChild(copy);
        side.appendChild(actions);
        panel.appendChild(side);
        root.appendChild(panel);

        document.body.appendChild(root);
        document.body.classList.add('px-work-open');
        document.addEventListener('keydown', pxWorkKey);
        pxWorkEl = root;
        close.focus();
    }

    function usePrompt(text) {
        var input = document.getElementById('promptInput');
        if (!input) return;
        input.textContent = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setView('generate');
        input.focus();
        var range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // ---------------- 视图切换 ----------------
    function setView(view) {
        var body = document.body;
        body.classList.toggle('px-view-inspire', view === 'inspire');
        body.classList.toggle('px-view-generate', view !== 'inspire');
        document.querySelectorAll('.px-rail [data-view]').forEach(function (el) {
            var on = el.getAttribute('data-view') === view;
            el.classList.toggle('active', on);
            if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
        });
        var main = document.querySelector('.main-area');
        if (main) main.scrollTop = 0;
        if (view === 'inspire') setTimeout(pxLayoutCards, 60);
        if (history.replaceState) {
            history.replaceState(null, '', view === 'inspire' ? '#inspire' : location.pathname + location.search);
        }
    }
    window.pxSetView = setView;

    // 设置弹窗里的语言分段按钮：高亮当前语言（语言切换本身仍由 #langZh/#langEn 处理）
    window.pxSyncLangSeg = function () {
        var lang = localStorage.getItem('nano_lang') || 'zh';
        document.querySelectorAll('[data-px-lang]').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-px-lang') === lang);
        });
    };
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#settingsBtn')) setTimeout(window.pxSyncLangSeg, 0);
    }, true);

    function watchGridEmpty() {
        var grid = document.getElementById('imagesGrid');
        if (!grid) return;
        var update = function () {
            document.body.classList.toggle('px-grid-empty', grid.children.length === 0);
        };
        update();
        new MutationObserver(update).observe(grid, { childList: true });

        // 作品卡片：用同一张图做模糊底，消除非方形图的上下/左右留白
        var syncThumbs = function () {
            grid.querySelectorAll('.task-image > img').forEach(function (img) {
                var box = img.parentElement;
                var src = img.currentSrc || img.src;
                if (src && box.dataset.pxThumb !== src) {
                    box.dataset.pxThumb = src;
                    box.style.setProperty('--px-thumb', 'url("' + src.replace(/"/g, '%22') + '")');
                    box.classList.add('px-has-thumb');
                }
            });
        };
        syncThumbs();
        new MutationObserver(syncThumbs).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }

    // 输入框：占位语随语言切换；Enter 生成，Shift+Enter 换行；无价格时隐藏按钮里的价格胶囊
    function setupComposer() {
        var input = document.getElementById('promptInput');
        var btn = document.getElementById('generateBtn');
        var counter = document.getElementById('taskCounter');
        if (!input || !btn) return;
        var syncPlaceholder = function () {
            if (typeof window.t === 'function') input.setAttribute('data-placeholder', window.t('promptPlaceholder'));
        };
        syncPlaceholder();
        if (typeof window.onLangChange === 'function') window.onLangChange(syncPlaceholder);

        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.keyCode === 229) return;
            var dd = document.getElementById('imageSelectDropdown');
            if (dd && !dd.classList.contains('hidden')) return;
            e.preventDefault();
            if (!btn.disabled) btn.click();
        });
        // 清空后 contenteditable 常残留 <br>，导致 :empty 失效、占位语不显示
        input.addEventListener('input', function () {
            if (!input.textContent.trim() && !input.querySelector('img, .image-tag')) input.innerHTML = '';
        });

        // 输入框状态：有无内容、字数、拖入图片提示
        var bar = input.closest('.bottom-bar');
        var upper = input.parentElement;
        var lower = bar && bar.querySelector('.bottom-lower');
        var actions = lower && lower.querySelector('.input-actions');
        var tr = function (key) { return typeof window.t === 'function' ? window.t(key) : key; };
        if (bar && upper && actions) {
            var len = document.createElement('span');
            len.className = 'px-len';
            lower.insertBefore(len, actions);

            var refs = document.getElementById('refsMini');
            var syncState = function () {
                var n = input.textContent.replace(/\s+/g, '').length;
                var hasText = n > 0 || !!input.querySelector('.image-tag');
                var hasRefs = !!(refs && refs.querySelector('.has-image'));
                bar.classList.toggle('px-has-text', hasText);
                if (hasText) bar.classList.add('px-tall');
                bar.classList.toggle('px-empty', !hasText && !hasRefs);
                len.textContent = n + ' ' + tr('pxChars');
                len.classList.toggle('px-warn', n > 1500);
            };
            var syncI18n = function () {
                bar.setAttribute('data-drop-text', tr('pxDropHint'));
                syncState();
            };
            syncI18n();
            if (typeof window.onLangChange === 'function') window.onLangChange(syncI18n);
            input.addEventListener('input', syncState);
            new MutationObserver(syncState).observe(input, { childList: true, characterData: true, subtree: true });
            if (refs) new MutationObserver(syncState).observe(refs, { childList: true });

            // 悬停或聚焦时输入框长高；没有文字时鼠标移出输入区、点输入区以外或按 Esc 即收回，有文字则保持
            // 高度统一由 JS 算出目标值再用 height 过渡：长高/收回/换行/粘贴/清空都走同一条平滑曲线。
            // 内容高度用隐藏的影子元素测量，测量时不碰输入框本身，正在进行的过渡不会被打断。
            var ghost = document.createElement('div');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:auto;min-height:0;max-height:none;overflow:hidden;';
            document.body.appendChild(ghost);
            var curH = -1;
            var fit = function (instant) {
                var cs = getComputedStyle(input);
                var s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
                ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordBreak', 'whiteSpace', 'overflowWrap',
                 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderBottomWidth', 'boxSizing']
                    .forEach(function (k) { ghost.style[k] = cs[k]; });
                ghost.style.borderStyle = 'solid'; ghost.style.borderColor = 'transparent'; ghost.style.borderLeftWidth = ghost.style.borderRightWidth = '0';
                ghost.style.width = input.clientWidth + 'px';
                ghost.innerHTML = input.innerHTML || 'x';
                var floor = (bar.classList.contains('px-tall') ? 128 : 56) * s;
                var max = parseFloat(cs.maxHeight) || 240 * s;
                var target = Math.round(Math.min(max, Math.max(floor, ghost.getBoundingClientRect().height)));
                if (target === curH && !instant) return;
                input.setAttribute('data-anim', target > curH ? 'grow' : 'shrink');
                if (instant) { input.style.transition = 'none'; input.style.height = target + 'px'; input.offsetHeight; input.style.transition = ''; }
                else input.style.height = target + 'px';
                curH = target;
            };
            var setTall = function (on) {
                if (bar.classList.contains('px-tall') === on) return;
                bar.classList.toggle('px-tall', on);
                fit();
            };
            var grow = function () { setTall(true); };
            var shrink = function () { if (!bar.classList.contains('px-has-text')) setTall(false); };
            upper.addEventListener('mouseenter', grow);
            bar.addEventListener('mouseleave', shrink);
            input.addEventListener('focus', grow);
            document.addEventListener('pointerdown', function (e) { if (!bar.contains(e.target)) shrink(); }, true);
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shrink(); });
            input.addEventListener('input', function () { fit(); });
            new MutationObserver(function () { fit(); }).observe(input, { childList: true, subtree: true, characterData: true });
            window.addEventListener('resize', function () { fit(true); });
            fit(true);

            // 从系统拖入文件时高亮输入框（只做视觉，上传仍由原有 drop 逻辑处理）
            var depth = 0;
            var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
            var off = function () { depth = 0; bar.classList.remove('px-drop'); };
            window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; depth++; bar.classList.add('px-drop'); });
            window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) off(); });
            window.addEventListener('drop', off, true);
            window.addEventListener('dragend', off);
        }

        if (counter) {
            var syncCost = function () { counter.classList.toggle('px-off', !/\d/.test(counter.textContent)); };
            syncCost();
            new MutationObserver(syncCost).observe(counter, { childList: true, characterData: true, subtree: true });
        }

        // "16:9 / 2K" → "16:9 | 2K"（中间用细分隔线）
        var combo = document.getElementById('comboLabel');
        if (combo) {
            var splitCombo = function () {
                var txt = combo.textContent;
                if (txt.indexOf(' / ') < 0) return;
                var parts = txt.split(' / ');
                combo.textContent = '';
                parts.forEach(function (part, i) {
                    if (i) { var sep = document.createElement('i'); sep.className = 'px-sep'; combo.appendChild(sep); }
                    var s = document.createElement('span'); s.textContent = part; combo.appendChild(s);
                });
            };
            splitCombo();
            new MutationObserver(splitCombo).observe(combo, { childList: true, characterData: true, subtree: true });
        }

        // 模型菜单：左侧缩写徽标，描述里的 "| ¥15/张" 移到右侧
        var menu = document.getElementById('modelMenu');
        if (menu) {
            var abbr = function (name) {
                var n = name.toLowerCase();
                if (n.indexOf('nano') === 0) return 'NB';
                if (n.indexOf('gpt') === 0) return 'GP';
                if (n.indexOf('seedream') === 0) return 'SD';
                if (n.indexOf('mj') === 0 || n.indexOf('midjourney') === 0) return 'MJ';
                if (n.indexOf('flux') === 0) return 'FX';
                var w = name.split(/\s+/).filter(function (x) { return /^[a-z]/i.test(x); });
                return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
            };
            var decorate = function () {
                menu.querySelectorAll('.model-option:not(.px-dec)').forEach(function (opt) {
                    var body = opt.firstElementChild;
                    var title = body && body.firstElementChild;
                    if (!title) return;
                    opt.classList.add('px-dec');
                    var mi = document.createElement('i');
                    mi.className = 'px-mi';
                    mi.textContent = abbr(title.textContent.trim());
                    opt.insertBefore(mi, body);
                    var desc = opt.querySelector('.model-desc');
                    if (desc && desc.textContent.indexOf('|') >= 0) {
                        var idx = desc.textContent.lastIndexOf('|');
                        var price = desc.textContent.slice(idx + 1).trim();
                        desc.title = desc.textContent.slice(0, idx).trim();
                        desc.textContent = desc.title;
                        var pr = document.createElement('span');
                        pr.className = 'px-price';
                        pr.textContent = price;
                        opt.appendChild(pr);
                    }
                });
            };
            decorate();
            new MutationObserver(decorate).observe(menu, { childList: true });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.body.classList.contains('px-theme')) return;

        // 主页专属：左侧导航视图切换 + 灵感广场（画布页无 .px-rail，整体跳过）
        var hasRail = !!document.querySelector('.px-rail');
        if (hasRail) {
            document.querySelectorAll('.px-rail [data-view]').forEach(function (el) {
                el.addEventListener('click', function () { setView(el.getAttribute('data-view')); });
            });
            renderInspire();
            watchGridEmpty();
            if (location.hash !== '#inspire') document.body.classList.add('px-history-loading');
            setView(location.hash === '#inspire' ? 'inspire' : 'generate');
            if (typeof window.onLangChange === 'function') window.onLangChange(renderInspire);
        }

        // 输入区增强：主页与画布页通用（画布页带有 px-theme 即可生效）
        setupComposer();

        // 滚动性能：滚动进行中给 body 挂 px-scrolling（CSS 据此挂起固定栏毛玻璃，
        // backdrop-filter 在内容滚过时每帧重算模糊，核显上明显掉帧），停止 180ms 后恢复
        var scroller = document.querySelector('.main-area');
        if (scroller) {
            var scTimer = null;
            scroller.addEventListener('scroll', function () {
                if (!document.body.classList.contains('px-scrolling')) document.body.classList.add('px-scrolling');
                if (scTimer) clearTimeout(scTimer);
                scTimer = setTimeout(function () { document.body.classList.remove('px-scrolling'); }, 180);
            }, { passive: true });
        }
    });

    // 从画布页跳回时，打开对应弹窗（需等 script.js 绑定完事件）
    window.addEventListener('load', function () {
        var map = { '#history': 'historyBtn', '#favorites': 'favoritesBtn' };
        var id = map[location.hash];
        if (!id) return;
        setTimeout(function () {
            var btn = document.getElementById(id);
            if (btn) btn.click();
            if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
        }, 300);
    });

    // ---------------- 页面跳转加载遮罩 ----------------
    function ensurePageLoader() {
        if (!document.body || document.getElementById('pxPageLoader')) return;
        var el = document.createElement('div');
        el.className = 'px-page-loader';
        el.id = 'pxPageLoader';
        el.innerHTML = '<div class="px-loader"><div class="px-loader-ring"></div><div class="px-loader-text">正在加载…</div></div>';
        document.body.appendChild(el);
    }
    if (document.body) ensurePageLoader(); else document.addEventListener('DOMContentLoaded', ensurePageLoader);
    // 离开页面（导航/刷新）时显示；遮罩自带 120ms 延迟，快速跳转不会闪
    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a[download]');
        if (a) window.__pxDlAt = Date.now();
    }, true);
    window.addEventListener('beforeunload', function () {
        if (window.__pxDlAt && Date.now() - window.__pxDlAt < 1500) return;
        ensurePageLoader();
        document.documentElement.classList.add('px-leaving');
        // 兜底：若实际没有离开（如触发文件下载的跳转），8 秒后自动撤销遮罩
        clearTimeout(window.__pxLeaveTimer);
        window.__pxLeaveTimer = setTimeout(function () { document.documentElement.classList.remove('px-leaving'); }, 8000);
    });
    // 从浏览器前进/后退缓存恢复时撤销遮罩
    window.addEventListener('pageshow', function () {
        document.documentElement.classList.remove('px-leaving');
    });
})();
