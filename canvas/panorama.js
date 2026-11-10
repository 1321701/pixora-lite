/**
 * panorama.js —— 无限画布 · 第四期：360 全景 + 角色多视角
 *   - 全景模式：图片生成节点 panorama:true（比例锁定 2:1，提交时拼接全景模板，不写回用户提示词）；参考图节点可「标记为全景」isPanorama:true
 *   - 全景查看器：Pannellum（canvas/vendor/pannellum，按需懒加载）+ 罗盘 / 视角读数 / 自动旋转 / 接缝辅助线 / 机位截取（CPU 等距柱状→透视投影，所见即所得）
 *   - 接缝：/api/panorama/seam-check · seam-fix（平移半宽 → 中央竖条 AI 修复 → 羽化贴回 → 平移回去）· seam-finalize；结果写回为节点新的生成记录
 *   - 角色多视角：转身设定图 / 8 视角宫格（服务端裁切 /api/characters/:id/split-grid）→ 存入角色卡 → 序列帧 360° 拖拽查看
 * 所有用户内容渲染一律转义；图片地址统一归一化为同源 /api/img（WebGL 纹理与像素读取需要 CORS 干净）
 */
(function (global) {
    'use strict';

    const VENDOR_V = '1';
    const PANO_MODELS = ['GPT Image 2.5 Pro', 'GPT Image 2.5', 'GPT Image 2.5 快速 Pro', 'GPT Image 2.5 快速', 'GPT Image 2 Pro', 'GPT Image 2 标准'];
    const PANO_DEFAULT = 'GPT Image 2.5 Pro';
    const PANO_TEMPLATE = 'equirectangular 360° panorama, 2:1 aspect ratio, full spherical 360x180 degree view, level horizon exactly at the vertical center, seamless wrap-around: the left edge and the right edge connect perfectly, consistent lighting, natural perspective, no fisheye circle, no border, no people, no text, no watermark.\n等距柱状投影 360° 全景图，宽高比 2:1，水平 360° × 垂直 180° 完整球面视角，地平线水平且位于画面正中，左右边缘内容无缝衔接，光照一致，无人物、无文字、无水印。\n场景：';
    const TURN_MODELS = ['Nano Banana 2.1', 'Nano Banana Pro', 'Nano Banana 2.0', 'GPT Image 2.5 Pro', 'GPT Image 2.5', 'Seedream 5.0'];
    const TURN_DEFAULT = 'Nano Banana 2.1';
    const TURN = {
        sheet: {
            aspect: '16:9', label: '转身设定图', 
            tpl: '角色转身设定图（character turnaround reference sheet）：严格参照参考图中的同一角色（五官、发型、服装、配饰、体型完全一致）。同一画面从左到右依次排列四个视图：①面部特写近景 ②正面全身 ③侧面全身（面朝右） ④背面全身。四个视图为同一套服装、同样的身高比例与光照，全身像头顶和脚底完整入画、不裁切，纯浅灰色干净背景，视图之间留白均匀，无文字、无标注、无水印。\ncharacter turnaround sheet, face close-up, front view, side view, back view, full body, same outfit, consistent proportions, plain light grey background, no text.'
        },
        grid8: {
            aspect: '4:3', label: '8 视角序列',
            tpl: '2×4 宫格的角色 8 视角转身序列：严格参照参考图中的同一角色（五官、发型、服装、配饰、体型完全一致）。上排从左到右依次为：正面 0°、右前方 45°、右侧面 90°、右后方 135°；下排从左到右依次为：背面 180°、左后方 225°、左侧面 270°、左前方 315°（相机绕角色每格旋转 45°）。每格一个完整全身像，人物居中、大小一致、同一机位高度，头顶和脚底完整入画，纯浅灰色干净背景，8 格等宽等高均匀排布，格子之间无边框，无文字、无编号、无水印。\n8-view character turnaround, 2 rows x 4 columns grid, evenly spaced cells, full body, rotating 45 degrees per cell, same outfit, plain light grey background, no text.'
        }
    };
    const ANGLES = ['0°', '45°', '90°', '135°', '180°', '225°', '270°', '315°'];
    const SHOT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '21:9'];

    const svg = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const IC = {
        pano: svg('<ellipse cx="12" cy="12" rx="9.5" ry="4.2"/><path d="M12 7.8c-2.6 0-4.6 1.9-4.6 4.2s2 4.2 4.6 4.2"/><path d="M20.2 5.6l1.3-1.3M3.8 18.4 2.5 19.7"/>'),
        p360: svg('<path d="M3.5 12a8.5 4.2 0 0 0 17 0"/><path d="M20.5 12a8.5 4.2 0 0 0-17 0" stroke-dasharray="2 2.6"/><path d="m17.5 15.6 3-3.4 1.3 3.9"/>'),
        eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
        seam: svg('<path d="M12 3v18" stroke-dasharray="2.4 2.4"/><path d="M4 7h5M4 12h5M4 17h5M15 7h5M15 12h5M15 17h5"/>'),
        camera: svg('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>'),
        x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
        rotate: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
        reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
        full: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
        dl: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
        trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>'),
        edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
        place: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
        spark: svg('<path d="M12 3c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6z"/>'),
        coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5c.4 2.3 1.4 3.3 3.6 3.7-2.2.4-3.2 1.4-3.6 3.7-.4-2.3-1.4-3.3-3.6-3.7 2.2-.4 3.2-1.4 3.6-3.7z"/>'),
        user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'),
        turn: svg('<circle cx="12" cy="6.5" r="2.6"/><path d="M8.5 21v-5.5a3.5 3.5 0 0 1 7 0V21"/><path d="M3 13.5c0 2.6 4 4.6 9 4.6s9-2 9-4.6"/><path d="m18.6 16.4 2.4 1.2-1.1 2.4"/>'),
        play: svg('<path d="M7 5.5v13l11-6.5z" fill="currentColor"/>'),
        pause: svg('<path d="M8 5v14M16 5v14" stroke-width="2.6"/>'),
        check: svg('<path d="m5.5 12.5 4.2 4 8.8-9"/>'),
        warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
        save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
        link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
        clap: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
        mark: svg('<path d="M3.5 12a8.5 4.2 0 0 0 17 0 8.5 4.2 0 0 0-17 0z"/><path d="m9 12 2 2 4-4"/>')
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function toast(msg, type) { if (typeof global.pxToast === 'function') global.pxToast(msg, type ? { type } : undefined); else alert(msg); }
    function fmt(n) { return Number((Number(n) || 0).toFixed(2)); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    // 同源 /api/img（国内入口 / 旧域名的绝对地址 → 相对路径），WebGL 纹理与像素读取不受跨域污染
    function sameOrigin(u) {
        const s = String(u || '');
        if (!s) return s;
        if (global.VideoProxy && global.VideoProxy.sameOrigin) return global.VideoProxy.sameOrigin(s);
        return s.replace(/^https?:\/\/[^/]+(?=\/api\/img)/i, '');
    }
    function withProc(u, proc) {
        const s = String(u || '');
        if (!s || s.indexOf('x-tos-process') !== -1 || s.indexOf('/api/img') === -1) return s;
        return s + (s.indexOf('?') === -1 ? '?' : '&') + 'x-tos-process=' + encodeURIComponent(proc);
    }
    function stripProc(u) { return String(u || '').replace(/[?&]x-tos-process=[^&#]*/g, '').replace(/\?&/, '?'); }
    function api(path, body) {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, typeof global.authHeaders === 'function' ? global.authHeaders() : {});
        return fetch(((global.API_CONFIG && global.API_CONFIG.baseUrl) || '') + path, { method: 'POST', headers, body: JSON.stringify(body || {}) })
            .then(async (res) => {
                let j = null;
                try { j = await res.json(); } catch (_) { /* 非 JSON */ }
                if (!j) throw new Error('请求失败: ' + res.status);
                if (j.code === 202) return { pending: true };
                if (!res.ok || j.code !== 0) { const e = new Error(j.msg || ('请求失败: ' + res.status)); e.code = j.code; throw e; }
                return j.data;
            });
    }
    const reduceMotion = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const isEn = () => { try { return localStorage.getItem('nano_lang') === 'en'; } catch (_) { return false; } };

    let _vendorP = null;
    function loadVendor() {
        if (global.pannellum && global.pannellum.viewer) return Promise.resolve(global.pannellum);
        if (_vendorP) return _vendorP;
        _vendorP = new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'canvas/vendor/pannellum/pannellum.css?v=' + VENDOR_V;
            document.head.appendChild(css);
            const s = document.createElement('script');
            s.src = 'canvas/vendor/pannellum/pannellum.js?v=' + VENDOR_V;
            s.onload = () => (global.pannellum ? resolve(global.pannellum) : reject(new Error('全景组件加载失败')));
            s.onerror = () => { _vendorP = null; reject(new Error('全景组件加载失败，请检查网络后重试')); };
            document.head.appendChild(s);
        });
        return _vendorP;
    }
    function hasWebGL() {
        if (global.__pxNoWebGL) return false;
        try {
            const c = document.createElement('canvas');
            return !!(global.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (_) { return false; }
    }
    function loadImg(src) {
        return new Promise((resolve, reject) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.decoding = 'async';
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('图片加载失败'));
            im.src = src;
        });
    }

    const CanvasPano = {
        PANO_MODELS, PANO_DEFAULT, PANO_TEMPLATE, TURN_MODELS, TURN_DEFAULT, TURN, ANGLES,
        _v: null,          // 查看器状态
        _turnWatch: {},    // 多视角节点 → 完成后弹出结果预览

        init() {
            if (this._inited) return;
            this._inited = true;
            this._hookPromptBar();
            this._buildDockBtn();
            window.addEventListener('keydown', (e) => this._onKey(e), true);
            setInterval(() => this._tickTurn(), 1500);
        },

        // ================= 判定 / 提示词 =================
        isPanoModel(m) { return PANO_MODELS.indexOf(String(m || '')) !== -1; },
        isPano(n) {
            if (!n || n.mediaType === 'video' || n.mediaType === 'audio') return false;
            if (n.nodeType === 'gen') return !!n.panorama;
            return n.nodeType === 'ref' && !!n.isPanorama;
        },
        hasPanoImage(n) { return this.isPano(n) && !!(n.imageUrl || n.previewUrl) && n.status !== 'generating' && n.status !== 'loading'; },
        wrapPrompt(p) { return PANO_TEMPLATE + String(p || '').trim(); },
        wrapTurnaround(p, mode) {
            const t = TURN[mode] || TURN.sheet;
            const extra = String(p || '').replace(t.label, '').trim();
            return t.tpl + (extra ? '\n补充要求：' + extra : '');
        },
        // canvas-generate.runNode 提交前调用：返回 false 表示中止
        applyToParams(node, p) {
            if (!node || !p) return true;
            if (node.turnaround && TURN[node.turnaround.mode]) {
                p.aspectRatio = TURN[node.turnaround.mode].aspect;
                p.prompt = this.wrapTurnaround(p.prompt, node.turnaround.mode);
                return true;
            }
            if (p.panorama || node.panorama) {
                if (!this.isPanoModel(p.model)) { alert('当前模型不支持 360° 全景，请切换到全景模型（如 ' + PANO_DEFAULT + '）'); return false; }
                if (!String(p.prompt || '').trim()) { alert('请先描述全景场景'); return false; }
                node.panorama = true;
                node.aspectRatio = '2:1';
                p.aspectRatio = '2:1';
                p.prompt = this.wrapPrompt(p.prompt);
            }
            return true;
        },
        // 价格：与 PromptBar / 服务端预扣同源（quality 缺省按 medium）
        priceOf(model, size, quality) {
            const PB = global.PromptBar;
            const cfg = PB && PB.modelConfigMap && PB.modelConfigMap[model];
            if (!cfg) return 0;
            const pm = cfg.priceMatrix || {};
            const opts = Array.isArray(cfg.qualityOptions) ? cfg.qualityOptions : [];
            let q = 'medium';
            if (opts.length && quality && opts.indexOf(quality) !== -1) q = quality;
            if (!pm[q]) q = pm.medium ? 'medium' : Object.keys(pm)[0];
            const v = pm[q] && pm[q][size];
            return typeof v === 'number' ? v : (cfg.price || 0);
        },
        _sizesOf(model) {
            const PB = global.PromptBar;
            const c = PB && PB.modelConfigMap && PB.modelConfigMap[model];
            return (c && Array.isArray(c.supportedResolutions) && c.supportedResolutions.length) ? c.supportedResolutions : ['1K', '2K', '4K'];
        },
        _availModels(list) {
            const PB = global.PromptBar;
            const map = (PB && PB.modelConfigMap) || {};
            const out = list.filter(m => map[m]);
            return out.length ? out : list.slice(0, 1);
        },
        _modelName(m) { const PB = global.PromptBar; const c = PB && PB.modelConfigMap && PB.modelConfigMap[m]; return (c && c.name) || m; },

        // ================= 提示词栏：全景开关 =================
        _hookPromptBar() {
            const PB = global.PromptBar;
            if (!PB || PB._panoHooked) return;
            PB._panoHooked = true;
            PB.panoMode = false;
            // 360° 入口已移到节点工具栏（提示词栏底排太挤），这里不再插入按钮
            const tools = null;
            if (tools && !document.getElementById('panoModeBtn')) {
                const b = document.createElement('button');
                b.type = 'button';
                b.id = 'panoModeBtn';
                b.className = 'pano-mode-btn hidden';
                b.title = '360° 全景模式：比例锁定 2:1，提交时自动追加全景提示词';
                b.setAttribute('aria-pressed', 'false');
                b.innerHTML = `${IC.p360}<span>360°</span>`;
                const combo = document.getElementById('comboDropdown');
                if (combo && combo.parentNode === tools) combo.insertAdjacentElement('afterend', b); else tools.appendChild(b);
                b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.setPanoMode(!PB.panoMode); });
            }
            const wrap = (name, after) => {
                const orig = PB[name];
                if (typeof orig !== 'function') return;
                PB[name] = function () { const r = orig.apply(this, arguments); try { after.apply(CanvasPano, [r].concat(Array.from(arguments))); } catch (e) { console.warn('[全景]', name, e); } return r; };
            };
            wrap('loadFromNode', (r, node) => {
                if (!node) return;
                if (node.nodeType === 'gen') {
                    PB.panoMode = !!node.panorama && !node.turnaround && this.isPanoModel(PB.currentModel);
                    PB.currentAspect = PB.panoMode ? '2:1' : (node.aspectRatio && node.aspectRatio !== '2:1' ? node.aspectRatio : (node.turnaround ? (TURN[node.turnaround.mode] || TURN.sheet).aspect : '1:1'));
                    if (PB.updateComboLabel) PB.updateComboLabel();
                }
                this._syncBar();
            });
            // 预置：载入前先按节点设定全景状态，避免载入过程中的价格/标签刷新沿用上一个节点的全景状态改写比例
            const origLoad = PB.loadFromNode;
            PB.loadFromNode = function (node) {
                if (node && node.nodeType === 'gen') PB.panoMode = !!node.panorama && !node.turnaround;
                return origLoad.apply(this, arguments);
            };
            wrap('snapshotToNode', (r, node) => {
                if (!node || node.nodeType !== 'gen' || node.turnaround) return;
                // 只在真正变化时写字段（不给普通节点平添 panorama:false，避免撤销快照/存档无谓变化）
                if (PB.panoMode) { node.panorama = true; node.aspectRatio = '2:1'; }
                else if (node.panorama) node.panorama = false;
            });
            wrap('getGenerationParams', (params) => {
                if (params && PB.panoMode) { params.panorama = true; params.aspectRatio = '2:1'; }
            });
            wrap('updateComboLabel', () => this._syncBar(true));
            wrap('renderModelOptionsForApi', () => this._syncBar(true));
            wrap('updatePriceDisplay', () => this._syncBar(true));
        },
        _syncBar(light) {
            const PB = global.PromptBar;
            if (!PB || this._syncing) return;
            this._syncing = true;
            try {
                const btn = document.getElementById('panoModeBtn');
                const isVideo = PB._isVideoModel && PB._isVideoModel(PB.currentModel);
                const can = !isVideo && PB.currentGenMode !== 'video' && this.isPanoModel(PB.currentModel);
                // 节点切换载入中（上一个节点可能是视频模式）：模型/模式尚未切换完，不能据此取消全景
                const loading = global.CanvasMain && global.CanvasMain._loadingPromptBar;
                if (!can && PB.panoMode && !loading) {
                    PB.panoMode = false;
                    if (PB.currentAspect === '2:1') PB.currentAspect = '16:9';
                    const CM = global.CanvasMain;
                    const n = CM && CM._activeNodeId && global.CanvasBlocks.getById(CM._activeNodeId);
                    if (n && n.nodeType === 'gen' && n.panorama) { n.panorama = false; if (n.aspectRatio === '2:1') n.aspectRatio = '16:9'; }
                }
                if (btn) {
                    btn.classList.toggle('hidden', !can);
                    btn.classList.toggle('active', !!PB.panoMode);
                    btn.setAttribute('aria-pressed', PB.panoMode ? 'true' : 'false');
                }
                const menu = document.getElementById('comboMenu');
                if (menu) menu.classList.toggle('pano-locked', !!PB.panoMode);
                const mm = PB.el && PB.el.modelMenu;
                if (mm) mm.querySelectorAll('.model-option').forEach(o => o.classList.toggle('pano-hide', !!PB.panoMode && !/^GPT Image 2/.test(o.dataset.value || '')));
                const lb = PB.el && PB.el.comboLabel;
                if (PB.panoMode) {
                    PB.currentAspect = '2:1';
                    if (lb) lb.textContent = `360° 2:1 / ${PB.currentRes}`;
                    document.querySelectorAll('.ratio-option').forEach(o => o.classList.remove('selected'));
                } else if (!light) {
                    document.querySelectorAll('.ratio-option').forEach(o => o.classList.toggle('selected', o.dataset.value === PB.currentAspect));
                }
            } finally { this._syncing = false; }
        },
        setPanoMode(on) {
            const PB = global.PromptBar;
            if (!PB) return;
            if (on && !this.isPanoModel(PB.currentModel)) {
                const m = this._availModels(PANO_MODELS)[0];
                if (PB._selectModelInternal) PB._selectModelInternal(m);
            }
            PB.panoMode = !!on;
            PB.currentAspect = on ? '2:1' : '16:9';
            const CM = global.CanvasMain, CB = global.CanvasBlocks;
            const n = CM && CM._activeNodeId && CB.getById(CM._activeNodeId);
            if (n && n.nodeType === 'gen' && !n.turnaround) {
                n.panorama = !!on;
                n.aspectRatio = PB.currentAspect;
                if (!n.imageUrl && !n.previewUrl) CB.update(n.id, { ratio: on ? 2 : 16 / 9 });
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            }
            if (PB.updateComboLabel) PB.updateComboLabel();
            this._syncBar();
            if (on) toast('已开启 360° 全景模式：比例锁定 2:1', 'ok');
        },

        // ================= 节点：徽标 / 工具栏 / 创建 =================
        nodeClass(b) { return this.hasPanoImage(b) ? ' is-pano' : ''; },
        badgeHtml(b) {
            if (!this.isPano(b)) return '';
            const w = Math.round((b.w || 400) * 1.4);
            const src = esc(sameOrigin(b.mediumUrl || b.previewUrl || b.imageUrl || ''));
            const pan = this.hasPanoImage(b) && src ? `<div class="pano-pan" style="background-image:url('${src}');--pw:${w}px" aria-hidden="true"></div>` : '';
            return `${pan}<span class="pano-badge" title="360° 全景">${IC.p360}<span>360°</span></span>`;
        },
        toolbarHtml(b) {
            if (!b || b.status === 'generating' || b.status === 'loading') return '';
            const T = (act, icon, label, title) => `<button class="node-tool-text" data-action="${act}" title="${esc(title || label)}">${icon.replace('<svg ', '<svg class="tb-ic" ')}<span class="tb-lb">${label}</span></button>`;
            let h = '';
            if (this.hasPanoImage(b)) {
                h += T('pano-view', IC.eye, '全景查看', '在全屏全景查看器中环视');
                h += T('pano-seam', IC.seam, '修复接缝', '检测并修复全景图左右边缘的接缝');
                h += T('pano-shot', IC.camera, '截取机位', '在全景中调整视角并截取为参考图');
                if (b.nodeType === 'ref') h += T('pano-unmark', IC.mark, '取消全景', '取消全景标记');
            } else if (b.nodeType === 'ref' && !b.subType && !b.mediaType && (b.imageUrl || b.previewUrl)) {
                const r = (b._imgW && b._imgH) ? b._imgW / b._imgH : (b.ratio || 1);
                if (Math.abs(r - 2) < 0.08) h += T('pano-mark', IC.mark, '标记为全景', '这张图接近 2:1，可标记为 360° 全景');
            }
            // 图片生成节点 / 普通图片参考节点：新建 360° 全景节点
            const CB = global.CanvasBlocks;
            const isImgGen = b.nodeType === 'gen' && !b.panorama && !b.turnaround && !(CB && CB._genCategoryOf && CB._genCategoryOf(b) === 'video') && b.mediaType !== 'video';
            const isImgRef = b.nodeType === 'ref' && !b.subType && !b.mediaType && !b.isPanorama && (b.imageUrl || b.previewUrl);
            if (isImgGen || isImgRef) h += T('pano-new', IC.p360, '360° 全景', isImgRef ? '以这张图为参考新建 360° 全景节点' : '新建 360° 全景节点（沿用当前提示词与参考素材）');
            if (b.subType === 'character' && b.characterId) h += T('turn-gen', IC.turn, '生成多视角', '生成角色转身设定图 / 8 视角序列');
            if (b.nodeType === 'gen' && b.turnaround && b.status === 'done' && b.imageUrl) h += T('turn-result', IC.save, '存入角色卡', '预览多视角结果并存入角色卡');
            return h;
        },
        onToolAction(action, node, ev) {
            if (!node) return;
            if (action === 'pano-new') return this.createFromNode(node);
            if (action === 'pano-view') return this.openViewer(node.id);
            if (action === 'pano-shot') return this.openViewer(node.id, { focusShots: true });
            if (action === 'pano-seam') return this.seamFlow(node.id);
            if (action === 'pano-mark' || action === 'pano-unmark') {
                global.CanvasBlocks.update(node.id, { isPanorama: action === 'pano-mark' });
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
                toast(action === 'pano-mark' ? '已标记为 360° 全景' : '已取消全景标记', 'ok');
                return;
            }
            if (action === 'turn-gen') return this.turnaroundDialog(node.characterId, { charNodeId: node.id });
            if (action === 'turn-result') return this.openTurnResult(node.id);
        },
        // 参考图上传完成后：接近 2:1 时提示可标记为全景
        maybeSuggest(node, w, h) {
            if (!node || node.nodeType !== 'ref' || node.subType || node.mediaType || node.isPanorama || node._panoHinted) return;
            if (!w || !h || Math.abs(w / h - 2) > 0.04 || w < 1024) return;
            node._panoHinted = true;
            toast('这张图比例接近 2:1，可在工具栏「标记为全景」后 360° 查看', 'info');
        },
        createPanoNode(o) {
            o = o || {};
            const CB = global.CanvasBlocks, PB = global.PromptBar;
            const model = o.model && this.isPanoModel(o.model) ? o.model : this._availModels(PANO_MODELS)[0];
            const sizes = this._sizesOf(model);
            const size = o.size && sizes.indexOf(o.size) !== -1 ? o.size : (sizes.indexOf('2K') !== -1 ? '2K' : sizes[0]);
            let x = o.x, y = o.y;
            if (x == null || y == null) { const c = CB.viewportCenterWorld(); x = c.x - 200; y = c.y - 100; }
            const node = CB.addGen({
                x, y, name: o.name || CB._nextGenName('全景节点'), genCategory: 'image', model, size, aspectRatio: '2:1', ratio: 2,
                prompt: o.prompt || '', panorama: true,
                quality: (PB && PB.modelConfigMap[model] && (PB.modelConfigMap[model].qualityOptions || []).indexOf('medium') !== -1) ? 'medium' : undefined
            });
            const sp = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            CB.update(node.id, { x: sp.x, y: sp.y });
            if (o.select !== false && global.CanvasSelection) { global.CanvasSelection.select(node.id, false); if (global.CanvasMain) global.CanvasMain.onSelectionChange(); }
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            if (o.pan !== false && global.CanvasCore) global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            if (o.focusPrompt) setTimeout(() => { const ip = document.getElementById('promptInput'); if (ip) ip.focus(); }, 80);
            return node;
        },
        // 工具栏「360° 全景」：在源节点右侧新建全景节点；参考图节点连入作参考，生成节点沿用提示词与上游连线
        createFromNode(src) {
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            if (!src || !CB) return;
            const isRef = src.nodeType === 'ref';
            const node = this.createPanoNode({
                x: src.x + src.w + 80, y: src.y,
                prompt: isRef ? '' : (src.prompt || ''),
                select: false, pan: false
            });
            if (CE) {
                if (isRef) CE.add(src.id, node.id);
                else CE.edges.filter(e => e.to === src.id).forEach(e => CE.add(e.from, node.id));
            }
            if (global.CanvasSelection) { global.CanvasSelection.select(node.id, false); if (global.CanvasMain) global.CanvasMain.onSelectionChange(); }
            if (global.CanvasMain && global.CanvasMain._ensureVisible) global.CanvasMain._ensureVisible(node);
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            setTimeout(() => { const ip = document.getElementById('promptInput'); if (ip) ip.focus(); }, 80);
            toast('已新建 360° 全景节点：仅可使用 GPT Image 全景模型，比例锁定 2:1', 'ok');
            return node;
        },
        _buildDockBtn() {
            const dock = document.getElementById('toolDock');
            if (!dock || document.getElementById('panoDockBtn')) return;
            const after = dock.querySelector('[data-add="upload"]');
            const b = document.createElement('button');
            b.className = 'capsule-btn';
            b.id = 'panoDockBtn';
            b.dataset.tip = '360 全景';
            b.innerHTML = IC.p360;
            if (after) after.insertAdjacentElement('afterend', b); else dock.appendChild(b);
            b.addEventListener('click', (e) => { e.stopPropagation(); this.createPanoNode({ focusPrompt: true }); });
            // 提示气泡（与工具坞其它按钮一致）
            const tipEl = document.querySelector('.px-ctip');
            if (tipEl) {
                b.addEventListener('mouseenter', () => {
                    tipEl.innerHTML = `<span>${esc(b.dataset.tip)}</span>`;
                    tipEl.classList.remove('hidden');
                    const r = b.getBoundingClientRect();
                    tipEl.style.left = (r.right + 10) + 'px';
                    tipEl.style.top = (r.top + r.height / 2 - tipEl.offsetHeight / 2) + 'px';
                });
                b.addEventListener('mouseleave', () => tipEl.classList.add('hidden'));
            }
        },

        // ================= 通用弹窗 =================
        _modal(opts) {
            const m = document.createElement('div');
            m.className = 'pv-modal-mask';
            m.innerHTML = `<div class="pv-modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
                <div class="pv-modal-h"><span class="pv-modal-ic">${opts.icon || IC.pano}</span><span class="pv-modal-t">${esc(opts.title)}</span><button type="button" class="pv-ibtn" data-m="x" title="关闭">${IC.x}</button></div>
                <div class="pv-modal-b"></div><div class="pv-modal-f"></div></div>`;
            document.body.appendChild(m);
            ['mousedown', 'wheel', 'keydown', 'keyup', 'contextmenu', 'paste', 'copy'].forEach(t => m.addEventListener(t, e => e.stopPropagation()));
            const ctl = {
                el: m, body: m.querySelector('.pv-modal-b'), foot: m.querySelector('.pv-modal-f'),
                close: () => { if (m.parentNode) m.parentNode.removeChild(m); if (opts.onClose) opts.onClose(); if (this._modalCtl === ctl) this._modalCtl = null; }
            };
            m.addEventListener('click', (e) => {
                if (e.target === m || e.target.closest('[data-m="x"]')) ctl.close();
            });
            this._modalCtl = ctl;
            return ctl;
        },

        // ================= 接缝：检测 / 确认 / 修复 / 写回 =================
        async seamFlow(nodeId) {
            const CB = global.CanvasBlocks;
            const node = CB.getById(nodeId);
            if (!this.hasPanoImage(node)) return;
            const url = sameOrigin(stripProc(node.imageUrl || node.previewUrl));
            const md = this._modal({ title: '修复全景接缝', icon: IC.seam, wide: true });
            md.body.innerHTML = `<div class="pv-loading-row"><span class="pv-spin"></span><span>正在检测接缝…</span></div>`;
            let chk;
            try { chk = await api('/api/panorama/seam-check', { imageUrl: url }); }
            catch (e) { md.body.innerHTML = `<div class="pv-err">${IC.warn}<span>${esc(e.message || '检测失败')}</span></div>`; return; }
            if (!md.el.parentNode) return;
            const models = this._availModels(['Nano Banana 2.0 快速', 'Nano Banana 2.1', 'Nano Banana Pro', 'GPT Image 2.5 Pro']);
            const st = { model: models[0], mode: chk.needFix ? 'ai' : 'blend' };
            const sizeOf = (m) => (/Nano Banana 2\.0 快速/.test(m) ? '1K' : (chk.height > 1600 ? '2K' : '1K'));
            const price = () => st.mode === 'blend' ? 0 : this.priceOf(st.model, sizeOf(st.model));
            const lvl = chk.score >= 50 ? 'bad' : (chk.needFix ? 'warn' : 'ok');
            const render = () => {
                md.body.innerHTML = `
                    <div class="pv-seam-top">
                        <div class="pv-seam-prev" style="background-image:url('${esc(withProc(url, 'image/resize,w_1600'))}')"><i class="pv-seam-line"></i><span class="pv-seam-cap">接缝处（左右边缘拼合）</span></div>
                        <div class="pv-seam-score ${lvl}">
                            <div class="pv-score-ring" style="--p:${chk.score}"><b class="num">${chk.score}</b></div>
                            <div class="pv-score-txt"><b>${chk.needFix ? '检测到明显接缝' : '接缝不明显'}</b><span>接缝分数 0-100，越低越好；≥ ${chk.threshold} 建议修复</span><span class="pv-dim num">${chk.width}×${chk.height}</span></div>
                        </div>
                    </div>
                    <div class="pv-opts">
                        <label class="pv-opt${st.mode === 'ai' ? ' on' : ''}"><input type="radio" name="pvm" value="ai"${st.mode === 'ai' ? ' checked' : ''}>
                            <span class="pv-opt-ic">${IC.spark}</span><span class="pv-opt-main"><b>AI 修复接缝</b><span>平移半宽把接缝移到中央，只重绘中央竖条并羽化贴回，其余像素保持不变</span>
                            <span class="pv-opt-row"><select class="pv-select" data-f="model">${models.map(m => `<option value="${esc(m)}"${m === st.model ? ' selected' : ''}>${esc(this._modelName(m))}</option>`).join('')}</select><span class="pv-price">${IC.coin}<b class="num">${fmt(this.priceOf(st.model, sizeOf(st.model)))}</b><span>积分</span></span></span></span></label>
                        <label class="pv-opt${st.mode === 'blend' ? ' on' : ''}"><input type="radio" name="pvm" value="blend"${st.mode === 'blend' ? ' checked' : ''}>
                            <span class="pv-opt-ic">${IC.seam}</span><span class="pv-opt-main"><b>快速柔化</b><span>免费，只做接缝两侧的色彩过渡，不改变画面内容（适合轻微色差）</span></span></label>
                    </div>
                    <div class="pv-note">修复结果会作为该节点的新版本，可在生成记录中随时切换回原图</div>`;
                const p = price();
                md.foot.innerHTML = `<button type="button" class="pv-btn ghost" data-m="x">取消</button>
                    <button type="button" class="pv-btn primary" data-a="go">${IC.check}<span>确认修复</span>${p ? `<span class="pv-btn-price num">${fmt(p)}</span><span>积分</span>` : '<span class="pv-btn-free">免费</span>'}</button>`;
            };
            render();
            md.el.addEventListener('change', (e) => {
                if (e.target.name === 'pvm') st.mode = e.target.value;
                if (e.target.dataset.f === 'model') st.model = e.target.value;
                render();
            });
            md.foot.addEventListener('click', async (e) => {
                const go = e.target.closest('[data-a="go"]');
                if (!go || go.disabled) return;
                go.disabled = true;
                await this._runSeamFix(md, node.id, url, st.mode === 'blend' ? { mode: 'blend' } : { model: st.model });
            });
        },
        async _runSeamFix(md, nodeId, url, body) {
            md.body.innerHTML = `<div class="pv-progress"><span class="pv-spin lg"></span><b>${body.mode === 'blend' ? '正在柔化接缝…' : '正在用 AI 修复接缝…'}</b><span class="pv-dim">${body.mode === 'blend' ? '' : '通常需要 20-90 秒，可关闭窗口，完成后自动写回节点'}</span></div>`;
            md.foot.innerHTML = '';
            const node0 = global.CanvasBlocks.getById(nodeId);
            if (node0 && node0.nodeType === 'gen') global.CanvasBlocks.update(nodeId, { panoFixing: true });
            let res;
            try {
                const st = await api('/api/panorama/seam-fix', Object.assign({ imageUrl: url }, body));
                if (st.done) res = st;
                else {
                    if (global.CanvasMain && global.CanvasMain._loadCredits) global.CanvasMain._loadCredits();
                    const t0 = Date.now();
                    while (!res) {
                        await new Promise(r => setTimeout(r, Date.now() - t0 < 20000 ? 2500 : 4000));
                        if (Date.now() - t0 > 8 * 60 * 1000) throw new Error('修复超时，请稍后在生成记录中查看');
                        const f = await api('/api/panorama/seam-finalize', { jobId: st.jobId });
                        if (!f.pending) res = f;
                    }
                }
            } catch (e) {
                const n = global.CanvasBlocks.getById(nodeId);
                if (n && n.panoFixing) global.CanvasBlocks.update(nodeId, { panoFixing: false });
                if (global.CanvasMain && global.CanvasMain._loadCredits) global.CanvasMain._loadCredits();
                if (md.el.parentNode) {
                    md.body.innerHTML = `<div class="pv-err">${IC.warn}<span>${esc(e.message || '修复失败')}</span></div>`;
                    md.foot.innerHTML = `<button type="button" class="pv-btn" data-m="x">关闭</button>`;
                } else toast('接缝修复失败：' + (e.message || ''), 'warn');
                return;
            }
            const newId = this._applySeamResult(nodeId, res);
            if (!md.el.parentNode) { toast('接缝已修复，分数 ' + res.scoreBefore + ' → ' + res.scoreAfter, 'ok'); return; }
            const big = (u) => esc(withProc(sameOrigin(u), 'image/resize,w_1600'));
            md.body.innerHTML = `<div class="pv-ba">
                    <div class="pv-ba-it"><div class="pv-seam-prev" style="background-image:url('${big(url)}')"><i class="pv-seam-line"></i></div><div class="pv-ba-cap"><span>修复前</span><b class="num">${res.scoreBefore}</b></div></div>
                    <div class="pv-ba-it"><div class="pv-seam-prev" style="background-image:url('${big(res.url)}')"><i class="pv-seam-line"></i></div><div class="pv-ba-cap ok"><span>修复后</span><b class="num">${res.scoreAfter}</b></div></div>
                </div><div class="pv-note">${IC.check}<span>已写回节点（新版本）。图片尺寸 ${res.width}×${res.height} 保持不变</span></div>`;
            md.foot.innerHTML = `<button type="button" class="pv-btn" data-m="x">完成</button><button type="button" class="pv-btn primary" data-a="view">${IC.eye}<span>在查看器中检查</span></button>`;
            md.foot.querySelector('[data-a="view"]').addEventListener('click', () => { md.close(); this.openViewer(newId, { seamGuide: true }); });
            if (global.CanvasMain && global.CanvasMain._loadCredits) global.CanvasMain._loadCredits();
        },
        _applySeamResult(nodeId, res) {
            const CB = global.CanvasBlocks, GH = global.GenHistory;
            const n = CB.getById(nodeId);
            if (!n) return nodeId;
            const media = { imageUrl: res.url, previewUrl: withProc(res.url, 'image/resize,l_150,m_lfit'), mediumUrl: withProc(res.url, 'image/resize,l_800,m_lfit') };
            if (n.nodeType === 'gen') {
                if (GH) GH._ensure(n);
                n.genParams = GH ? GH._snapParams(n) : null;
                CB.update(n.id, Object.assign({ status: 'done', panoFixing: false, seamScore: res.scoreAfter }, media));
                if (GH) GH.record(n.id);
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.saveNow();
                return n.id;
            }
            const nn = CB.addRef(Object.assign({ x: n.x + n.w + 60, y: n.y, name: (n.name || '全景') + ' · 修缝', isPanorama: true, ratio: n.ratio || 2, status: 'idle', seamScore: res.scoreAfter }, media));
            const sp = CB._findFreeSpot(nn.x, nn.y, nn.w, nn.h, nn.id);
            CB.update(nn.id, { x: sp.x, y: sp.y });
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.saveNow();
            return nn.id;
        },

        // ================= 全景查看器 =================
        async openViewer(nodeId, opts) {
            opts = opts || {};
            const CB = global.CanvasBlocks;
            const node = CB.getById(nodeId);
            if (!this.hasPanoImage(node)) { toast('该节点还没有全景图', 'warn'); return false; }
            this.closeViewer();
            const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            const target = sel.map(id => CB.getById(id)).find(b => b && b.nodeType === 'gen' && b.id !== nodeId && !b.panorama) || null;
            let src = sameOrigin(stripProc(node.imageUrl || node.previewUrl));
            const W = node._imgW || 0;
            if (W > 4096) src = withProc(src, 'image/resize,w_4096');
            const v = this._v = {
                nodeId, src, target: target ? target.id : '', ratio: '16:9', res: '2K', auto: false, guide: !!opts.seamGuide,
                shots: (node.panoShots || []).slice(), sel: '', webgl: hasWebGL(), sceneId: opts.sceneId || ''
            };
            const el = document.createElement('div');
            el.className = 'pv-overlay';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', '全景查看器');
            el.innerHTML = `
                <div class="pv-stage"><div class="pv-pano" id="pvPano"></div><svg class="pv-guide-svg" aria-hidden="true"><polyline points=""/></svg><div class="pv-frame"><i></i><i></i><i></i><i></i><span class="pv-frame-lb num"></span></div>
                    <div class="pv-loading"><span class="pv-spin lg"></span><span>正在加载全景…</span></div></div>
                <div class="pv-top">
                    <div class="pv-top-l"><span class="pv-brand">${IC.p360}</span><span class="pv-title px-no-i18n">${esc(node.name || '全景')}</span><span class="pv-chip num">2:1</span></div>
                    <div class="pv-read num" aria-live="off"><span><i>水平</i><b data-r="yaw">0°</b></span><span><i>俯仰</i><b data-r="pitch">0°</b></span><span><i>视角</i><b data-r="hfov">100°</b></span></div>
                    <div class="pv-top-r">
                        <button type="button" class="pv-tbtn" data-a="auto" aria-pressed="false" title="自动旋转">${IC.rotate}<span>自动旋转</span></button>
                        <button type="button" class="pv-tbtn" data-a="guide" aria-pressed="false" title="显示接缝辅助线并转到接缝处（水平 180°）">${IC.seam}<span>接缝辅助线</span></button>
                        <button type="button" class="pv-tbtn" data-a="reset" title="重置视角">${IC.reset}<span>重置</span></button>
                        <button type="button" class="pv-tbtn" data-a="fix" title="修复接缝">${IC.spark}<span>修复接缝</span></button>
                        ${global.CanvasStage3D ? `<button type="button" class="pv-tbtn" data-a="stage3d" title="在 3D 片场中使用此全景（作为背景摆人偶、设机位）">${global.CanvasStage3D.IC.stage}<span>3D 片场</span></button>` : ''}
                        <button type="button" class="pv-tbtn icon" data-a="dl" title="下载">${IC.dl}</button>
                        <button type="button" class="pv-tbtn icon" data-a="fs" title="全屏">${IC.full}</button>
                        <button type="button" class="pv-tbtn icon close" data-a="close" title="关闭（Esc）">${IC.x}</button>
                    </div>
                </div>
                <div class="pv-compass" title="方向"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><g class="pv-ticks"></g><g class="pv-needle"><path d="M32 6 37 32H27z"/><path d="M32 58 27 32h10z" class="s"/></g><circle cx="32" cy="32" r="3"/></svg><span class="num">N</span></div>
                <div class="pv-bar">
                    <div class="pv-bar-l">
                        <div class="pv-bar-head"><span class="pv-bar-ic">${IC.camera}</span><b>机位</b><span class="pv-dim">截取当前视角，作为镜头的场景参考图</span></div>
                        <div class="pv-bar-ctl">
                            <div class="pv-seg" data-g="ratio">${SHOT_RATIOS.map(r => `<button type="button" data-v="${r}" class="${r === v.ratio ? 'on' : ''}">${r}</button>`).join('')}</div>
                            <div class="pv-seg" data-g="res"><button type="button" data-v="1K">1K</button><button type="button" data-v="2K" class="on">2K</button></div>
                            <button type="button" class="pv-btn primary" data-a="shot">${IC.camera}<span>截取当前视角</span></button>
                        </div>
                    </div>
                    <div class="pv-shots"></div>
                    <div class="pv-bar-r"></div>
                </div>
                <div class="pv-fallback hidden"><div class="pv-flat"><img alt="" draggable="false"></div><div class="pv-fb-tip">${IC.warn}<span>当前浏览器不支持 WebGL，已切换为平面预览（左右拖动查看）</span></div></div>`;
            document.body.appendChild(el);
            v.el = el;
            ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'paste', 'copy', 'touchstart', 'pointerdown'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
            el.addEventListener('click', (e) => this._onViewerClick(e));
            el.addEventListener('dblclick', (e) => { const n = e.target.closest('.pv-shot-name'); if (n) this._renameShot(n.closest('.pv-shot').dataset.id); });
            this._buildTicks();
            this._renderShots();
            this._renderBarRight();
            document.body.classList.add('pv-open');
            requestAnimationFrame(() => el.classList.add('in'));
            if (!v.webgl) { this._startFallback(); return true; }
            try {
                const P = await loadVendor();
                if (this._v !== v) return false;
                v.viewer = P.viewer(el.querySelector('#pvPano'), {
                    type: 'equirectangular', panorama: src, autoLoad: true, crossOrigin: 'anonymous',
                    showControls: false, showZoomCtrl: false, showFullscreenCtrl: false, keyboardZoom: false, disableKeyboardCtrl: true,
                    mouseZoom: true, draggable: true, friction: 0.15, hfov: 100, minHfov: 30, maxHfov: 120, yaw: 0, pitch: 0,
                    compass: false, autoRotate: 0, showLoadingText: false, strings: { loadingLabel: '', loadButtonLabel: '' }
                });
                v.viewer.on('load', () => {
                    if (this._v !== v) return;
                    el.classList.add('loaded');
                    v.loaded = true;
                    if (v.guide) this._setGuide(true);
                    if (opts.focusShots) { const b = el.querySelector('[data-a="shot"]'); if (b) b.focus(); }
                });
                v.viewer.on('error', (msg) => {
                    if (this._v !== v) return;
                    console.warn('[全景] 渲染失败:', msg);
                    this._startFallback(String(msg || ''));
                });
            } catch (e) {
                this._startFallback(e.message);
            }
            const tick = () => {
                if (this._v !== v) return;
                this._updateHud();
                v.raf = requestAnimationFrame(tick);
            };
            v.raf = requestAnimationFrame(tick);
            v.onResize = () => this._layoutFrame();
            window.addEventListener('resize', v.onResize);
            this._layoutFrame();
            return true;
        },
        closeViewer() {
            const v = this._v;
            if (!v) return;
            this._v = null;
            cancelAnimationFrame(v.raf);
            window.removeEventListener('resize', v.onResize);
            try { if (v.viewer) v.viewer.destroy(); } catch (_) { /* 忽略 */ }
            if (document.fullscreenElement && v.el.contains(document.fullscreenElement)) { try { document.exitFullscreen(); } catch (_) { /* 忽略 */ } }
            if (v.el && v.el.parentNode) v.el.parentNode.removeChild(v.el);
            document.body.classList.remove('pv-open');
        },
        isViewerOpen() { return !!this._v; },
        // 视角：WebGL 用 Pannellum；平面降级时由滚动位置推算（俯仰 0、视角 90°）
        getView() {
            const v = this._v;
            if (!v) return null;
            if (v.viewer && v.loaded && !v.flat) return { yaw: v.viewer.getYaw(), pitch: v.viewer.getPitch(), hfov: v.viewer.getHfov() };
            if (v.flat) {
                const f = v.el.querySelector('.pv-flat');
                const img = f.querySelector('img');
                const tw = img.offsetWidth || 1;
                const cx = (f.scrollLeft + f.clientWidth / 2) % tw;
                return { yaw: (cx / tw - 0.5) * 360, pitch: 0, hfov: Math.min(120, 360 * f.clientWidth / tw) };
            }
            return { yaw: 0, pitch: 0, hfov: 100 };
        },
        _startFallback(why) {
            const v = this._v;
            if (!v || v.flat) return;
            v.flat = true;
            try { if (v.viewer) v.viewer.destroy(); } catch (_) { /* 忽略 */ }
            v.viewer = null;
            const el = v.el;
            el.classList.add('flat', 'loaded');
            const fb = el.querySelector('.pv-fallback');
            fb.classList.remove('hidden');
            if (why && !/webgl/i.test(why)) fb.querySelector('.pv-fb-tip span').textContent = '全景渲染失败，已切换为平面预览（左右拖动查看）';
            const f = fb.querySelector('.pv-flat');
            const img = f.querySelector('img');
            img.src = v.src;
            // 横向无缝循环：复制一份拼在右侧
            const img2 = img.cloneNode();
            img2.src = v.src;
            f.appendChild(img2);
            img.onload = () => { f.scrollLeft = img.offsetWidth / 2 - f.clientWidth / 2; };
            let drag = null;
            f.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, s: f.scrollLeft }; f.setPointerCapture(e.pointerId); });
            f.addEventListener('pointermove', (e) => {
                if (!drag) return;
                let s = drag.s - (e.clientX - drag.x);
                const tw = img.offsetWidth;
                if (tw) { while (s < 0) { s += tw; drag.s += tw; } while (s > tw) { s -= tw; drag.s -= tw; } }
                f.scrollLeft = s;
            });
            const end = () => { drag = null; };
            f.addEventListener('pointerup', end);
            f.addEventListener('pointercancel', end);
            ['auto', 'guide', 'fs'].forEach(a => { const b = el.querySelector(`[data-a="${a}"]`); if (b) b.disabled = true; });
            this._layoutFrame();
        },
        _buildTicks() {
            const g = this._v.el.querySelector('.pv-ticks');
            let h = '';
            for (let i = 0; i < 36; i++) {
                const a = i * 10 * Math.PI / 180, r1 = i % 9 === 0 ? 22 : 25.5, r0 = 28;
                h += `<line x1="${32 + Math.sin(a) * r1}" y1="${32 - Math.cos(a) * r1}" x2="${32 + Math.sin(a) * r0}" y2="${32 - Math.cos(a) * r0}" class="${i % 9 === 0 ? 'm' : ''}"/>`;
            }
            g.innerHTML = h;
        },
        _updateHud() {
            const v = this._v;
            const vw = this.getView();
            if (!vw) return;
            const key = vw.yaw.toFixed(1) + '|' + vw.pitch.toFixed(1) + '|' + vw.hfov.toFixed(1);
            if (key === v._hudKey) return;
            v._hudKey = key;
            let y = ((vw.yaw % 360) + 540) % 360 - 180;
            const set = (k, t) => { const b = v.el.querySelector(`[data-r="${k}"]`); if (b) b.textContent = t; };
            set('yaw', Math.round(y) + '°');
            set('pitch', Math.round(vw.pitch) + '°');
            set('hfov', Math.round(vw.hfov) + '°');
            const nd = v.el.querySelector('.pv-needle');
            if (nd) nd.setAttribute('transform', `rotate(${-y} 32 32)`);
            if (v.guide) this._drawGuide(vw);
        },
        // 以当前视角把 yaw=180°（接缝）经线投影到屏幕
        _drawGuide(vw) {
            const v = this._v;
            const svgEl = v.el.querySelector('.pv-guide-svg');
            const st = v.el.querySelector('.pv-stage');
            const W = st.clientWidth, H = st.clientHeight;
            svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
            const f = (W / 2) / Math.tan(vw.hfov * Math.PI / 360);
            const yw = vw.yaw * Math.PI / 180, pt = vw.pitch * Math.PI / 180;
            const pts = [];
            for (let lat = -88; lat <= 88; lat += 2) {
                const la = lat * Math.PI / 180, lo = Math.PI;
                const x2 = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z2 = Math.cos(la) * Math.cos(lo);
                const x1 = x2 * Math.cos(yw) - z2 * Math.sin(yw), z1 = x2 * Math.sin(yw) + z2 * Math.cos(yw);
                const yc = y * Math.cos(pt) - z1 * Math.sin(pt), zc = y * Math.sin(pt) + z1 * Math.cos(pt);
                if (zc <= 0.02) continue;
                pts.push((W / 2 + x1 / zc * f).toFixed(1) + ',' + (H / 2 - yc / zc * f).toFixed(1));
            }
            svgEl.querySelector('polyline').setAttribute('points', pts.join(' '));
        },
        _setGuide(on) {
            const v = this._v;
            v.guide = !!on;
            v.el.classList.toggle('guide-on', v.guide);
            const b = v.el.querySelector('[data-a="guide"]');
            if (b) { b.classList.toggle('on', v.guide); b.setAttribute('aria-pressed', v.guide ? 'true' : 'false'); }
            v._hudKey = '';
            if (v.guide && v.viewer && v.loaded) {
                if (v.auto) this._setAuto(false);
                v.viewer.lookAt(0, 180, 90, reduceMotion() ? false : 900);
            }
        },
        _setAuto(on) {
            const v = this._v;
            if (!v.viewer || !v.loaded) return;
            v.auto = !!on;
            if (v.auto) v.viewer.startAutoRotate(reduceMotion() ? -2 : -6); else v.viewer.stopAutoRotate();
            const b = v.el.querySelector('[data-a="auto"]');
            if (b) { b.classList.toggle('on', v.auto); b.setAttribute('aria-pressed', v.auto ? 'true' : 'false'); }
        },
        _layoutFrame() {
            const v = this._v;
            if (!v) return;
            const st = v.el.querySelector('.pv-stage');
            const fr = v.el.querySelector('.pv-frame');
            const W = st.clientWidth, H = st.clientHeight;
            const [a, b] = v.ratio.split(':').map(Number);
            const A = a / b;
            const maxW = W * 0.86, maxH = (H - 260) * 0.9 > 120 ? (H - 260) * 0.95 : H * 0.6;
            let fw = maxW, fh = fw / A;
            if (fh > maxH) { fh = maxH; fw = fh * A; }
            const top = Math.max(70, (H - 190 - fh) / 2 + 40);
            v.frame = { x: (W - fw) / 2, y: top, w: fw, h: fh, W, H };
            Object.assign(fr.style, { left: v.frame.x + 'px', top: v.frame.y + 'px', width: fw + 'px', height: fh + 'px' });
            fr.querySelector('.pv-frame-lb').textContent = v.ratio + ' · ' + v.res;
        },
        _onViewerClick(e) {
            const v = this._v;
            if (!v) return;
            const seg = e.target.closest('.pv-seg button');
            if (seg) {
                const g = seg.parentNode.dataset.g;
                seg.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === seg));
                v[g] = seg.dataset.v;
                this._layoutFrame();
                return;
            }
            const shot = e.target.closest('.pv-shot');
            const b = e.target.closest('[data-a]');
            const a = b && b.dataset.a;
            if (a === 'close') return this.closeViewer();
            if (a === 'auto') return this._setAuto(!v.auto);
            if (a === 'guide') return this._setGuide(!v.guide);
            if (a === 'reset') { if (v.auto) this._setAuto(false); if (v.viewer && v.loaded) v.viewer.lookAt(0, 0, 100, reduceMotion() ? false : 700); else if (v.flat) { const f = v.el.querySelector('.pv-flat'); const im = f.querySelector('img'); f.scrollLeft = im.offsetWidth / 2 - f.clientWidth / 2; } return; }
            if (a === 'fs') { if (v.viewer && v.loaded) { if (document.fullscreenElement) document.exitFullscreen(); else v.el.requestFullscreen && v.el.requestFullscreen().catch(() => {}); } return; }
            if (a === 'dl') { const n = global.CanvasBlocks.getById(v.nodeId); if (n && global.pxDownload) global.pxDownload(n.imageUrl, (n.name || 'panorama') + '_360'); return; }
            if (a === 'fix') { const id = v.nodeId; this.closeViewer(); this.seamFlow(id); return; }
            if (a === 'stage3d') { const id = v.nodeId; this.closeViewer(); if (global.CanvasStage3D) global.CanvasStage3D.createFromPano(id); return; }
            if (a === 'shot') return this.captureShot();
            if (a === 'shot-del' && shot) return this._delShot(shot.dataset.id);
            if (a === 'shot-ren' && shot) return this._renameShot(shot.dataset.id);
            if (a === 'shot-go' && shot) { const s = v.shots.find(x => x.id === shot.dataset.id); if (s && v.viewer && v.loaded) v.viewer.lookAt(s.pitch, s.yaw, s.hfov, reduceMotion() ? false : 700); v.sel = shot.dataset.id; this._renderShots(); this._renderBarRight(); return; }
            if (a === 'place') return this.placeShot(v.sel);
            if (a === 'scene-set') return this._setSceneRef(v.sel, b.dataset.sid);
            if (shot && !a) { v.sel = shot.dataset.id; this._renderShots(); this._renderBarRight(); }
        },
        _onKey(e) {
            if (this._modalCtl && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this._modalCtl.close(); return; }
            if (this._seq) return this._seqKey(e);
            const v = this._v;
            if (!v) return;
            const t = e.target;
            const typing = t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable);
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); if (document.fullscreenElement) return; this.closeViewer(); return; }
            if (typing) return;
            const vw = this.getView();
            if (!vw || !v.viewer || !v.loaded) return;
            const step = e.shiftKey ? 20 : 6;
            let { yaw, pitch, hfov } = vw;
            if (e.key === 'ArrowLeft') yaw -= step;
            else if (e.key === 'ArrowRight') yaw += step;
            else if (e.key === 'ArrowUp') pitch += step;
            else if (e.key === 'ArrowDown') pitch -= step;
            else if (e.key === '+' || e.key === '=') hfov -= 8;
            else if (e.key === '-' || e.key === '_') hfov += 8;
            else return;
            e.preventDefault();
            if (v.auto) this._setAuto(false);
            v.viewer.lookAt(clamp(pitch, -85, 85), yaw, clamp(hfov, 30, 120), false);
        },

        // ---------- 机位截取：等距柱状 → 透视（与 Pannellum 相同的直线透视），按取景框所见即所得 ----------
        async _srcPixels() {
            const v = this._v;
            if (v.pix) return v.pix;
            const im = await loadImg(v.src);
            let w = im.naturalWidth, h = im.naturalHeight;
            const k = Math.min(1, 4096 / w);
            w = Math.round(w * k); h = Math.round(h * k);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(im, 0, 0, w, h);
            v.pix = { w, h, data: g.getImageData(0, 0, w, h).data };
            return v.pix;
        },
        renderView(pix, view, frame, outW, outH) {
            const out = new ImageData(outW, outH);
            const o = out.data, d = pix.data, Ws = pix.w, Hs = pix.h;
            const f = (frame.W / 2) / Math.tan(view.hfov * Math.PI / 360);
            const cy = Math.cos(view.yaw * Math.PI / 180), sy = Math.sin(view.yaw * Math.PI / 180);
            const cp = Math.cos(view.pitch * Math.PI / 180), sp = Math.sin(view.pitch * Math.PI / 180);
            // 取景框在舞台中的位置 → 相对舞台中心的偏移
            const ox = frame.x + frame.w / 2 - frame.W / 2, oy = frame.y + frame.h / 2 - frame.H / 2;
            const PI2 = Math.PI * 2;
            for (let j = 0; j < outH; j++) {
                const sY = -(oy + ((j + 0.5) / outH - 0.5) * frame.h);
                for (let i = 0; i < outW; i++) {
                    const sX = ox + ((i + 0.5) / outW - 0.5) * frame.w;
                    const y1 = sY * cp + f * sp, z1 = -sY * sp + f * cp;
                    const x2 = sX * cy + z1 * sy, z2 = -sX * sy + z1 * cy;
                    const lon = Math.atan2(x2, z2), lat = Math.atan2(y1, Math.sqrt(x2 * x2 + z2 * z2));
                    let u = (lon / PI2 + 0.5) * Ws - 0.5, vv = (0.5 - lat / Math.PI) * Hs - 0.5;
                    if (vv < 0) vv = 0; else if (vv > Hs - 1) vv = Hs - 1;
                    u = ((u % Ws) + Ws) % Ws;
                    const x0 = Math.floor(u), y0 = Math.floor(vv);
                    const x1 = (x0 + 1) % Ws, yb = Math.min(Hs - 1, y0 + 1);
                    const fx = u - x0, fy = vv - y0;
                    const a = (y0 * Ws + x0) * 4, b = (y0 * Ws + x1) * 4, c = (yb * Ws + x0) * 4, e = (yb * Ws + x1) * 4;
                    const q = (j * outW + i) * 4;
                    for (let k = 0; k < 3; k++) {
                        const top = d[a + k] + (d[b + k] - d[a + k]) * fx, bot = d[c + k] + (d[e + k] - d[c + k]) * fx;
                        o[q + k] = top + (bot - top) * fy;
                    }
                    o[q + 3] = 255;
                }
            }
            return out;
        },
        _outSize(ratio, res) {
            const [a, b] = ratio.split(':').map(Number);
            const L = res === '1K' ? 1024 : 2048;
            let w, h;
            if (a >= b) { w = L; h = Math.round(L * b / a); } else { h = L; w = Math.round(L * a / b); }
            return { w: w - (w % 2), h: h - (h % 2) };
        },
        async captureShot() {
            const v = this._v;
            if (!v || v._capturing) return;
            if (!v.flat && !(v.viewer && v.loaded)) { toast('全景还在加载，请稍候', 'warn'); return; }
            const btn = v.el.querySelector('[data-a="shot"]');
            v._capturing = true;
            if (btn) btn.classList.add('loading');
            try {
                const view = this.getView();
                this._layoutFrame();
                const pix = await this._srcPixels();
                const { w, h } = this._outSize(v.ratio, v.res);
                const img = this.renderView(pix, view, v.frame, w, h);
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').putImageData(img, 0, 0);
                this._lastCapture = { w, h, ratio: v.ratio, res: v.res, view };
                const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
                const thumb = c.toDataURL('image/jpeg', 0.7);
                const shot = { id: rid('ps_'), name: (isEn() ? 'Shot ' : '机位 ') + (v.shots.length + 1), yaw: +view.yaw.toFixed(2), pitch: +view.pitch.toFixed(2), hfov: +view.hfov.toFixed(2), ratio: v.ratio, res: v.res, w, h, url: '', previewUrl: '', _thumb: thumb, uploading: true };
                v.shots.push(shot);
                v.sel = shot.id;
                this._renderShots();
                this._renderBarRight();
                const file = new File([blob], 'pano_shot.jpg', { type: 'image/jpeg' });
                try {
                    const r = await global.CanvasGenerate.uploadRef(file);
                    shot.url = r.highUrl; shot.previewUrl = r.mediumUrl || r.previewUrl || r.highUrl;
                } catch (e) {
                    v.shots = v.shots.filter(x => x !== shot);
                    toast('机位上传失败：' + (e.message || ''), 'warn');
                }
                shot.uploading = false;
                this._saveShots();
                if (this._v === v) { this._renderShots(); this._renderBarRight(); }
            } catch (e) {
                toast('截取失败：' + (e.message || ''), 'warn');
            } finally {
                v._capturing = false;
                if (btn) btn.classList.remove('loading');
            }
        },
        _saveShots() {
            const v = this._v;
            if (!v) return;
            const n = global.CanvasBlocks.getById(v.nodeId);
            if (!n) return;
            n.panoShots = v.shots.filter(s => s.url).map(s => ({ id: s.id, name: s.name, yaw: s.yaw, pitch: s.pitch, hfov: s.hfov, ratio: s.ratio, res: s.res, w: s.w, h: s.h, url: s.url, previewUrl: s.previewUrl, nodeId: s.nodeId || '' })).slice(-24);
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },
        _renderShots() {
            const v = this._v;
            const box = v.el.querySelector('.pv-shots');
            if (!v.shots.length) { box.innerHTML = `<div class="pv-shots-empty">${IC.camera}<span>调整视角后点「截取当前视角」，机位会出现在这里</span></div>`; return; }
            box.innerHTML = v.shots.map(s => `<div class="pv-shot${s.id === v.sel ? ' on' : ''}${s.uploading ? ' busy' : ''}" data-id="${esc(s.id)}" title="${esc(s.name)} · ${esc(s.ratio)}">
                <div class="pv-shot-img"><img src="${esc(s._thumb || sameOrigin(s.previewUrl || s.url))}" alt="" draggable="false">${s.uploading ? '<span class="pv-spin"></span>' : ''}${s.nodeId && global.CanvasBlocks.getById(s.nodeId) ? `<span class="pv-shot-on" title="已放到画布">${IC.check}</span>` : ''}</div>
                <div class="pv-shot-meta"><span class="pv-shot-name px-no-i18n">${esc(s.name)}</span><span class="pv-dim num">${esc(s.ratio)}</span></div>
                <div class="pv-shot-ops"><button type="button" data-a="shot-go" title="转到该视角">${IC.eye}</button><button type="button" data-a="shot-ren" title="重命名">${IC.edit}</button><button type="button" data-a="shot-del" title="删除">${IC.trash}</button></div></div>`).join('');
            const on = box.querySelector('.pv-shot.on');
            if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        },
        _renderBarRight() {
            const v = this._v;
            const box = v.el.querySelector('.pv-bar-r');
            const s = v.shots.find(x => x.id === v.sel);
            const tgt = v.target && global.CanvasBlocks.getById(v.target);
            const D = global.CanvasDirector;
            const scenes = (D && D.d && Array.isArray(D.d.scenes)) ? D.d.scenes : [];
            const dis = !s || s.uploading || !s.url ? ' disabled' : '';
            box.innerHTML = `
                ${tgt ? `<label class="pv-check"><input type="checkbox" data-f="link" checked><span class="pv-switch"></span><span>同时连到</span><b class="px-no-i18n">${esc(tgt.name || '')}</b></label>` : ''}
                <button type="button" class="pv-btn primary" data-a="place"${dis}>${IC.place}<span>放到画布</span></button>
                ${scenes.length ? `<div class="pv-dd"><button type="button" class="pv-btn" data-a="scene-menu"${dis}>${IC.clap}<span>设为场景参考图</span></button>
                    <div class="pv-dd-menu">${scenes.map((sc, i) => `<button type="button" data-a="scene-set" data-sid="${esc(sc.id)}"><span class="num">${i + 1}.</span><span class="px-no-i18n">${esc(sc.name)}</span>${sc.id === v.sceneId ? '<i>当前</i>' : ''}</button>`).join('')}</div></div>` : ''}`;
            const dd = box.querySelector('[data-a="scene-menu"]');
            if (dd) dd.addEventListener('click', (e) => { e.stopPropagation(); if (!dd.disabled) dd.parentNode.classList.toggle('open'); });
        },
        async _renameShot(id) {
            const v = this._v;
            const s = v && v.shots.find(x => x.id === id);
            if (!s) return;
            const nm = prompt('机位名称', s.name);
            if (nm === null) return;
            s.name = String(nm).trim().slice(0, 30) || s.name;
            this._saveShots();
            this._renderShots();
            if (s.nodeId) { const n = global.CanvasBlocks.getById(s.nodeId); if (n) global.CanvasBlocks.update(n.id, { name: s.name }); }
        },
        _delShot(id) {
            const v = this._v;
            v.shots = v.shots.filter(x => x.id !== id);
            if (v.sel === id) v.sel = v.shots.length ? v.shots[v.shots.length - 1].id : '';
            this._saveShots();
            this._renderShots();
            this._renderBarRight();
        },
        // 机位 → 参考图节点（放在全景节点右侧，记录来源全景与视角参数）；可选连到打开查看器前选中的生成节点
        placeShot(id, opts) {
            opts = opts || {};
            const v = this._v;
            const s = v && v.shots.find(x => x.id === id);
            if (!s || !s.url) return null;
            const CB = global.CanvasBlocks;
            const pano = CB.getById(v.nodeId);
            const exist = s.nodeId && CB.getById(s.nodeId);
            let node = exist;
            if (!node) {
                const [a, b] = s.ratio.split(':').map(Number);
                const n0 = pano ? v.shots.filter(x => x.nodeId && CB.getById(x.nodeId)).length : 0;
                node = CB.addRef({
                    x: pano ? pano.x + pano.w + 80 : 0, y: pano ? pano.y + n0 * 60 : 0, name: s.name, ratio: a / b,
                    imageUrl: s.url, previewUrl: s.previewUrl || s.url, mediumUrl: s.previewUrl || s.url, status: 'idle',
                    panoShot: { srcId: v.nodeId, yaw: s.yaw, pitch: s.pitch, hfov: s.hfov, ratio: s.ratio }
                });
                const sp = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
                CB.update(node.id, { x: sp.x, y: sp.y });
                s.nodeId = node.id;
                this._saveShots();
            }
            const chk = v.el.querySelector('[data-f="link"]');
            let linked = false;
            if (!opts.noLink && v.target && chk && chk.checked && global.CanvasEdges && !global.CanvasEdges.edges.some(e => e.from === node.id && e.to === v.target)) {
                linked = !!global.CanvasEdges.add(node.id, v.target);
                if (global.CanvasMain) global.CanvasMain.onEdgesChange();
            }
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            if (!opts.silent) toast(linked ? '机位已放到画布并连到生成节点' : (exist ? '该机位已在画布上' : '机位已放到画布'), 'ok');
            this._renderShots();
            return node;
        },
        _setSceneRef(shotId, sceneId) {
            const D = global.CanvasDirector;
            const v = this._v;
            const sc = D && D.d && (D.d.scenes || []).find(x => x.id === sceneId);
            if (!sc) return;
            const node = this.placeShot(shotId, { noLink: true, silent: true });
            if (!node) return;
            sc.refImageNodeId = node.id;
            if (D._sceneChanged) D._sceneChanged(sc);
            if (D._drawerId && D._renderDrawer) D._renderDrawer();
            v.sceneId = sceneId;
            const dd = v.el.querySelector('.pv-dd');
            if (dd) dd.classList.remove('open');
            this._renderBarRight();
            toast('已设为场景「' + sc.name + '」的参考图', 'ok');
        },
        // 画布上的机位节点（导演台场景参考图选择用）
        shotNodes() { const CB = global.CanvasBlocks; return CB ? CB.blocks.filter(b => b.panoShot && (b.imageUrl || b.previewUrl)) : []; },

        // ================= 导演台：为场景生成全景 =================
        createForScene(sc, anchorNode) {
            if (!sc) return;
            const models = this._availModels(PANO_MODELS);
            const st = { model: models[0], size: '2K', prompt: [sc.name, sc.description].filter(Boolean).join('，') };
            const md = this._modal({ title: '为场景生成 360° 全景', icon: IC.p360 });
            const render = () => {
                const sizes = this._sizesOf(st.model);
                if (sizes.indexOf(st.size) === -1) st.size = sizes.indexOf('2K') !== -1 ? '2K' : sizes[0];
                const price = this.priceOf(st.model, st.size, 'medium');
                md.body.innerHTML = `<label class="pv-label">场景描述</label>
                    <textarea class="pv-input px-no-i18n" data-f="prompt" rows="3" maxlength="800">${esc(st.prompt)}</textarea>
                    <div class="pv-row2"><div><label class="pv-label">模型</label><select class="pv-select" data-f="model">${models.map(m => `<option value="${esc(m)}"${m === st.model ? ' selected' : ''}>${esc(this._modelName(m))}</option>`).join('')}</select></div>
                    <div><label class="pv-label">分辨率</label><div class="pv-seg" data-g="size">${sizes.map(s => `<button type="button" data-v="${s}" class="${s === st.size ? 'on' : ''}">${s}</button>`).join('')}</div></div></div>
                    <div class="pv-note">${IC.link}<span>全景生成后会绑定到该场景，在查看器中截取机位即可设为场景参考图</span></div>`;
                md.foot.innerHTML = `<button type="button" class="pv-btn ghost" data-m="x">取消</button><button type="button" class="pv-btn primary" data-a="go">${IC.spark}<span>确认生成</span><span class="pv-btn-price num">${fmt(price)}</span><span>积分</span></button>`;
            };
            render();
            md.body.addEventListener('input', (e) => { if (e.target.dataset.f === 'prompt') st.prompt = e.target.value; });
            md.body.addEventListener('change', (e) => { if (e.target.dataset.f === 'model') { st.model = e.target.value; render(); } });
            md.body.addEventListener('click', (e) => { const b = e.target.closest('.pv-seg button'); if (b) { st.size = b.dataset.v; render(); } });
            md.foot.addEventListener('click', (e) => {
                if (!e.target.closest('[data-a="go"]')) return;
                if (!String(st.prompt).trim()) { md.body.querySelector('textarea').focus(); return; }
                md.close();
                const near = anchorNode && global.CanvasBlocks.getById(anchorNode);
                const node = this.createPanoNode({ prompt: st.prompt.trim(), model: st.model, size: st.size, name: '全景 · ' + sc.name, x: near ? near.x : undefined, y: near ? near.y - 520 : undefined, select: false, pan: false });
                sc.panoNodeId = node.id;
                const D = global.CanvasDirector;
                if (D && D._sceneChanged) D._sceneChanged(sc);
                global.CanvasGenerate.runNode(node.id);
                if (D && D._drawerId && D._renderDrawer) D._renderDrawer();
                toast('已开始生成场景全景', 'ok');
            });
        },

        // ================= 角色多视角 =================
        turnaroundDialog(charId, opts) {
            opts = opts || {};
            const CL = global.CharacterLib;
            const c = CL && CL.get(charId);
            if (!c) { toast('角色不存在或尚未保存', 'warn'); return; }
            if (!(c.refs || []).length) { toast('该角色还没有参考图，先添加至少一张参考图', 'warn'); return; }
            const models = this._availModels(TURN_MODELS);
            const st = { mode: opts.mode || 'grid8', model: models[0], size: '2K' };
            const md = this._modal({ title: '生成多视角', icon: IC.turn, wide: true });
            const cover = (c.refs[0] && (c.refs[0].previewUrl || c.refs[0].url)) || '';
            const render = () => {
                const sizes = this._sizesOf(st.model);
                if (sizes.indexOf(st.size) === -1) st.size = sizes.indexOf('2K') !== -1 ? '2K' : sizes[0];
                const price = this.priceOf(st.model, st.size, 'medium');
                md.body.innerHTML = `
                    <div class="pv-char"><span class="pv-char-av">${cover ? `<img src="${esc(sameOrigin(cover))}" alt="">` : IC.user}</span><div><b class="px-no-i18n">${esc(c.name)}</b><span class="pv-dim">${(c.refs || []).length} 张参考图将作为外观参考</span></div></div>
                    <div class="pv-modes">
                        <button type="button" class="pv-mode${st.mode === 'sheet' ? ' on' : ''}" data-mode="sheet"><span class="pv-mode-art sheet"><i></i><i></i><i></i><i></i></span><b>转身设定图</b><span>1 张：面部近景 + 正 / 侧 / 背全身</span><em class="num">16:9</em></button>
                        <button type="button" class="pv-mode${st.mode === 'grid8' ? ' on' : ''}" data-mode="grid8"><span class="pv-mode-art grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><b>8 视角序列</b><span>一次生成 2×4 宫格，自动裁切为 8 张，可 360° 拖拽查看</span><em class="num">4:3</em></button>
                    </div>
                    <div class="pv-row2"><div><label class="pv-label">模型（多参考图）</label><select class="pv-select" data-f="model">${models.map(m => `<option value="${esc(m)}"${m === st.model ? ' selected' : ''}>${esc(this._modelName(m))}</option>`).join('')}</select></div>
                    <div><label class="pv-label">分辨率</label><div class="pv-seg" data-g="size">${sizes.map(s => `<button type="button" data-v="${s}" class="${s === st.size ? 'on' : ''}">${s}</button>`).join('')}</div></div></div>
                    <div class="pv-note">${IC.link}<span>会在画布上创建一个图片生成节点并连好角色节点，完成后可一键存入角色卡</span></div>`;
                md.foot.innerHTML = `<button type="button" class="pv-btn ghost" data-m="x">取消</button><button type="button" class="pv-btn primary" data-a="go">${IC.spark}<span>确认生成</span><span class="pv-btn-price num">${fmt(price)}</span><span>积分</span></button>`;
            };
            render();
            md.body.addEventListener('click', (e) => {
                const m = e.target.closest('.pv-mode');
                if (m) { st.mode = m.dataset.mode; render(); return; }
                const b = e.target.closest('.pv-seg button');
                if (b) { st.size = b.dataset.v; render(); }
            });
            md.body.addEventListener('change', (e) => { if (e.target.dataset.f === 'model') { st.model = e.target.value; render(); } });
            md.foot.addEventListener('click', (e) => {
                if (!e.target.closest('[data-a="go"]')) return;
                md.close();
                const node = this.createTurnaroundNode(charId, st.mode, st.model, st.size, opts.charNodeId);
                if (node) { this._turnWatch[node.id] = true; global.CanvasGenerate.runNode(node.id); toast('已开始生成多视角', 'ok'); }
            });
        },
        // 创建多视角生成节点并连好角色节点（复用画布上已有的同角色节点，没有则创建）
        createTurnaroundNode(charId, mode, model, size, charNodeId) {
            const CB = global.CanvasBlocks, CL = global.CharacterLib, CE = global.CanvasEdges;
            const c = CL && CL.get(charId);
            if (!c || !TURN[mode]) return null;
            let ch = charNodeId && CB.getById(charNodeId);
            if (!ch) ch = CB.blocks.find(b => b.subType === 'character' && b.characterId === charId && !b.wardrobeId) || null;
            if (!ch) {
                const ctr = CB.viewportCenterWorld();
                ch = CL.insertToCanvas(charId, ctr.x - 360, ctr.y - 100, { center: false, noSelect: true, findSpot: true });
            }
            if (!ch) return null;
            const t = TURN[mode];
            const [a, b] = t.aspect.split(':').map(Number);
            const m = TURN_MODELS.indexOf(model) !== -1 ? model : this._availModels(TURN_MODELS)[0];
            const node = CB.addGen({
                x: ch.x + ch.w + 100, y: ch.y, name: c.name + ' · ' + t.label, genCategory: 'image', model: m, size: size || '2K',
                aspectRatio: t.aspect, ratio: a / b, prompt: t.label, turnaround: { mode, characterId: charId }
            });
            const sp = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            CB.update(node.id, { x: sp.x, y: sp.y });
            CE.add(ch.id, node.id);
            if (global.CanvasMain) global.CanvasMain.onEdgesChange();
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            if (global.CanvasCore) global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            return node;
        },
        _tickTurn() {
            const CB = global.CanvasBlocks;
            if (!CB) return;
            Object.keys(this._turnWatch).forEach(id => {
                const n = CB.getById(id);
                if (!n) { delete this._turnWatch[id]; return; }
                if (n.status === 'failed') { delete this._turnWatch[id]; return; }
                if (n.status === 'done' && n.imageUrl) {
                    delete this._turnWatch[id];
                    if (!this._v && !this._seq && !this._modalCtl) this.openTurnResult(id);
                    else toast('多视角已生成，可在节点工具栏「存入角色卡」', 'ok');
                }
            });
        },
        async openTurnResult(nodeId) {
            const CB = global.CanvasBlocks, CL = global.CharacterLib;
            const n = CB.getById(nodeId);
            if (!n || !n.turnaround || !n.imageUrl) return;
            const charId = n.turnaround.characterId, mode = n.turnaround.mode;
            const c = CL && CL.get(charId);
            const md = this._modal({ title: mode === 'grid8' ? '8 视角序列' : '转身设定图', icon: IC.turn, wide: true });
            const img = sameOrigin(stripProc(n.imageUrl));
            let frames = null;
            if (mode === 'grid8') {
                md.body.innerHTML = `<div class="pv-loading-row"><span class="pv-spin"></span><span>正在裁切 8 个视角…</span></div>`;
                try {
                    const r = await api('/api/characters/' + encodeURIComponent(charId) + '/split-grid', { imageUrl: img, rows: 2, cols: 4 });
                    frames = r.frames.map((f, i) => ({ url: f.url, previewUrl: f.previewUrl, note: ANGLES[i] }));
                } catch (e) {
                    md.body.innerHTML = `<div class="pv-err">${IC.warn}<span>${esc(e.message || '裁切失败')}</span></div>`;
                    md.foot.innerHTML = `<button type="button" class="pv-btn" data-m="x">关闭</button>`;
                    return;
                }
                if (!md.el.parentNode) return;
                md.body.innerHTML = `<div class="pv-turn-grid">${frames.map(f => `<div class="pv-tf"><img src="${esc(f.previewUrl)}" alt="" draggable="false"><span class="num">${f.note}</span></div>`).join('')}</div>
                    <div class="pv-note">${IC.check}<span>已裁切为 ${frames.length} 张，按 0°→315° 顺时针排列；存入角色卡后可 360° 拖拽查看</span></div>`;
            } else {
                md.body.innerHTML = `<div class="pv-sheet"><img src="${esc(withProc(img, 'image/resize,l_1600'))}" alt=""></div>`;
            }
            md.foot.innerHTML = `${frames ? `<button type="button" class="pv-btn" data-a="spin">${IC.p360}<span>360° 预览</span></button>` : ''}
                <button type="button" class="pv-btn ghost" data-m="x">稍后</button>
                <button type="button" class="pv-btn primary" data-a="save"${c ? '' : ' disabled'}>${IC.save}<span>存入角色卡</span></button>`;
            md.foot.addEventListener('click', async (e) => {
                const b = e.target.closest('[data-a]');
                if (!b || b.disabled) return;
                if (b.dataset.a === 'spin') { this.openSequenceViewer(frames, c ? c.name : ''); return; }
                if (b.dataset.a === 'save') {
                    b.disabled = true;
                    b.classList.add('loading');
                    const ok = await this.saveTurnaround(charId, mode, n.imageUrl, frames);
                    b.classList.remove('loading');
                    if (ok) md.close(); else b.disabled = false;
                }
            });
        },
        // 存入角色卡：设定图 / 宫格原图 → refs（role=turnaround；满 8 张时替换已有的 turnaround 参考图）；8 视角帧 → turnaround 序列
        async saveTurnaround(charId, mode, sheetUrl, frames) {
            const CL = global.CharacterLib;
            const c = CL && CL.get(charId);
            if (!c) { toast('角色不存在', 'warn'); return false; }
            const refs = (c.refs || []).map(r => ({ url: r.url, previewUrl: r.previewUrl || r.url, role: r.role || 'other', note: r.note || '' }));
            const entry = { url: stripProc(sheetUrl), previewUrl: withProc(stripProc(sheetUrl), 'image/resize,l_800,m_lfit'), role: 'turnaround', note: mode === 'grid8' ? '8 视角宫格' : '转身设定图' };
            let note = '';
            if (!refs.some(r => r.url === entry.url)) {
                if (refs.length < 8) refs.push(entry);
                else {
                    const i = refs.map(r => r.role).lastIndexOf('turnaround');
                    if (i !== -1) refs[i] = entry; else note = '参考图已满 8 张，设定图未加入参考图';
                }
            }
            const body = { refs };
            if (frames && frames.length) body.turnaround = frames.map(f => ({ url: f.url, previewUrl: f.previewUrl, note: f.note }));
            try {
                const saved = await CL._api('PUT', '/' + encodeURIComponent(charId), body);
                CL._upsert(saved);
                CL.refreshNodes();
                if (CL._draft && CL._draft.id === charId && CL._view === 'edit') CL._editDraft(Object.assign(JSON.parse(JSON.stringify(saved)), { _ingest: false }));
                toast('已存入角色卡' + (note ? '（' + note + '）' : ''), 'ok');
                return true;
            } catch (e) {
                toast('保存失败：' + (e.message || ''), 'warn');
                return false;
            }
        },
        turnFramesOf(c) { return ((c && c.turnaround) || []).filter(f => f && f.url); },

        // ================= 序列帧 360° 查看器 =================
        openSequenceViewer(frames, title) {
            frames = (frames || []).filter(f => f && (f.url || f.previewUrl));
            if (frames.length < 2) return;
            this.closeSequence();
            const n = frames.length;
            const s = this._seq = { i: 0, pos: 0, vel: 0, auto: !reduceMotion(), frames, raf: 0 };
            const el = document.createElement('div');
            el.className = 'pv-overlay pv-seq';
            el.setAttribute('role', 'dialog');
            el.innerHTML = `
                <div class="pv-top"><div class="pv-top-l"><span class="pv-brand">${IC.turn}</span><span class="pv-title px-no-i18n">${esc(title || '')}</span><span class="pv-chip">360°</span></div>
                    <div class="pv-read num"><span><i>角度</i><b data-r="ang">0°</b></span><span><i>帧</i><b data-r="fr">1/${n}</b></span></div>
                    <div class="pv-top-r"><button type="button" class="pv-tbtn${s.auto ? ' on' : ''}" data-a="auto" aria-pressed="${s.auto}">${IC.rotate}<span>自动旋转</span></button><button type="button" class="pv-tbtn icon close" data-a="close" title="关闭（Esc）">${IC.x}</button></div></div>
                <div class="pv-seq-stage" tabindex="0"><div class="pv-seq-floor"></div>${frames.map((f, i) => `<img class="pv-seq-img${i === 0 ? ' on' : ''}" data-i="${i}" src="${esc(sameOrigin(f.url))}" alt="" draggable="false">`).join('')}
                    <div class="pv-seq-hint">${IC.p360}<span>左右拖动旋转角色</span></div></div>
                <div class="pv-seq-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50"/>${frames.map((f, i) => { const a = i / n * Math.PI * 2; return `<circle class="dot" data-i="${i}" cx="${(60 + Math.sin(a) * 50).toFixed(1)}" cy="${(60 - Math.cos(a) * 50).toFixed(1)}" r="4.5"/>`; }).join('')}<path class="pv-seq-arc" d=""/></svg></div>
                <div class="pv-seq-strip">${frames.map((f, i) => `<button type="button" class="pv-seq-th${i === 0 ? ' on' : ''}" data-i="${i}"><img src="${esc(sameOrigin(f.previewUrl || f.url))}" alt="" draggable="false"><span class="num">${esc(f.note || ANGLES[i] || '')}</span></button>`).join('')}</div>`;
            document.body.appendChild(el);
            s.el = el;
            ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'touchstart', 'pointerdown'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
            requestAnimationFrame(() => el.classList.add('in'));
            const stage = el.querySelector('.pv-seq-stage');
            const PX = 46;   // 每帧拖动像素
            let drag = null;
            stage.addEventListener('pointerdown', (e) => {
                drag = { x: e.clientX, p: s.pos, t: performance.now(), lx: e.clientX };
                s.vel = 0;
                this._seqAuto(false);
                stage.setPointerCapture(e.pointerId);
                el.classList.add('dragging');
            });
            stage.addEventListener('pointermove', (e) => {
                if (!drag) return;
                const now = performance.now();
                const dt = Math.max(1, now - drag.t);
                s.vel = 0.8 * s.vel + 0.2 * ((e.clientX - drag.lx) / PX) / dt * 16;
                drag.t = now; drag.lx = e.clientX;
                s.pos = drag.p - (e.clientX - drag.x) / PX;
                this._seqShow();
            });
            const end = () => { if (!drag) return; drag = null; el.classList.remove('dragging'); s.vel = -s.vel; };
            stage.addEventListener('pointerup', end);
            stage.addEventListener('pointercancel', end);
            el.addEventListener('click', (e) => {
                const b = e.target.closest('[data-a]');
                if (b && b.dataset.a === 'close') return this.closeSequence();
                if (b && b.dataset.a === 'auto') return this._seqAuto(!s.auto);
                const th = e.target.closest('.pv-seq-th, .dot');
                if (th) { this._seqAuto(false); s.vel = 0; s.pos = Number(th.dataset.i); this._seqShow(); }
            });
            let last = performance.now();
            const loop = (now) => {
                if (this._seq !== s) return;
                const dt = Math.min(64, now - last); last = now;
                if (!drag) {
                    if (Math.abs(s.vel) > 0.002) { s.pos += s.vel * dt / 16; s.vel *= Math.pow(0.94, dt / 16); this._seqShow(); }
                    else if (s.auto) { s.pos += dt / 1000 * 2.2; this._seqShow(); }
                }
                s.raf = requestAnimationFrame(loop);
            };
            s.raf = requestAnimationFrame(loop);
            this._seqShow();
            stage.focus();
        },
        _seqAuto(on) {
            const s = this._seq;
            if (!s) return;
            s.auto = !!on;
            const b = s.el.querySelector('[data-a="auto"]');
            if (b) { b.classList.toggle('on', s.auto); b.setAttribute('aria-pressed', s.auto ? 'true' : 'false'); }
        },
        _seqShow() {
            const s = this._seq;
            const n = s.frames.length;
            const i = ((Math.round(s.pos) % n) + n) % n;
            if (i === s.i && s._shown) return;
            s.i = i; s._shown = true;
            s.el.querySelectorAll('.pv-seq-img').forEach(im => im.classList.toggle('on', Number(im.dataset.i) === i));
            s.el.querySelectorAll('.pv-seq-th').forEach(t => t.classList.toggle('on', Number(t.dataset.i) === i));
            s.el.querySelectorAll('.dot').forEach(t => t.classList.toggle('on', Number(t.dataset.i) === i));
            const f = s.frames[i];
            const set = (k, t) => { const b = s.el.querySelector(`[data-r="${k}"]`); if (b) b.textContent = t; };
            set('ang', (f.note || ANGLES[i] || (Math.round(i * 360 / n) + '°')));
            set('fr', (i + 1) + '/' + n);
            const a1 = i / n * Math.PI * 2;
            s.el.querySelector('.pv-seq-arc').setAttribute('d', `M60 10 A50 50 0 ${a1 > Math.PI ? 1 : 0} 1 ${(60 + Math.sin(a1) * 50).toFixed(2)} ${(60 - Math.cos(a1) * 50).toFixed(2)}`);
        },
        _seqKey(e) {
            const s = this._seq;
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); this.closeSequence(); return; }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                this._seqAuto(false);
                s.vel = 0;
                s.pos = Math.round(s.pos) + (e.key === 'ArrowRight' ? 1 : -1);
                this._seqShow();
            } else if (e.key === ' ') { e.preventDefault(); this._seqAuto(!s.auto); }
        },
        closeSequence() {
            const s = this._seq;
            if (!s) return;
            this._seq = null;
            cancelAnimationFrame(s.raf);
            if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
        }
    };

    global.CanvasPano = CanvasPano;
})(window);
