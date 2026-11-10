/**
 * canvas-ui.js
 * 画布页外围交互：左侧工具坞、左下缩放控件、按钮提示、快捷键（G/T/U）、
 * 空画布引导、生成中计时。
 */
(function (global) {
    'use strict';

    const CanvasUI = {
        _tipEl: null,

        init() {
            this._bindAdd();
            this._bindZoom();
            this._bindTips();
            this._bindKeys();
            this._watchEmpty();
            // 点画布时让外部输入框失焦，否则快捷键（T/U/Delete 等）会被当作打字吞掉
            const vp = global.CanvasCore && global.CanvasCore.viewportEl;
            if (vp) vp.addEventListener('mousedown', () => {
                const a = document.activeElement;
                if (a && a !== document.body && !vp.contains(a) && (a.isContentEditable || /input|textarea|select/i.test(a.tagName))) a.blur();
            }, true);
            setInterval(() => this._tickElapsed(), 1000);
        },

        // ===== 添加内容 =====
        _bindAdd() {
            document.querySelectorAll('[data-add]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.add(btn.dataset.add);
                });
            });
        },

        add(kind) {
            const CM = global.CanvasMain, CB = global.CanvasBlocks;
            if (!CM || !CB) return;
            const c = CB.viewportCenterWorld();
            if (kind === 'gen') {
                CM._createGenNode(c.x - 110, c.y - 110);
                setTimeout(() => { const ip = document.getElementById('promptInput'); if (ip) ip.focus(); }, 60);
            } else if (kind === 'text') {
                CM._createTextNode(c.x, c.y);
            } else if (kind === 'upload') {
                const input = document.getElementById('refFileInput');
                if (input) input.click();
            }
        },

        // ===== 缩放 =====
        _bindZoom() {
            const Core = global.CanvasCore;
            const center = () => {
                const r = Core.viewportEl.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            };
            const zoom = (f) => { const c = center(); Core.zoomAt(c.x, c.y, f); };
            const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
            on('zoomInBtn', () => zoom(1.25));
            on('zoomOutBtn', () => zoom(0.8));
            on('zoomIndicator', () => zoom(1 / Core.viewport.scale));
        },

        // ===== 按钮提示：名称 + 快捷键 =====
        _bindTips() {
            const tip = document.createElement('div');
            tip.className = 'px-ctip hidden';
            document.body.appendChild(tip);
            this._tipEl = tip;
            const show = (el) => {
                const label = el.dataset.tip;
                if (!label) return;
                const key = el.dataset.key;
                tip.innerHTML = `<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}`;
                tip.classList.remove('hidden');
                const r = el.getBoundingClientRect();
                const inDock = !!el.closest('.float-dock-l');
                const tw = tip.offsetWidth, th = tip.offsetHeight;
                let x, y;
                if (inDock) { x = r.right + 10; y = r.top + r.height / 2 - th / 2; }
                else { x = r.left + r.width / 2 - tw / 2; y = r.top - th - 8; }
                tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, x)) + 'px';
                tip.style.top = Math.max(8, y) + 'px';
            };
            const hide = () => tip.classList.add('hidden');
            document.querySelectorAll('.canvas-app [data-tip]').forEach(el => {
                el.addEventListener('mouseenter', () => show(el));
                el.addEventListener('mouseleave', hide);
                el.addEventListener('mousedown', hide);
            });
        },

        // ===== 快捷键：G 图片生成 / T 文本 / U 上传 =====
        _bindKeys() {
            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
                const t = e.target;
                const typing = /input|textarea|select/i.test(t.tagName) || t.isContentEditable;
                if (typing) return;
                const modal = document.querySelector('#imageEditorModal:not(.hidden), .fullscreen-viewer:not(.hidden)');
                if (modal) return;
                const k = e.key.toLowerCase();
                const map = { g: 'gen', t: 'text', u: 'upload' };
                if (map[k]) { e.preventDefault(); this.add(map[k]); }
            });
        },

        // ===== 空画布引导 =====
        _watchEmpty() {
            const layer = document.getElementById('blocksLayer');
            if (!layer) return;
            new MutationObserver(() => this.refreshEmpty()).observe(layer, { childList: true });
            this.refreshEmpty();
        },

        refreshEmpty() {
            const guide = document.getElementById('canvasEmptyGuide');
            const CB = global.CanvasBlocks;
            if (!guide || !CB) return;
            const empty = !CB.blocks || CB.blocks.length === 0;
            guide.classList.toggle('hidden', !empty);
        },

        // ===== 生成中计时 =====
        _tickElapsed() {
            const now = Date.now();
            document.querySelectorAll('.node-gen-elapsed[data-start]').forEach(el => {
                const st = parseInt(el.dataset.start, 10);
                if (!st) { el.textContent = ''; return; }
                const sec = Math.max(0, Math.round((now - st) / 1000));
                el.textContent = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            });
        }
    };

    global.CanvasUI = CanvasUI;
})(window);
