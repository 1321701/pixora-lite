/**
 * canvas-blocks.js
 * 节点系统（节点式）：节点 = 按真实比例显示的图片 + 上方名字标签
 *   - ref（参考图节点）：拖入/上传的参考图，只有输出端口；默认名=文件本名
 *   - gen（图片节点）：生成结果图，有输入+输出端口；默认名=图片节点1/2/3…
 * 节点内部不再嵌入参数控件，选中节点时由浮层输入区（CanvasMain 管理）展示提示词/模型等
 */
(function (global) {
    'use strict';

    const SHORT_SIDE = 220;      // 节点短边固定长度（长边按比例缩放）
    const RATIO_DEFAULT = 1;     // 默认宽高比（正方）

    /** 按短边固定 + 原图比例计算节点图片区域的宽高（宽高取偶） */
    function sizeFromRatio(ratio) {
        const r = ratio || RATIO_DEFAULT;
        const w = r >= 1 ? Math.round(SHORT_SIDE * r) : Math.round(SHORT_SIDE);
        const h = r >= 1 ? Math.round(SHORT_SIDE) : Math.round(SHORT_SIDE / r);
        // 取偶：比例切换时新旧差值恒为偶数，底边中点锚定的 x/y 补偿无 .5 舍入，往复切换不累积漂移
        return { w: 2 * Math.round(w / 2), h: 2 * Math.round(h / 2) };
    }

    const CanvasBlocks = {
        blocks: [],
        layerEl: null,
        _idSeq: 0,
        _genSeq: 0,              // 图片节点递增编号

        models: [],
        _drag: null,
        _onPortDragStart: null,
        _onPortInDragStart: null,
        groups: {},            // 分组几何范围：{ gid: { x, y, w, h } }，成员 = 完全落在范围内的节点
        _activeGroupId: null,  // 当前点击激活的分组（显示四角手柄）
        _portMagnetR: 56,      // 端口吸附半径（世界像素）
        _portHoverNodeId: null,// 当前鼠标所在节点（用于判断吸附范围）

        init() {
            this.layerEl = document.getElementById('blocksLayer');
            this.shadowLayerEl = document.getElementById('shadowsLayer');
            this.groupsLayerEl = document.getElementById('groupsLayer');
            this._bindGlobalMove();
            if (global.CanvasSnap) global.CanvasSnap.init();
            // 视口虚拟化：平移/缩放时只保留视口内节点的图片，视口外卸载图片释放内存
            if (global.CanvasCore && typeof global.CanvasCore.onTransform === 'function') {
                global.CanvasCore.onTransform(() => this.scheduleCulling())
            }
        },

        // 防抖执行视口裁剪，避免平移过程中高频操作 DOM
        scheduleCulling() {
            clearTimeout(this._cullTimer);
            this._cullTimer = setTimeout(() => this.applyViewportCulling(), 120);
        },

        // 视口虚拟化：视口外（含缓冲区）节点的图片替换为 1px 透明占位图，
        // 释放解码内存与合成层压力；回到视口时按当前缩放级别恢复正确 URL。
        // 节点框、名字栏、连线端口保留，布局与交互不受影响。
        // 获取节点元素（优先缓存引用，避免 querySelector 全量扫描）
        _getEl(b) {
            if (b._el && b._el.parentNode) return b._el;
            b._el = this.layerEl.querySelector(`[data-block-id="${b.id}"]`);
            return b._el;
        },

        applyViewportCulling() {
            const core = global.CanvasCore;
            if (!this.layerEl || !core || !core.viewportEl) return;
            const rect = (core._vpRect) || core.viewportEl.getBoundingClientRect();
            const vp = core.viewport;
            const scale = vp.scale || 1;
            const buf = 500 / scale; // 屏幕空间 500px 缓冲，快速平移不闪烁
            const minX = -vp.x / scale - buf;
            const minY = -vp.y / scale - buf;
            const maxX = (rect.width - vp.x) / scale + buf;
            const maxY = (rect.height - vp.y) / scale + buf;
            const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            this.blocks.forEach(b => {
                const el = this._getEl(b);
                if (!el) return;
                const img = el.querySelector('.node-img');
                if (!img) return;
                const visible = (b.x + b.w >= minX && b.x <= maxX && b.y + b.h >= minY && b.y <= maxY);
                if (visible) {
                    if (img.dataset.culled === '1') {
                        img.dataset.culled = '0';
                        img.src = this._pickDisplayUrl(b);
                    }
                } else if (img.dataset.culled !== '1') {
                    img.dataset.culled = '1';
                    img.src = PLACEHOLDER;
                }
            });
        },

        // 阴影镜像：独立元素置于世界容器最底层，只画投影，永不覆盖节点
        _getShadow(id) {
            return this.shadowLayerEl ? this.shadowLayerEl.querySelector(`[data-shadow-id="${id}"]`) : null;
        },
        _syncShadow(b) {
            let s = this._getShadow(b.id);
            if (!s) {
                if (!this.shadowLayerEl) return;
                s = document.createElement('div');
                s.className = 'node-shadow';
                s.dataset.shadowId = b.id;
                this.shadowLayerEl.appendChild(s);
            }
            s.style.left = b.x + 'px';
            s.style.top = b.y + 'px';
            s.style.width = b.w + 'px';
            s.style.height = b.h + 'px';
        },

        genId() {
            return 'nd_' + Date.now() + '_' + (this._idSeq++);
        },

        getById(id) {
            return this.blocks.find(b => b.id === id);
        },

        setModels(models) {
            this.models = models || [];
        },

        // gen 节点类别：video | image（genCategory 优先，旧节点按模型名推断）
        _genCategoryOf(block) {
            if (!block) return 'image';
            if (block.genCategory === 'video' || block.genCategory === 'image') return block.genCategory;
            return /seedance-2|minimax-h3|^cpx-/i.test(String(block.model || '')) ? 'video' : 'image';
        },

        // 计算下一个 gen 节点编号（图片节点N / 视频节点N，序列独立）
        _nextGenName(prefix) {
            const re = new RegExp('^' + prefix + '(\\d+)$');
            let max = 0;
            this.blocks.forEach(b => {
                if (b.nodeType === 'gen') {
                    const m = re.exec(b.name || '');
                    if (m) max = Math.max(max, parseInt(m[1]));
                }
            });
            return prefix + (max + 1);
        },

        // 计算下一个文本节点编号
        _nextTextName() {
            let max = 0;
            this.blocks.forEach(b => {
                if (b.nodeType === 'text') {
                    const m = /文本节点(\d+)/.exec(b.name || '');
                    if (m) max = Math.max(max, parseInt(m[1]));
                }
            });
            return '文本节点' + (max + 1);
        },

        add(data) {
            const isGen = data.nodeType === 'gen';
            const isText = data.nodeType === 'text';
            // 过滤掉 data 中值为 undefined 的键，避免覆盖默认值（如复制时传入 id:undefined）
            const cleanData = {};
            Object.keys(data || {}).forEach(k => { if (data[k] !== undefined) cleanData[k] = data[k]; });
            // 运行时 DOM 引用不可继承：复制节点时若带上原节点 _el，副本会复用并搬走原节点 DOM（原节点"消失"）
            delete cleanData._el;
            const block = Object.assign({
                id: this.genId(),
                nodeType: data.nodeType || 'ref',
                name: '',
                x: 0, y: 0,
                w: SHORT_SIDE, h: SHORT_SIDE,
                ratio: RATIO_DEFAULT,
                imageUrl: '', previewUrl: '', mediumUrl: '', tempKey: '',
                prompt: '', model: '', size: '4K', aspectRatio: '1:1',
                duration: 5, resolution: '',      // 视频节点专用：时长(秒)与分辨率
                videoUrl: '', mediaUrl: '', mediaType: '',  // 媒体：视频结果/参考素材地址与类型
                assetId: '', assetStatus: '',     // 素材库：入库 ID 与状态（ref 图节点用）
                text: '', insertPos: 'head',   // 文本节点专用：text=内容，insertPos='head'|'tail'
                status: 'idle',  // ref: idle/loading ; gen: idle/generating/done/failed
                taskId: '',      // 生成节点关联的任务ID，持久化保存，用于刷新/长时间搁置后按节点自身查询真实状态
                groupColor: '',  // 旧版打组颜色标记（兼容历史数据）
                groupId: ''      // 分组ID：同组节点共享，分组框按成员包围盒实时计算
            }, cleanData);
            if (isGen && !block.name) block.name = this._nextGenName();
            if (isText && !block.name) block.name = this._nextTextName();
            if (isGen && !block.model) {
                block.model = (this.models[0] && this.models[0].id) || 'Nano Banana Pro';
            }
            if (isText) {
                // 文本节点：保留已保存的尺寸，未保存过时用默认值
                if (!block.w) block.w = 220;
                if (!block.h) block.h = 110;
            } else {
                // 按短边固定 + 原图比例计算节点宽高（名字栏悬浮在框外上方，不计入框高）
                const sz = sizeFromRatio(block.ratio);
                block.w = sz.w;
                block.h = sz.h;
            }
            this.blocks.push(block);
            this._render(block);
            return block;
        },

        addRef(opts) {
            return this.add(Object.assign({ nodeType: 'ref' }, opts));
        },
        addGen(opts) {
            return this.add(Object.assign({ nodeType: 'gen' }, opts));
        },
        addText(opts) {
            return this.add(Object.assign({ nodeType: 'text' }, opts));
        },

        // 在期望位置附近搜索不与已有节点重叠的空位（创建节点时自动避让）
        // 间距与自动排列一致（水平 gap=12，垂直额外留出名字栏 24px），搜索按欧氏距离从近到远
        _findFreeSpot(x, y, w, h, excludeId) {
            const gap = 12;
            const gapY = gap + 24; // 名字栏悬浮在节点上方 24px，垂直方向需多留出这段高度
            const blocks = this.blocks.filter(b => b.id !== excludeId);
            if (!blocks.length) return { x, y };
            const ow = w || 220, oh = h || 220;
            const overlaps = (px, py) => blocks.some(b =>
                px < b.x + b.w + gap && px + ow + gap > b.x &&
                py < b.y + b.h + gapY && py + oh + gapY > b.y
            );
            if (!overlaps(x, y)) return { x, y };
            // 小步长搜索：step=30px，能滑入节点之间的缝隙，每个环内按距离排序确保找到最近空位
            const step = 30;
            for (let r = 1; r < 40; r++) {
                const candidates = [];
                for (let c = -r; c <= r; c++) {
                    candidates.push({ px: x + c * step, py: y - r * step });
                    candidates.push({ px: x + c * step, py: y + r * step });
                }
                for (let rr = -r + 1; rr <= r - 1; rr++) {
                    candidates.push({ px: x - r * step, py: y + rr * step });
                    candidates.push({ px: x + r * step, py: y + rr * step });
                }
                // 按欧氏距离排序，从最近开始检查
                candidates.sort((a, b) => {
                    const da = (a.px - x) * (a.px - x) + (a.py - y) * (a.py - y);
                    const db = (b.px - x) * (b.px - x) + (b.py - y) * (b.py - y);
                    return da - db;
                });
                for (const { px, py } of candidates) {
                    if (!overlaps(px, py)) return { x: px, y: py };
                }
            }
            return { x, y };
        },

        remove(id) {
            const idx = this.blocks.findIndex(b => b.id === id);
            if (idx === -1) return;
            this._dropLocalPreview(id);
            this.blocks.splice(idx, 1);
            const el = this.layerEl.querySelector(`[data-block-id="${id}"]`);
            if (el) el.remove();
            const shadowEl = this._getShadow(id);
            if (shadowEl) shadowEl.remove();
            if (global.CanvasEdges) global.CanvasEdges.removeByBlock(id);
            if (global.CanvasMain) global.CanvasMain.onNodeRemoved(id);
            this._syncGroupFrames();
            this._cleanupEmptyGroups();
        },

        update(id, patch) {
            const block = this.getById(id);
            if (!block) return;
            Object.assign(block, patch);
            if (block.status !== 'loading' && this._localUrls[id]) this._dropLocalPreview(id);
            // 比例变化时按短边固定重算宽高（与 add() 一致：名字栏悬浮框外，不计入框高）
            // 锚点=下方边中点：底边不动、水平居中伸缩，节点下方区域（提示词生成区）位置保持不变
            if (patch.ratio && patch.ratio !== block._lastRatio) {
                const sz = sizeFromRatio(patch.ratio);
                const oldW = block.w, oldH = block.h;
                block.w = sz.w;
                block.h = sz.h;
                block._lastRatio = patch.ratio;
                // 已有节点尺寸变化不做防重叠（重叠就重叠，不挪位置；防重叠只用于新建节点）
                if (oldW !== block.w || oldH !== block.h) {
                    // 以底边中点为锚调整位置：x 居中补偿、y 补偿保持底边不变
                    block.x = block.x + Math.round((oldW - block.w) / 2);
                    block.y = block.y + (oldH - block.h);
                }
            }
            this._render(block);
            if (global.CanvasEdges) global.CanvasEdges.refresh();
            if (global.CanvasMain) global.CanvasMain.onNodeUpdated(block);
        },

        // ===== 渲染 =====
        _render(block) {
            // 优先使用缓存的 DOM 引用：querySelector 属性选择器无法走索引，
            // 每次调用都要线性扫描节点层，节点多了（上百个）时每次变换/裁剪
            // 触发数百次全量扫描 = 闪烁卡顿的直接原因
            let el = block._el;
            if (!el || !el.parentNode) {
                el = this.layerEl.querySelector(`[data-block-id="${block.id}"]`);
                block._el = el;
            }
            const exists = !!el;
            if (!exists) {
                el = document.createElement('div');
                el.dataset.blockId = block.id;
                block._el = el;
                this.layerEl.appendChild(el);
            }
            // 保留选中/拖拽状态，避免缩放重新渲染时丢失
            const keepSelected = el.classList.contains('selected');
            const keepDragging = el.classList.contains('dragging');
            el.className = 'canvas-node node-' + block.nodeType +
                (block.status === 'generating' ? ' busy' : '') +
                (block.status === 'failed' ? ' failed' : '') +
                (keepSelected ? ' selected' : '') +
                (keepDragging ? ' dragging' : '') +
                (block.groupColor ? ' grouped' : '') +
                (block.subType === 'character' ? ' node-character' : '') +
                (global.CanvasPano ? global.CanvasPano.nodeClass(block) : '') +
                (global.CanvasStage3D ? global.CanvasStage3D.nodeClass(block) : '') +
                ((block.imageUrl || block.previewUrl || block.mediaUrl) ? '' : ' is-empty');
            el.style.left = block.x + 'px';
            el.style.top = block.y + 'px';
            el.style.width = block.w + 'px';
            el.style.height = block.h + 'px';
            this._syncShadow(block);
            if (block.groupColor) el.style.setProperty('--group-color', block.groupColor);
            else el.style.removeProperty('--group-color');

            this._renderInner(el, block);
            if (!exists) this._bindNodeEvents(el, block);
            this._syncGroupFrames();
        },

        _renderInner(el, block) {
            // 正在重命名时不替换 innerHTML：否则两次 click 之间的 update 会重渲染 DOM，
            // 第一次 click 的 target 被移除，浏览器不认为是 dblclick，导致双击重命名失效
            if (el.querySelector('.node-name-input')) return;
            // 文本节点编辑中被重渲染时，保留编辑态与光标
            const editingTa = el.querySelector('.node-textarea[data-editing="1"]');
            const editState = editingTa && document.activeElement === editingTa
                ? { start: editingTa.selectionStart, end: editingTa.selectionEnd } : null;
            const defName = block.nodeType === 'gen' ? this._nextGenName(this._genCategoryOf(block) === 'video' ? '视频节点' : '图片节点') : (block.nodeType === 'text' ? '文本节点' : '参考节点');
            const name = this._esc(block.name || defName);
            let body;
            if (block.nodeType === 'text') {
                // 文本节点：内联文本框 + resize 手柄（色球/首尾按钮移到顶部工具栏）
                body = `<textarea class="node-textarea" placeholder="输入提示词文本…"></textarea>
                <div class="node-handle-br" title="拖拽调整大小"></div>`;
            } else if (block.status === 'generating') {
                body = `<div class="node-result generating"><div class="gen-shimmer"></div>
                    <div class="gen-meta"><span class="spin"></span><span>生成中</span><span class="node-gen-elapsed" data-start="${block.genStartedAt || ''}"></span></div></div>`;
            } else if (block.status === 'loading') {
                const local = this._localUrls[block.id];
                body = local
                    ? `<img class="node-img" src="${local}" alt="" data-block-id="${block.id}"><div class="node-uploading-tag"><span class="spin"></span>上传中…</div>`
                    : `<div class="node-loading"><span class="spin"></span>上传中…</div>`;
            } else if (block.status === 'failed') {
                const why = this._esc(block.errorMsg || '');
                body = `<div class="node-result failed"${why ? ` title="${why}"` : ''}><span>生成失败</span>${block.nodeType === 'gen' ? '<button type="button" class="node-retry">重试</button>' : ''}</div>`;
            } else if (block.mediaType === 'video' && block.videoExpired) {
                // 已确认失效（外链过期且无法回填）：显示遮罩，不创建 video 元素、不发任何请求
                body = `<div class="node-video-wrap node-video-expired" data-block-id="${this._esc(block.id)}">
                    <div class="node-video-expired-mask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4.5"/><path d="M12 16h.01"/></svg><span>视频链接已失效</span></div>
                </div>`;
            } else if (block.mediaType === 'video' && (block.videoUrl || block.mediaUrl || block.imageUrl)) {
                // 画布内播放用预览版（video-proxy.js，有则用），下载/提交模型仍用原始地址
                const vurl = this._esc((global.VideoProxy ? global.VideoProxy.previewOf(block) : '') || block.videoUrl || block.mediaUrl || block.imageUrl);
                // 海报模式：preload=metadata + #t=0.1 显示首帧，居中播放键点击后才加载播放（点节点外恢复海报）
                // 有封面图：poster 走图片缓存秒出，preload=none 静止时不拉视频（避免首帧黑屏）
                const poster = this._esc(global.VideoProxy ? global.VideoProxy.validPosterOf(block) : '');
                const vAttr = poster ? `src="${vurl}" poster="${poster}" preload="none"` : `src="${vurl}#t=0.1" preload="metadata"`;
                body = `<div class="node-video-wrap" data-block-id="${block.id}"><video class="node-video" ${vAttr} data-src="${vurl}" loop playsinline data-block-id="${block.id}"></video><button type="button" class="node-video-play" data-action="video-play" title="播放"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></button></div>`;
            } else if (block.mediaType === 'audio' && block.mediaUrl) {
                body = `<div class="node-audio-wrap"><audio class="node-audio" src="${this._esc(block.mediaUrl)}" controls preload="metadata" data-block-id="${block.id}"></audio></div>`;
            } else if (block.imageUrl || block.previewUrl) {
                const u = this._pickDisplayUrl(block);
                body = `<img class="node-img" src="${u}" alt="" data-block-id="${block.id}">`;
            } else if (block.nodeType === 'gen') {
                body = `<div class="node-result empty">尚未生成</div>`;
            } else if (block.subType === 'stage3d' && global.CanvasStage3D) {
                body = global.CanvasStage3D.emptyBodyHtml(block);
            } else {
                const emptyTxt = block.mediaType === 'video' ? '视频素材' : (block.mediaType === 'audio' ? '音频素材' : '无图片');
                const upBtn = block.mediaType ? `<button type="button" class="node-media-upload" data-action="media-upload">点击上传${block.mediaType === 'video' ? '视频' : '音频'}</button>` : '';
                body = `<div class="node-empty">${emptyTxt}${upBtn}</div>`;
            }

            const ports = block.nodeType === 'gen'
                ? `<div class="port port-in" data-port="in" title="连入参考素材"></div><div class="port-hit port-in-hit"></div>
                   <div class="port port-out" data-port="out" title="拖出作为下游参考"></div><div class="port-hit port-out-hit"></div>`
                : `<div class="port port-out" data-port="out" title="拖出连线到图片节点"></div><div class="port-hit port-out-hit"></div>`;

            // 顶部名字栏（工具栏已移到屏幕空间浮层，避免随画布缩放）
            const vres = block.mediaType === 'video' && block.videoW && block.videoH && block.videoResUrl === (block.videoUrl || block.mediaUrl);
            const res = vres ? `${block.videoW}×${block.videoH}` : ((block._imgW && block._imgH && block.mediaType !== 'video') ? `${block._imgW}×${block._imgH}` : '');
            const typeIcon = this._renderTypeIcon(block.nodeType, block);
            const isCharNode = block.subType === 'character';
            const charWd = isCharNode && global.CharacterLib ? global.CharacterLib.wardrobeName(block) : '';
            const nameBar = `<div class="node-name" data-action="rename">
                <span class="node-name-info">
                    ${isCharNode ? `<span class="node-char-pill node-char-badge">${typeIcon}<span>角色</span></span>` : typeIcon}
                    <span class="node-name-name">${name}</span>
                </span>
                ${res ? `<span class="node-name-res">${res}</span>` : ''}${block.assetId ? '<span class="node-name-res">角色</span>' : ''}${charWd ? `<span class="node-name-res node-char-wd px-no-i18n" title="当前造型">${this._esc(charWd)}</span>` : ''}${(global.VideoProxy && global.VideoProxy.isBusy(block.id)) ? '<span class="node-name-res vproxy-badge" title="正在本地生成预览版，用于画布内流畅播放">优化中…</span>' : ''}
                ${block.nodeType === 'text' ? '<span class="node-name-hint">双击输入</span>' : ''}
            </div>`;
            // 角色节点：多张参考图时右下角显示「N 张」
            if (isCharNode && global.CharacterLib && !/node-result|node-loading|node-empty/.test(body)) {
                const nRefs = global.CharacterLib.expandRefs(block).length;
                if (nRefs > 1) body += `<span class="node-char-count" title="${nRefs} 张参考图"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="14" height="14" rx="2.5"/><path d="M3 15V5a2 2 0 0 1 2-2h10"/></svg>${nRefs} 张</span>`;
            }

            el.innerHTML = `
                ${nameBar}
                <div class="node-body">${body}${(global.CanvasPano && block.status !== 'generating' && block.status !== 'failed') ? global.CanvasPano.badgeHtml(block) : ''}${global.CanvasStage3D ? global.CanvasStage3D.badgeHtml(block) : ''}${(global.CanvasDraft && block.nodeType === 'gen') ? global.CanvasDraft.bodyHtml(block) : ''}</div>
                ${global.GenHistory ? global.GenHistory.badgeHtml(block) : ''}
                ${ports}
            `;

            // 文本节点：应用 bgColor 作为节点背景（50% 透明度，覆盖 CSS 默认值）
            if (block.nodeType === 'text') {
                el.style.background = this._hexToRgba(block.bgColor || '#3a3a2e', 0.5);
            }

            // 图片加载后按真实比例调整节点高度（显示用 previewUrl，可能为缩略图）
            const img = el.querySelector('.node-img');
            if (img && !img.dataset.bound) {
                img.dataset.bound = '1';
                img.addEventListener('load', () => {
                    // 视口外裁剪的占位图（1x1）不参与比例计算
                    if (img.dataset.culled === '1') return;
                    if (img.naturalWidth && img.naturalHeight) {
                        const r = img.naturalWidth / img.naturalHeight;
                        if (Math.abs(r - block.ratio) > 0.01) {
                            this.update(block.id, { ratio: r });
                        }
                    }
                });
            }
            // 视频：按真实分辨率调整节点框比例
            const vid = el.querySelector('.node-video');
            if (vid && !vid.dataset.bound) {
                vid.dataset.bound = '1';
                vid.addEventListener('loadedmetadata', () => {
                    if (vid.videoWidth && vid.videoHeight) {
                        const r = vid.videoWidth / vid.videoHeight;
                        if (Math.abs(r - block.ratio) > 0.01) {
                            this.update(block.id, { ratio: r });
                        }
                    }
                });
                // 海报模式（preload=none）不会触发 loadedmetadata：用首帧封面图的尺寸修正比例（_posterRatio）
                const posterSrc = vid.getAttribute('poster');
                if (posterSrc) {
                    const pi = new Image();
                    pi.onload = () => {
                        const cur = this.getById(block.id);
                        if (!cur || !pi.naturalWidth || !pi.naturalHeight) return;
                        const r = pi.naturalWidth / pi.naturalHeight;
                        if (Math.abs(r - cur.ratio) > 0.01) this.update(block.id, { ratio: r });
                    };
                    pi.src = posterSrc;
                }
                // 预览版加载失败（如文件已过期）：回退原视频；原视频仍失败则最多触发一次服务端修复
                vid.addEventListener('error', () => {
                    const cur = this.getById(block.id);
                    if (!cur || cur.videoExpired) return;
                    const VP = global.VideoProxy;
                    const orig = VP ? VP.originalOf(cur) : '';
                    if (!orig) return;
                    if (vid.dataset.src !== orig) {
                        vid.dataset.src = orig;
                        vid.src = orig + (vid.classList.contains('is-playing') ? '' : '#t=0.1');
                        return;
                    }
                    if (VP && VP.repair) VP.repair(cur.id);
                });
            }
            // 显示分辨率：取原图(imageUrl)的真实尺寸，避免 previewUrl 缩略图导致分辨率错误
            if (block.mediaType === 'video') {
                if (!block.videoExpired && (block.videoUrl || block.mediaUrl) && !(block.videoW && block.videoResUrl === (block.videoUrl || block.mediaUrl))) this._fetchVideoRes(block);
            } else if (block._imgW && block._imgH) {
                this._applyRes(el, block._imgW, block._imgH);
            } else if (block.imageUrl) {
                this._fetchImageRes(block, el);
            }

            // 输出端口拖拽：绑定到端口视觉和扩展命中区（innerHTML 替换后需重绑）
            const portOut = el.querySelector('.port-out');
            const portOutHit = el.querySelector('.port-out-hit');
            const bindPortDrag = (target) => {
                if (!target) return;
                target.addEventListener('mousedown', (e) => {
                    // _CB_MIDFIX_1027 非左键（中键误触）不进入连线拖拽：放行冒泡由画布平移接管
                    if (e.button !== 0) return;
                    // 端口处于隐藏态（落在选中节点端口吸附半径内被屏蔽）时不响应，
                    // 且不阻断冒泡，让事件继续走节点拖拽/选中逻辑
                    if (el._portState && el._portState.out.to === 0) return;
                    e.stopPropagation();
                    if (this._onPortDragStart) this._onPortDragStart(block.id, e);
                });
            };
            bindPortDrag(portOut);
            bindPortDrag(portOutHit);

            // 输入端口拖拽（仅 gen 节点有 port-in）：拖出可落到上游节点，或落空白弹出「添加上下文」菜单
            const portIn = el.querySelector('.port-in');
            const portInHit = el.querySelector('.port-in-hit');
            const bindPortInDrag = (target) => {
                if (!target) return;
                target.addEventListener('mousedown', (e) => {
                    // _CB_MIDFIX_1027 非左键（中键误触）不进入连线拖拽：放行冒泡由画布平移接管
                    if (e.button !== 0) return;
                    // 端口处于隐藏态（落在选中节点端口吸附半径内被屏蔽）时不响应，
                    // 且不阻断冒泡，让事件继续走节点拖拽/选中逻辑
                    if (el._portState && el._portState.in.to === 0) return;
                    e.stopPropagation();
                    if (this._onPortInDragStart) this._onPortInDragStart(block.id, e);
                });
            };
            bindPortInDrag(portIn);
            bindPortInDrag(portInHit);

            // 端口渐显/渐隐 + 磁吸缓动状态机（与多选包围框端口共用同一套实现）
            this._setupPortFx(el);

            // 文本节点：设置 textarea 值 + 绑定编辑相关事件（innerHTML 每次重建，必须随渲染重绑）
            const textarea = el.querySelector('.node-textarea');
            if (textarea) {
                textarea.value = block.text || '';
                textarea.setAttribute('readonly', '');  // 默认只读，双击进入编辑
                textarea.addEventListener('input', () => {
                    block.text = textarea.value;
                    if (global.CanvasStore) global.CanvasStore.scheduleSave();
                });
                // 失焦或 Esc → 退出编辑（恢复只读）
                textarea.addEventListener('blur', () => {
                    textarea.dataset.editing = '';
                    textarea.setAttribute('readonly', '');
                });
                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') textarea.blur();
                    e.stopPropagation();  // 防止 Esc 触发删除节点等画布快捷键
                });
                textarea.addEventListener('mousedown', (e) => {
                    // 编辑态时阻止 mousedown 冒泡到节点拖拽逻辑（让原生选区工作）
                    if (textarea.dataset.editing === '1') { e.stopPropagation(); return; }
                    // 连击计数判定双击：不依赖 dblclick 事件（元素重建/事件拦截时 dblclick 不可靠）
                    if (e.detail >= 2) {
                        e.stopPropagation();
                        e.preventDefault();
                        this._focusTextarea(el);
                    }
                });
            }
            // 文本节点 resize 手柄：随渲染重绑（innerHTML 重建会替换手柄元素，首次绑定的监听随之丢失）
            const resizeHandle = el.querySelector('.node-handle-br');
            if (resizeHandle) {
                resizeHandle.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    // 与节点拖拽一致：抓手工具/空格按住时不触发 resize（让位视口平移）
                    if (CanvasCore.tool === 'hand' || CanvasCore.spaceDown) return;
                    e.stopPropagation();
                    e.preventDefault();
                    this._resize = {
                        id: block.id,
                        startX: e.clientX, startY: e.clientY,
                        ow: block.w, oh: block.h
                    };
                });
            }
            if (editState) this._focusTextarea(el, editState.start, editState.end);
            // 失败节点的重试按钮
            const retry = el.querySelector('.node-retry');
            if (retry) {
                retry.addEventListener('mousedown', (e) => e.stopPropagation());
                retry.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (global.CanvasGenerate) global.CanvasGenerate.runNode(block.id);
                });
            }
            // 名字栏 mousedown 阻止冒泡，避免触发节点拖拽（工具栏已迁至屏幕浮层，节点内无工具栏元素）
            if (!el._toolbarBound) {
                el._toolbarBound = true;
                el.addEventListener('mousedown', (ev) => {
                    if (ev.target.closest('.node-name')) ev.stopPropagation();
                }, true);
            }
        },

        // 文本节点进入编辑态并聚焦（光标默认放在末尾）
        _focusTextarea(el, start, end) {
            const ta = el && el.querySelector('.node-textarea');
            if (!ta) return;
            ta.dataset.editing = '1';
            ta.removeAttribute('readonly');
            ta.focus({ preventScroll: true });
            const len = ta.value.length;
            ta.setSelectionRange(start == null ? len : start, end == null ? len : end);
        },
        beginTextEdit(id) {
            const b = this.getById(id);
            if (!b || b.nodeType !== 'text') return;
            this._focusTextarea(b._el || this.layerEl.querySelector(`[data-block-id="${id}"]`));
        },

        // 渲染节点顶部工具栏（按 nodeType 不同操作）
        _renderToolbar(block) {
            // 3D 片场节点：专用工具栏（打开片场 / 截图到画布 / 复制 / 下载）
            if (block.subType === 'stage3d' && global.CanvasStage3D) return global.CanvasStage3D.toolbarHtml(block);
            if (block.nodeType === 'text') {
                // 文本节点：背景色（透明取色器覆盖按钮，与打组背景色完全一致）+ 文字位置
                const colorHex = block.bgColor || '#3a3a2e';
                return `<div class="node-toolbar toolbar-capsule">
                    <label class="node-tool-link node-tool-color" title="选择背景颜色"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6c0-4.4-4.5-8.4-10-8.4z"/></svg><span class="tb-lb">背景色</span><input type="color" class="node-color-input" value="${colorHex}"></label>
                    <span class="node-tool-sep">丨</span>
                    <span class="node-tool-link node-text-pos" data-action="pos" data-pos="${block.insertPos || 'head'}" title="切换文字插入位置（最前/最后）"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h12M3 18h16"/></svg><span class="tb-lb">文字位置：${(block.insertPos === 'tail') ? '最后' : '最前'}</span></span>
                </div>`;
            }
            // ref / gen 节点：编辑、下载、查看大图（小图标按钮），不含翻转
            const isVideoNode = block.mediaType === 'video';
            const isMediaNode = isVideoNode || block.mediaType === 'audio';
            const hasImage = !!(block.imageUrl || block.previewUrl) && !isMediaNode;
            const hasMedia = isVideoNode ? !!(block.videoUrl || block.mediaUrl) : (isMediaNode ? !!block.mediaUrl : hasImage);
            const isBusy = (block.status === 'generating' || block.status === 'loading');
            const dis = (hasMedia && !isBusy) ? '' : ' disabled';
            let texts = '';
            if (hasImage && !isBusy) texts += `<button class="node-tool-text" data-action="ref-gen" title="以这张图为参考继续生成"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4 .9 2.1L18 7l-2.1.9L15 10l-.9-2.1L12 7l2.1-.9z"/><path d="M3 21l9-9"/><path d="M19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z"/></svg><span class="tb-lb">参考生成</span></button>`;
            // ref 图节点：存为角色（存入角色库；表单内可选同时入库素材库，Seedance 人物一致性）
            // 已入库（旧版「设为角色」）的节点仍显示入库状态，点击可移除标记
            const isCharNode = block.subType === 'character';
            if (block.nodeType === 'ref' && hasImage && !isBusy && !isCharNode) {
                const SVG_USER = '<svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>';
                if (block.assetId || block.assetStatus === 'ingesting') {
                    const aLabel = block.assetStatus === 'ingesting' ? '入库中…' : (block.assetStatus === 'active' ? '角色✓' : '处理中…');
                    texts += `<button class="node-tool-text" data-action="asset" title="已入库素材库，点击移除角色标记">${SVG_USER}<span class="tb-lb">${aLabel}</span></button>`;
                }
                texts += `<button class="node-tool-text" data-action="save-char" title="把这张图存为角色库中的角色，可在所有画布复用">${SVG_USER}<span class="tb-lb">存为角色</span></button>`;
            }
            // 角色节点：切换造型 / 打开角色卡
            if (isCharNode && !isBusy) {
                texts += `<button class="node-tool-text" data-action="char-wardrobe" title="切换该角色节点使用的造型"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 6.6 16 4l-1.5 1.6a3.5 3.5 0 0 1-5 0L8 4 3.6 6.6a1 1 0 0 0-.4 1.3l1.5 3a1 1 0 0 0 1.2.5L7 11v9h10v-9l1.1.4a1 1 0 0 0 1.2-.5l1.5-3a1 1 0 0 0-.4-1.3z"/></svg><span class="tb-lb">切换造型</span></button>`;
                texts += `<button class="node-tool-text" data-action="char-open" title="在角色库中打开该角色卡"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.2"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M14 9h4M14 13h4"/></svg><span class="tb-lb">打开角色卡</span></button>`;
            }
            if (block.nodeType === 'gen' && (hasImage || (isVideoNode && block.videoUrl)) && !isBusy) texts += `<button class="node-tool-text" data-action="regen" title="用相同参数在旁边再生成一个"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/></svg><span class="tb-lb">再来一个</span></button>`;
            if (block.nodeType === 'gen' && block.status === 'failed') texts += `<button class="node-tool-text" data-action="retry" title="重新生成"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span class="tb-lb">重试</span></button>`;
            // 360 全景 / 角色多视角（panorama.js）
            if (global.CanvasPano) texts += global.CanvasPano.toolbarHtml(block);
            // Seedance 2.5 样片：升级 1080p 成片入口
            if (global.CanvasDraft) texts += global.CanvasDraft.toolbarHtml(block);
            if (texts) texts += '<span class="node-tool-divider"></span>';
            // 视频节点：无编辑/查看大图（图片专用），保留下载与再来一个
            const editViewBtns = (isMediaNode || isCharNode) ? '' : `
                <button class="node-tool-icon has-label${dis}" data-action="edit" title="编辑图片"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span class="tb-lb">编辑</span></button>`;
            const viewBtn = isMediaNode ? '' : `
                <button class="node-tool-icon has-label${dis}" data-action="view" title="查看大图"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg><span class="tb-lb">查看大图</span></button>`;
            // 视频节点（素材/生成结果）：截取帧（下拉：首帧/尾帧/自定义）、视频修剪（浏览器本地处理）
            const videoBtns = (isVideoNode && hasMedia) ? `
                <span class="node-tool-dd">
                    <button class="node-tool-icon has-label${dis}" data-action="frame-menu" title="截取帧"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span class="tb-lb">截取帧</span><svg class="tb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
                    <div class="ctx-menu node-tool-menu">
                        <div class="ctx-item" data-frame="first"><svg class="ctx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg><span class="ctx-label">首帧</span></div>
                        <div class="ctx-item" data-frame="last"><svg class="ctx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg><span class="ctx-label">尾帧</span></div>
                        <div class="ctx-item" data-frame="custom"><svg class="ctx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M16 3v18"/></svg><span class="ctx-label">自定义</span></div>
                    </div>
                </span>
                <button class="node-tool-icon has-label${dis}" data-action="video-trim" title="视频修剪"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg><span class="tb-lb">视频修剪</span></button>` : '';
            // 音频节点（素材/修剪结果）：修剪音频（服务端 ffmpeg 截取并转 MP3）
            const audioBtns = (block.mediaType === 'audio' && hasMedia && !isBusy) ? `
                <button class="node-tool-icon has-label" data-action="audio-trim" title="修剪音频"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg><span class="tb-lb">修剪音频</span></button>` : '';
            return `<div class="node-toolbar toolbar-capsule">
                ${texts}
                ${editViewBtns}
                ${videoBtns}
                ${audioBtns}
                <button class="node-tool-icon has-label${dis}" data-action="download" title="下载"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span class="tb-lb">下载</span></button>
                ${viewBtn}
            </div>`;
        },

        // 节点类型小图标（显示在名字左侧）
        _renderTypeIcon(nodeType, block) {
            const mt = block && block.mediaType;
            if (nodeType === 'ref' && mt === 'video') {
                return `<svg class="node-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="视频参考节点"><rect x="2.5" y="5" width="14" height="14" rx="2"/><path d="M16.5 10l5-3v10l-5-3z"/></svg>`;
            }
            if (nodeType === 'ref' && mt === 'audio') {
                return `<svg class="node-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="音频参考节点"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
            }
            if (nodeType === 'text') {
                return `<svg class="node-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="文本节点"><path d="M6 4h12M12 4v16"/></svg>`;
            }
            if (nodeType === 'ref' && block && block.subType === 'character') {
                return `<svg class="node-type-icon is-char" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="角色节点"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>`;
            }
            if (nodeType === 'ref' && block && block.subType === 'stage3d') {
                return `<svg class="node-type-icon is-gen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="3D 片场"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/></svg>`;
            }
            if (nodeType === 'gen') {
                // 生成节点：图片生成=画笔，视频生成=场记板（青柠色，区别于素材节点的相框/摄像机）
                const isVid = block && this._genCategoryOf && this._genCategoryOf(block) === 'video';
                return isVid
                    ? `<svg class="node-type-icon is-gen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="视频生成节点"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`
                    : `<svg class="node-type-icon is-gen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="图片生成节点"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`;
            }
            return `<svg class="node-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="参考节点"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
        },

        // hex(#rrggbb) → rgba 字符串，alpha 为透明度
        _hexToRgba(hex, alpha) {
            const h = (hex || '#3a3a2e').replace('#', '');
            const r = parseInt(h.substring(0, 2), 16) || 0;
            const g = parseInt(h.substring(2, 4), 16) || 0;
            const b = parseInt(h.substring(4, 6), 16) || 0;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        },

        // 设置名字栏中的分辨率标注
        _applyRes(el, w, h) {
            const resEl = el.querySelector('.node-name-res:not(.node-char-badge):not(.node-char-wd)');
            if (resEl && w && h) {
                resEl.textContent = `${w}×${h}`;
            } else if (resEl) {
                resEl.textContent = '';
            }
        },

        // 根据画布缩放级别选择显示用 URL（保证网页效能）
        //   缩放 < 0.7  → 小缩略图(previewUrl, 150px)
        //   缩放 0.7~3  → 中缩略图(mediumUrl, 800px)
        //   缩放 > 3    → 原图(imageUrl)
        // 每档优先本级图；缺失时升档兜底（用更大图），避免落到小图糊掉（ref 节点可能无 mediumUrl）
        // 上传中的本地预览（blob URL，仅内存，不入存档）：上传期间立即显示原图，完成后换成云端缩略图
        _localUrls: {},
        setLocalPreview(id, file) {
            if (!id || !file || !/^image\//.test(file.type || '')) return;
            const url = URL.createObjectURL(file);
            this._localUrls[id] = url;
            const b0 = this.getById(id);
            if (b0) this._render(b0);
            // 按本地图真实比例先把节点框调好，上传完成后不再跳动
            const im = new Image();
            im.onload = () => {
                const b = this.getById(id);
                if (!b || !im.naturalWidth || !im.naturalHeight) return;
                const r = im.naturalWidth / im.naturalHeight;
                if (global.CanvasPano && global.CanvasPano.maybeSuggest) global.CanvasPano.maybeSuggest(b, im.naturalWidth, im.naturalHeight);
                if (Math.abs(r - (b.ratio || 1)) > 0.01) this.update(id, { ratio: r });
                else this._render(b);
            };
            im.src = url;
        },
        _dropLocalPreview(id) {
            const u = this._localUrls[id];
            if (!u) return;
            delete this._localUrls[id];
            setTimeout(() => { try { URL.revokeObjectURL(u); } catch (_) {} }, 1000);
        },

        _pickDisplayUrl(block) {
            const scale = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.scale) || 1;
            // 放大时不用原图（原图通常 3-10MB，几十张同时解码放大展示是帧率崩掉的直接原因）
            if (scale > 2.8) return block.mediumUrl || block.imageUrl || block.previewUrl || '';
            if (scale >= 0.6) return block.mediumUrl || block.imageUrl || block.previewUrl || '';
            return block.previewUrl || block.mediumUrl || block.imageUrl || '';
        },

        // 画布缩放变化时，若显示 URL 级别发生变化则重新渲染所有节点
        // 防抖：缩放过程中不切换 URL（避免分档边界附近反复切换导致闪烁），停止 200ms 后才执行
        refreshDisplayLevel() {
            const scale = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.scale) || 1;
            // 滞后缓冲：避免缩放值在 70% 或 300% 边界附近来回抖动时反复切换级别
            // （边界附近所有图片同时换源 = 70-80% 极其剧烈闪烁的根源）
            let level = this._lastDisplayLevel;
            if (typeof level !== 'number') { level = scale > 3 ? 2 : (scale >= 0.7 ? 1 : 0); }
            else if (level === 0 && scale > 0.75) level = 1;
            else if (level === 1 && scale < 0.6) level = 0;
            else if (level === 1 && scale > 3.2) level = 2;
            else if (level === 2 && scale < 2.8) level = 1;
            if (this._lastDisplayLevel === level) return;
            clearTimeout(this._refreshLevelTimer);
            this._refreshLevelTimer = setTimeout(() => {
                this._lastDisplayLevel = level;
            this.blocks.forEach(b => {
                if (!(b.imageUrl || b.previewUrl)) return;
                const el = this._getEl(b);
                const img = el && el.querySelector('.node-img');
                if (!img) { this._render(b); return; }
                // 视口外已裁剪的节点跳过：回到视口时由 applyViewportCulling 按当前级别恢复，
                // 避免缩放切换时对全部节点（含不可见节点）批量预加载造成卡顿
                if (img.dataset.culled === '1') return;
                const newUrl = this._pickDisplayUrl(b);
                if (!newUrl || img.getAttribute('src') === newUrl) return;
                // 新图预加载完成后再替换 src：旧图保持显示至新图就绪，避免切换瞬间闪烁
                const pre = new Image();
                pre.onload = () => {
                    // 节点可能已被重渲染，重新查询当前 DOM 再替换
                    const curEl = this.layerEl.querySelector(`[data-block-id="${b.id}"]`);
                    const curImg = curEl && curEl.querySelector('.node-img');
                    if (curImg) curImg.src = newUrl;
                };
                pre.src = newUrl;
            });
            }, 200);
        },

        // 将节点元素移到图层末尾（DOM 顺序即 z 序），多选组保持组内相对顺序
        _bringToFront(ids) {
            const layer = this.layerEl;
            if (!layer) return;
            const order = new Map();
            Array.from(layer.children).forEach((el, i) => order.set(el.dataset.blockId, i));
            ids.slice().sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0)).forEach(id => {
                const el = layer.querySelector(`[data-block-id="${id}"]`);
                if (el) layer.appendChild(el);
            });
        },

        // 视频节点分辨率：只加载元数据读取原视频宽高，记到节点上（videoResUrl 绑定地址，换视频后自动重读）
        _fetchVideoRes(block) {
            const url = block.videoUrl || block.mediaUrl;
            if (!url || block._vresFetching || block.videoExpired) return;
            block._vresFetching = true;
            this._vresQueue = this._vresQueue || [];
            this._vresQueue.push(() => new Promise((done) => {
                const v = document.createElement('video');
                const VP = global.VideoProxy;
                // 仅站内地址设 crossOrigin；外链不设，避免 CORS 校验失败导致元数据都读不到
                if (VP && VP.isInternalMedia && VP.isInternalMedia(VP.sameOrigin ? VP.sameOrigin(url) : url)) {
                    v.crossOrigin = 'anonymous';
                }
                v.preload = 'metadata';
                v.muted = true;
                let timer = null;
                const fin = () => {
                    clearTimeout(timer);
                    try { v.removeAttribute('src'); v.load(); } catch (_) {}
                    block._vresFetching = false;
                    done();
                };
                timer = setTimeout(fin, 20000);
                v.onloadedmetadata = () => {
                    const cur = this.getById(block.id);
                    if (cur && v.videoWidth && v.videoHeight && (cur.videoUrl || cur.mediaUrl) === url) {
                        cur.videoW = v.videoWidth;
                        cur.videoH = v.videoHeight;
                        cur.videoResUrl = url;
                        const curEl = this.layerEl.querySelector(`[data-block-id="${cur.id}"]`);
                        if (curEl) {
                            if (!curEl.querySelector('.node-name-res')) {
                                const info = curEl.querySelector('.node-name-info');
                                if (info) info.insertAdjacentHTML('afterend', '<span class="node-name-res"></span>');
                            }
                            this._applyRes(curEl, cur.videoW, cur.videoH);
                        }
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    }
                    fin();
                };
                v.onerror = fin;
                v.src = url;
            }));
            this._vresPump();
        },
        _vresPump() {
            this._vresActive = this._vresActive || 0;
            while (this._vresActive < 2 && this._vresQueue && this._vresQueue.length) {
                this._vresActive++;
                this._vresQueue.shift()().then(() => { this._vresActive--; this._vresPump(); });
            }
        },

        // 异步获取原图真实分辨率（不依赖显示中的缩略图）
        _fetchImageRes(block, el) {
            if (block._resFetching) return;
            block._resFetching = true;
            const probe = new Image();
            probe.onload = () => {
                block._resFetching = false;
                if (probe.naturalWidth && probe.naturalHeight) {
                    block._imgW = probe.naturalWidth;
                    block._imgH = probe.naturalHeight;
                    // 节点可能已被重新渲染，重新查询当前 DOM
                    const curEl = this.layerEl.querySelector(`[data-block-id="${block.id}"]`);
                    if (curEl) this._applyRes(curEl, block._imgW, block._imgH);
                }
            };
            probe.onerror = () => { block._resFetching = false; };
            probe.src = block.imageUrl;
        },

        _bindNodeEvents(el, block) {
            // 拖拽移动（点在名字栏/图片/空白处，避开端口与手柄）
            el.addEventListener('mousedown', (e) => {
                if (e.target.closest('.port') || e.target.closest('.node-handle-br')) return;
                if (CanvasCore.tool === 'hand' || CanvasCore.spaceDown || e.button !== 0) return;
                e.stopPropagation();

                // 点击节点：取消分组框激活态（隐藏四角手柄）
                if (this._activeGroupId) {
                    this._activeGroupId = null;
                    this._syncGroupFrames();
                }

                // 记录点击前是否已选中
                const wasSelected = global.CanvasSelection && global.CanvasSelection.isSelected(block.id);

                // Shift 多选：mousedown 立即处理
                if (e.shiftKey && global.CanvasSelection) {
                    global.CanvasSelection.handleBlockMouseDown(block.id, e);
                } else if (!wasSelected && global.CanvasSelection) {
                    // 未选中且非 Shift：立即清空其他选中（暂不选中当前节点，等 mouseup 未拖动再选中）
                    global.CanvasSelection.selected.clear();
                    global.CanvasSelection._syncDom();
                    // 清空选择后立即通知：让节点旁的提示词浮层立刻切回底部停靠，避免拖动期间浮层残留
                    if (global.CanvasMain) global.CanvasMain.onSelectionChange();
                }
                if (global.CanvasMain) global.CanvasMain.onNodeMouseDown(block.id);

                // textarea 编辑态时不进入拖拽（让原生选区工作）
                const ta = e.target.closest('.node-textarea');
                if (ta && ta.dataset.editing === '1') return;

                // 拖拽（textarea 非编辑态时也参与拖拽）
                const ids = wasSelected
                    ? (global.CanvasSelection ? global.CanvasSelection.getSelectedIds().slice() : [])
                    : [];
                // Shift+点击刚取消唯一选中时选择集可能为空：保证被点节点仍在拖拽集合中，避免空集合导致崩溃
                if (!ids.includes(block.id)) ids.push(block.id);
                // 点击的节点（含多选组）提升到最上层：DOM 顺序置顶，取消选中后仍保持，直到点击其他节点
                this._bringToFront(ids);
                this._drag = {
                    startX: e.clientX, startY: e.clientY,
                    items: ids.map(id => { const b = this.getById(id); return { id, ox: b.x, oy: b.y }; }),
                    moved: false,
                    blockId: block.id,
                    wasSelected: wasSelected,
                    shiftKey: e.shiftKey
                };
                // _DRAGFIX_1027 全部被拖节点统一加 .dragging 禁用 left/top 过渡（只给被点节点加时，其余成员有滞后错位感）
                ids.forEach(id => {
                    const del = this.layerEl.querySelector(`[data-block-id="${id}"]`);
                    if (del) del.classList.add('dragging');
                    const dsh = this._getShadow(id);
                    if (dsh) dsh.classList.add('dragging');
                });
                // 拖动开始：降低彗星透明度 + 标记拖动态（跳过昂贵的 getTotalLength）
                document.querySelectorAll('.edge-comets').forEach(g => g.classList.add('dragging'));
                if (global.CanvasEdges) global.CanvasEdges.setDragging(true, ids.length > 1);
            });

            // 双击名字 → 重命名；双击 textarea → 进入编辑
            // 3D 片场节点：连击计数判定双击打开编辑器（选中时节点会重渲染，dblclick 事件不可靠）
            el.addEventListener('mousedown', (e) => {
                if (e.detail !== 2 || e.button !== 0 || !global.CanvasStage3D) return;
                const cur = this.getById(block.id);
                if (cur && cur.subType === 'stage3d' && e.target.closest('.node-body')) { e.preventDefault(); global.CanvasStage3D.onNodeDblClick(cur); }
            });
            el.addEventListener('dblclick', (e) => {
                if (e.target.closest('.node-name')) {
                    e.stopPropagation();
                    e.preventDefault();
                    const nameEl = el.querySelector('.node-name');
                    if (nameEl) this._beginRename(block, nameEl);
                    return;
                }
                // 双击 textarea → 进入编辑态
                const ta = e.target.closest('.node-textarea');
                if (ta) {
                    e.stopPropagation();
                    e.preventDefault();
                    this._focusTextarea(el);
                    return;
                }
            });

            // textarea 的 blur/Esc/编辑态 mousedown 监听在 _renderInner 中随每次渲染重绑（innerHTML 会重建元素）

            // 右键菜单
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (global.CanvasMain) global.CanvasMain.showBlockMenu(block.id, e.clientX, e.clientY);
            });

            // 文本节点 resize 手柄监听已移至 _renderInner 随渲染重绑（innerHTML 重建会丢失此处绑定）
        },

        _beginRename(block, nameEl) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'node-name-input';
            input.value = block.name || '';
            input.spellcheck = false;
            nameEl.replaceWith(input);
            input.focus();
            input.select();
            const commit = () => {
                // 防重入：blur 与 Enter 会先后触发两次提交
                if (input._committed) return;
                input._committed = true;
                // 先移除输入框再更新：否则渲染保护检测到输入框仍在 DOM 会跳过重渲染，
                // 输入框永远留在原地不被替换回名字元素
                if (input.parentNode) input.remove();
                this.update(block.id, { name: input.value.trim() || block.name });
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { input.value = block.name; input.blur(); }
            });
            input.addEventListener('mousedown', ev => ev.stopPropagation());
        },

        _bindGlobalMove() {
            // 节点图片加载失败（如限流 429）：捕获阶段监听 error（error 不冒泡），
            // 2 秒后延迟重试一次；加载成功复位标记，新 src 仍可重试。避免平移缩放期间密集重发加剧限流
            this.layerEl.addEventListener('error', (e) => {
                const img = e.target;
                if (!img || !img.classList || !img.classList.contains('node-img')) return;
                if (img.dataset.retried === '1') return;
                img.dataset.retried = '1';
                const src = img.getAttribute('src');
                setTimeout(() => {
                    if (img.isConnected && img.dataset.culled !== '1' && src) {
                        img.src = src;
                    }
                }, 2000);
            }, true);
            this.layerEl.addEventListener('load', (e) => {
                const img = e.target;
                if (img && img.classList && img.classList.contains('node-img')) img.dataset.retried = '';
            }, true);
            window.addEventListener('mousemove', (e) => {
                // 文本节点 resize
                if (this._resize) {
                    const dx = (e.clientX - this._resize.startX) / CanvasCore.viewport.scale;
                    const dy = (e.clientY - this._resize.startY) / CanvasCore.viewport.scale;
                    const b = this.getById(this._resize.id);
                    if (b) {
                        b.w = Math.max(120, Math.round(this._resize.ow + dx));
                        b.h = Math.max(60, Math.round(this._resize.oh + dy));
                        const el = this.layerEl.querySelector(`[data-block-id="${b.id}"]`);
                        if (el) {
                            // 加 dragging 类禁用过渡，避免 resize 跟手延迟
                            el.classList.add('dragging');
                            el.style.width = b.w + 'px';
                            el.style.height = b.h + 'px';
                        }
                        const sh = this._getShadow(b.id);
                        if (sh) {
                            sh.classList.add('dragging');
                            sh.style.width = b.w + 'px';
                            sh.style.height = b.h + 'px';
                        }
                        if (global.CanvasEdges) global.CanvasEdges.refresh();
                    }
                    return;
                }
                if (this._drag) {
                    const dx = (e.clientX - this._drag.startX) / CanvasCore.viewport.scale;
                    const dy = (e.clientY - this._drag.startY) / CanvasCore.viewport.scale;
                    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                        if (!this._drag.moved) {
                            this._drag.moved = true;
                            // 拖动开始：通知 CanvasMain 隐藏浮层
                            if (global.CanvasMain && typeof global.CanvasMain.onNodeDragStart === 'function') {
                                global.CanvasMain.onNodeDragStart();
                            }
                        }
                    }
                    // 先按原始偏移计算主拖节点的"自由位置"
                    const mainItem = this._drag.items.find(it => it.id === this._drag.blockId) || this._drag.items[0];
                    if (!mainItem) return;  // 防御：拖拽集合为空时直接忽略
                    let mainX = mainItem.ox + dx;
                    let mainY = mainItem.oy + dy;
                    const mainBlock = this.getById(mainItem.id);
                    // 吸附检测：以主拖节点为锚点，与其他非选中节点比对
                    let snapDx = 0, snapDy = 0;
                    let guides = { x: null, y: null };
                    if (global.CanvasSnap && mainBlock) {
                        const selectedIds = new Set(this._drag.items.map(it => it.id));
                        const others = this.blocks.filter(b => !selectedIds.has(b.id));
                        const res = global.CanvasSnap.snap(
                            { x: mainX, y: mainY, w: mainBlock.w, h: mainBlock.h },
                            others
                        );
                        snapDx = res.x - mainX;
                        snapDy = res.y - mainY;
                        guides = res.guides;
                    }
                    // 应用位置：所有选中节点按相同偏移移动（含吸附修正）
                    this._drag.items.forEach(it => {
                        const b = this.getById(it.id);
                        if (!b) return;
                        b.x = it.ox + dx + snapDx;
                        b.y = it.oy + dy + snapDy;
                        const el = this.layerEl.querySelector(`[data-block-id="${it.id}"]`);
                        if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
                        const sh = this._getShadow(it.id);
                        if (sh) { sh.style.left = b.x + 'px'; sh.style.top = b.y + 'px'; }
                    });
                    // 渲染参考线（基于主拖节点吸附后的位置）
                    if (global.CanvasSnap && mainBlock) {
                        const snappedMain = this.getById(mainItem.id);
                        const selectedIds = new Set(this._drag.items.map(it => it.id));
                        const others = this.blocks.filter(b => !selectedIds.has(b.id));
                        global.CanvasSnap.renderGuides(
                            guides,
                            { x: snappedMain.x, y: snappedMain.y, w: snappedMain.w, h: snappedMain.h },
                            others
                        );
                    }
                    // 分组框随成员整体平移（几何范围独立存储）
                    if (this._drag.groupGid && this.groups[this._drag.groupGid]) {
                        const g = this.groups[this._drag.groupGid];
                        g.x = this._drag.og.x + dx + snapDx;
                        g.y = this._drag.og.y + dy + snapDy;
                    }
                    if (global.CanvasEdges) global.CanvasEdges.refresh(this._drag.items.map(it => it.id));
                    if (global.CanvasMain) global.CanvasMain.onNodeMoved();
                    if (global.CanvasSelection) global.CanvasSelection._renderBounds();
                    // _DRAGFIX_1027 组框拖动中只平移当前组框（全量 _syncGroupFrames 每帧扫全部节点/组，逐帧执行有延迟感）
                    if (this._drag.groupGid && this.groups[this._drag.groupGid]) {
                        const gcur = this.groups[this._drag.groupGid];
                        const gframe = this.groupsLayerEl && this.groupsLayerEl.querySelector(`[data-group-id="${this._drag.groupGid}"]`);
                        if (gframe) { gframe.style.left = gcur.x + 'px'; gframe.style.top = gcur.y + 'px'; }
                    } else if (this.groups && Object.keys(this.groups).length) {
                        this._syncGroupFrames();
                    }
                } else {
                    // 非拖拽时：全局统一控制端口显隐（选中节点端口常亮 + 吸附范围内其他节点端口隐藏）
                    this._lastMousePos = { clientX: e.clientX, clientY: e.clientY };
                    this._updatePortsVisibility(e.clientX, e.clientY);
                }
            });
            window.addEventListener('mouseup', () => {
                // 文本节点 resize 结束
                if (this._resize) {
                    const el = this.layerEl.querySelector(`[data-block-id="${this._resize.id}"]`);
                    if (el) el.classList.remove('dragging');
                    const sh = this._getShadow(this._resize.id);
                    if (sh) sh.classList.remove('dragging');
                    if (global.CanvasHistory) global.CanvasHistory.snapshot();
                    if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    this._resize = null;
                    return;
                }
                if (this._drag) {
                    const dragInfo = this._drag;
                    // _DRAGFIX_1027 按拖拽集合全量清理 .dragging（组框/多选拖动时成员不止 blockId 一个）
                    (dragInfo.items || []).forEach(it => {
                        const el = this.layerEl.querySelector(`[data-block-id="${it.id}"]`);
                        if (el) el.classList.remove('dragging');
                        const sh = this._getShadow(it.id);
                        if (sh) sh.classList.remove('dragging');
                    });
                    // 框选背景发起的拖拽：清理选框的拖拽态
                    if (dragInfo.fromFrame && global.CanvasSelection && global.CanvasSelection._boundsEl) {
                        global.CanvasSelection._boundsEl.classList.remove('dragging');
                    }
                    // 拖动结束：恢复彗星透明度 + 重算 dasharray（拖动期间跳过了 getTotalLength）
                    document.querySelectorAll('.edge-comets').forEach(g => g.classList.remove('dragging'));
                    if (global.CanvasEdges) {
                        global.CanvasEdges.setDragging(false);
                        global.CanvasEdges.refresh();  // 完整刷新：重算 dasharray + 更新所有边
                    }
                    // 拖动结束：清除吸附参考线
                    if (global.CanvasSnap) global.CanvasSnap.clearGuides();
                    const moved = dragInfo.moved;
                    const clickId = dragInfo.blockId;
                    this._drag = null;
                    if (moved) {
                        // 节点被拖出分组后，清理空分组
                        this._cleanupEmptyGroups();
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    } else {
                        // 未拖动 → 视为点击：松开鼠标才执行选中（框选背景/分组框发起的拖拽保持原选择）
                        if (!dragInfo.shiftKey && !dragInfo.fromFrame && global.CanvasSelection) {
                            global.CanvasSelection.handleBlockMouseDown(dragInfo.blockId, { shiftKey: false });
                        }
                    }
                    // 通知 CanvasMain 拖动结束
                    if (global.CanvasMain && typeof global.CanvasMain.onNodeDragEnd === 'function') {
                        global.CanvasMain.onNodeDragEnd(moved);
                    }
                    // 未拖动 → 视为点击：显示浮层
                    if (!moved && clickId && !dragInfo.fromFrame && global.CanvasMain && typeof global.CanvasMain.onNodeClick === 'function') {
                        global.CanvasMain.onNodeClick(clickId);
                    }
                }
            });
        },

        // ===== 分组容器框：几何范围模型 =====
        // 成员 = 完全落在分组范围内的节点（哪怕只超出一点也不算）；范围独立存储，不随成员自动变化
        // _GRPPAD_1027 26 -> 44：组框向外多延伸一圈，边缘更好点中拖动
        GROUP_PAD: 44,

        // 完全落在分组范围内的节点
        _nodesInGroup(gid) {
            const g = this.groups[gid];
            if (!g) return [];
            return this.blocks.filter(b =>
                b.x >= g.x && b.y >= g.y && b.x + b.w <= g.x + g.w && b.y + b.h <= g.y + g.h
            );
        },

        // 清理没有任何成员的空分组（拖动/调整结束后调用）
        _cleanupEmptyGroups() {
            let changed = false;
            Object.keys(this.groups).forEach(gid => {
                if (this._nodesInGroup(gid).length === 0) {
                    delete this.groups[gid];
                    if (this._activeGroupId === gid) this._activeGroupId = null;
                    changed = true;
                }
            });
            if (changed) this._syncGroupFrames();
        },

        serializeGroups() {
            return JSON.parse(JSON.stringify(this.groups || {}));
        },
        loadGroups(obj) {
            Object.assign(this.groups, obj || {});
            this._syncGroupFrames();
        },

        // 端口渐显/渐隐 + 磁吸缓动状态机：rAF 驱动内联样式（不经 CSS 过渡，
        // 避免合成层动画结束后浏览器复用旧分辨率位图导致端口发虚）
        // 宿主可以是节点，也可以是多选包围框（两者端口用同一套类名与逻辑）
        _setupPortFx(el) {
            if (el._portState) { el._portFxWake(); return; }
            // 每个端口的动效状态：o=透明度、tx/ty=位移的当前值，to/ttx/tty 为目标值，逐帧指数趋近
            const state = {
                out: { o: 0, tx: 0, ty: 0, to: 0, ttx: 0, tty: 0, sel: '.port-out', hitSel: '.port-out-hit' },
                in: { o: 0, tx: 0, ty: 0, to: 0, ttx: 0, tty: 0, sel: '.port-in', hitSel: '.port-in-hit' }
            };
            let rafId = 0;
            const tick = () => {
                rafId = 0;
                let settled = true;
                Object.keys(state).forEach(key => {
                    const s = state[key];
                    s.o += (s.to - s.o) * 0.25;
                    s.tx += (s.ttx - s.tx) * 0.3;
                    s.ty += (s.tty - s.ty) * 0.3;
                    if (Math.abs(s.to - s.o) > 0.01 || Math.abs(s.ttx - s.tx) > 0.3 || Math.abs(s.tty - s.ty) > 0.3) {
                        settled = false;
                    } else { s.o = s.to; s.tx = s.ttx; s.ty = s.tty; }
                    const portEl = el.querySelector(s.sel);
                    if (!portEl) return;
                    portEl.style.opacity = s.o;
                    const t = `translateY(-50%) translate(${s.tx}px, ${s.ty}px)`;
                    portEl.style.transform = t;
                    // 隐藏态端口（含命中区）不参与命中，事件穿透给下方元素，
                    // 避免被屏蔽的端口挡住选中节点/包围框的端口命中区
                    const pe = s.to > 0 ? 'auto' : 'none';
                    portEl.style.pointerEvents = pe;
                    // 命中区跟随端口一起移动，确保磁吸后点击吸附位置的端口仍可触发连线拖拽
                    const hitEl = el.querySelector(s.hitSel);
                    if (hitEl) {
                        hitEl.style.transform = t;
                        hitEl.style.pointerEvents = pe;
                    }
                });
                if (!settled) rafId = requestAnimationFrame(tick);
            };
            el._portState = state;
            el._portFxWake = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
            el._portFxWake();
        },

        // 全局统一控制端口显隐 + 磁吸位移（由 window mousemove 驱动，鼠标在任何位置都能收到）
        //   显示条件：宿主被选中（常亮），或鼠标在宿主内部/落在端口吸附半径内
        //   屏蔽规则：鼠标落在「选中宿主的端口圈半径」内时，其他宿主端口不触发
        //   磁吸位移：鼠标在宿主外侧（输出端口右侧 / 输入端口左侧）且在半径内时，端口跟随鼠标
        _updatePortsVisibility(clientX, clientY) {
              if (this._lastPortCalc && Math.abs(clientX - this._lastPortCalc.clientX) < 1 && Math.abs(clientY - this._lastPortCalc.clientY) < 1) return;
              this._lastPortCalc = { clientX, clientY };
            const scale = (global.CanvasCore && global.CanvasCore.viewport.scale) || 1;
            const R = this._portMagnetR;
            const PORT_REST_OFFSET = 12;
            const selectedSet = (global.CanvasSelection && global.CanvasSelection.selected) || new Set();

            // 端口宿主 = 所有节点 + 多选包围框（包围框只有输出端口，且视为常亮的选中宿主）
            const hosts = [];
            for (const b of this.blocks) {
                const el = this.layerEl.querySelector(`[data-block-id="${b.id}"]`);
                if (!el || !el._portState) continue;
                hosts.push({ el, block: b, selected: selectedSet.has(b.id), hasIn: b.nodeType === 'gen' });
            }
            const boundsEl = global.CanvasSelection && global.CanvasSelection._boundsEl;
            if (boundsEl && boundsEl._portState) {
                hosts.push({ el: boundsEl, selected: true, hasIn: false });
            }
            if (!hosts.length) return;

            // 逐宿主计算：是否悬停在宿主内、端口到鼠标的世界距离
            for (const h of hosts) {
                const rect = (h.block && global.CanvasCore && global.CanvasCore._vpRect) ? (function(){ const c=global.CanvasCore, v=c.viewport, r=c._vpRect, sc=v.scale||1; return { left: r.left+h.block.x*sc+v.x, top: r.top+h.block.y*sc+v.y, right: r.left+(h.block.x+h.block.w)*sc+v.x, bottom: r.top+(h.block.y+h.block.h)*sc+v.y, width: h.block.w*sc, height: h.block.h*sc }; })() : h.el.getBoundingClientRect();
                const cy = rect.top + rect.height / 2;
                h.rect = rect;
                h.hover = clientX >= rect.left && clientX <= rect.right
                    && clientY >= rect.top && clientY <= rect.bottom;
                // 输出端口静止中心（屏幕坐标）
                const outCx = rect.right + PORT_REST_OFFSET * scale;
                h.outDx = (clientX - outCx) / scale;
                h.outDy = (clientY - cy) / scale;
                h.outDist = Math.hypot(h.outDx, h.outDy);
                // 输入端口（仅 gen 节点有）
                h.inDx = 0; h.inDy = 0; h.inDist = Infinity;
                if (h.hasIn) {
                    const inCx = rect.left - PORT_REST_OFFSET * scale;
                    h.inDx = (clientX - inCx) / scale;
                    h.inDy = (clientY - cy) / scale;
                    h.inDist = Math.hypot(h.inDx, h.inDy);
                }
                h.inRange = h.hover || h.outDist < R || h.inDist < R;
            }

            // 多选时（选中节点数 > 1）：被框选中的节点的端口完全隐藏，
            // 只显示包围框（boundsEl）的端口，避免拉线时误选中单个节点端口拉错线
            const multiSelect = selectedSet.size > 1;

            // 屏蔽判定：多选时只看包围框的端口圈；单选时只看选中节点的端口圈
            const inSelectedPortCircle = hosts.some(h =>
                h.selected && (multiSelect ? (h.el === boundsEl) : true) && (h.outDist < R || h.inDist < R));

            for (const h of hosts) {
                let outTo = 0, inTo = 0;
                const isBounds = (h.el === boundsEl);
                if (isBounds) {
                    // 包围框端口：常亮（多选时唯一可拉线的端口）
                    outTo = 1; inTo = 0;
                } else if (multiSelect && h.selected) {
                    // 多选时被框选中的节点端口：完全隐藏，只能从包围框拉线
                    outTo = 0; inTo = 0;
                } else if (h.selected) {
                    // 单选时选中的节点端口：常亮
                    outTo = 1; inTo = h.hasIn ? 1 : 0;
                } else if (inSelectedPortCircle) {
                    outTo = 0; inTo = 0;
                } else if (h.inRange) {
                    outTo = 1; inTo = h.hasIn ? 1 : 0;
                }

                const state = h.el._portState;
                state.out.to = outTo;
                state.in.to = inTo;

                // 磁吸位移：位移目标按屏幕像素取整，避免亚像素渲染发虚
                const applyMagnet = (s, show, outside, dx, dy, dist) => {
                    if (show && outside && dist < R) {
                        s.ttx = Math.round(dx * scale) / scale;
                        s.tty = Math.round(dy * scale) / scale;
                    } else { s.ttx = 0; s.tty = 0; }
                };
                applyMagnet(state.out, outTo > 0, clientX >= h.rect.right, h.outDx, h.outDy, h.outDist);
                applyMagnet(state.in, inTo > 0, clientX <= h.rect.left, h.inDx, h.inDy, h.inDist);

                h.el._portFxWake();
            }
        },

        _syncGroupFrames() {
            const layer = this.groupsLayerEl;
            if (!layer) return;
            // 移除已删除的分组框
            Array.from(layer.children).forEach(f => { if (!this.groups[f.dataset.groupId]) f.remove(); });
            // 所有节点的"在组内"标记（组框之上、组内节点最高的层级规则）
            const inGroupIds = new Set();
            Object.keys(this.groups).forEach(gid => {
                this._nodesInGroup(gid).forEach(b => inGroupIds.add(b.id));
            });
            this.layerEl.querySelectorAll('.canvas-node').forEach(el => {
                el.classList.toggle('in-group', inGroupIds.has(el.dataset.blockId));
            });
            Object.keys(this.groups).forEach(gid => {
                const g = this.groups[gid];
                const members = this._nodesInGroup(gid);
                let frame = layer.querySelector(`[data-group-id="${gid}"]`);
                if (!frame) {
                    frame = document.createElement('div');
                    frame.className = 'group-frame';
                    frame.dataset.groupId = gid;
                    frame.innerHTML = '<div class="group-title"></div>' +
                        '<div class="group-toolbar toolbar-capsule">' +
                            '<button class="gt-btn" data-action="arrange" title="自动整理"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span class="tb-lb">自动整理</span></button>' +
                            '<button class="gt-btn" data-action="ungroup" title="解除分组"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg><span class="tb-lb">解除分组</span></button>' +
                            '<label class="gt-btn gt-color" title="更改打组框背景色"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6c0-4.4-4.5-8.4-10-8.4z"/></svg><span class="tb-lb">背景色</span><input type="color" class="gt-color-input"></label>' +
                        '</div>' +
                        '<div class="gf-handle gf-nw" data-corner="nw"></div>' +
                        '<div class="gf-handle gf-ne" data-corner="ne"></div>' +
                        '<div class="gf-handle gf-sw" data-corner="sw"></div>' +
                        '<div class="gf-handle gf-se" data-corner="se"></div>';
                    this._bindGroupFrame(frame, gid);
                    layer.appendChild(frame);
                }
                frame.style.left = g.x + 'px';
                frame.style.top = g.y + 'px';
                frame.style.width = g.w + 'px';
                frame.style.height = g.h + 'px';
                // 背景色：自定义颜色 16% 透明度，未设置时用 CSS 默认灰
                frame.style.background = g.bgColor ? this._hexToRgba(g.bgColor, 0.16) : '';
                const colorInput = frame.querySelector('.gt-color-input');
                if (colorInput && colorInput.value !== (g.bgColor || '#9696a0')) {
                    colorInput.value = g.bgColor || '#9696a0';
                }
                const tEl = frame.querySelector('.group-title');
                if (g.kind === 'director') {
                    // 导演台分组：「导演台 · 片名」（片名为用户内容，不参与界面翻译）
                    const key = 'dir|' + (g.title || '');
                    if (tEl._dirKey !== key) {
                        tEl._dirKey = key;
                        tEl.innerHTML = '<span class="gt-dir"><span class="gt-dir-badge">导演台</span>' + (g.title ? '<span class="gt-dir-name">·</span><span class="gt-dir-name px-no-i18n">' + this._esc(g.title) + '</span>' : '') + '</span>';
                    }
                    frame.classList.add('is-director');
                } else if (g.title) {
                    // 自定义标题（AI 助手打组时命名；用户内容，不参与界面翻译）
                    const key = 't|' + g.title;
                    if (tEl._dirKey !== key) { tEl._dirKey = key; tEl.innerHTML = '<span class="px-no-i18n">' + this._esc(g.title) + '</span>'; }
                    frame.classList.remove('is-director');
                } else {
                    tEl._dirKey = '';
                    tEl.textContent = `分组 ${members.length} 个节点`;
                    frame.classList.remove('is-director');
                }
                // 点击分组框后才显示四角手柄
                frame.classList.toggle('active', this._activeGroupId === gid);
            });
        },

        _bindGroupFrame(frame, gid) {
            // 拖动框体：激活分组（不再触发节点选中/框选），组框与组内成员一起移动
            frame.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.gf-handle')) return;
                if (e.target.closest('.group-toolbar')) return;
                e.stopPropagation();
                e.preventDefault();
                const g = this.groups[gid];
                if (!g) return;
                // 清空节点选中（不出现多选框），激活当前分组
                if (global.CanvasSelection) global.CanvasSelection.clear();
                this._activeGroupId = gid;
                this._syncGroupFrames();
                const members = this._nodesInGroup(gid);
                // _DRAGFIX_1027 组框拖动：所有成员同步加 .dragging 禁用过渡（否则成员各自 CSS 过渡滞后于指针，产生错位感）
                members.forEach(b => {
                    const mel = this.layerEl.querySelector(`[data-block-id="${b.id}"]`);
                    if (mel) mel.classList.add('dragging');
                    const msh = this._getShadow(b.id);
                    if (msh) msh.classList.add('dragging');
                });
                document.querySelectorAll('.edge-comets').forEach(gc => gc.classList.add('dragging'));
                if (global.CanvasEdges) global.CanvasEdges.setDragging(true, true);
                this._drag = {
                    startX: e.clientX, startY: e.clientY,
                    items: members.map(b => ({ id: b.id, ox: b.x, oy: b.y })),
                    moved: false,
                    blockId: members.length ? members[0].id : null,
                    shiftKey: false,
                    fromFrame: true,        // 分组框发起：松手时不做单选/点击处理
                    groupGid: gid,          // 组框随成员一起平移
                    og: { x: g.x, y: g.y }
                };
            });

            // 四角手柄：只调整分组范围（节点大小不变），成员按"是否完全在框内"自动加入/脱离
            frame.querySelectorAll('.gf-handle').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    const g = this.groups[gid];
                    if (!g) return;
                    const corner = handle.dataset.corner;
                    const MIN = 80; // 分组框最小尺寸
                    // 固定点 = 对角
                    const ax = corner.includes('w') ? g.x + g.w : g.x;
                    const ay = corner.includes('n') ? g.y + g.h : g.y;
                    let moved = false;
                    const onMove = (ev) => {
                        const w = CanvasCore.screenToWorld(ev.clientX, ev.clientY);
                        // 根据角方向调整对应边（固定对角，最小尺寸 MIN）
                        if (corner.includes('w')) { g.x = Math.min(w.x, ax - MIN); g.w = ax - g.x; }
                        else { g.w = Math.max(MIN, w.x - ax); }
                        if (corner.includes('n')) { g.y = Math.min(w.y, ay - MIN); g.h = ay - g.y; }
                        else { g.h = Math.max(MIN, w.y - ay); }
                        moved = true;
                        this._syncGroupFrames();
                    };
                    const onUp = () => {
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                        if (moved) {
                            this._cleanupEmptyGroups();
                            if (global.CanvasHistory) global.CanvasHistory.snapshot();
                            if (global.CanvasStore) global.CanvasStore.scheduleSave();
                        }
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                });
            });

            // 分组工具栏：自动整理（与多选整理同理，排列后自动重置打组框范围）+ 背景色
            const toolbar = frame.querySelector('.group-toolbar');
            if (toolbar) {
                toolbar.addEventListener('mousedown', e => e.stopPropagation());
                toolbar.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    e.stopPropagation();
                    if (btn.dataset.action === 'ungroup') {
                        // 解除分组：删除组框，保留所有节点
                        this.removeGroup(gid, false);
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                        return;
                    }
                    if (btn.dataset.action !== 'arrange') return;
                    const ids = this._nodesInGroup(gid).map(b => b.id);
                    if (ids.length < 2 || !global.CanvasMain) return;
                    global.CanvasMain._renderMenu([
                        { label: '自动排列', act: () => global.CanvasMain._arrangeNodes(ids, 'auto') },
                        { label: '水平排列', act: () => global.CanvasMain._arrangeNodes(ids, 'horizontal') },
                        { label: '垂直排列', act: () => global.CanvasMain._arrangeNodes(ids, 'vertical') }
                    ], e.clientX, e.clientY);
                });
                const colorInput = toolbar.querySelector('.gt-color-input');
                if (colorInput) {
                    // 拖动取色实时预览；松手（change）记一次历史
                    colorInput.addEventListener('input', () => {
                        const g = this.groups[gid];
                        if (!g) return;
                        g.bgColor = colorInput.value;
                        frame.style.background = this._hexToRgba(g.bgColor, 0.16);
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    });
                    colorInput.addEventListener('change', () => {
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    });
                }
            }
        },

        // 删除分组：withMembers=true 连同组内节点一起删除；false 仅删除组框保留节点
        removeGroup(gid, withMembers) {
            const g = this.groups[gid];
            if (!g) return;
            if (withMembers) {
                this._nodesInGroup(gid).slice().forEach(b => this.remove(b.id));
            }
            delete this.groups[gid];
            if (this._activeGroupId === gid) this._activeGroupId = null;
            this._syncGroupFrames();
        },

        // 将分组范围重置为指定节点的包围盒 + 内边距（整理后自动重置打组框）
        _refitGroupToIds(gid, ids) {
            const g = this.groups[gid];
            if (!g) return;
            const blocks = (ids || []).map(id => this.getById(id)).filter(Boolean);
            if (!blocks.length) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            blocks.forEach(b => {
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            });
            const PAD = this.GROUP_PAD;
            g.x = minX - PAD; g.y = minY - PAD;
            g.w = (maxX - minX) + PAD * 2; g.h = (maxY - minY) + PAD * 2;
            this._syncGroupFrames();
        },

        getBounds() {
            if (this.blocks.length === 0) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            this.blocks.forEach(b => {
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            });
            return { minX, minY, maxX, maxY };
        },

        viewportCenterWorld() {
            const rect = CanvasCore.viewportEl.getBoundingClientRect();
            return CanvasCore.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        },

        clear() {
            this.blocks = [];
            this.groups = {};
            this._activeGroupId = null;
            this.layerEl.innerHTML = '';
            if (this.shadowLayerEl) this.shadowLayerEl.innerHTML = '';
            if (this.groupsLayerEl) this.groupsLayerEl.innerHTML = '';
        },

        serialize() {
            return this.blocks.map(b => {
                // 剔除会话级临时字段（下划线开头）：_resFetching/_vresFetching 持久化会导致重载后探测永久锁死，_el 为 DOM 引用
                const rest = {};
                Object.keys(b).forEach(k => { if (k.charAt(0) !== '_') rest[k] = b[k]; });
                return rest;
            });
        },
        load(arr) {
            this.clear();
            (arr || []).forEach(b => this.add(b));
            // 兼容旧版 groupId 打组标记：转换为几何分组范围（已有存储范围的分组不覆盖）
            const legacy = {};
            this.blocks.forEach(b => { if (b.groupId) (legacy[b.groupId] = legacy[b.groupId] || []).push(b); });
            Object.keys(legacy).forEach(gid => {
                const members = legacy[gid];
                members.forEach(b => { b.groupId = ''; });
                if (this.groups[gid]) return;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                members.forEach(b => {
                    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
                });
                const PAD = 26;
                this.groups[gid] = { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
            });
            this._syncGroupFrames();
        },

        _esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        }
    };

    global.CanvasBlocks = CanvasBlocks;
})(window);

/**
 * CanvasDraft —— Seedance 2.5 样片模式（画布侧 UI）
 *  - 样片节点左上角「样片」徽标（生成中/完成后都显示）
 *  - 样片完成后：节点覆盖层 + 工具栏出现「生成1080成片」按钮，带按天倒计时（7 天有效期，纯前端展示，服务端有硬校验）
 *  - 点击弹确认卡片：成片规格 1080P / 时长 / 价格（1080p 价 × 计费秒，含参考视频折算）/ 当前余额；确认后走
 *    CanvasGenerate.runNode 同一链路提交成片任务（params.upgradeFromDraft），完成后成片成为节点新版本
 *    （genHistory 保留样片与成片两版可切换），节点「样片」徽标消失
 */
(function (global) {
    'use strict';
    const VALID_MS = 7 * 24 * 3600 * 1000;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5-5 5 5"/><path d="M5 21h14"/></svg>';

    const CanvasDraft = {
        _mask: null,

        // 当前展示的这一条结果是否是样片：只看结果本身的 draft 标记，不再要求节点当前模型是 Seedance 2.5
        // （节点换模型重新生成、或成片后切回历史样片时，样片态由 genHistory 记录恢复，不受节点模型影响）
        isDraftNode(b) {
            return !!(b && b.nodeType === 'gen' && b.draft === true &&
                (b.videoUrl || b.mediaType === 'video' || b.status === 'generating'));
        },
        // 样片完成时刻起 7 天内可升级；draftAt 缺失（生成中/尚未完成）视为不可升级
        leftMs(b) {
            if (!this.isDraftNode(b) || !b.draftAt) return -1;
            return VALID_MS - (Date.now() - b.draftAt);
        },
        isExpired(b) {
            const l = this.leftMs(b);
            return l !== -1 && l <= 0;
        },
        daysLeft(b) {
            return Math.max(0, Math.ceil(this.leftMs(b) / (24 * 3600 * 1000)));
        },

        // 节点体内：仅「样片」纯文字徽标（升级入口统一放在提示词面板操作行，不覆盖画面）
        bodyHtml(b) {
            if (!this.isDraftNode(b)) return '';
            return `<span class="draft-badge" title="样片（480p），7 天内可升级 1080p 成片">样片</span>`;
        },

        // 节点工具栏入口（与画面下方操作条同一动作）
        toolbarHtml(b) {
            if (!this.isDraftNode(b) || !b.draftTaskId || !b.draftAt || this.isExpired(b)) return '';
            if (b.status === 'generating' || b.status === 'loading') return '';
            return `<button class="node-tool-text" data-action="draft-upgrade" title="用这条样片生成 1080p 成片">${UP_SVG.replace('<svg ', '<svg class="tb-ic" ')}<span class="tb-lb">生成1080成片</span></button>`;
        },

        // 1080 升级的规格与价格（升级用的模型/时长以「样片这条记录」为准：
        // 节点当前模型可能已被用户换成别的（未生成），若仍按节点模型提交，服务端会按错模型校验/计价）
        _upgradeInfo(b) {
            const PB = global.PromptBar;
            const GH = global.GenHistory;
            const ent = (GH && Array.isArray(b.genHistory)) ? (b.genHistory.find(x => x.id === b.genHistoryActive) || null) : null;
            const ep = (ent && ent.params) || {};
            const modelId = (ep.model && /seedance-2[_-]?5|sd25/i.test(String(ep.model))) ? ep.model : b.model;
            const cfg = (PB && PB.modelConfigMap && PB.modelConfigMap[modelId]) || {};
            const pm = cfg.priceMatrix || {};
            const dur = parseInt(ep.duration, 10) || parseInt(b.duration, 10) || 5;
            const billSec = parseInt(b.draftBillSec, 10) || dur;
            const refSec = Math.max(0, billSec - dur);
            // 价格：与服务端预扣同式——1080p 价 × 计费秒；矩阵缺档按最大档每秒单价外推
            let price = 0;
            const row1080 = pm['1080p'] || {};
            if (typeof row1080[String(billSec)] === 'number') price = row1080[String(billSec)];
            else {
                const keys = Object.keys(row1080).map(Number).filter(n => isFinite(n) && n > 0);
                const maxD = keys.length ? Math.max.apply(null, keys) : 0;
                if (maxD && typeof row1080[String(maxD)] === 'number') price = Math.round(row1080[String(maxD)] / maxD * billSec);
            }
            return { ent: ent, ep: ep, modelId: modelId, cfg: cfg, pm: pm, dur: dur, billSec: billSec, refSec: refSec, price: price };
        },

        _upgradeRunParams(b, info) {
            return {
                baseUrl: '',
                prompt: (info.ep.prompt || b.prompt || '').trim(),
                model: info.modelId,
                aspectRatio: info.ep.aspectRatio || b.aspectRatio,
                imageSize: info.ep.size || b.size,
                duration: info.dur,
                imageUrls: [],
                api: 'auto',
                upgradeFromDraft: { taskId: b.draftTaskId }
            };
        },

        // 确认卡片：规格 / 价格 / 余额（余额不足引导充值）
        async openConfirm(nodeId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || !this.isDraftNode(b) || !b.draftTaskId) return;
            if (b.status === 'generating') return;
            if (this._mask) this.closeConfirm();
            const info = this._upgradeInfo(b);
            const dur = info.dur, refSec = info.refSec, price = info.price;
            let credits = null;
            try {
                const res = await fetch(`${global.API_CONFIG.baseUrl}/api/user/credits`, { headers: (typeof authHeaders === 'function' ? authHeaders() : {}) });
                const j = await res.json();
                if (j && j.code === 0 && j.data && typeof j.data.credits === 'number') credits = j.data.credits;
            } catch (_) { /* 余额获取失败不阻断卡片，仅隐藏余额行 */ }
            const lack = credits !== null && credits < price;

            const mask = document.createElement('div');
            mask.className = 'dc-mask';
            mask.innerHTML = `
                <div class="dc-card" role="dialog" aria-modal="true">
                    <div class="dc-title">生成 1080P 成片</div>
                    <div class="dc-sub">基于当前样片生成高清成片，样片费用已单独支付，成片按 1080P 另行计费</div>
                    <div class="dc-rows">
                        <div class="dc-row"><span class="dc-k">分辨率</span><span class="dc-v">1080P</span></div>
                        <div class="dc-row"><span class="dc-k">时长</span><span class="dc-v">${dur} 秒</span></div>
                        ${refSec > 0 ? `<div class="dc-row"><span class="dc-k">参考视频</span><span class="dc-v">${refSec} 秒（按 0.6 折算计费）</span></div>` : ''}
                        <div class="dc-row"><span class="dc-k">预计消耗</span><span class="dc-v dc-price">${price} 积分</span></div>
                        ${credits !== null ? `<div class="dc-row"><span class="dc-k">当前余额</span><span class="dc-v${lack ? ' dc-lack' : ''}">${credits} 积分</span></div>` : ''}
                    </div>
                    ${lack ? `<div class="dc-warn">积分不足，无法生成 1080P 成片</div>` : ''}
                    <div class="dc-acts">
                        ${lack && typeof global.showCdkModal === 'function' ? `<button type="button" class="dc-btn dc-recharge">去充值</button>` : ''}
                        <button type="button" class="dc-btn dc-cancel">取消</button>
                        <button type="button" class="dc-btn dc-ok" ${lack ? 'disabled' : ''}>确认生成</button>
                    </div>
                </div>`;
            mask.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);
            mask.addEventListener('click', (e) => {
                if (e.target === mask) return this.closeConfirm();
                if (e.target.closest('.dc-cancel')) return this.closeConfirm();
                if (e.target.closest('.dc-recharge')) { if (typeof global.showCdkModal === 'function') global.showCdkModal(); return this.closeConfirm(); }
                const ok = e.target.closest('.dc-ok');
                if (ok && !ok.disabled) {
                    this.closeConfirm();
                    if (global.CanvasGenerate) {
                        global.CanvasGenerate.runNode(nodeId, this._upgradeRunParams(b, info));
                        if (global.CanvasStore) global.CanvasStore.saveNow();
                    }
                }
            });
            document.body.appendChild(mask);
            this._mask = mask;
        },

        // 操作条按钮状态：当前模式高亮绿色，另一个保持灰色（提示词模式=样片修改，1080 面板=生成正片）
        _syncActStates() {
            const el = document.getElementById('draftActionFloat');
            if (!el) return;
            const active = this._upNodeId ? 'upgrade' : 'modify';
            el.querySelectorAll('.draft-act').forEach(btn => {
                btn.classList.toggle('is-active', btn.dataset.draftAct === active);
            });
        },

        // 生成 1080 区域：直接替换提示词输入区（不弹窗），取消/生成后恢复
        // 注意：面板必须立即渲染（余额异步补），不要在点击后先 await 余额接口，否则按钮看起来有延迟
        openUpgradePanel(nodeId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || !this.isDraftNode(b) || !b.draftTaskId) return;
            if (b.status === 'generating') return;
            const pf = document.getElementById('canvasPromptFloat');
            if (!pf) return this.openConfirm(nodeId);   // 面板不可用时兜底弹窗
            this.closeConfirm();
            const info = this._upgradeInfo(b);
            const dur = info.dur, refSec = info.refSec, price = info.price;
            this.closeUpgradePanel();
            const el = document.createElement('div');
            el.className = 'bottom-bar glass-panel draft-up-panel';
            el.id = 'draftUpgradePanel';
            el.innerHTML = `
                <div class="du-head">
                    <div class="du-title">${this._tx('生成 1080P 成片', 'Generate 1080P final')}</div>
                    <div class="du-tag">1080P</div>
                </div>
                <div class="du-sub">${this._tx('基于当前样片生成高清成片，样片费用已单独支付，成片按 1080P 另行计费', 'Generate a HD final from this draft. Draft is already paid; the final is billed separately at 1080P.')}</div>
                <div class="du-rows">
                    <div class="du-row"><span class="du-k">${this._tx('分辨率', 'Resolution')}</span><span class="du-v">1080P</span></div>
                    <div class="du-row"><span class="du-k">${this._tx('时长', 'Duration')}</span><span class="du-v">${dur}s</span></div>
                    ${refSec > 0 ? `<div class="du-row"><span class="du-k">${this._tx('参考视频', 'Reference video')}</span><span class="du-v">${refSec}s × 0.6</span></div>` : ''}
                    <div class="du-row"><span class="du-k">${this._tx('预计消耗', 'Cost')}</span><span class="du-v du-price">${price} ${this._tx('积分', 'credits')}</span></div>
                    <div class="du-row" id="duBalanceRow"><span class="du-k">${this._tx('当前余额', 'Balance')}</span><span class="du-v" id="duBalanceVal">—</span></div>
                </div>
                <div class="du-warn hidden" id="duWarn">${this._tx('积分不足，无法生成 1080P 成片', 'Not enough credits to generate the 1080P final.')}</div>
                <div class="du-acts">
                    <button type="button" class="du-btn ghost du-recharge hidden">${this._tx('去充值', 'Top up')}</button>
                    <button type="button" class="du-btn ghost du-cancel">${this._tx('返回', 'Back')}</button>
                    <button type="button" class="du-btn primary du-ok">${this._tx('确认生成', 'Confirm')}${price ? ` · ${price} ${this._tx('积分', 'credits')}` : ''}</button>
                </div>`;
            pf.appendChild(el);
            pf.classList.add('draft-upgrade-mode');
            this._upNodeId = nodeId;
            this._syncActStates();
            el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.du-cancel')) return this.closeUpgradePanel();
                if (e.target.closest('.du-recharge')) {
                    if (typeof global.showCdkModal === 'function') global.showCdkModal();
                    return this.closeUpgradePanel();
                }
                const ok = e.target.closest('.du-ok');
                if (ok && !ok.disabled) {
                    this.closeUpgradePanel();
                    if (global.CanvasGenerate) {
                        global.CanvasGenerate.runNode(nodeId, this._upgradeRunParams(b, info));
                        if (global.CanvasStore) global.CanvasStore.saveNow();
                    }
                }
            });
            const CM = global.CanvasMain;
            if (CM && typeof CM._positionFloat === 'function') { try { CM._positionFloat(); } catch (_) {} }
            this._floatPlace();
            this._fitPanel();
            // 余额异步补齐（面板已立即可见；余额拉取失败时移除余额行，不阻断确认）
            (async () => {
                let credits = null;
                try {
                    const res = await fetch(`${global.API_CONFIG.baseUrl}/api/user/credits`, { headers: (typeof authHeaders === 'function' ? authHeaders() : {}) });
                    const j = await res.json();
                    if (j && j.code === 0 && j.data && typeof j.data.credits === 'number') credits = j.data.credits;
                } catch (_) { /* 忽略，余额行移除 */ }
                if (!el.isConnected) return;
                const balRow = el.querySelector('#duBalanceRow');
                const balVal = el.querySelector('#duBalanceVal');
                if (credits === null) { if (balRow) balRow.remove(); return; }
                balVal.textContent = credits + ' ' + this._tx('积分', 'credits');
                if (credits < price) {
                    balVal.classList.add('du-lack');
                    const ok = el.querySelector('.du-ok');
                    if (ok) ok.disabled = true;
                    const warn = el.querySelector('#duWarn');
                    if (warn) warn.classList.remove('hidden');
                    const rc = el.querySelector('.du-recharge');
                    if (rc && typeof global.showCdkModal === 'function') rc.classList.remove('hidden');
                }
            })();
        },

        closeUpgradePanel() {
            const pf = document.getElementById('canvasPromptFloat');
            if (pf) pf.classList.remove('draft-upgrade-mode');
            const el = document.getElementById('draftUpgradePanel');
            if (el) el.remove();
            this._upNodeId = null;
            this._syncActStates();
        },
        closeConfirm() {
            if (this._mask && this._mask.parentNode) this._mask.parentNode.removeChild(this._mask);
            this._mask = null;
        },

        // 中英双语（随界面语言切换；i18n-dom 对动态文本不做二次翻译，这里直接给出两种语言）
        _tx(zh, en) {
            try {
                const l = (typeof global.getCurrentLang === 'function') ? global.getCurrentLang() : localStorage.getItem('nano_lang');
                return l === 'en' ? en : zh;
            } catch (_) { return zh; }
        },

        // 当前选中/绑定到提示词栏的节点（与提示词栏同一口径；取消选中后返回空）
        _activeId() {
            const M = global.CanvasMain;
            if (M && typeof M._activeNodeId !== 'undefined') return M._activeNodeId || '';
            return this._rowId || '';
        },

        // 当前展示结果的样片状态与节点字段对齐（结果记录才是唯一口径）
        // 历史切换、换模型、刷新恢复后 node.draft 都可能与记录不一致，这里发现不一致就自动修复
        _healDraft(b) {
            const CB = global.CanvasBlocks, GH = global.GenHistory;
            if (this._healing || !b || b.nodeType !== 'gen' || !CB || !GH || typeof GH.currentDraftState !== 'function') return false;
            const st = GH.currentDraftState(b);
            if (!st) return false;
            if (st.isDraft) {
                const same = b.draft === true &&
                    (b.draftTaskId || '') === (st.taskId || '') &&
                    (Number(b.draftAt) || 0) === (st.at || 0) &&
                    (b.draftUpstreamId || '') === (st.upstreamId || '') &&
                    (Number(b.draftBillSec) || 0) === (st.billSec || 0);
                if (same) return false;
                this._healing = true;
                try {
                    CB.update(b.id, {
                        draft: true, draftAt: st.at || 0, draftTaskId: st.taskId || '',
                        draftUpstreamId: st.upstreamId || '', draftBillSec: st.billSec || 0
                    });
                } finally { this._healing = false; }
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
                return true;
            }
            if (b.draft || b.draftTaskId) {
                this._healing = true;
                try {
                    CB.update(b.id, { draft: false, draftAt: 0, draftTaskId: '', draftUpstreamId: '', draftBillSec: 0 });
                } finally { this._healing = false; }
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
                return true;
            }
            return false;
        },
        healNodes(ids) {
            (ids || []).forEach(id => {
                const b = global.CanvasBlocks && global.CanvasBlocks.getById(id);
                if (b) this._healDraft(b);
            });
        },

        // 样片操作条：悬浮在节点正下方（提示词面板之上），不进入面板、不遮挡画面
        syncPromptRow() {
            const el = document.getElementById('draftActionFloat');
            if (!el) return;
            const pf = document.getElementById('canvasPromptFloat');
            const CB = global.CanvasBlocks;
            const id = this._activeId();
            const b = id && CB && CB.getById(id);
            if (b && b.nodeType === 'gen') this._healDraft(b);
            // 生成 1080 区域只在当前样片节点上有效：节点切换/开始生成/不再样片时自动恢复提示词区域
            if (this._upNodeId && (!b || b.id !== this._upNodeId || !this.isDraftNode(b) || b.status === 'generating')) {
                this.closeUpgradePanel();
            }
            // 放大输入区时操作条会被浮层盖住，直接收起
            const expanded = !!(pf && pf.classList.contains('expanded'));
            const show = !!b && !expanded && this.isDraftNode(b) && b.status !== 'generating' && b.status !== 'loading';
            if (!show) {
                el.classList.add('hidden');
                if (pf) pf.classList.remove('has-draft-actions');
                this._floatStop();
                return;
            }
            this._rowId = id;
            el.classList.remove('hidden');
            this._syncActStates();
            // 跟随模式：按操作条实际高度算面板下移量，让「节点↔按钮」「按钮↔面板」两段间距相同
            {
                const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
                const barH = el.offsetHeight || Math.round(30 * s);
                if (pf) pf.style.setProperty('--draft-shift', Math.round(barH + 8 * s) + 'px');
            }
            // 提示词面板整体下移，给操作条留出空间（仅跟随节点模式；停靠模式面板在屏幕底部，由 _floatPlace 避让）
            if (pf) pf.classList.add('has-draft-actions');
            // 面板上方那行小字（样片可用于 7 天内升级…）与操作条重复，显示操作条时一并隐藏
            const hint = document.getElementById('draftHint');
            if (hint) hint.classList.add('hidden');
            const expired = this.isExpired(b);
            const legacy = !b.draftTaskId || !b.draftAt;   // 旧历史样片：任务信息尚未找回
            if (legacy && !expired && global.GenHistory && typeof global.GenHistory.recoverNode === 'function') {
                // 后台按视频文件名从任务列表找回样片任务号，成功后按钮自动转为可用
                global.GenHistory.recoverNode(b);
            }
            const up = el.querySelector('[data-draft-act="upgrade"]');
            const mod = el.querySelector('[data-draft-act="modify"]');
            if (mod) mod.innerHTML = `<span class="da-t">${this._tx('样片修改', 'Edit draft')}</span><span class="da-d">480P</span>`;
            if (up) {
                up.classList.toggle('is-disabled', expired || legacy);
                up.innerHTML = `<span class="da-t">${this._tx('生成正片', 'Generate final')}</span><span class="da-d">${expired ? this._tx('已过期', 'Expired') : '1080P'}</span>`;
                up.title = expired
                    ? this._tx('样片已超过 7 天有效期，请重新生成样片', 'This draft expired after 7 days. Please regenerate.')
                    : (legacy
                        ? this._tx('正在查找该历史样片的任务信息…若未找到可重新生成样片', 'Looking up this historical draft task. If not found, please regenerate.')
                        : this._tx(`剩余 ${this.daysLeft(b)} 天可升级 1080P 成片`, `Upgrade to 1080P within ${this.daysLeft(b)} days`));
            }
            this._floatPlace();
            this._floatStart();
            this._fitPanel();
        },

        // 跟随模式下：面板下移后若底部超出画布视口，自动把画布上移溢出量，保证模型行/生成按钮可见
        _fitPanel() {
            const pf = document.getElementById('canvasPromptFloat');
            const core = global.CanvasCore;
            if (!pf || !core || !core.viewportEl) return;
            if (!pf.classList.contains('has-draft-actions') || pf.classList.contains('docked') || pf.classList.contains('expanded')) return;
            if (pf.classList.contains('hidden')) return;
            if (this._panLockUntil && Date.now() < this._panLockUntil) return;
            if (core._panning || (global.CanvasBlocks && global.CanvasBlocks._drag)) return;
            const vpr = core._vpRect || core.viewportEl.getBoundingClientRect();
            const pr = pf.getBoundingClientRect();
            // 面板本身比视口还高时平移也解决不了，交给放大/滚动模式处理
            if (pr.height > vpr.height - 80) return;
            const limit = Math.min(vpr.bottom, window.innerHeight) - 8;
            const overflow = Math.round(pr.bottom - limit);
            if (overflow <= 0) return;
            const scale = core.viewport.scale || 1;
            const cx = (vpr.width / 2 - core.viewport.x) / scale;
            const cy = (vpr.height / 2 - core.viewport.y) / scale;
            this._panLockUntil = Date.now() + 700;
            core.panTo(cx, cy + overflow / scale, 240);
        },

        // 按节点屏幕位置把操作条居中贴在节点下方 10px（fixed 定位，随画布平移/缩放实时跟随）
        _floatPlace() {
            const el = document.getElementById('draftActionFloat');
            const id = this._rowId;
            if (!el || el.classList.contains('hidden') || !id) return;
            const nodeEl = document.querySelector('.canvas-node[data-block-id="' + id + '"]');
            if (!nodeEl) return;
            const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
            const r = nodeEl.getBoundingClientRect();
            const h = el.offsetHeight || Math.round(30 * s);
            let top = Math.round(r.bottom + 10 * s);
            // 停靠（固定）模式：把面板整体上移，使「节点↔按钮」「按钮↔面板」两段间距相等；
            // 节点离面板太近时再把操作条放到两者中间（面板仍保持上移后的位置）
            const pf = document.getElementById('canvasPromptFloat');
            if (pf && pf.classList.contains('docked') && !pf.classList.contains('hidden') && pf.offsetHeight > 0) {
                const naturalTop = Math.round(window.innerHeight - 16 * s - pf.offsetHeight);
                const wantTop = Math.round(r.bottom + 10 * s + h + 10 * s);
                const lift = Math.max(0, Math.min(naturalTop - wantTop, Math.round(90 * s)));
                const liftStr = lift + 'px';
                if (pf.style.getPropertyValue('--draft-lift') !== liftStr) pf.style.setProperty('--draft-lift', liftStr);
                const panelTop = naturalTop - lift;
                if (top + h > panelTop - 6 * s) {
                    const room = panelTop - r.bottom;
                    top = room >= h + 12 * s
                        ? Math.round(r.bottom + (room - h) / 2)
                        : Math.round(panelTop - h - 6 * s);
                }
            } else if (pf) {
                if (pf.style.getPropertyValue('--draft-lift')) pf.style.removeProperty('--draft-lift');
            }
            // 水平方向也不出屏：节点靠左/靠右时操作条仍完整可见
            const bw = el.offsetWidth || Math.round(160 * s);
            const half = bw / 2 + 8;
            const cx = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half);
            el.style.left = Math.round(cx) + 'px';
            el.style.top = Math.max(8, top) + 'px';
        },

        _floatStart() {
            if (this._raf) return;
            const tick = () => {
                const el = document.getElementById('draftActionFloat');
                if (!el || el.classList.contains('hidden')) { this._raf = 0; return; }
                this._floatPlace();
                this._raf = requestAnimationFrame(tick);
            };
            this._raf = requestAnimationFrame(tick);
        },

        _floatStop() {
            if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        },

        _bindPromptRow() {
            const row = document.getElementById('draftActionFloat');
            if (!row || row.dataset.bound) return;
            row.dataset.bound = '1';
            row.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.draft-act');
                if (!btn) return;
                e.stopPropagation(); e.preventDefault();
                const id = this._rowId || this._activeId();
                if (!id) return;
                if (btn.dataset.draftAct === 'upgrade') {
                    if (btn.classList.contains('is-disabled')) {
                        // 旧历史样片只是缺任务号时：先尝试找回任务，成功则直接打开升级区域
                        const b = global.CanvasBlocks.getById(id);
                        if (b && !this.isExpired(b) && global.GenHistory && typeof global.GenHistory.recoverNode === 'function') {
                            global.GenHistory.recoverNode(b).then(ok => { if (ok) this.openUpgradePanel(id); });
                        }
                        return;
                    }
                    // 生成正片：提示词输入区就地换成「生成 1080」区域，不弹窗
                    this.openUpgradePanel(id);
                    return;
                }
                // 样片修改：恢复提示词输入区并聚焦（修改后再次点生成仍按样片 480P 出片，不额外扣费）
                this.closeUpgradePanel();
                const pf = document.getElementById('canvasPromptFloat');
                if (pf) {
                    pf.classList.remove('hidden');
                    if (pf.classList.contains('docked')) pf.classList.add('force-show');
                }
                const pi = document.getElementById('promptInput');
                if (pi) {
                    pi.focus();
                    try { const r = pi.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) pi.scrollIntoView({ block: 'center' }); } catch (_) {}
                }
                this.syncPromptRow();
            });
        },

        init() {
            // 升级入口（提示词面板操作行）
            this._bindPromptRow();
            // 选中变化 / 点击后同步操作行（CanvasMain 可能晚于本模块加载，故延迟检查并在首次可用时挂钩）
            const hookSelection = () => {
                const M = global.CanvasMain;
                if (!M || typeof M.onSelectionChange !== 'function' || M._draftRowHooked) return false;
                const orig = M.onSelectionChange;
                M.onSelectionChange = function () {
                    // 先按「当前展示记录」修复节点样片态（loadFromNode 之前），避免模型下拉/面板按残留标记判断；
                    // 再关闭不属于新选中的「生成 1080」区域；最后用 try/finally 保证样片操作行同步
                    try {
                        const D = global.CanvasDraft;
                        const ids = arguments[0] || [];
                        if (D && D._upNodeId && Array.prototype.indexOf.call(ids, D._upNodeId) < 0) D.closeUpgradePanel();
                    } catch (_) {}
                    try { global.CanvasDraft.healNodes(arguments[0]); } catch (_) {}
                    try { return orig.apply(this, arguments); }
                    finally { try { global.CanvasDraft.syncPromptRow(); } catch (_) {} }
                };
                M._draftRowHooked = true;
                return true;
            };
            hookSelection();
            setTimeout(hookSelection, 1200);
            // 节点数据更新（历史切换 / 结果回填 / 模型切换）后立即同步，避免最长 2 秒的按钮残留
            const hookUpdate = () => {
                const CB = global.CanvasBlocks;
                if (!CB || typeof CB.update !== 'function' || CB._draftRowUpdateHooked) return false;
                const origUpdate = CB.update.bind(CB);
                CB.update = function () {
                    const r = origUpdate.apply(this, arguments);
                    try { global.CanvasDraft.syncPromptRow(); } catch (_) {}
                    return r;
                };
                CB._draftRowUpdateHooked = true;
                return true;
            };
            hookUpdate();
            setTimeout(hookUpdate, 1200);
            window.addEventListener('pointerup', () => setTimeout(() => this.syncPromptRow(), 0), true);
            // 状态变化（生成中/完成/过期）由低频轮询兜底，开销可忽略
            setInterval(() => { if (!document.hidden) this.syncPromptRow(); }, 1000);
            window.addEventListener('mousedown', (e) => {
                if (e.target.closest && e.target.closest('.draft-up-btn')) { e.stopPropagation(); }
            }, true);
            window.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.draft-up-btn');
                if (!btn || btn.disabled) return;
                e.stopPropagation(); e.preventDefault();
                const nodeEl = btn.closest('[data-block-id]');
                const id = nodeEl && nodeEl.dataset.blockId;
                if (id) this.openConfirm(id);
            }, true);
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this._mask) { e.stopPropagation(); this.closeConfirm(); }
                else if (e.key === 'Escape' && this._upNodeId) { e.stopPropagation(); this.closeUpgradePanel(); }
            }, true);
        }
    };

    global.CanvasDraft = CanvasDraft;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => CanvasDraft.init());
    else CanvasDraft.init();
})(window);
