# Pixora Lite

**An open-source, fully static, self-hostable workspace for AI image / video generation and an infinite canvas.** Bring your own model service (OpenAI-compatible relays, Volcengine Ark, etc.); API keys never leave the user's browser.

[中文](README.md) · [Deploy guide (zh)](docs/deploy.md) · [Relay proxy (zh)](docs/relay-proxy.md) · [Optional services (zh)](docs/self-hosted-services.md)

> **Don't want to self-host? Try the hosted version: [Pixora AI · pixoraai.cc](https://pixoraai.cc)** — sign up and start creating, no API key needed, with a tuned canvas assistant, a large inspiration library and a Photoshop plugin.

## Highlights

- **No backend** – plain static files. A browser-side "local backend" (`pxl/backend.js`) keeps tasks, history, canvases and media in IndexedDB.
- **Keys stay local** – stored in the user's browser and sent only to the model service they configured (when `relayProxy` is enabled, the operator's nginx passes them through without storing).
- **Auto adaptation** – reads `/v1/models` to detect image / video / chat models and their capabilities; for non-standard APIs an LLM can turn the API docs into a call protocol. Rules are generic, never per-site hacks.
- **Images & videos** – text/image-to-image, multi-reference; video via new-api unified video API, OpenAI `/v1/videos`, Volcengine Ark, MiniMax and more.
- **Infinite canvas** – node workflows, character library, batch generation and an AI assistant driven by function calling.
- **Inspiration wall** – remote API, static shards or built-in samples; community works are shown with author / source / license attribution.
- **Compliance-friendly** – no adult-content features; downloaded images get a visible "AI 生成" label plus AIGC metadata (configurable).

## Quick start

```bash
git clone https://github.com/1321701/pixora-lite.git
cd pixora-lite
python -m http.server 8080
```

Open `http://localhost:8080`, click **接口设置 (API settings)** at the top right and enter your service URL and key. A secure context (localhost or HTTPS) is required for the Service Worker.

## Configuration

Everything lives in [config.js](config.js); every option may be left empty. See the table in the [Chinese README](README.md#配置) and the service contracts in [docs/self-hosted-services.md](docs/self-hosted-services.md).

## Inspiration wall data

```bash
npm i sharp
node tools/showcase-build.js --limit=500 --max-new=500        # from CC BY 4.0 community collections
node tools/showcase-build.js --from-api=https://example.com/api/showcase   # mirror a compatible API
```

## Compliance

Operators who offer this as a public service are the service provider and are responsible for local legal obligations (e.g. in mainland China: generative-AI filing, ICP filing, AI-generated content labeling under GB 45438-2025, content moderation). Video files cannot be re-encoded in the browser, so pick a model service that labels videos at generation time.

## License

Code: [Apache License 2.0](LICENSE). "Pixora" and its logo are trademarks and are not licensed with the code — see [TRADEMARK.md](TRADEMARK.md). Third-party components and showcase samples: see [NOTICE](NOTICE).
