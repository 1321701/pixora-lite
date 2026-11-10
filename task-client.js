/**
 * 任务管理客户端
 * 支持断点续传，刷新页面不中断任务
 */

const TaskClient = {
    // 本地存储键名
    STORAGE_KEY: 'nano_active_tasks',
    
    // 轮询间隔（毫秒）
    POLL_INTERVAL: 3000,
    
    // 轮询定时器
    pollTimer: null,
    
    // 获取用户ID
    getUserId() {
        const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
        return user.id;
    },
    
    getAuthHeaders(extra = {}) { const user = JSON.parse(localStorage.getItem("nano_user") || "{}"); const headers = { ...extra }; if (user.token) headers.Authorization = "Bearer " + user.token; return headers; },
    /**
     * 创建生成任务
     * @param {Object} params - 生成参数
     * @param {Object} [opts] - 可选参数 { source: 'main'|'canvas' }，区分任务来源，默认 'main'
     * @returns {Object} 创建的任务
     */
    async createTask(params, opts) {
        const userId = this.getUserId();
        if (!userId) {
            throw new Error('用户未登录');
        }

        // 将来源标记注入 params，供后端区分历史记录存储（main/canvas）
        const source = (opts && opts.source) || 'main';
        const paramsWithSource = { ...params, source };

        const response = await fetch(`${API_CONFIG.baseUrl}/api/tasks`, {
            method: 'POST',
            headers: this.getAuthHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                userId: userId,
                params: paramsWithSource
            }),
        });

        const result = await response.json();
        if (result && result.code === 200) {
            // 保存到本地活跃任务列表（带来源标记，区分主页/画布）
            this.addActiveTask(result.data.id, source);
            // 开始轮询
            this.startPolling();
            return result.data;
        } else {
            throw new Error(result?.msg || '创建任务失败');
        }
    },
    
    /**
     * 获取任务列表
     * @param {Object} options - 查询选项
     */
    async getTasks(options = {}) {
        const userId = this.getUserId();
        if (!userId) return [];
        
        const { status, limit = 50 } = options;
        let url = `${API_CONFIG.baseUrl}/api/tasks?userId=${userId}&limit=${limit}`;
        if (status) {
            url += `&status=${status}`;
        }
        
        const response = await fetch(url, { headers: this.getAuthHeaders() });
        const result = await response.json();
        
        if (result && result.code === 200) {
            return result.data || [];
        }
        return [];
    },
    
    /**
     * 获取单个任务状态
     * @param {string} taskId - 任务ID
     */
    async getTaskStatus(taskId) {
        try {
            const response = await fetch(`${API_CONFIG.baseUrl}/api/tasks/${taskId}`, { headers: this.getAuthHeaders() });
            if (!response.ok) return null;
            const result = await response.json();
            if (result && result.code === 200) { return result.data; }
        } catch (e) { }
        return null;
    },
    
    /**
     * 取消任务
     * @param {string} taskId - 任务ID
     */
    async cancelTask(taskId) {
        const response = await fetch(`${API_CONFIG.baseUrl}/api/tasks/${taskId}/cancel`, {
            method: 'POST',
            headers: this.getAuthHeaders()
        });
        
        const result = await response.json();
        
        // 从活跃任务列表移除
        this.removeActiveTask(taskId);
        
        return result && result.code === 200;
    },
    
    /**
     * 删除任务
     * @param {string} taskId - 任务ID
     */
    async deleteTask(taskId) {
        const response = await fetch(`${API_CONFIG.baseUrl}/api/tasks/${taskId}`, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        
        const result = await response.json();
        
        // 从活跃任务列表移除
        this.removeActiveTask(taskId);
        
        return result && result.code === 200;
    },
    
    /**
     * 获取活跃任务列表（本地存储）
     * 返回统一格式：[{ id, source }]，兼容旧格式（纯字符串 id 视为 source='main'）
     */
    getActiveTasks() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            if (!data) return [];
            const raw = JSON.parse(data);
            return raw.map(item => {
                if (typeof item === 'string') return { id: item, source: 'main' };
                return item;
            });
        } catch (error) {
            return [];
        }
    },

    /**
     * 保存活跃任务列表（统一存为 [{id, source}]）
     */
    saveActiveTasks(tasks) {
        const normalized = tasks.map(item =>
            typeof item === 'string' ? { id: item, source: 'main' } : item
        );
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(normalized));
    },

    /**
     * 添加活跃任务
     * @param {string} taskId
     * @param {string} [source='main'] - 'main' | 'canvas'，区分任务来源
     */
    addActiveTask(taskId, source) {
        const tasks = this.getActiveTasks();
        if (!tasks.find(t => t.id === taskId)) {
            tasks.push({ id: taskId, source: source || 'main' });
            this.saveActiveTasks(tasks);
        }
    },

    /**
     * 移除活跃任务
     */
    removeActiveTask(taskId) {
        const tasks = this.getActiveTasks().filter(t => t.id !== taskId);
        this.saveActiveTasks(tasks);
    },
    
    /**
     * 开始轮询任务状态
     */
    startPolling() {
        if (this.pollTimer) return;
        
        this.pollTimer = setInterval(() => {
            this.pollTasks();
        }, this.POLL_INTERVAL);
    },
    
    /**
     * 停止轮询
     */
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },
    
    /**
     * 轮询所有活跃任务
     */
    async pollTasks() {
        const activeTasks = this.getActiveTasks();
        if (activeTasks.length === 0) {
            this.stopPolling();
            return;
        }

        for (const item of activeTasks) {
            const taskId = item.id;
            try {
                const task = await this.getTaskStatus(taskId);
                if (task) {
                    // 附带来源标记，供监听方过滤
                    task.source = item.source || 'main';
                    // 触发任务状态更新事件
                    window.dispatchEvent(new CustomEvent('taskStatusUpdated', {
                        detail: task
                    }));

                    // 如果任务已完成或失败，从活跃列表移除
                    if (task.status === 'completed' || task.status === 'failed') {
                        this.removeActiveTask(taskId);
                    }
                } else {
                    // 任务不存在（404），触发恢复事件让前端从历史记录恢复卡片
                    window.dispatchEvent(new CustomEvent('taskNotFound', { detail: { taskId: taskId, source: item.source || 'main' } }));
                    this.removeActiveTask(taskId);
                }
            } catch (error) {
                console.error('[任务客户端] 轮询任务失败:', taskId, error);
            }
        }
        
        // 一轮轮询结束后，检查是否还有活跃任务
        const remainingTasks = this.getActiveTasks();
        if (remainingTasks.length === 0) {
            this.stopPolling();
        }
    },
    
    /**
     * 恢复活跃任务（页面刷新后调用）
     */
    async restoreActiveTasks() {
        const activeTasks = this.getActiveTasks();
        if (activeTasks.length === 0) return [];

        const tasks = [];
        for (const item of activeTasks) {
            const taskId = item.id;
            try {
                const task = await this.getTaskStatus(taskId);
                if (task) {
                    // 附带来源标记
                    task.source = item.source || 'main';
                    tasks.push(task);
                    // 如果任务还在运行，继续轮询
                    if (task.status === 'pending' || task.status === 'running') {
                        this.startPolling();
                    } else {
                        // 任务已完成，从活跃列表移除
                        this.removeActiveTask(taskId);
                    }
                } else {
                    // 任务不存在，从活跃列表移除
                    this.removeActiveTask(taskId);
                }
            } catch (error) {
                console.error('[任务客户端] 恢复任务失败:', taskId, error);
                this.removeActiveTask(taskId);
            }
        }

        return tasks;
    },
    
    /**
     * 恢复任务（别名，用于页面加载时调用）
     */
    async resumeTasks() {
        return this.restoreActiveTasks();
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskClient;
}
