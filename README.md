# carhome

`carhome` 是一个可直接运行的汽车图片图审 MVP，统一输出结构化 JSON，支持三种模式：

- `heuristic`：纯启发式 baseline，无需 key，当前默认模式
- `gemini`：直接调用 Gemini 视觉分析
- `hybrid`：先跑启发式信号，只对边界样本再调用 Gemini
- `gemini / hybrid` 会先用 LLM 做场景分类：`整车外观 / 局部外观 / 局部内饰`

当前仅覆盖 5 类问题：

- 过曝
- 偏暗
- 虚图 / 模糊
- 背景杂乱
- 构图异常

交接说明见 [docs/HANDOFF.md](docs/HANDOFF.md)。
模型配置对比见 [docs/MODEL_CONFIG.md](docs/MODEL_CONFIG.md)。
贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。
版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 技术结构

- 前端：纯静态 HTML + CSS + 原生 JavaScript
- 服务端：零依赖 Node.js HTTP 服务
- 启发式分析器：`public/js/analyzer-core.js`
- Schema / taxonomy：`lib/audit-schema.js`
- Vision provider 校验层：`lib/vision-provider.js`
- Gemini provider：`lib/gemini-vision-provider.js`
- Gemini 编排层：`lib/analyzers.js`
- 环境变量读取：`lib/env.js`，自动读取项目根目录 `.env.local` 和 `.env`

设计目标：

- 没有 key 时仍然能完整跑 `heuristic`
- 有 key 时能切到 `gemini` / `hybrid`
- `gemini` / `hybrid` 在无 key 时自动 fallback 到 `heuristic`
- `gemini` / `hybrid` 在 provider 调用失败时也会自动 fallback 到 `heuristic`
- `hybrid` 对明显 `pass` 或明确 `P0` 命中会短路，不额外调用 Gemini
- 前端、API、脚本三条链路共用同一套 analyzer 编排逻辑

## 环境要求

- Node.js 18+

## 配置 Gemini

项目根目录可放 `.env` 或 `.env.local`。建议从 `.env.example` 开始：

```bash
cd carhome
cp .env.example .env
```

`.env` 示例：

```bash
GEMINI_API_KEY=your_api_key_here
GEMINI_BASE_URL=https://your-gemini-proxy.example.com/v1
GEMINI_MODEL=gemini-2.5-flash
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_TIMEOUT_MS=45000
GEMINI_PROTOCOL=auto
```

环境变量说明：

- `GEMINI_API_KEY`：Gemini key 或代理 key
- `GEMINI_BASE_URL`：Gemini 官方地址或代理根地址
- `GEMINI_MODEL`：模型名
- `GEMINI_PRO_MODEL`：预留给疑难样本升级模型
- `GEMINI_TIMEOUT_MS`：Gemini 请求超时
- `GEMINI_PROTOCOL`：`auto | openai | native`

协议规则：

- `auto`：自动判断
- 当 `GEMINI_BASE_URL` 是 `https://generativelanguage.googleapis.com/v1beta` 这类官方地址时，走原生 Gemini `generateContent`
- 当 `GEMINI_BASE_URL` 是 `https://your-gemini-proxy.example.com/v1` 这类代理根地址时，默认走 OpenAI 兼容 `chat/completions`

## 启动

```bash
cd carhome
npm start
```

默认地址：

```text
http://127.0.0.1:3100
```

健康检查：

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3100/api/config
```

页面使用：

1. 打开 `http://127.0.0.1:3100`
2. 默认是 `heuristic`，也可切到 `gemini` / `hybrid`
3. 上传单张图片
4. 查看结构化 JSON、启发式指标、Gemini 总结和 fallback 信息

## 自测

启发式基线自测：

```bash
cd carhome
npm run self-test
```

这个脚本会生成合成汽车图片并验证 5 类标签命中情况，同时输出一张可复用测试图的元信息。

运行时 fallback 自测：

```bash
cd carhome
npm run self-test:runtime
```

