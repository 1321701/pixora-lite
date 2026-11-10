/**
 * canvas-core.js
 * 画布核心：视口状态、平移、缩放、坐标转换
 * 整个画布用一个"世界容器"做统一 transform，平移缩放只改这一个元素
 */
(function (global) {
    'use strict';

    const CanvasCore = {
        // 视口状态：world 容器的位移与缩放
        viewport: { x: 0, y: 0, scale: 1 },
        minScale: 0.1,
        maxScale: 4,

        // DOM 引用
        viewportEl: null,
        worldEl: null,

        // 当前工具：select | hand
        tool: 'select',
        // 空格临时抓手
        spaceDown: false,

        // 平移状态
        _panning: false,
        _panStart: null,

        // 变换回调（连线层等需要在变换后重绘）
        _onTransform: [],

        init() {
            this.viewportEl = document.getElementById('canvasViewport');
            this.worldEl = document.getElementById('canvasWorld');
            this.zoomIndicator = document.getElementById('zoomIndicator');

            this._bindPan();
            this._bindZoom();
            this._bindKeyboard();
            this.applyTransform();
        },

        onTransform(fn) {
            this._onTransform.push(fn);
        },

        applyTransform() {
            const { x, y, scale } = this.viewport;
            // 缓存 viewport rect：变换过程中其他模块调用 getBoundingClientRect 会触发强制重排，
            // 统一在此缓存一次，供 onTransform 回调链复用
            this._vpRect = this.viewportEl.getBoundingClientRect();
            // 平移量对齐到物理像素，减少亚像素渲染导致的文字/线条发虚
            const dpr = window.devicePixelRatio || 1;
            const rx = Math.round(x * dpr) / dpr;
            const ry = Math.round(y * dpr) / dpr;
            this.worldEl.style.transform = `translate(${rx}px, ${ry}px) scale(${scale})`;
            this.viewportEl.classList.add("is-transforming");
            clearTimeout(this._transformingTimer);
            this._transformingTimer = setTimeout(() => this.viewportEl.classList.remove("is-transforming"), 150);
            // 放大超过阈值时持续禁用节点磨砂（zoomed-far），缩小到阈值以下时恢复。
            // 不再用 is-zooming 类反复添加/移除（每次切换都会触发 backdrop-filter
            // 从禁用→恢复的重绘，放大时节点面积大、重绘明显 = 闪烁根源）。
            // 放大时 zoomed-far 保持常驻，缩小时一次性移除，避免反复切换。
            this.viewportEl.classList.toggle('zoomed-far', scale > 1.2);
            // 平移时不触发任何额外处理（scale 未变化时跳过）
            if (scale !== this._lastAppliedScale) {
                this._lastAppliedScale = scale;
            }
            // 暴露当前缩放给 CSS：选中色环等需要按缩放倒数计算宽度，保持屏幕恒定粗细
            this.viewportEl.style.setProperty('--scale', scale);
            if (this.zoomIndicator) {
                this.zoomIndicator.textContent = Math.round(scale * 100) + '%';
            }
            // 网格背景：固定 24px 尺寸不随缩放变化（缩放时改 backgroundSize 会触发
            // 背景重采样，点阵与像素不对齐 = 整个视口周期性闪烁的根源），
            // 只跟随平移对齐像素（使用已对齐的 rx/ry，避免亚像素重采样）
            this.viewportEl.style.backgroundSize = '24px 24px';
            this.viewportEl.style.backgroundPosition = `${rx}px ${ry}px`;
            this._onTransform.forEach(fn => fn());
        },

        // _forceReraster 已移除：任何形式的重栅格化（display 切换 / will-change 提示）
        // 都会触发浏览器重绘，在缩放/拖动后造成节点和线条闪烁。
        // 浏览器在 transform 变化后自行管理栅格化，无需手动干预。
        _forceReraster() {},

        // 屏幕坐标 → 世界坐标
        screenToWorld(clientX, clientY) {
            const rect = this._vpRect || this.viewportEl.getBoundingClientRect();
            const px = clientX - rect.left;
            const py = clientY - rect.top;
            return {
                x: (px - this.viewport.x) / this.viewport.scale,
                y: (py - this.viewport.y) / this.viewport.scale
            };
        },

        // 世界坐标 → 屏幕坐标（相对 viewport）
        worldToScreen(wx, wy) {
            return {
                x: wx * this.viewport.scale + this.viewport.x,
                y: wy * this.viewport.scale + this.viewport.y
            };
        },

        // 以某屏幕点为中心缩放
        zoomAt(clientX, clientY, factor) {
            const rect = this._vpRect || this.viewportEl.getBoundingClientRect();
            const px = clientX - rect.left;
            const py = clientY - rect.top;
            const worldX = (px - this.viewport.x) / this.viewport.scale;
            const worldY = (py - this.viewport.y) / this.viewport.scale;
            let newScale = this.viewport.scale * factor;
            newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
            this.viewport.scale = newScale;
            this.viewport.x = px - worldX * newScale;
            this.viewport.y = py - worldY * newScale;
            this.applyTransform();
        },

        setTool(tool) {
            this.tool = tool;
            // 仅切换底部悬浮胶囊内的工具按钮激活态，避免影响图片编辑器弹窗内的同名按钮
            document.querySelectorAll('#toolDock .capsule-btn[data-tool]').forEach(b => {
                b.classList.toggle('active', b.dataset.tool === tool);
            });
            this.viewportEl.classList.toggle('hand-tool', tool === 'hand');
        },

        // 动画平移到指定世界坐标（使该点位于视口中心）
        panTo(wx, wy, duration = 400) {
            const rect = this._vpRect || this.viewportEl.getBoundingClientRect();
            const targetX = rect.width / 2 - wx * this.viewport.scale;
            const targetY = rect.height / 2 - wy * this.viewport.scale;
            const startX = this.viewport.x;
            const startY = this.viewport.y;
            const startTime = performance.now();
            cancelAnimationFrame(this._panAnim);
            const animate = (t) => {
                const progress = Math.min((t - startTime) / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                this.viewport.x = startX + (targetX - startX) * eased;
                this.viewport.y = startY + (targetY - startY) * eased;
                this.applyTransform();
                if (progress < 1) {
                    this._panAnim = requestAnimationFrame(animate);
                }
            };
            this._panAnim = requestAnimationFrame(animate);
        },

        // 适应全部图块到视野
        zoomToFit(bounds) {
            if (!bounds) return;
            const vw = this.viewportEl.clientWidth;
            const vh = this.viewportEl.clientHeight;
            const padding = 80;
            const bw = bounds.maxX - bounds.minX;
            const bh = bounds.maxY - bounds.minY;
            if (bw <= 0 || bh <= 0) return;
            const scale = Math.min(
                (vw - padding * 2) / bw,
                (vh - padding * 2) / bh,
                this.maxScale
            );
            this.viewport.scale = Math.max(this.minScale, scale);
            this.viewport.x = vw / 2 - (bounds.minX + bw / 2) * this.viewport.scale;
            this.viewport.y = vh / 2 - (bounds.minY + bh / 2) * this.viewport.scale;
            this.applyTransform();
        },

        _isPanGesture(e) {
            // 中键 / 抓手工具 / 空格按住
            return e.button === 1 || this.tool === 'hand' || this.spaceDown;
        },

        _bindPan() {
            const toggleCometDim = (dim) => {
                document.querySelectorAll('.edge-comets').forEach(g => {
                    g.classList.toggle('dragging', dim);
                });
            };
            this.viewportEl.addEventListener('mousedown', (e) => {
                // 只有点在空白处或满足平移手势才平移
                const onBlock = e.target.closest('.canvas-node');
                if (this._isPanGesture(e) || (!onBlock && e.button === 0 && this.tool === 'hand')) {
                    if (this._isPanGesture(e)) {
                        this._panning = true;
                        this._panStart = { x: e.clientX, y: e.clientY, vx: this.viewport.x, vy: this.viewport.y };
                        this.viewportEl.classList.add('panning');
                        toggleCometDim(true);
                        if (global.CanvasEdges) global.CanvasEdges.setDragging(true);
                        e.preventDefault();
                    }
                }
            });
            window.addEventListener('mousemove', (e) => {
                if (!this._panning) return;
                this.viewport.x = this._panStart.vx + (e.clientX - this._panStart.x);
                this.viewport.y = this._panStart.vy + (e.clientY - this._panStart.y);
                this.applyTransform();
            });
            window.addEventListener('mouseup', () => {
                if (this._panning) {
                    this._panning = false;
                    this.viewportEl.classList.remove('panning');
                    toggleCometDim(false);
                    if (global.CanvasEdges) global.CanvasEdges.setDragging(false);
                }
            });
            // 双击空白复位缩放
            this.viewportEl.addEventListener('dblclick', (e) => {
                if (e.target.closest('.canvas-node')) return;
                this.viewport.scale = 1;
                this.applyTransform();
            });
        },

        _bindZoom() {
            this.viewportEl.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    // 触控板捏合
                    const factor = e.deltaY > 0 ? 0.97 : 1.03;
                    this.zoomAt(e.clientX, e.clientY, factor);
                } else {
                    const factor = e.deltaY > 0 ? 0.9 : 1.1;
                    this.zoomAt(e.clientX, e.clientY, factor);
                }
            }, { passive: false });
        },

        _bindKeyboard() {
            window.addEventListener('keydown', (e) => {
                const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
                if (e.code === 'Space' && !typing) {
                    this.spaceDown = true;
                    this.viewportEl.classList.add('hand-tool');
                    e.preventDefault();
                }
                if (!typing && (e.key === 'v' || e.key === 'V')) this.setTool('select');
                if (!typing && (e.key === 'h' || e.key === 'H')) this.setTool('hand');
                if (e.shiftKey && e.key === '1') {
                    e.preventDefault();
                    if (global.CanvasBlocks) this.zoomToFit(global.CanvasBlocks.getBounds());
                }
            });
            window.addEventListener('keyup', (e) => {
                if (e.code === 'Space') {
                    this.spaceDown = false;
                    if (this.tool !== 'hand') this.viewportEl.classList.remove('hand-tool');
                }
            });
        }
    };

    global.CanvasCore = CanvasCore;
})(window);
