// i18n.js - 国际化词典
const i18n = {
    en: {
        // 通用
        appTitle: "Image Editor",
        cancel: "Cancel",
        save: "Save",
        delete: "Delete",
        confirm: "Confirm",
        close: "Close",
        
        // 语言切换
        langEn: "EN",
        langZh: "中文",
        
        // 主界面
        addReferenceImage: "Add Reference Image",
        promptPlaceholder: "Describe the image you want, e.g. a swordsman in white under moonlight, ink-wash landscape, cinematic lighting",
        ratio: "Ratio",
        resolution: "Resolution",
        taskCounter: "tasks",
        
        // 设置
        settings: "Settings",
        apiKey: "API Key",
        apiEndpoint: "API Endpoint",
        saveSettings: "Save Settings",
        
        // 图片编辑器
        imageEditor: "Image Editor",
        
        // 工具
        toolSelect: "Select/Move (S)",
        toolText: "Text (T)",
        toolBrush: "Brush (B)",
        toolCrop: "Crop (C)",
        toolUndo: "Undo (Ctrl+Z)",
        toolRedo: "Redo (Ctrl+Y)",
        
        // 选择工具
        resetView: "Reset View",
        
        // 画笔工具
        brushMode: "Brush",
        eraserMode: "Eraser",
        color: "Color",
        size: "Size",
        brushSizeLabel: "Brush/Eraser Size",
        brushTip: "Wheel: Zoom canvas  |  Mid/Right drag: Pan canvas",
        
        // 文字工具
        textTool: "Text",
        arrowTool: "Arrow",
        rectTool: "Rectangle",
        colorWhite: "White",
        colorRed: "Red",
        colorOrange: "Orange",
        colorYellow: "Yellow",
        colorGreen: "Green",
        colorBlue: "Blue",
        colorBlack: "Black",
        textTip: "Wheel: Zoom text size",
        
        // 裁剪工具
        cropRatio: "Crop Ratio",
        ratioFree: "Free",
        ratio1_1: "1:1",
        ratio4_3: "4:3",
        ratio3_4: "3:4",
        ratio9_16: "9:16",
        ratio16_9: "16:9",
        
        // 文字编辑侧边栏
        textEditTitle: "Text Edit",
        textContent: "Content",
        textContentPlaceholder: "Enter text...",
        fontSize: "Font Size",
        
        // 状态消息
        statusGenerating: "Generating...",
        statusSucceeded: "Success",
        statusFailed: "Failed",
        errorApiKey: "Please set API Key in Settings",
        errorPrompt: "Please enter prompt",
        errorMaxTasks: "Max 10 concurrent tasks",
        
        // 操作提示
        titleDownload: "Download",
        titleCopy: "Copy",
        retry: "Retry",
        editParams: "Edit Parameters",
        regenerate: "Regenerate",
        generate: "Generate",
        processing: "Processing...",
        clickToView: "Click to view full image",
        
        // 大图查看器参数
        viewerTitle: "Generation Parameters",
        viewerModel: "Model",
        viewerAspect: "Aspect Ratio",
        viewerSize: "Resolution",
        viewerPrompt: "Prompt",
        viewerRefImages: "Reference Images",
        viewerRefCount: "images",
        viewerNoRef: "None",
        
        // 删除确认
        deleteConfirm: "Are you sure to delete?",
        clearHistoryConfirm: "Are you sure to clear all history records?",

        // 单位
        unitPx: "px",
        unitTasks: "tasks",
        unitImage: "img",

        // 历史记录
        history: "History",
        generationHistory: "Generation History",
        clearHistory: "Clear History",
        noHistory: "No generation records",

        // 图片上传
        imageTooLarge: "Image size exceeds 50MB limit",
        imageResolutionTooHigh: "Image resolution exceeds 4K limit",

        // 作参考图
        useAsRef: "Ref",
        refSlotsFull: "Reference image slots are full, please delete one first",
        addedAsRef: "Added as reference image",
        addRefFailed: "Failed to add reference image",

        // 外部链接弹窗
        externalLinkTitle: "Leaving this site",
        externalLinkDesc: "You are about to visit the following external link:",
        externalLinkWarning: "Note: This site is not responsible for the content of external links. Please make sure you trust this website.",
        externalLinkConfirm: "Continue",

        // 通知/收藏/确认
        systemNotice: "System Notice",
        noNotice: "No notifications",
        myFavorites: "My Favorites",
        infiniteCanvas: "Infinite Canvas",
        pxNavGenerate: "Create",
        pxNavInspire: "Home",
        pxNavCanvas: "Canvas",
        pxNavHistory: "History",
        pxNavFavorites: "Saved",
        pxNavNotice: "Notices",
        pxNavSettings: "Settings",
        pxCreditsUnit: "credits",
        pxAssist: "Assistant",
        pxHintGen: "generate",
        pxHintBreak: "new line",
        pxHintDrop: "drop images as reference",
        pxChars: "chars",
        pxClear: "Clear",
        pxDropHint: "Drop to add as reference",
        pxHeroPill: "GPT Image 2.5 is live, built for speed",
        pxHeroTitleA: "One sentence, ",
        pxHeroTitleB: "commercial-ready",
        pxHeroTitleC: " HD artwork",
        pxHeroDesc: "Nano Banana Pro, GPT Image, Seedream and more top models, up to 4K output",
        pxInspireTitle: "Explore",
        pxInspireHint: "Click a card to reuse its prompt",
        pxUsePrompt: "Use prompt",
        pxSetLang: "Language",
        pxSetLangDesc: "Applies immediately",
        pxSetPs: "Photoshop plugin",
        pxSetPsDesc: "Generate with Pixora right inside Photoshop",
        pxSetPsBtn: "Get plugin",
        copy: "Copy",
        userName: "Username",
        autoBestRoute: "The system will automatically select the best route",
        clearHistoryTitle: "Clear History",
        clearHistoryMessage: "Please choose how to clear:\n\n• All records: clear all history (including favorites)\n• Keep favorites: clear only un-favorited records",
        keepFavorites: "Keep Favorites",
        allRecords: "All Records",

        // 顶部栏/用户菜单
        smartSchedule: "Smart Scheduling",
        logout: "Log Out",
        adImage: "Ad",
        dontShowAgain: "Don't show again",
        confirmTitle: "Confirm",
        copyPrompt: "Copy Prompt",
        copied: "Copied",
        copyFailed: "Copy failed, please copy manually",

        // 聊天模块
        chatAssistant: "Creative Assistant - XiaoP",
        chatRobotName: "XiaoP",
        contextUsage: "Context Usage",
        toggleLayout: "Toggle Layout",
        chatSessions: "Chat Sessions",
        newChat: "New Chat",
        chatInputPlaceholder: "Type a message...",
        brainModeTip: "Click to enable thinking mode",
        sendImageTip: "Send images (up to 3)",
        chatWelcome: "Hi! I'm the AI creative assistant. I can help you:",
        chatWelcomeItem1: "Optimize image prompts",
        chatWelcomeItem2: "Recommend suitable models",
        chatWelcomeItem3: "Answer creative questions",
        chatWelcomeAsk: "How can I help you?",
        chatErrorPrefix: "Sorry, ",
        chatError: "an error occurred",
        squeezeMode: "Squeeze mode (click to toggle)",
        overlayMode: "Overlay mode (click to toggle)",
        accountBanned: "Your account has been banned. Please contact the administrator.",

        // 模型简介
        descNanoBananaPro: "Gemini 3 Pro image generation model, supports text-to-image, image-to-image, multi-image blending",
        descNanoBanana2: "Gemini 3.1 Flash image generation model, fast generation, supports text-to-image and image-to-image",
        descNanoBanana21: "Gemini Nano Banana 2.1 image generation model, next-gen model, supports text-to-image and image-to-image",
        descGptImage2: "OpenAI GPT-Image-2 image generation model, high-quality generation",
        descGptImage2Vip: "OpenAI GPT-Image-2 Pro model, supports full-resolution high-quality generation",

        // 动态文案
        currentlyUsing: "In use",
        clickToSwitch: "Click to switch",
        loading: "Loading...",
        noModels: "No available models",
        configLoadFailed: "Failed to load config",
        serverError: "Server error",
        noImages: "No uploaded images",
        noImageContent: "No image content, please add images",
        imageLabel: "Image",
        favorite: "Favorite",
        unfavorite: "Unfavorite",
        use: "Use",
        usePrompt: "Use prompt",
        loadFailed: "Failed to load",
        noPrompt: "No prompt",
        unknownModel: "Unknown model",
        noFavorites: "No favorites",
        noHistoryRecords: "No generation records",
        deleteTaskConfirm: "Are you sure to delete this task record?",
        taskSystemNotInit: "Task system not initialized, please refresh the page",
        createTaskFailed: "Failed to create task",
        retryParamsLost: "Task parameters lost, cannot retry",
        operationFailed: "Operation failed",
        unknownError: "Unknown error",
        uploadFailed: "Image upload failed",
        previewUploadFailed: "Preview image upload failed",
        imageProcessing: "Processing images",
        imageUploading: "Uploading image...",
        mjMaxRefImages: "Midjourney models support up to 3 reference images",
        imageTooLarge20: "Image size exceeds 20MB limit",
        imageFormatUnsupported: "Unsupported image format. Only jpg/jpeg, png, bmp, gif, webp, tiff, heic are supported",
        readImageFailed: "Failed to read image info",
        viewerQuality: "Quality:",
        viewerAspectLabel: "Aspect:",
        viewerSizeLabel: "Resolution:",
        qualitySd: "SD",
        qualityHd: "HD",
        qualityUhd: "UHD",
        qualityExp: "Experimental",
    },
    zh: {
        // 通用
        appTitle: "图片编辑器",
        cancel: "取消",
        save: "保存",
        delete: "删除",
        confirm: "确认",
        close: "关闭",
        
        // 语言切换
        langEn: "EN",
        langZh: "中文",
        
        // 主界面
        addReferenceImage: "添加参考图",
        promptPlaceholder: "描述你想要的画面，例如：月光下的白衣剑客，水墨山水背景，电影级光影",
        ratio: "比例",
        resolution: "分辨率",
        taskCounter: "张",
        
        // 设置
        settings: "设置",
        apiKey: "API Key",
        apiEndpoint: "接口地址",
        saveSettings: "保存设置",
        
        // 图片编辑器
        imageEditor: "图片编辑",
        
        // 工具
        toolSelect: "选择/拖动 (S)",
        toolText: "添加文字 (T)",
        toolBrush: "画笔 (B)",
        toolCrop: "裁切 (C)",
        toolUndo: "撤销 (Ctrl+Z)",
        toolRedo: "重做 (Ctrl+Y)",
        
        // 选择工具
        resetView: "还原视图",
        
        // 画笔工具
        brushMode: "画笔",
        eraserMode: "橡皮擦",
        color: "颜色",
        size: "大小",
        brushSizeLabel: "画笔/橡皮大小",
        brushTip: "滚轮缩放画布 | 中键/右键拖动画布",
        
        // 文字工具
        textTool: "文字",
        arrowTool: "箭头",
        rectTool: "方框",
        colorWhite: "白色",
        colorRed: "红色",
        colorOrange: "橙色",
        colorYellow: "黄色",
        colorGreen: "绿色",
        colorBlue: "蓝色",
        colorBlack: "黑色",
        textTip: "滚轮缩放大小",
        
        // 裁剪工具
        cropRatio: "裁切比例",
        ratioFree: "自由",
        ratio1_1: "1:1",
        ratio4_3: "4:3",
        ratio3_4: "3:4",
        ratio9_16: "9:16",
        ratio16_9: "16:9",
        
        // 文字编辑侧边栏
        textEditTitle: "文字编辑",
        textContent: "文字内容",
        textContentPlaceholder: "输入文字...",
        fontSize: "字体大小",
        
        // 状态消息
        statusGenerating: "生成中...",
        statusSucceeded: "成功",
        statusFailed: "失败",
        errorApiKey: "请在设置中输入 API Key",
        errorPrompt: "请输入提示词",
        errorMaxTasks: "已达最大任务数 (10)",
        
        // 操作提示
        titleDownload: "下载",
        titleCopy: "复制",
        retry: "重试",
        editParams: "编辑参数",
        regenerate: "再次生成",
        generate: "生成",
        processing: "处理中...",
        clickToView: "点击查看完整图",
        
        // 大图查看器参数
        viewerTitle: "生成参数",
        viewerModel: "模型",
        viewerAspect: "比例",
        viewerSize: "分辨率",
        viewerPrompt: "提示词",
        viewerRefImages: "参考图",
        viewerRefCount: "张",
        viewerNoRef: "无",
        
        // 删除确认
        deleteConfirm: "确定要删除吗？",
        clearHistoryConfirm: "确定要清空所有历史记录吗？",

        // 单位
        unitPx: "px",
        unitTasks: "张",
        unitImage: "张",

        // 历史记录
        history: "历史记录",
        generationHistory: "生成历史",
        clearHistory: "清空记录",
        noHistory: "暂无生成记录",

        // 图片上传
        imageTooLarge: "图片大小超过50MB限制，无法上传",
        imageResolutionTooHigh: "图片分辨率超过4K限制，无法上传",

        // 作参考图
        useAsRef: "参考",
        refSlotsFull: "参考图位置已满，请先删除一张图片",
        addedAsRef: "已添加为参考图",
        addRefFailed: "添加参考图失败",

        // 外部链接弹窗
        externalLinkTitle: "即将离开本站",
        externalLinkDesc: "您即将访问以下外部链接：",
        externalLinkWarning: "请注意：本站不对外部链接的内容负责，请确保您信任该网站。",
        externalLinkConfirm: "继续访问",

        // 通知/收藏/确认
        systemNotice: "系统通知",
        noNotice: "暂无通知",
        myFavorites: "我的收藏",
        infiniteCanvas: "无限画布",
        pxNavGenerate: "生成",
        pxNavInspire: "主页",
        pxNavCanvas: "画布",
        pxNavHistory: "历史",
        pxNavFavorites: "收藏",
        pxNavNotice: "通知",
        pxNavSettings: "设置",
        pxCreditsUnit: "积分",
        pxAssist: "创意助手",
        pxHintGen: "生成",
        pxHintBreak: "换行",
        pxHintDrop: "拖入图片作为参考",
        pxChars: "字",
        pxClear: "清空",
        pxDropHint: "松开鼠标，添加为参考图",
        pxHeroPill: "GPT Image 2.5 已上线，速度优先",
        pxHeroTitleA: "一句话，生成",
        pxHeroTitleB: "可商用",
        pxHeroTitleC: "的高清作品",
        pxHeroDesc: "汇集 Nano Banana Pro、GPT Image、Seedream 等顶级模型，最高 4K 输出",
        pxInspireTitle: "灵感广场",
        pxInspireHint: "点击卡片，一键套用提示词",
        pxUsePrompt: "用这个提示词",
        pxSetLang: "界面语言",
        pxSetLangDesc: "切换后立即生效",
        pxSetPs: "Photoshop 插件",
        pxSetPsDesc: "在 PS 里直接调用 Pixora 生图",
        pxSetPsBtn: "下载插件",
        copy: "复制",
        userName: "用户名",
        autoBestRoute: "系统将自动选择最优线路",
        clearHistoryTitle: "清空历史记录",
        clearHistoryMessage: "请选择清空方式：\n\n• 全部记录：清空所有历史记录（包括收藏）\n• 保留收藏：仅清空未收藏的记录，保留收藏",
        keepFavorites: "保留收藏",
        allRecords: "全部记录",

        // 顶部栏/用户菜单
        smartSchedule: "智能调度",
        logout: "退出登录",
        adImage: "广告",
        dontShowAgain: "不再显示",
        confirmTitle: "确认",
        copyPrompt: "复制提示词",
        copied: "已复制",
        copyFailed: "复制失败，请手动复制",

        // 聊天模块
        chatAssistant: "创意助手 - 小P",
        chatRobotName: "小P",
        contextUsage: "上下文使用量",
        toggleLayout: "切换布局模式",
        chatSessions: "会话列表",
        newChat: "新建会话",
        chatInputPlaceholder: "输入消息...",
        brainModeTip: "点击开启思考模式",
        sendImageTip: "发送图片（最多3张）",
        chatWelcome: "你好！我是AI创意助手，可以帮你：",
        chatWelcomeItem1: "优化图像提示词",
        chatWelcomeItem2: "推荐合适的模型",
        chatWelcomeItem3: "解答创作问题",
        chatWelcomeAsk: "有什么可以帮你的吗？",
        chatErrorPrefix: "抱歉，",
        chatError: "发生错误",
        squeezeMode: "挤压模式（点击切换）",
        overlayMode: "覆盖模式（点击切换）",
        accountBanned: "您的账号已被封禁，请联系管理员",

        // 模型简介
        descNanoBananaPro: "Gemini 3 Pro 图像生成模型，支持文生图、图生图、多图混合",
        descNanoBanana2: "Gemini 3.1 Flash 图像生成模型，快速生成，支持文生图、图生图",
        descNanoBanana21: "Gemini Nano Banana 2.1 图像生成模型，新一代模型，支持文生图、图生图",
        descGptImage2: "OpenAI GPT-Image-2 图像生成模型，高质量生成",
        descGptImage2Vip: "OpenAI GPT-Image-2 Pro 模型，支持全分辨率高质量生成",

        // 动态文案
        currentlyUsing: "当前使用",
        clickToSwitch: "点击切换",
        loading: "加载中...",
        noModels: "暂无可用模型",
        configLoadFailed: "配置加载失败",
        serverError: "服务器返回错误",
        noImages: "暂无上传的图片",
        noImageContent: "暂无图片内容，请添加图片",
        imageLabel: "图片",
        favorite: "收藏",
        unfavorite: "取消收藏",
        use: "使用",
        usePrompt: "使用提示词",
        loadFailed: "加载失败",
        noPrompt: "无提示词",
        unknownModel: "未知模型",
        noFavorites: "暂无收藏记录",
        noHistoryRecords: "暂无生成记录",
        deleteTaskConfirm: "确定要删除此任务记录吗？",
        taskSystemNotInit: "任务系统未初始化，请刷新页面重试",
        createTaskFailed: "创建任务失败",
        retryParamsLost: "任务参数已丢失，无法重试",
        operationFailed: "操作失败",
        unknownError: "未知错误",
        uploadFailed: "图片上传失败",
        previewUploadFailed: "预览图上传失败",
        imageProcessing: "图片处理中",
        imageUploading: "图片上传中...",
        mjMaxRefImages: "Midjourney 模型最多支持 3 张参考图",
        imageTooLarge20: "图片大小超过20MB限制",
        imageFormatUnsupported: "不支持的图片格式，仅支持 jpg/jpeg、png、bmp、gif、webp、tiff、heic",
        readImageFailed: "无法读取图片信息",
        viewerQuality: "画质:",
        viewerAspectLabel: "比例:",
        viewerSizeLabel: "分辨率:",
        qualitySd: "标清",
        qualityHd: "高清",
        qualityUhd: "超清",
        qualityExp: "实验",
    }
};

