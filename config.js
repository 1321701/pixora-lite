window.LITE_CONFIG = {
    baseUrl: '',
    relayProxy: '/api-relay',
    lockBaseUrl: false,
    models: { image: [], video: [], chat: [] },
    // /v1/models 只列对话模型的中转站：识别不到图片/视频模型时从官网模型页抓取补充
    modelsPage: '',
    // 内置 AI：中转站没有对话模型时，AI 自动适配用主站提供的模型解析文档（不暴露 Key）
    aiEndpoint: 'https://pixora.aitoo-cn.com/api/lite/adapt',
    // 图床：生成结果优先转存到火山 TOS（主站提供，免登录）；留空则只存本浏览器
    mediaHostEndpoint: 'https://pixora.aitoo-cn.com/api/lite/upload',
    inviteCode: '',
    partnerId: '',
    analytics: true,
    showNsfw: false,
    pixoraUrl: 'https://pixoraai.cc'
};

// 构建版本：community=开源社区版（无引流）/ partner=合作分发版（带引流）
window.PXL_EDITION = 'community';
