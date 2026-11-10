# 部署指南

Pixora Lite 是纯静态站点，把仓库文件原样放到任意静态服务器即可。

## 1. 准备文件

```bash
git clone https://github.com/1321701/pixora-lite.git /var/www/pixora-lite
cd /var/www/pixora-lite
# 按需修改 config.js（见 README 配置表）
node scripts/bump-version.js   # 每次更新代码后执行，刷新浏览器缓存
```

不想改动仓库里的 `config.js` 时，可以另存一份部署专用配置，部署时覆盖过去（`config.local.js` 已在 `.gitignore` 中）：

```bash
cp config.local.js /var/www/pixora-lite/config.js
```

## 2. nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name ai.example.com;
    ssl_certificate     /etc/ssl/ai.example.com.pem;
    ssl_certificate_key /etc/ssl/ai.example.com.key;

    root /var/www/pixora-lite;
    index index.html;

    # html 与 config.js 不缓存，其余静态资源带 ?v= 版本号，可长缓存
    location ~* (\.html|/config\.js)$ { add_header Cache-Control "no-cache"; }
    location ~* \.(js|css|woff2|png|jpg|webp|ico|json)$ { expires 30d; }
    # Service Worker 必须每次校验
    location = /pxl-sw.js { add_header Cache-Control "no-cache"; }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # 可选：模型服务不允许跨域时的同源转发，完整说明见 relay-proxy.md
    # location /api-relay/ { ... }
}
```

部署在子路径（如 `https://example.com/lite/`）同样可用，页面会按自身所在目录解析资源与 Service Worker。

## 3. 必须使用 HTTPS

Service Worker、剪贴板、`crypto.randomUUID` 等能力需要安全上下文。除 `localhost` 外请务必启用 HTTPS。

## 4. 其他托管方式

- **GitHub Pages / Cloudflare Pages / Vercel**：直接发布仓库根目录；如需同源转发，改用平台的反向代理能力或保持 `relayProxy: ''`。
- **对象存储 + CDN**：上传全部文件，`index.html`、`config.js`、`pxl-sw.js` 设置为不缓存。

## 5. 上线前检查

- [ ] `config.js` 已按需配置；未使用的服务地址留空
- [ ] 已执行 `node scripts/bump-version.js`
- [ ] 页面名称与 logo 已换成你自己的品牌（见 TRADEMARK.md）
- [ ] 中国大陆对外服务：ICP 备案、生成式 AI 备案/登记、内容审核与投诉渠道（见 README 合规说明）
