/**
 * canvas-snap.js
 * 节点拖动吸附对齐（Figma/n8n 风格）
 *   - 边对边：左左/右右/左右/顶顶/底底/顶底
 *   - 中心对齐：水平居中/垂直居中
 *   - 拖动接近对齐线（容差内）时自动吸附 + 显示红色参考线
 *   - 多选拖动时以主拖节点为锚点吸附，其他选中节点保持相对偏移一起移动
 * 参考线渲染在 guides-layer（SVG），位于节点下方、连线层上方
 */
(function (global) {
    'use strict';

    const SVGNS = 'http://www.w3.org/2000/svg';

    const CanvasSnap = {
        enabled: true,       // 吸附开关（右键菜单可切换）
        threshold: 6,        // 吸附容差（屏幕像素 px，缩放后体验一致）
        _layerEl: null,      // 参考线 SVG 层

        init() {
            this._layerEl = document.getElementById('guidesLayer');
        },

        /**
         * 吸附检测
         * @param {Object} dragged  主拖节点 {x,y,w,h}
         * @param {Array}  others   其他节点数组 [{x,y,w,h}, ...]
         * @returns {Object} { x, y, guides: { x:{pos,type}?, y:{pos,type}? }, snappedX, snappedY }
         */
        snap(dragged, others) {
            const guides = { x: null, y: null };
            if (!this.enabled) {
                return { x: dragged.x, y: dragged.y, guides, snappedX: false, snappedY: false };
            }

            // 容差按屏幕像素固定：缩放后体验一致
            const scale = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.scale) || 1;
            const worldThreshold = this.threshold / scale;

            let dxBest = null, dyBest = null;

            // 主拖节点的 6 条参考边/中心
            const d = {
                left:   dragged.x,
                right:  dragged.x + dragged.w,
                cx:     dragged.x + dragged.w / 2,
                top:    dragged.y,
                bottom: dragged.y + dragged.h,
                cy:     dragged.y + dragged.h / 2,
            };

            for (const o of others) {
                const oe = {
                    left:   o.x,
                    right:  o.x + o.w,
                    cx:     o.x + o.w / 2,
                    top:    o.y,
                    bottom: o.y + o.h,
                    cy:     o.y + o.h / 2,
                };
                // X 轴：dragged 的 left/right/cx 与 other 的 left/right/cx
                const xPairs = [
                    ['left', d.left], ['right', d.right], ['cx', d.cx],
                ];
                const xOthers = [
                    ['left', oe.left], ['right', oe.right], ['cx', oe.cx],
                ];
                for (const [dk, dv] of xPairs) {
                    for (const [ok, ov] of xOthers) {
                        const diff = dv - ov;
                        if (Math.abs(diff) < worldThreshold &&
                            (dxBest === null || Math.abs(diff) < Math.abs(dxBest))) {
                            dxBest = diff;
                            guides.x = { pos: ov, type: dk + '-' + ok };
                        }
                    }
                }
                // Y 轴
                const yPairs = [
                    ['top', d.top], ['bottom', d.bottom], ['cy', d.cy],
                ];
                const yOthers = [
                    ['top', oe.top], ['bottom', oe.bottom], ['cy', oe.cy],
                ];
                for (const [dk, dv] of yPairs) {
                    for (const [ok, ov] of yOthers) {
                        const diff = dv - ov;
                        if (Math.abs(diff) < worldThreshold &&
                            (dyBest === null || Math.abs(diff) < Math.abs(dyBest))) {
                            dyBest = diff;
                            guides.y = { pos: ov, type: dk + '-' + ok };
                        }
                    }
                }
            }

            return {
                x: dxBest !== null ? dragged.x - dxBest : dragged.x,
                y: dyBest !== null ? dragged.y - dyBest : dragged.y,
                guides,
                snappedX: dxBest !== null,
                snappedY: dyBest !== null,
            };
        },

        /**
         * 渲染参考线（铺满整个视口的世界坐标范围，缩放后也铺满）
         * @param {Object} guides   { x:{pos,type}?, y:{pos,type}? }
         * @param {Object} dragged  主拖节点 {x,y,w,h}
         * @param {Array}  others   其他节点数组
         */
        renderGuides(guides, dragged, others) {
            if (!this._layerEl) return;
            this.clearGuides();
            if (!this.enabled) return;

            // 计算当前视口在世界坐标中的范围（铺满视口，不受节点位置限制）
            const vp = global.CanvasCore.viewportEl;
            const scale = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.scale) || 1;
            const tx = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.x) || 0;
            const ty = (global.CanvasCore && global.CanvasCore.viewport && global.CanvasCore.viewport.y) || 0;
            const worldW = vp.clientWidth / scale;
            const worldH = vp.clientHeight / scale;
            const worldLeft = -tx / scale;
            const worldTop = -ty / scale;

            // 虚线间距 + 线宽按屏幕像素固定（除以 scale 抵消画布缩放）
            const dash = (4 / scale) + ' ' + (3 / scale);
            const sw = 1 / scale;

            // X 对齐 → 垂直参考线（铺满视口高度）
            if (guides.x) {
                const line = document.createElementNS(SVGNS, 'line');
                line.setAttribute('class', 'guide-line');
                line.setAttribute('x1', guides.x.pos);
                line.setAttribute('y1', worldTop);
                line.setAttribute('x2', guides.x.pos);
                line.setAttribute('y2', worldTop + worldH);
                line.setAttribute('stroke-dasharray', dash);
                line.setAttribute('stroke-width', sw);
                this._layerEl.appendChild(line);
            }
            // Y 对齐 → 水平参考线（铺满视口宽度）
            if (guides.y) {
                const line = document.createElementNS(SVGNS, 'line');
                line.setAttribute('class', 'guide-line');
                line.setAttribute('x1', worldLeft);
                line.setAttribute('y1', guides.y.pos);
                line.setAttribute('x2', worldLeft + worldW);
                line.setAttribute('y2', guides.y.pos);
                line.setAttribute('stroke-dasharray', dash);
                line.setAttribute('stroke-width', sw);
                this._layerEl.appendChild(line);
            }
        },

        clearGuides() {
            if (this._layerEl) this._layerEl.innerHTML = '';
        },

        // 切换开关
        toggle() {
            this.enabled = !this.enabled;
            if (!this.enabled) this.clearGuides();
            return this.enabled;
        },
    };

    global.CanvasSnap = CanvasSnap;
})(window);
