# 安全策略

如发现安全问题（例如 Key 泄露到非用户配置的地址、XSS、转发配置可被滥用为开放代理等），请**不要**公开提交 Issue，改为通过 https://pixoraai.cc 联系我们，或使用 GitHub 的 Private vulnerability reporting。

请尽量附上：影响范围、复现步骤、浏览器与版本。我们会在确认后尽快修复并致谢。

部署者自查要点：

- `relayProxy` 的 nginx 白名单 `map` 默认值必须为 0，不要做成开放代理；
- 访问日志不要记录 `Authorization` 头；
- 全站启用 HTTPS。
