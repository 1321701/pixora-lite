/**
 * canvas-history-ui.js
 * 无限画布的历史记录与收藏弹窗
 *   - 历史记录/收藏与主页分离，仅显示画布生成（source=canvas）的记录
 *   - 画布中删除节点不影响历史记录，只有在此弹窗内删除才真正删除
 *   - 收藏/取消收藏实时同步
 */
(function (global) {
    'use strict';

    const CanvasHistoryUI = {
        // 分页参数
        _page: 0,
        _pageSize: 50,
        _total: 0,
        _loading: false,
        _allLoaded: false,
        _cache: [],

        // 收藏弹窗
        _favLoading: false,

        // 历史分类 tab：image | video
        _histTab: 'image',

        init() {
            this._bindHistoryBtn();
            this._bindHistoryTabs();
            this._bindFavoritesBtn();
            this._bindScroll();
        },

        getUserId() {
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                return user.id;
            } catch { return undefined; }
        },

        getToken() {
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                return user.token;
            } catch { return undefined; }
        },

        // 鉴权请求头：服务端 userId 以 token 为准
        _authHeaders(extra) {
            const t = this.getToken();
            return Object.assign(t ? { 'Authorization': 'Bearer ' + t } : {}, extra || {});
        },

        // ===== 历史记录弹窗 =====
        _bindHistoryTabs() {
            const tImg = document.getElementById('canvasHistTabImage');
            const tVid = document.getElementById('canvasHistTabVideo');
            if (!tImg || !tVid) return;
            tImg.addEventListener('click', () => this._switchHistoryTab('image'));
            tVid.addEventListener('click', () => this._switchHistoryTab('video'));
        },

        async _switchHistoryTab(tab) {
            if (this._histTab === tab) return;
            this._histTab = tab;
            const tImg = document.getElementById('canvasHistTabImage');
            const tVid = document.getElementById('canvasHistTabVideo');
            if (tImg) tImg.classList.toggle('active', tab === 'image');
            if (tVid) tVid.classList.toggle('active', tab === 'video');
            this._resetPaging();
            await this._loadHistoryPage();
        },

        _bindHistoryBtn() {
            const btn = document.getElementById('canvasHistoryBtn');
            if (!btn) return;
            btn.addEventListener('click', () => this._openHistory());

            const closeBtn = document.getElementById('closeCanvasHistoryBtn');
            if (closeBtn) closeBtn.addEventListener('click', () => this._closeHistory());

            const clearBtn = document.getElementById('clearCanvasHistoryBtn');
            if (clearBtn) clearBtn.addEventListener('click', () => this._clearHistory());

            // 点击遮罩关闭
            const modal = document.getElementById('canvasHistoryModal');
            if (modal) modal.addEventListener('click', (e) => {
                if (e.target === modal) this._closeHistory();
            });
        },

        async _openHistory() {
            const modal = document.getElementById('canvasHistoryModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            this._resetPaging();
            await this._loadHistoryPage();
        },

        _closeHistory() {
            const modal = document.getElementById('canvasHistoryModal');
            if (modal) modal.classList.add('hidden');
        },

        _resetPaging() {
            this._page = 0;
            this._total = 0;
            this._loading = false;
            this._allLoaded = false;
            this._cache = [];
            const list = document.getElementById('canvasHistoryList');
            if (list) list.innerHTML = '';
        },

        async _loadHistoryPage() {
            if (this._loading || this._allLoaded) return;
            const userId = this.getUserId();
            if (!userId) return;
            this._loading = true;

            try {
                const offset = this._page * this._pageSize;
                const url = `${API_CONFIG.baseUrl}/api/history?userId=${userId}&limit=${this._pageSize}&offset=${offset}&source=canvas&mediaType=${this._histTab}`;
                const res = await fetch(url, { headers: this._authHeaders() });
                const result = await res.json();
                if (result && result.code === 200 && result.data) {
                    const records = result.data.records || [];
                    this._total = result.data.total || 0;
                    this._updateCount();
                    if (records.length === 0 && this._page === 0) {
                        const list = document.getElementById('canvasHistoryList');
                        if (list) list.innerHTML = '<div class="history-empty">暂无画布生成记录</div>';
                        this._allLoaded = true;
                    } else {
                        this._cache = this._cache.concat(records);
                        this._appendRecords(records);
                        if (this._cache.length >= this._total) this._allLoaded = true;
                        this._page++;
                    }
                }
            } catch (e) {
                console.error('[画布历史] 加载失败:', e);
            } finally {
                this._loading = false;
            }
        },

        _updateCount() {
            const el = document.getElementById('canvasHistoryCount');
            if (el) el.textContent = `(${this._total})`;
        },

        _appendRecords(records) {
            const list = document.getElementById('canvasHistoryList');
            if (!list) return;
            // 移除空状态提示
            const empty = list.querySelector('.history-empty');
            if (empty) empty.remove();

            const html = records.map(r => this._renderItem(r, false)).join('');
            list.insertAdjacentHTML('beforeend', html);
            this._bindItemEvents(list, records, false);
        },

        // 渲染单个历史记录卡片
        _renderItem(record, isFav) {
            const date = new Date(record.timestamp || record.createdAt);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
            const prompt = record.prompt || '无提示词';
            const model = record.model || '-';
            const isVideo = record.mediaType === 'video';
            const size = isVideo ? (record.resolution || record.videoResolution || '视频') : (record.imageSize || '-');
            const originalUrl = record.imageUrl || record.originalUrl || '';
            const thumbnailUrl = originalUrl ? originalUrl.replace('/original/', '/preview/') : '';
            // 视频缩略图：直接用首帧（thumbnailUrl 带图片处理参数对 mp4 无效）
            const videoThumb = isVideo && originalUrl ? originalUrl + '#t=0.1' : '';
            const favClass = record.isFavorited ? ' favorited' : '';
            const favIcon = record.isFavorited ? '★' : '☆';
            // 全部插值统一转义，防止存储型 XSS（prompt/model/URL 等均可被恶意构造）
            const esc = (s) => this._escape(s);

            return `
                <div class="history-item${favClass}" data-record-id="${esc(record.id)}" data-task-id="${esc(record.taskId || '')}" data-img-url="${esc(originalUrl)}">
                    ${isVideo
                        ? `<video src="${esc(videoThumb)}" preload="metadata" muted playsinline onerror="this.style.opacity=0.3"></video><span class="history-badge-video">视频</span>`
                        : `<img src="${esc(thumbnailUrl)}" alt="${esc(prompt)}" loading="lazy" onerror="this.style.opacity=0.3">`}
                    <div class="history-item-info">
                        <div class="history-item-prompt">${esc(prompt)}</div>
                        <div class="history-item-meta">
                            <span>${esc(model)}</span>
                            <span>${esc(size)}</span>
                            <span>${dateStr}</span>
                        </div>
                    </div>
                    <div class="canvas-hist-actions">
                        <button class="canvas-hist-fav-btn" title="${record.isFavorited ? '取消收藏' : '收藏'}">${favIcon}</button>
                        <button class="canvas-hist-del-btn" title="删除">🗑</button>
                    </div>
                </div>
            `;
        },

        _bindItemEvents(list, records, isFav) {
            records.forEach(record => {
                const item = list.querySelector(`.history-item[data-record-id="${record.id}"]`);
                if (!item) return;
                const favBtn = item.querySelector('.canvas-hist-fav-btn');
                const delBtn = item.querySelector('.canvas-hist-del-btn');
                const img = item.querySelector('img, video');

                if (favBtn) favBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._toggleFavorite(record);
                });
                if (delBtn) delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._deleteRecord(record, item);
                });
                if (img) img.addEventListener('click', () => {
                    const url = item.dataset.imgUrl;
                    if (url) window.open(url, '_blank');
                });
            });
        },

        async _toggleFavorite(record) {
            const userId = this.getUserId();
            if (!userId) return;
            const isFav = record.isFavorited;
            const endpoint = isFav ? '/api/history/unfavorite' : '/api/history/favorite';
            try {
                const res = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
                    method: 'POST',
                    headers: this._authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        userId,
                        recordId: record.id,
                        taskId: record.taskId,
                        source: 'canvas'
                    })
                });
                const result = await res.json();
                if (result && result.code === 200) {
                    record.isFavorited = !isFav;
                    // 更新对应卡片的视觉状态
                    this._updateItemVisual(record.id, record.isFavorited);
                }
            } catch (e) {
                console.error('[画布历史] 收藏操作失败:', e);
            }
        },

        _updateItemVisual(recordId, isFavorited) {
            // 更新历史弹窗中的卡片
            document.querySelectorAll(`.history-item[data-record-id="${recordId}"]`).forEach(item => {
                item.classList.toggle('favorited', isFavorited);
                const btn = item.querySelector('.canvas-hist-fav-btn');
                if (btn) {
                    btn.textContent = isFavorited ? '★' : '☆';
                    btn.title = isFavorited ? '取消收藏' : '收藏';
                }
            });
        },

        async _deleteRecord(record, itemEl) {
            const userId = this.getUserId();
            if (!userId) return;
            if (!confirm('确定删除此记录吗？')) return;
            try {
                const res = await fetch(`${API_CONFIG.baseUrl}/api/history?userId=${userId}&recordId=${record.id}&source=canvas`, {
                    method: 'DELETE',
                    headers: this._authHeaders()
                });
                const result = await res.json();
                if (result && result.code === 200) {
                    if (itemEl) itemEl.remove();
                    this._total = Math.max(0, this._total - 1);
                    this._updateCount();
                    // 从缓存中移除
                    this._cache = this._cache.filter(r => r.id !== record.id);
                }
            } catch (e) {
                console.error('[画布历史] 删除失败:', e);
            }
        },

        async _clearHistory() {
            const userId = this.getUserId();
            if (!userId) return;
            if (!confirm('确定清空所有未收藏的画布历史记录吗？收藏记录会保留。')) return;
            try {
                const res = await fetch(`${API_CONFIG.baseUrl}/api/history/clear?userId=${userId}&clearFavorites=false&source=canvas`, {
                    method: 'DELETE',
                    headers: this._authHeaders()
                });
                const result = await res.json();
                if (result && result.code === 200) {
                    this._resetPaging();
                    await this._loadHistoryPage();
                }
            } catch (e) {
                console.error('[画布历史] 清空失败:', e);
            }
        },

        _bindScroll() {
            const body = document.querySelector('#canvasHistoryModal .history-body');
            if (!body) return;
            body.addEventListener('scroll', () => {
                if (body.scrollTop + body.clientHeight >= body.scrollHeight - 50) {
                    this._loadHistoryPage();
                }
            });
        },

        // ===== 收藏弹窗 =====
        _bindFavoritesBtn() {
            const btn = document.getElementById('canvasFavBtn');
            if (!btn) return;
            btn.addEventListener('click', () => this._openFavorites());

            const closeBtn = document.getElementById('closeCanvasFavBtn');
            if (closeBtn) closeBtn.addEventListener('click', () => this._closeFavorites());

            const modal = document.getElementById('canvasFavoritesModal');
            if (modal) modal.addEventListener('click', (e) => {
                if (e.target === modal) this._closeFavorites();
            });
        },

        async _openFavorites() {
            const modal = document.getElementById('canvasFavoritesModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            const list = document.getElementById('canvasFavList');
            if (list) list.innerHTML = '<div class="history-empty">加载中...</div>';
            await this._loadFavorites();
        },

        _closeFavorites() {
            const modal = document.getElementById('canvasFavoritesModal');
            if (modal) modal.classList.add('hidden');
        },

        async _loadFavorites() {
            const userId = this.getUserId();
            if (!userId) return;
            const list = document.getElementById('canvasFavList');
            const countEl = document.getElementById('canvasFavCount');
            try {
                const res = await fetch(`${API_CONFIG.baseUrl}/api/history/favorites?userId=${userId}&source=canvas`, { headers: this._authHeaders() });
                const result = await res.json();
                if (result && result.code === 200 && result.data) {
                    const records = result.data.records || [];
                    if (countEl) countEl.textContent = `(${records.length})`;
                    if (list) {
                        if (records.length === 0) {
                            list.innerHTML = '<div class="history-empty">暂无画布收藏</div>';
                        } else {
                            list.innerHTML = records.map(r => this._renderItem(r, true)).join('');
                            this._bindItemEvents(list, records, true);
                        }
                    }
                }
            } catch (e) {
                console.error('[画布收藏] 加载失败:', e);
                if (list) list.innerHTML = '<div class="history-empty">加载失败</div>';
            }
        },

        _escape(str) {
            if (!str) return '';
            return String(str).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }
    };

    global.CanvasHistoryUI = CanvasHistoryUI;
})(window);
