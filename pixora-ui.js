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

    // ---------------- 灵感广场数据 ----------------
    var INSPIRE = [
        { img: '01', model: 'Nano Banana Pro', p: '白衣修仙剑客立于云海之巅，长发飘逸，手持发光长剑，电影级光影，国风写实，超高细节' },
        { img: '02', model: 'GPT Image 2', p: '极简护肤品产品摄影，磨砂玻璃瓶，柔和晨光，浅绿色背景，商业广告质感' },
        { img: '03', model: 'Seedream 5.0', p: '赛博朋克雨夜街头的少女肖像，霓虹灯反射，浅景深，35mm 胶片质感' },
        { img: '04', model: 'Nano Banana 2', p: '水墨风格的江南古镇，小桥流水，晨雾，留白构图，宣纸纹理' },
        { img: '05', model: 'GPT Image 2.5', p: '可爱的 3D 小狐狸角色，皮克斯风格，柔和的工作室布光，纯色背景' },
        { img: '06', model: 'Nano Banana Pro', p: '复古科幻电影海报，宇航员站在橙色沙丘上仰望巨大行星，颗粒质感' },
        { img: '07', model: 'Seedream 5.0', p: '日式咖啡馆室内设计，原木与亚麻，午后阳光透过百叶窗，安静温暖' },
        { img: '08', model: 'GPT Image 2', p: '东方神话中的青龙穿梭于云层与雷电之间，史诗感，金色高光' }
    ];

    function renderInspire() {
        var grid = document.getElementById('pxInspireGrid');
        if (!grid) return;
        var useLabel = typeof window.t === 'function' ? window.t('pxUsePrompt') : '用这个提示词';
        grid.innerHTML = '';
        INSPIRE.forEach(function (item) {
            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'px-card';
            card.setAttribute('aria-label', item.p);

            var img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = 'assets/inspire/' + item.img + '.jpg';
            card.appendChild(img);

            var meta = document.createElement('span');
            meta.className = 'px-meta';
            var p = document.createElement('p');
            p.textContent = item.p;
            var row = document.createElement('span');
            row.className = 'px-row';
            var model = document.createElement('span');
            model.className = 'px-model';
            model.textContent = item.model;
            var use = document.createElement('span');
            use.className = 'px-use';
            use.textContent = useLabel;
            row.appendChild(model);
            row.appendChild(use);
            meta.appendChild(p);
            meta.appendChild(row);
            card.appendChild(meta);

            card.addEventListener('click', function () { usePrompt(item.p); });
            grid.appendChild(card);
        });
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

        // 用户头像：补齐本地缺失的头像编号并渲染（主页/画布通用）
        pxEnsureAvatar();
        pxApplyAvatars();

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
