/**
 * canvas-history.js
 * 撤销/重做：基于全量快照的命令栈（图块 + 连线 + 视口）
 */
(function (global) {
    'use strict';

    const CanvasHistory = {
        _stack: [],
        _index: -1,
        _max: 50,
        _suspended: false,

        init() {
            this.undoBtn = document.getElementById('undoBtn');
            this.redoBtn = document.getElementById('redoBtn');
            this.undoBtn.addEventListener('click', () => this.undo());
            this.redoBtn.addEventListener('click', () => this.redo());

            window.addEventListener('keydown', (e) => {
                // 输入框/文本域/contenteditable（提示词编辑器）内不拦截，保留原生文本撤销
                const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
                if (typing) return;
                if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                    e.preventDefault();
                    this.undo();
                } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
                    e.preventDefault();
                    this.redo();
                }
            });
        },

        _capture() {
            return JSON.stringify({
                blocks: global.CanvasBlocks.serialize(),
                edges: global.CanvasEdges.serialize(),
                groups: global.CanvasBlocks.serializeGroups(),
                // 导演台（分镜表）纳入撤销快照
                director: global.CanvasDirector ? global.CanvasDirector.serialize() : null
            });
        },

        // 记录一次快照（在某个操作完成后调用）
        snapshot() {
            if (this._suspended) return;
            const snap = this._capture();
            // 与栈顶相同则跳过
            if (this._index >= 0 && this._stack[this._index] === snap) return;
            // 丢弃 redo 分支
            this._stack = this._stack.slice(0, this._index + 1);
            this._stack.push(snap);
            if (this._stack.length > this._max) {
                this._stack.shift();
            } else {
                this._index++;
            }
            this._updateButtons();
        },

        _restore(snapStr) {
            const data = JSON.parse(snapStr);
            this._suspended = true;
            global.CanvasBlocks.load(data.blocks);
            // 分组范围在 load 之后恢复（load 内会重置 groups，历史快照中的范围优先）
            global.CanvasBlocks.loadGroups(data.groups || {});
            global.CanvasEdges.load(data.edges);
            if (global.CanvasDirector) global.CanvasDirector.load(data.director || null);
            global.CanvasSelection.clear();
            this._suspended = false;
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        undo() {
            if (this._index <= 0) return;
            this._index--;
            this._restore(this._stack[this._index]);
            this._updateButtons();
        },

        redo() {
            if (this._index >= this._stack.length - 1) return;
            this._index++;
            this._restore(this._stack[this._index]);
            this._updateButtons();
        },

        // 初始基线（加载完画布后调用）
        reset() {
            this._stack = [this._capture()];
            this._index = 0;
            this._updateButtons();
        },

        _updateButtons() {
            this.undoBtn.disabled = this._index <= 0;
            this.redoBtn.disabled = this._index >= this._stack.length - 1;
        }
    };

    global.CanvasHistory = CanvasHistory;
})(window);
