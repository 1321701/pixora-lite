/**
 * canvas-minimap.js
 * 画布小地图：右下角缩略图，展示全部节点与连线
 *   - 点击小地图快速转移视口到目标位置
 *   - 视口范围用矩形框（视口框）标示
 *   - 随节点增删/移动/连线变化/视口变换自动刷新
 *
 * 依赖：CanvasCore（视口状态）、CanvasBlocks（节点）、CanvasEdges（连线）
 */
(function (global) {
    'use strict';

    const MINIMAP_W = 200;   // 小地图宽
    const MINIMAP_H = 140;   // 小地图高
    const PADDING = 40;      // 内容留白

    const CanvasMinimap = {
        el: null,         // 容器
        canvasEl: null,   // <canvas> 绘制层
        vpRectEl: null,   // 视口框
        _ctx: null,
        _dirty: true,     // 内容脏标记（节点/边变化）
        _scale: 1,
        _offsetX: 0,
        _offsetY: 0,
        _rafId: null,

        init() {
            // 创建 DOM
            this.el = document.createElement('div');
            this.el.className = 'canvas-minimap';
            this.el.innerHTML = `
                <canvas width="${MINIMAP_W}" height="${MINIMAP_H}"></canvas>
                <div class="minimap-viewport"></div>
            `;
            // 插入到 canvas-app 末尾
            const app = document.querySelector('.canvas-app');
            if (!app) return;
            app.appendChild(this.el);

            this.canvasEl = this.el.querySelector('canvas');
            this.vpRectEl = this.el.querySelector('.minimap-viewport');
            this._ctx = this.canvasEl.getContext('2d');

            this._bindEvents();
            this.scheduleRender();
        },

        _bindEvents() {
            // 点击/拖动小地图 → 视口居中到点击点
            const onInteract = (clientX, clientY) => {
                const rect = this.el.getBoundingClientRect();
                const px = clientX - rect.left;
                const py = clientY - rect.top;
                // 小地图坐标 → 世界坐标
                const wx = (px - this._offsetX) / this._scale;
                const wy = (py - this._offsetY) / this._scale;
                // 视口居中到该世界坐标
                const core = global.CanvasCore;
                if (!core) return;
                const vw = core._vpRect ? core._vpRect.width : core.viewportEl.clientWidth;
                const vh = core._vpRect ? core._vpRect.height : core.viewportEl.clientHeight;
                core.viewport.x = vw / 2 - wx * core.viewport.scale;
                core.viewport.y = vh / 2 - wy * core.viewport.scale;
                core.applyTransform();
                this.renderViewport();
            };

            let dragging = false;
            this.el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                dragging = true;
                onInteract(e.clientX, e.clientY);
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                onInteract(e.clientX, e.clientY);
            });
            window.addEventListener('mouseup', () => { dragging = false; });
        },

        /** 标记内容为脏（节点/边变化时调用） */
        markDirty() {
            this._dirty = true;
            this.scheduleRender();
        },

        /** 视口框更新（平移/缩放时调用，轻量不重绘内容） */
        renderViewport() {
            const core = global.CanvasCore;
            const blocks = global.CanvasBlocks;
            if (!core || !blocks) return;
            // 无内容时隐藏视口框
            if (!this._getWorldBounds()) { this.vpRectEl.style.display = 'none'; return; }
            // 使用内容渲染时确定的缩放/偏移，避免拖动时重新拟合导致框抖动/变小
            // 视口在世界中的可见矩形
            const vw = core._vpRect ? core._vpRect.width : core.viewportEl.clientWidth;
            const vh = core._vpRect ? core._vpRect.height : core.viewportEl.clientHeight;
            const viewWorldW = vw / core.viewport.scale;
            const viewWorldH = vh / core.viewport.scale;
            const viewWorldX = -core.viewport.x / core.viewport.scale;
            const viewWorldY = -core.viewport.y / core.viewport.scale;
            // 映射到小地图坐标
            const x = viewWorldX * this._scale + this._offsetX;
            const y = viewWorldY * this._scale + this._offsetY;
            const w = viewWorldW * this._scale;
            const h = viewWorldH * this._scale;
            this.vpRectEl.style.display = 'block';
            this.vpRectEl.style.left = x + 'px';
            this.vpRectEl.style.top = y + 'px';
            this.vpRectEl.style.width = w + 'px';
            this.vpRectEl.style.height = h + 'px';
        },

        _getWorldBounds() {
            const blocks = global.CanvasBlocks;
            if (!blocks || !blocks.blocks || blocks.blocks.length === 0) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            blocks.blocks.forEach(b => {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
            });
            return { minX, minY, maxX, maxY };
        },

        // 计算小地图缩放与偏移（世界→小地图映射）
        _fitBounds(bounds) {
            const bw = Math.max(1, bounds.maxX - bounds.minX);
            const bh = Math.max(1, bounds.maxY - bounds.minY);
            const sx = (MINIMAP_W - PADDING * 2) / bw;
            const sy = (MINIMAP_H - PADDING * 2) / bh;
            this._scale = Math.min(sx, sy);
            // 居中
            this._offsetX = (MINIMAP_W - bw * this._scale) / 2 - bounds.minX * this._scale;
            this._offsetY = (MINIMAP_H - bh * this._scale) / 2 - bounds.minY * this._scale;
        },

        /** 完整重绘内容（节点+边） */
        renderContent() {
            const ctx = this._ctx;
            const blocks = global.CanvasBlocks;
            const edges = global.CanvasEdges;
            if (!blocks || !edges) return;
            // 清空
            ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
            // 背景
            ctx.fillStyle = 'rgba(17,18,21,0.9)';
            ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

            const bounds = this._getWorldBounds();
            if (!bounds) return;
            this._fitBounds(bounds);
            const s = this._scale, ox = this._offsetX, oy = this._offsetY;

            // 绘制连线
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            (edges.edges || []).forEach(e => {
                const from = blocks.getById(e.from);
                const to = blocks.getById(e.to);
                if (!from || !to) return;
                const x1 = (from.x + from.w) * s + ox;
                const y1 = (from.y + from.h / 2) * s + oy;
                const x2 = to.x * s + ox;
                const y2 = (to.y + to.h / 2) * s + oy;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });

            // 绘制节点
            blocks.blocks.forEach(b => {
                const x = b.x * s + ox;
                const y = b.y * s + oy;
                const w = Math.max(2, b.w * s);
                const h = Math.max(2, b.h * s);
                // 颜色：生成节点用青柠强调色，编辑节点用薄荷色，其他（参考图/文本）用中性灰
                if (b.nodeType === 'gen') {
                    ctx.fillStyle = b.status === 'generating' ? '#f2c46b' : 'rgba(196,241,123,0.85)';
                } else if (b.subType === 'edited') {
                    ctx.fillStyle = '#8fd6b0';
                } else {
                    ctx.fillStyle = '#5c616b';
                }
                ctx.fillRect(x, y, w, h);
                // 描边
                ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, w, h);
            });
        },

        scheduleRender() {
            if (this._rafId) return;
            this._rafId = requestAnimationFrame(() => {
                this._rafId = null;
                if (this._dirty) {
                    this.renderContent();
                    this._dirty = false;
                }
                this.renderViewport();
            });
        }
    };

    global.CanvasMinimap = CanvasMinimap;
})(window);
