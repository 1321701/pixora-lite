# 参与贡献

欢迎 Issue 和 Pull Request。

## 开发

项目没有构建步骤，改完直接刷新浏览器：

```bash
python -m http.server 8080   # 打开 http://localhost:8080
```

提交前请：

1. `node --check <改动的 js 文件>` 确认语法；
2. 在浏览器里走一遍生图页、画布页、接口设置、灵感广场，确认控制台没有报错；
3. 执行 `node scripts/bump-version.js` 更新缓存版本号（发布时）。

## 原则

- **通用优先**：接口适配写成对所有中转站都生效的规则（按协议、模型族、能力探测），不要为某一个站点写特例；确实只适用于某个服务的协议，放进 `protocols.json` 或协议库。
- **不引入后端依赖**：新功能应能在纯静态部署下工作；需要服务端的能力做成 `config.js` 里的可选项，并在 `docs/self-hosted-services.md` 写明接口约定。
- **Key 不外泄**：用户的 Key 只能发往用户自己配置的地址。
- **内容合规**：不接受成人内容、绕过安全审核或去除 AI 生成标识的功能。

## 提交规范

提交信息用一句话说明“为什么改”，例如 `Fix video polling for relays that return 202`。代码以 Apache 2.0 授权，提交即表示你同意以该许可证贡献。
