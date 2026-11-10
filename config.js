/**
 * Pixora Lite 部署配置
 * 部署者按需修改；所有项都可留空，留空即使用浏览器本地能力，不依赖任何外部服务。
 */
window.LITE_CONFIG = {
    // 预置模型服务地址（OpenAI / 火山方舟等兼容接口）。留空则由用户在「接口设置」里自行填写
    baseUrl: '',
    // 锁定 baseUrl：为 true 时用户不能修改地址（适合只对接一家服务的部署）
    lockBaseUrl: false,
    // 同源转发路径：模型服务不允许浏览器跨域时，经部署者的 nginx 转发（见 docs/relay-proxy.md）。不用转发请留空
    relayProxy: '/api-relay',
    // 预置模型（/v1/models 识别不到时手动补充），如 { video: ['doubao-seedance-2-0-260128'] }
    models: { image: [], video: [], chat: [] },
    // 模型服务的「模型列表」网页：/v1/models 只列对话模型时，从该页面补充识别图片/视频模型
    modelsPage: '',
    // 内置 AI 适配接口：用户的模型服务没有对话模型时，用它解析接口文档（需部署者自建，见 docs/self-hosted-services.md）
    aiEndpoint: '',
    // 图床上传接口：生成结果与参考图转存到部署者的对象存储（跨设备可访问、可供模型服务拉取）。留空则只存本浏览器
    mediaHostEndpoint: '',
    // 协议库地址（可选）：远程 protocols.json，用于覆盖内置的接口协议库
    protocolHubUrl: '',
    // 灵感广场数据源：
    //   showcaseApi  —— 远程接口（返回 { code:0, data:{ items, total, models } }），优先使用
    //   showcaseBase —— 静态分片目录（tools/showcase-build.js 生成），默认 'showcase/'
    //   两者都取不到时使用内置示例
    showcaseApi: '',
    showcaseBase: 'showcase/',
    // 生成内容标识（《人工智能生成合成内容标识办法》）：下载图片时加「AI 生成」角标并写入隐式元数据
    aiLabel: true,
    // 页脚「Powered by Pixora」链接地址
    pixoraUrl: 'https://pixoraai.cc'
};