// 语言切换回调函数数组
const langChangeCallbacks = [];

// 注册语言切换回调
function onLangChange(callback) {
    langChangeCallbacks.push(callback);
}

// 获取当前语言
function getCurrentLang() {
    return localStorage.getItem('nano_lang') || 'zh';
}

// 设置语言
function setLang(lang) {
    localStorage.setItem('nano_lang', lang);
    updateAllText();
    // 触发所有注册的回调
    langChangeCallbacks.forEach(cb => cb(lang));
}

// 获取翻译文本
function t(key) {
    const lang = getCurrentLang();
    return i18n[lang][key] || i18n['en'][key] || key;
}

// 更新所有带 data-i18n 属性的元素
function updateAllText() {
    // 更新普通文本元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            el.textContent = t(key);
        }
    });
    
    // 更新 placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
            el.placeholder = t(key);
        }
    });
    
    // 更新 title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
            el.title = t(key);
        }
    });
    
    // 更新语言按钮状态
    const lang = getCurrentLang();
    const langEnBtn = document.getElementById('langEn');
    const langZhBtn = document.getElementById('langZh');
    if (langEnBtn) langEnBtn.classList.toggle('active', lang === 'en');
    if (langZhBtn) langZhBtn.classList.toggle('active', lang === 'zh');
}

// 初始化
function initI18n() {
    updateAllText();
    
    // 绑定语言切换按钮
    const langEnBtn = document.getElementById('langEn');
    const langZhBtn = document.getElementById('langZh');
    
    if (langEnBtn) {
        langEnBtn.addEventListener('click', () => setLang('en'));
    }
    if (langZhBtn) {
        langZhBtn.addEventListener('click', () => setLang('zh'));
    }
}

// 导出
window.i18n = i18n;
window.t = t;
window.getCurrentLang = getCurrentLang;
window.setLang = setLang;
window.updateAllText = updateAllText;
window.initI18n = initI18n;
window.onLangChange = onLangChange;
