# 可选服务接口约定

Pixora Lite 不依赖任何后端。以下三个服务都是**可选**的，部署者按需自建，在 `config.js` 填入地址即可启用；接口需允许页面所在域名跨域访问（或与页面同源）。

## 1. AI 适配接口 `aiEndpoint`

用途：用户的模型服务没有对话模型时，用它来阅读接口文档、生成调用协议（「接口设置 → AI 适配」）。

```
POST {aiEndpoint}
Content-Type: application/json

{ "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." } ] }
```

响应（任一形式）：

```json
{ "code": 0, "data": { "content": "模型回复的文本" } }
{ "content": "模型回复的文本" }
```

实现建议：服务端用你自己的 Key 调任意对话模型，把 `messages` 原样转发，返回回复文本；务必做限流，避免被滥用。

## 2. 图床上传接口 `mediaHostEndpoint`

用途：把生成结果和参考图转存到你的对象存储——结果跨设备可访问，参考图能以公网 https 地址交给模型服务拉取（否则只能用 data URL）。

```
POST {mediaHostEndpoint}
Content-Type: multipart/form-data

file=<二进制文件>
```

响应：

```json
{ "code": 0, "data": { "url": "https://cdn.example.com/a.png", "direct": "https://bucket.example.com/a.png?signature=..." } }
```

- `url`：页面展示用地址（必填）。
- `direct`：可选，模型服务能直接下载的地址（例如对象存储的签名直链）。不提供时使用 `url`。
- 可选的签名接口：若 `url` 形如 `.../api/img?b=<bucket>&k=<key>`（经你的服务 302 到对象存储），页面会请求 `{mediaHostEndpoint 去掉结尾 /upload 后加 /sign}?b=&k=`，期望返回 `{ "data": { "direct": "..." } }`，用于给不跟随 302 的模型服务换直链。

注意：上传接口应限制文件类型与大小，并按法规对存储内容进行管理。

## 3. 灵感广场接口 `showcaseApi`

用途：作品较多、需要服务端搜索时使用；否则直接用 `tools/showcase-build.js` 生成静态分片即可。

```
GET {showcaseApi}?limit=36&offset=0&sort=random&seed=abc123&model=<模型名>&q=<关键词>
```

响应：

```json
{
  "code": 0,
  "data": {
    "total": 1234,
    "models": [ { "name": "Nano Banana Pro", "count": 800 } ],
    "items": [
      {
        "id": "sc_xxx", "title": "标题", "prompt": "提示词",
        "model": "Nano Banana Pro", "modelRaw": "原始模型名",
        "author": "作者", "authorUrl": "https://...",
        "license": "CC BY 4.0", "licenseUrl": "https://...",
        "source": "来源名称", "sourceRepo": "https://...", "sourceUrl": "https://原帖",
        "img": "/assets/showcase/sc_xxx.webp", "thumb": "/assets/showcase/sc_xxx_t.webp",
        "width": 1024, "height": 1536
      }
    ]
  }
}
```

- `img` / `thumb` 可以是相对地址，页面按 `showcaseApi` 的地址解析。
- `sort=random` 时同一 `seed` 下翻页结果应稳定、不重复。
- 标记 `"sfw": false` 的条目不会显示。
- 接口不可用时页面自动降级到静态分片（`showcaseBase`），再降级到内置示例。

静态分片格式（`showcaseBase` 目录）：`index.json` 为 `{ total, pageSize, pages, files, models }`，每个 `page-N.json` 为 `{ items: [...] }`，条目字段同上，图片地址相对该目录。