`self-test:runtime` 会验证：

- 缺少 `GEMINI_API_KEY` 时，请求 `gemini` 会自动回退
- Gemini provider 连接失败时，请求 `hybrid` 也会自动回退

Gemini / hybrid live test：

```bash
cd carhome
npm run self-test:live
```

`self-test:live` 会：

- 自动生成 `tmp/overexposed.png`
- 用这张图分别跑 `gemini` 和 `hybrid`
- 输出请求模式、实际模式、provider、协议、scene、decision、回退状态、命中标签、Gemini 总结

如果你使用当前提供的代理配置，也可以直接这样跑：

```bash
cd carhome
GEMINI_API_KEY=... \
GEMINI_BASE_URL=https://your-gemini-proxy.example.com/v1 \
npm run self-test:live
```

如果本机环境里有无效代理变量，例如：

```bash
http_proxy=http://localhost:7897
https_proxy=http://localhost:7897
```

请先清掉再跑：

```bash
cd carhome
HTTPS_PROXY= HTTP_PROXY= ALL_PROXY= https_proxy= http_proxy= all_proxy= \
GEMINI_API_KEY=... \
GEMINI_BASE_URL=https://your-gemini-proxy.example.com/v1 \
npm run self-test:live
```

## API

`POST /api/analyze`

请求体：

```json
{
  "analyzer": "hybrid",
  "image": {
    "name": "car.jpg",
    "mime_type": "image/jpeg",
    "file_size_bytes": 123456,
    "original_width": 3024,
    "original_height": 4032,
    "analyzed_width": 384,
    "analyzed_height": 512,
    "rgba_base64": "...",
    "original_base64": "..."
  }
}
```

响应中的关键字段：

- `analyzer.mode`：最终实际跑的 analyzer
- `scene`：LLM 场景分类结果，含 `label / label_cn / scope / area / confidence / reason`
- `view_angle`：LLM 识别的拍摄角度，含 `label / label_cn / confidence / reason`
- `focus_part`：LLM 识别的主要展示部位，含 `label / label_cn / confidence / reason`
- `decision`：`pass | risk | fail | out_of_scope`
- `review_recommendation`：`auto_pass | manual_review | auto_fail`
- `issues`：命中的结构化标签列表，含 `code / label / confidence / severity / reason / source`
- `out_of_scope_note`：可选的超纲备注，例如拉花、污渍、强光阴影、反光等当前 5 标签外问题；当只命中超纲问题时，`decision` 会返回 `out_of_scope`
- `runtime.requested_mode`：请求模式
- `runtime.effective_mode`：实际模式
- `runtime.fallback_used`：是否发生回退
- `runtime.fallback_reason`：发生 fallback 时给出原因
- `provider`：最终返回结果的 provider 信息
- `baseline`：仅 `hybrid` 返回启发式基线结果
- `metrics`：启发式参与时返回
- `gemini`：Gemini 总结、模型、协议

当前建议：

- API 默认模式用 `heuristic`
- `hybrid` 作为可选增强模式保留，当前仅对边界样本补充语义判断
- 不建议让 `gemini` 单独做主判

## 目录结构

```text
carhome/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── server.js
├── lib/
│   ├── audit-schema.js
│   ├── analyzers.js
│   ├── env.js
│   ├── gemini-vision-provider.js
│   ├── test-image-fixtures.js
│   └── vision-provider.js
├── public/
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── analyzer-core.js
│       └── app.js
├── scripts/
│   ├── live-test.js
│   ├── runtime-self-test.js
│   └── self-test.js
└── tmp/
```

## 已知边界

- 当前是 MVP，不是生产级图审模型。
- `gemini` / `hybrid` 依赖外网和有效 key。
- 请求体为了简单直跑，会把原图 base64 与启发式像素一起发到本地服务。
- 启发式里的“背景杂乱”“构图异常”仍然没有做车辆检测，只适合做 baseline 信号。
