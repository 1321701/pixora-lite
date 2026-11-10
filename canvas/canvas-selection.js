/**
 * canvas-selection.js
 * 选择系统：单选、Shift 多选、空白处框选
 * 多选时显示包围框 + 批量连接端口 + 多选工具栏
 */
(function (global) {
    'use strict';

    const PADDING = 14;      // 包围框相对节点的内边距
    const PADDING_TOP = 30;  // 顶部内边距加大：覆盖悬浮在节点上方 24px 的名字栏，避免名字卡在框外
    const CanvasSelection = {
        selected: new Set(),
        boxEl: null,
        _boxStart: null,
        _boxing: false,
        _boundsEl: null,
        _boundsBound: false,

        init() {
            this.boxEl = document.getElementById('selectionBox');
            this._bindMarquee();
        },

        getSelectedIds() {
            return Array.from(this.selected);
        },

        isSelected(id) {
            return this.selected.has(id);
        },

        clear() {
            this.selected.clear();
            this._syncDom();
            if (global.CanvasMain) global.CanvasMain.onSelectionChange();
        },

        select(id, additive) {
            if (!additive) this.selected.clear();
            this.selected.add(id);
            this._syncDom();
            if (global.CanvasMain) global.CanvasMain.onSelectionChange();
        },

        // 图块按下时的选中逻辑（在拖拽前调用）
        handleBlockMouseDown(id, e) {
            if (e.shiftKey) {
                // Shift 切换
                if (this.selected.has(id)) {
                    this.selected.delete(id);
                } else {
                    this.selected.add(id);
                }
            } else if (!this.selected.has(id)) {
                // 点未选中的图块 → 单选
                this.selected.clear();
                this.selected.add(id);
            }
            // 已选中且无 Shift：保持（允许多选整体拖拽）
            this._syncDom();
            if (global.CanvasMain) global.CanvasMain.onSelectionChange();
        },

        _syncDom() {
            const layer = global.CanvasBlocks.layerEl;
            if (!layer) return;
            layer.querySelectorAll('.canvas-node').forEach(el => {
                el.classList.toggle('selected', this.selected.has(el.dataset.blockId));
            });
            this._renderBounds();
            // 分组框激活态（成员全选时显示四角手柄）
            if (global.CanvasBlocks && global.CanvasBlocks._syncGroupFrames) global.CanvasBlocks._syncGroupFrames();
            // 选中变化时刷新端口显隐（选中节点端口常亮）
            if (global.CanvasBlocks && global.CanvasBlocks._updatePortsVisibility) {
                const last = global.CanvasBlocks._lastMousePos || { clientX: 0, clientY: 0 };
                global.CanvasBlocks._updatePortsVisibility(last.clientX, last.clientY);
            }
        },

        // 计算选中节点的世界坐标包围框
        _getSelectionBounds() {
            if (this.selected.size < 2) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let has = false;
            global.CanvasBlocks.blocks.forEach(b => {
                if (!this.selected.has(b.id)) return;
                has = true;
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
            });
            if (!has) return null;
            return {
                x: minX - PADDING,
                y: minY - PADDING_TOP,
                w: maxX - minX + PADDING * 2,
                h: maxY - minY + PADDING + PADDING_TOP
            };
        },

        _renderBounds() {
            const bounds = this._getSelectionBounds();
            if (!bounds) {
                this._removeBounds();
                return;
            }
            const layer = global.CanvasBlocks.layerEl;
            if (!layer) return;
            if (!this._boundsEl) {
                this._boundsEl = document.createElement('div');
                this._boundsEl.className = 'selection-bounds selection-bounds--static';
                // 批量输出端口：沿用端口结构，但保持静态以避免额外的逐帧合成。
                this._boundsEl.innerHTML = `
                    <div class="port port-out" data-port="out" title="批量连接到生成节点"></div>
                    <div class="port-hit port-out-hit"></div>
                    <div class="selection-toolbar toolbar-capsule">
                        <button class="selection-tool-btn" data-action="arrange" title="自动整理"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span class="tb-lb">自动整理</span></button>
                        <button class="selection-tool-btn" data-action="group" title="打组"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg><span class="tb-lb">打组</span></button>
                        <button class="selection-tool-btn" data-action="download" title="批量下载"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span class="tb-lb">批量下载</span></button>
                        <button class="selection-tool-btn" data-action="save-char" title="把所选图片存为同一个角色的多张参考图"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg><span class="tb-lb">存为角色</span></button>
                    </div>
                `;
                layer.appendChild(this._boundsEl);
                this._boundsToolbarEl = this._boundsEl.querySelector('.selection-toolbar');
                // 批量端口保持静态，避免多选框触发额外的逐帧端口动画。
                this._bindBoundsEvents();
                this._lastBounds = null;
            }
            // 避免重复 DOM 写入：拖动中每帧调用，仅在值真正变化时才写 style
            if (!this._lastBounds ||
                this._lastBounds.x !== bounds.x || this._lastBounds.y !== bounds.y ||
                this._lastBounds.w !== bounds.w || this._lastBounds.h !== bounds.h) {
                this._boundsEl.style.left = bounds.x + 'px';
                this._boundsEl.style.top = bounds.y + 'px';
                this._boundsEl.style.width = bounds.w + 'px';
                this._boundsEl.style.height = bounds.h + 'px';
                this._lastBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
            }

            // 工具栏显示在包围框上方居中
            const toolbar = this._boundsToolbarEl;
            if (toolbar) {
                toolbar.style.left = (bounds.w / 2) + 'px';
                toolbar.style.top = (-34) + 'px';
            }
        },

        _removeBounds() {
            if (this._boundsEl) {
                this._boundsEl.remove();
                this._boundsEl = null;
                this._boundsToolbarEl = null;
                this._boundsBound = false;
            }
        },

        _bindBoundsEvents() {
            if (!this._boundsEl || this._boundsBound) return;
            this._boundsBound = true;

            // 批量输出端口拖拽：从包围框拖出，连接所有选中节点到目标（端口视觉 + 扩展命中区）
            const bindBatchDrag = (target) => {
                if (!target) return;
                target.addEventListener('mousedown', (e) => {
                    // 端口隐藏态不响应（与普通节点端口一致）
                    const st = this._boundsEl._portState;
                    if (st && st.out.to === 0) return;
                    e.stopPropagation();
                    if (global.CanvasEdges && global.CanvasEdges.startBatchConnection) {
                        global.CanvasEdges.startBatchConnection(Array.from(this.selected), e);
                    }
                });
            };
            bindBatchDrag(this._boundsEl.querySelector('.port-out'));
            bindBatchDrag(this._boundsEl.querySelector('.port-out-hit'));

            // 工具栏按钮事件委托
            this._boundsEl.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.selection-tool-btn[data-action]');
                if (!btn) return;
                ev.stopPropagation();
                const action = btn.dataset.action;
                if (global.CanvasMain && typeof global.CanvasMain._onSelectionToolAction === 'function') {
                    global.CanvasMain._onSelectionToolAction(action, Array.from(this.selected), { x: ev.clientX, y: ev.clientY });
                }
            });

            // 工具栏 mousedown 阻止冒泡，避免触发画布平移
            // 注意：端口不在此拦截——捕获阶段 stopPropagation 会让事件到不了端口自身的监听，
            // 端口的拖线监听会自行 stopPropagation
            this._boundsEl.addEventListener('mousedown', (ev) => {
                if (ev.target.closest('.selection-toolbar')) {
                    ev.stopPropagation();
                }
            }, true);

            // 拖动包围框磨砂背景：整体移动所有选中节点（复用 CanvasBlocks 的全局拖拽管线）
            this._boundsEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.selection-toolbar')) return;
                e.stopPropagation();
                e.preventDefault();
                const CB = global.CanvasBlocks;
                if (!CB) return;
                const ids = this.getSelectedIds();
                if (!ids.length) return;
                CB._drag = {
                    startX: e.clientX, startY: e.clientY,
                    items: ids.map(id => { const b = CB.getById(id); return { id, ox: b.x, oy: b.y }; }),
                    moved: false,
                    blockId: ids[0],
                    shiftKey: false,
                    fromFrame: true     // 由框选背景发起：松手时不做单选/点击处理
                };
                if (global.CanvasEdges) global.CanvasEdges.setDragging(true, ids.length > 1);
                this._boundsEl.classList.add('dragging');
            });
        },

        _bindMarquee() {
            const vp = CanvasCore.viewportEl;
            vp.addEventListener('mousedown', (e) => {
                // 仅 select 工具、左键、点在空白处才框选
                if (CanvasCore.tool !== 'select' || e.button !== 0) return;
                if (CanvasCore.spaceDown) return;
                if (e.target.closest('.canvas-node')) return;
                if (e.target.closest('.selection-bounds')) return;

                // 点空白 → 清空选择 + 清空连线选中
                this.clear();
                if (global.CanvasEdges) global.CanvasEdges.clearEdgeSelection();
                // 取消分组激活态（隐藏四角手柄）
                if (global.CanvasBlocks && global.CanvasBlocks._activeGroupId) {
                    global.CanvasBlocks._activeGroupId = null;
                    global.CanvasBlocks._syncGroupFrames();
                }

                this._boxing = true; vp.classList.add("boxing");
                const rect = CanvasCore._vpRect || vp.getBoundingClientRect();
                this._boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                this.boxEl.style.left = this._boxStart.x + 'px';
                this.boxEl.style.top = this._boxStart.y + 'px';
                this.boxEl.style.width = '0px';
                this.boxEl.style.height = '0px';
                this.boxEl.classList.remove('hidden');
            });

            window.addEventListener('mousemove', (e) => {
                if (!this._boxing) return;
                const rect = CanvasCore._vpRect || vp.getBoundingClientRect();
                const cx = e.clientX - rect.left;
                const cy = e.clientY - rect.top;
                const x = Math.min(cx, this._boxStart.x);
                const y = Math.min(cy, this._boxStart.y);
                const w = Math.abs(cx - this._boxStart.x);
                const h = Math.abs(cy - this._boxStart.y);
                this.boxEl.style.left = x + 'px';
                this.boxEl.style.top = y + 'px';
                this.boxEl.style.width = w + 'px';
                this.boxEl.style.height = h + 'px';

                // 实时高亮命中图块（diff 更新，避免全量 _syncDom 触发 _syncGroupFrames/
                // _updatePortsVisibility 导致分组框/端口闪烁）
                const wTL = CanvasCore.screenToWorld(x + rect.left, y + rect.top);
                const wBR = CanvasCore.screenToWorld(x + w + rect.left, y + h + rect.top);
                const newSel = new Set();
                global.CanvasBlocks.blocks.forEach(b => {
                    if (b.x < wBR.x && b.x + b.w > wTL.x && b.y < wBR.y && b.y + b.h > wTL.y) {
                        newSel.add(b.id);
                    }
                });
                // 只对变化的节点 toggle selected 类（diff），避免无谓的样式重算
                const layer = global.CanvasBlocks.layerEl;
                if (layer) {
                    layer.querySelectorAll('.canvas-node').forEach(el => {
                        const id = el.dataset.blockId;
                        const should = newSel.has(id);
                        if (el.classList.contains('selected') !== should) {
                            el.classList.toggle('selected', should);
                        }
                    });
                }
                this.selected = newSel;
                // 框选中只更新包围框几何，不触发分组框/端口重算（mouseup 时 _syncDom 统一处理）
                if (this._boxing === false) this._renderBounds();
            });

            window.addEventListener('mouseup', () => {
                if (this._boxing) {
                    this._boxing = false; vp.classList.remove("boxing");
                    this.boxEl.classList.add('hidden');
                    // 框选结束：统一同步分组框、端口显隐等（拖动中跳过以避免闪烁）
                    this._syncDom();
                    if (global.CanvasMain) global.CanvasMain.onSelectionChange();
                }
            });
        }
    };

    global.CanvasSelection = CanvasSelection;
})(window);
