# Pixora Lite

**开源、纯静态、可自部署的 AI 生图 / 生视频 / 无限画布工作台。** 接入你自己的模型服务（OpenAI 兼容中转站、火山方舟等），API Key 只保存在用户自己的浏览器里。

[English](README.en.md) · [部署指南](docs/deploy.md) · [中转站转发](docs/relay-proxy.md) · [可选服务接口](docs/self-hosted-services.md)

> 在线演示：https://130-94-14-244.sslip.io （需填写你自己的模型服务地址与 Key）

## 特点

- **零后端**：整个项目是静态文件，放到 nginx、对象存储、GitHub Pages 都能跑；浏览器里自带一个“本地后端”（`pxl/backend.js`），任务、历史、画布、收藏、素材全部存 IndexedDB。
- **Key 只存浏览器**：Key 保存在用户本地，只发往用户自己填写的模型服务；启用同源转发（`relayProxy`）时由部署者的 nginx 透传，不落盘。
- **自动适配接口**：填好地址后自动读取 `/v1/models`，识别图片 / 视频 / 对话模型及其能力；遇到非标准接口时可让 AI 读接口文档生成调用协议，适配规则对所有中转站通用，不为单个站点写特例。
- **生图 / 生视频**：文生图、图生图、多参考图；视频支持 new-api 统一视频接口、OpenAI `/v1/videos`、火山方舟、MiniMax 等协议，含首尾帧 / 参考图 / 参考视频。
- **无限画布**：节点式工作流、角色库、批量生成、AI 助手（通过模型服务的 function calling 操作画布）。
- **灵感广场**：作品墙，支持远程接口、静态分片或内置示例三种数据源；收录的社区作品均带作者 / 来源 / 许可署名。
- **合规友好**：不含成人内容相关功能；下载生成图片时自动添加“AI 生成”显式标识和 AIGC 隐式元数据（可关闭）。

## 快速开始

```bash
git clone https://github.com/1321701/pixora-lite.git
cd pixora-lite
python -m http.server 8080        # 或任意静态服务器：npx serve / nginx
```

浏览器打开 `http://localhost:8080`，点右上角「接口设置」，填写模型服务地址和 Key 即可使用。

> 需要 `localhost` 或 HTTPS（安全上下文）才能注册 Service Worker 显示本地图片和视频；直接双击 `index.html`（file://）部分功能不可用。

## 配置

所有部署配置都在 [config.js](config.js)，每项都可以留空：

| 配置项 | 说明 |
|---|---|
| `baseUrl` / `lockBaseUrl` | 预置模型服务地址；锁定后用户不能修改 |
| `relayProxy` | 同源转发路径，模型服务不允许跨域时使用，见 [relay-proxy.md](docs/relay-proxy.md) |
| `models` / `modelsPage` | `/v1/models` 识别不到时手动补充的模型 / 模型列表网页 |
| `aiEndpoint` | 自建 AI 适配接口（用户的服务没有对话模型时用于解析接口文档） |
| `mediaHostEndpoint` | 自建图床上传接口（结果跨设备可访问、参考图可供模型服务拉取） |
| `protocolHubUrl` | 远程协议库，覆盖内置的 `protocols.json` |
| `showcaseApi` / `showcaseBase` | 灵感广场数据源：远程接口 / 静态分片目录 |
| `aiLabel` | 下载图片时添加 AI 生成标识，默认开启 |
| `pixoraUrl` | 页脚 Powered by 链接 |

可选服务的接口约定见 [self-hosted-services.md](docs/self-hosted-services.md)。

## 灵感广场数据

仓库自带少量示例（`showcase/`）。用脚本从开源社区合集（CC BY 4.0）构建更多：

```bash
npm i sharp                                   # 图片转码
node tools/showcase-build.js --limit=500 --max-new=500
# 或镜像一个兼容的作品墙接口（不需要 sharp）
node tools/showcase-build.js --from-api=https://example.com/api/showcase --max-new=300
```

产物是 `showcase/index.json + page-N.json + img/`，可以直接静态托管。署名清单自动生成在 `showcase/CREDITS.md`。

## 发布新版本

```bash
node scripts/bump-version.js     # 更新 html 里的 ?v= 缓存版本号
```

## 合规说明（中国大陆部署者必读）

本项目只是工具，**对外提供服务的部署者是服务提供者**，需要自行履行相关义务，包括但不限于：

1. **备案与登记**：面向境内公众提供生成式 AI 服务，需按《生成式人工智能服务管理暂行办法》完成算法备案 / 大模型登记（或使用已备案的模型服务并完成登记），网站需 ICP 备案。
2. **内容标识**：《人工智能生成合成内容标识办法》（2025 年 9 月 1 日施行）及 GB 45438-2025 要求对生成内容添加显式和隐式标识。本项目在下载**图片**时自动添加；**视频**无法在浏览器内重新编码，请选用在生成时自带标识的模型服务，或在服务端补充。
3. **内容安全**：部署者应对输入提示词与生成结果做必要审核，建立投诉举报渠道；灵感广场展示的内容也应自行审核。
4. **个人信息与数据**：本项目默认不收集任何用户数据；若你接入了图床、统计等服务，请自行提供隐私政策。
5. **第三方内容**：灵感广场示例来自 CC BY 4.0 社区合集，转载时须保留署名；生成内容不得侵犯他人肖像权、商标权、著作权。

## 许可证

代码以 [Apache License 2.0](LICENSE) 开源。「Pixora」名称和标识为商标，不随代码授权，见 [TRADEMARK.md](TRADEMARK.md)。第三方组件与示例素材的许可见 [NOTICE](NOTICE)。
