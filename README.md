# aigou-storefront — 一条命令把你的店接入 AI购开放商务网络

<p align="center"><img src="https://cdn.jsdelivr.net/npm/aigou-storefront@latest/assets/banners/minimal-hex-1500x500.png" alt="aigou-storefront banner" width="750"></p>

<p align="center">
  <a href="https://www.npmjs.com/package/aigou-storefront"><img src="https://img.shields.io/npm/v/aigou-storefront?color=7C3AED" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/aigou-storefront"><img src="https://img.shields.io/npm/dt/aigou-storefront?color=6366F1" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-EC4899" alt="license MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-339933" alt="node >= 18">
</p>

把你的商品目录发布为 `aigou/catalog@1` 快照，推送到 AI购目录服务（或自托管），所有接入网络的购物 agent 都能发现你的商品。零佣金、零平台抽成，商家保持 merchant-of-record。

## 快速开始（WooCommerce）

1. 安装 Node.js ≥ 18，然后在你的商店目录：

```bash
npm install -g aigou-storefront   # 或直接 npx aigou-storefront
```

2. 写配置 `aigou-storefront.config.json`：

```json
{
  "store": { "store_id": "acme", "name": "Acme 旗舰店" },
  "source": {
    "type": "woocommerce",
    "base_url": "https://shop.example.com",
    "consumer_key": "ck_你的key",
    "consumer_secret": "cs_你的secret"
  },
  "publish": {
    "mode": "push",
    "catalog_base_url": "http://127.0.0.1:8000",
    "shop_domain": "shop.example.com"
  }
}
```

（WooCommerce key 在 后台 → 设置 → 高级 → REST API 创建，只读权限即可。）

3. 先干跑看一眼，再正式注册并推送：

```bash
aigou-storefront sync --dry-run
aigou-storefront sync --register
```

4. 建议用 cron / 计划任务每天同步一次。改价、上新、下架，下次同步即生效。

## 无 WooCommerce？用 JSON 源

手工（或用你的进销存导出脚本）维护一份快照文件，字段见目录服务的 `GET /catalog/schema`：

```json
{
  "store": { "store_id": "acme", "name": "Acme 旗舰店" },
  "source": { "type": "json", "path": "./products.aigou.json" },
  "publish": { "mode": "file", "path": "./public/aigou-catalog.json" }
}
```

`mode: "file"` 生成可自托管的 `aigou-catalog.json`，上传到你网站的任意公开路径后，在目录服务注册并触发拉取：

```bash
curl -X POST http://127.0.0.1:8000/stores \
  -H "Content-Type: application/json" \
  --data-binary @register.json
# register.json: {"store_id":"acme","name":"Acme 旗舰店",
#   "shop_domain":"shop.example.com","endpoint_type":"catalog_url",
#   "catalog_url":"https://shop.example.com/aigou-catalog.json"}
curl -X POST http://127.0.0.1:8000/stores/acme/refresh
```

注意：目录服务只在收到 `refresh` 调用时拉取（不会自动轮询，可用 cron 定期调用）；且快照内的 `store.store_id` 必须与注册的 `store_id` 一致，否则拉取被拒绝。

## 配置参考

| 字段 | 说明 |
|---|---|
| `store.store_id` | 全网唯一店 ID（注册后绑定你的域名） |
| `store.name` / `store.currency` | 店名（展示用）/ 币种，默认 CNY |
| `source.type` | `woocommerce` 或 `json` |
| `source.base_url` / `consumer_key` / `consumer_secret` | WooCommerce REST v3 凭据 |
| `source.path` | json 源的快照文件路径 |
| `publish.mode` | `push`（推目录服务）或 `file`（写文件自托管） |
| `publish.catalog_base_url` / `shop_domain` | 目录服务地址 / 你的店域名（push 用） |
| `publish.path` | 输出文件路径（file 用） |

## 开放 MCP 店面端点（让 agent 可代下单）

目录快照只让 agent「搜得到」；要让 agent 真正下单，再跑一个 MCP 端点：

1. WooCommerce 的 REST key 需要**读写权限**（后台 → 设置 → 高级 → REST API 新建，权限勾 Read/Write；只读 key 会在下单时报 403）。
2. 配置里加 `mcp` 段：

```json
{
  "store": { "store_id": "acme", "name": "Acme 旗舰店" },
  "source": { "type": "woocommerce", "...": "..." },
  "publish": { "mode": "push", "...": "..." },
  "mcp": {
    "port": 8080,
    "token": "换成你生成的长随机串",
    "public_base_url": "https://shop.example.com"
  }
}
```

3. 启动端点（建议用 systemd / pm2 常驻，反代 `/mcp` 到该端口）：

```bash
aigou-storefront mcp
```

4. 注册端点信息到目录（下次 sync 一并完成）：

```bash
aigou-storefront sync --register
```

之后任何接入 AI购 的 agent 都能通过标准 MCP 工具调用你的店：`search_products`、`get_product`、`create_cart`、`checkout`。订单以 pending 状态落到你的 WooCommerce 后台，收款与发货由你按平时流程处理——你始终是 merchant-of-record。

安全说明：`mcp.token` 会随注册提交给目录服务，用于买方服务调用你的端点；请只通过 https 暴露 `public_base_url`，并定期轮换 token（改配置后重新 `sync --register` 并重启 `mcp`）。

## 安全说明

- consumer key/secret 只用于读取商品（只读权限即可），且只在你自己的机器与你的商店之间传输；**请勿在 http 明文环境使用**。
- 工具不会上传任何订单、客户数据；快照只含公开商品信息。

## 路线图

v0.2（本版）：WooCommerce + JSON 源 → 快照推送/自托管 + 开放 MCP 店面端点（search/get_product/cart/checkout，可代下单）。
下一步：微店适配、ACP checkout、信任层（注册凭证门控/DID）。

## 品牌资产

`assets/` 下提供可复用的品牌物料（GitHub、npm、社交分享卡片均可直接引用）：

- `assets/banners/minimal-hex-1500x500.png` — README banner（本文顶部）
- `assets/banners/minimal-hex-1200x630.png` — og-image / 社交分享卡片
- `assets/logo.svg` / `assets/logo.png` — logo（矢量 / 512px 透明底）
- `assets/banners/src/` — 各物料的 HTML 源文件，可自行改文案后用 Chrome headless 重导出
