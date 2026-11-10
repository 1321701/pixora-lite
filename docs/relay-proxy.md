# 中转站转发配置（可选）

适用场景：你的 Pixora Lite 部署在**服务器**上，而你想让用户连接的中转站**不允许浏览器跨域访问**（连接测试报 CORS 错误）。在部署 Lite 的同一台 nginx 上加一段转发即可，无需改动中转站。

> 本地打开（file:// 或 localhost 自用）不涉及此配置。

## 两种模式

| 模式 | 说明 | 适用 |
|---|---|---|
| **A. 白名单动态转发（推荐）** | 配置 `config.js` 的 `relayProxy` 后，用户可以填**任意中转站地址**；部署者在 nginx 白名单里放行哪些域名，哪些就能连 | 合作方、开放部署 |
| B. 固定上游转发 | 用户只能连部署者指定的那一个中转站（地址填部署者提供的转发路径） | 单一供应商 |

## 模式 A：白名单动态转发

**第 1 步**：`config.js` 里加一行：

```js
relayProxy: '/api-relay',
```

**第 2 步**：nginx 加白名单 map（http 上下文，放在站点文件最顶部）+ 转发 location：

```nginx
# 白名单：用户填的中转站 host 匹配这些正则才放行
# 建议一条规则同时覆盖 api. 和 www.（官网模型页自动识别需要抓 www 站点）
map $http_x_relay_target $relay_ok {
    default 0;
    ~^(api|www)\.你的中转站\.com$ 1;
    ~^(api|www)\.另一家\.com$ 1;
}

server {
    ...
    location /api-relay/ {
        if ($relay_ok = 0) { return 403; }
        resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off;
        rewrite ^/api-relay/(.*)$ /$1 break;
        proxy_pass https://$http_x_relay_target;
        proxy_set_header Host $http_x_relay_target;
        proxy_ssl_server_name on;
        proxy_set_header X-Relay-Target "";
        proxy_buffering off;              # 关键：SSE 流式必须关缓冲
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 30s;
        client_max_body_size 25m;
    }
}
```

用户体验：在「接口设置」里填任意白名单内的中转站地址即可；不在白名单内的会提示 403（错误信息里说明让部署者加白名单）。

## 模式 B：固定上游转发

在 Lite 所在站点的 server 块里加入（**只需修改两处上游地址**）：

```nginx
location /api-relay/ {
    proxy_pass https://api.你的中转站.com/;   # 结尾斜杠必须保留：/api-relay/v1/... → 上游 /v1/...
    proxy_set_header Host api.你的中转站.com;
    proxy_ssl_server_name on;
    proxy_set_header Authorization $http_authorization;   # 透传用户 Key
    proxy_buffering off;                      # 关键：SSE 流式回答必须关缓冲
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_connect_timeout 30s;
    client_max_body_size 25m;                 # 参考图 multipart 上传
}
```

重载 nginx 后，用户在「接口设置」里填：`https://你的域名/api-relay`。

## 原理

页面与转发接口**同源**，浏览器不触发跨域检查；nginx 把请求转发给上游中转站，用户的 API Key 只透传、不落盘。

```
用户浏览器 → 你的服务器 /api-relay/ → 上游中转站
             （同源，无跨域问题）      （服务器间调用，无跨域问题）
```

## 注意事项

1. 模式 A 的白名单是唯一的安全边界，**不要把 map 的 default 改成 1**（那会变成开放代理，被扫描滥用）。
2. `proxy_buffering off` 不能省：省了之后流式回答会"卡住→一次性吐出"。
3. Key 是用户自己的、经你的服务器透传给上游；如开启了访问日志，注意不要记录 Authorization 头。
4. 上游是自建 new-api 时，更推荐直接在中转站的 nginx 加 `Access-Control-Allow-Origin`，省一层转发。
5. Cloudflare 橙云代理下同样可用；若上游启用了防护（如质询页），转发可能失败，属上游策略。
6. 官网模型页自动识别：中转站 `/v1/models` 不列图片/视频模型时，会自动抓其中转站官网的模型页（`www.主域/models` 等候选）补充——白名单需同时覆盖 `www.`（上面的建议写法已覆盖）。个别站点结构特殊抓不到时，可在 `config.js` 配 `modelsPage: 'https://官网/models 页地址'` 指定。

## 自检

```bash
# 模式 A：白名单内应返回模型列表 / 401（Key 无效），白名单外应返回 403
curl -s -o /dev/null -w '%{http_code}\n' "https://你的域名/api-relay/v1/models" -H "X-Relay-Target: api.你的中转站.com"
curl -s -o /dev/null -w '%{http_code}\n' "https://你的域名/api-relay/v1/models" -H "X-Relay-Target: evil.example.com"
```
