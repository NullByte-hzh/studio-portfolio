# STUDIO · 摄影作品集 PWA

一个**零构建（no-build）**、纯静态的摄影师作品集渐进式 Web 应用（PWA）。所有前端逻辑都集中在单个 `index.html` 中，配合 Service Worker 实现离线访问，并通过 [Decap CMS](https://decapcms.org/)（基于 GitHub 仓库作为后台）进行内容管理。

> 中文 | 专注于人像、风光与街头摄影，用镜头捕捉生活的温度。

---

## ✨ 功能特性

- **首页 Hero** — 全屏轮播背景、向下滚动提示、滚动渐显（reveal）动效。
- **作品画廊（Gallery）**
  - 瀑布流（masonry）布局，按 `portrait / landscape / street / nature` 分类筛选。
  - 灯箱（Lightbox）支持：左右切换、缩略图导航、缩放、全屏、幻灯片播放。
  - **EXIF 读取**：自动解析原图的相机型号、焦距、光圈、快门、ISO、GPS 坐标（基于 `exif-js`，仅对原图生效）。
  - **本地上传**：访客可即时上传照片到浏览器本地（`localStorage`），支持「仅看我的上传」过滤与删除，刷新后保留（最多 20 张）。
- **摄影地图（Map）** — 基于 [Leaflet](https://leafletjs.com/) 懒加载；底图**优先使用高德地图瓦片，加载失败自动回退 OpenStreetMap**；依据作品经纬度打点，点击弹窗可跳转至对应作品。
- **预约页（Booking）** — 三档套餐卡片 + 预约表单（提交至 Formspree）+ 联系方式 / 微信 / 邮箱。
- **留言讨论** — 集成 [Giscus](https://giscus.app/) 评论（支持暗色模式自适应）。
- **AI 智能客服「小影」** — 右下角浮动按钮唤出聊天面板，流式打字机输出，复用站点配色与暗色模式；接智谱 GLM-4.7-Flash（免费档），**双后端自适应**：内网部署走自托管本地代理（`/chat-api/` 同源反代），公网 Pages 走 Cloudflare Worker。API Key 绝不出现在前端。内置话题守卫 + 三层限流 + 高峰降级链。
- **深色模式** — 一键切换，默认跟随系统并记忆偏好。
- **PWA / 离线** — `manifest.json` 可安装到桌面/主屏；`service-worker.js` 对图片采用「缓存优先」、其余请求「网络优先 + 离线外壳回退」。
- **内容管理（Decap CMS）** — 访问 `/admin/` 即可在浏览器中可视化编辑作品与首页文案，内容以 Markdown 落库到仓库。

---

## 🧱 技术栈

| 类别 | 方案 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript（**无打包、无框架**） |
| 地图 | Leaflet 1.9.4（CDN 懒加载） + 高德 / OpenStreetMap 瓦片 |
| EXIF | exif-js 2.3.0（CDN） |
| PWA | Web App Manifest + Service Worker（Cache API） |
| 内容后台 | Decap CMS 3.x（GitHub 仓库作为后端） |
| 评论 | Giscus（GitHub Discussions 驱动） |
| 表单 | Formspree（无需自建后端） |
| AI 客服 | 智谱 GLM-4.7-Flash（免费）· SSE 流式 · CF Worker 或自托管 Python 代理（`deploy/chat/`） |
| 部署 | GitHub Pages（子路径适配）· 自托管 Docker（`Dockerfile` + `docker-compose.yml`） |

---

## 📁 目录结构

```
.
├── index.html          # 全部前端（结构 + 样式 + 脚本）唯一入口
├── manifest.json       # PWA 清单（图标、名称、显示模式等）
├── service-worker.js   # Service Worker：离线缓存与路由策略
├── icon-192.svg        # PWA 图标
├── Dockerfile          # 自托管镜像（nginx:alpine + 站点文件）
├── docker-compose.yml  # 端口 8082:80，restart=unless-stopped
├── nginx.conf          # 容器内站点配置（gzip + 30 天静态缓存）
├── admin/
│   ├── index.html      # Decap CMS 入口（加载 decap-cms.js）
│   └── config.yml      # CMS 集合与字段定义（GitHub 后台）
└── deploy/
    ├── host-nginx.conf # 宿主机反代参考（HTTPS/HTTP2/安全头/chat-api 路由）
    ├── chat/           # 自托管 AI 客服代理（Python 单文件 + systemd + 17 项测试）
    └── worker/         # Cloudflare Worker 版客服（公网部署用）
```

> 作品内容有两种来源：
> 1. **内置数据** — `index.html` 中的 `galleryData` 数组。
> 2. **CMS 数据** — 站点加载时自动读取仓库 `_gallery/*.md`，追加到内置画廊；同时读取 `index.md` 用于覆盖首页标题与描述。

---

## 🚀 本地预览

由于是纯静态站点，任意静态服务器即可：

```bash
# 任选其一
python3 -m http.server 8080
npx serve .
```

然后访问 `http://localhost:8080`。

> ⚠️ Service Worker 与 Decap CMS 的 OAuth 回调依赖 **HTTPS 或 `localhost`**。直接用 `file://` 打开时部分功能（离线缓存、CMS 登录）不可用。

---

## 🌐 部署到 GitHub Pages

1. 在仓库 **Settings → Pages** 中选择 `main` 分支根目录。
2. 访问 `https://<用户名>.github.io/<仓库名>/` 即可。

本项目已对**子路径部署**做适配：

- `manifest.json` 使用相对 `start_url` / `scope` (`./`)。
- `service-worker.js` 基于 `registration.scope` 计算资源绝对地址（兼容根目录与子路径）。
- CMS 管理链接、地图瓦片、画廊图片均使用相对/容错路径。

---

## 🛠 内容管理（Decap CMS）

1. 进入 `/admin/`，使用 GitHub 账号授权登录。
2. 在 `admin/config.yml` 中，`backend.repo` 已配置为 `NullByte-hzh/studio-portfolio`。

   > 若你要复用到自己的仓库，需要：
   > - 注册一个 **GitHub OAuth App**（回调地址填 `https://<你的Pages地址>/admin/`）；
   > - 将 `admin/config.yml` 中的 `repo` 改为你的 `owner/repo`，并把 `auth_endpoint` 指向 GitHub 授权地址。

3. 两个集合（collection）：
   - **作品（gallery）**：写入 `_gallery/<标题>.md`，字段含 标题 / 分类 / 描述 / 纬度 / 经度 / 图片。带经纬度的作品会自动出现在地图页。
   - **页面（pages → 首页）**：写入 `index.md`，可覆盖网站标题与描述。

上传的图片保存在仓库的 `uploads/` 目录（`media_folder: 'uploads'`）。

---

## ⚙️ 自定义配置

多数个性化信息集中在 `index.html` 与配置文件中，搜索对应关键字即可修改：

| 想改的内容 | 位置 |
| --- | --- |
| 内置作品 | `index.html` → `const galleryData = [...]` |
| 联系方式 / 邮箱 | `index.html` → `mailto:haozhihao9502@163.com`（页脚、关于、预约页） |
| 预约表单接收 | `index.html` → `action="https://formspree.io/f/xqerwwpw"`（替换为你的 Formspree 表单 ID） |
| 评论区 | `index.html` → `<script src="https://giscus.app/client.js" ...>`（需替换 `data-repo` / `data-repo-id` / `data-category-id` 为你自己的 Giscus 配置） |
| PWA 名称 / 图标 | `manifest.json` + `icon-192.svg` |
| 地图底图 | `index.html` → `tileProviders`（高德 / OSM 可增删、调整顺序） |
| 客服接口地址 | `index.html` → `const CHAT_API`（已按 hostname 自适应：内网走 `/chat-api/`，公网走 Worker；纯 Pages 用户可改回固定 Worker 地址） |
| 客服欢迎语 / 快捷问题 | `index.html` → `GREETING` 与 `.chat-chip` 按钮 |
| 客服业务知识 / 话术 | Worker 端 `SYSTEM_PROMPT`（不在本仓库，见下方说明） |
| CMS 字段 | `admin/config.yml` |

---

## 🤖 AI 智能客服「小影」

右下角浮动按钮唤出，回答套餐价格、拍摄流程、改期规则等问题；话题守卫硬拦与摄影无关的请求（写代码/翻译/百科/越狱注入）。

### 架构：双后端自适应

```
内网自托管（大陆可达）:
  访客 → nginx /chat-api/ → chat-proxy.py(:8790, 仅本机) → 智谱 GLM API

公网 GitHub Pages:
  访客 → Cloudflare Worker（持有 Key）→ 智谱 GLM API
```

`index.html` 按 `location.hostname` 自动选择以上后端（见 `const CHAT_API`）。**API Key 只存在于服务端**（Worker secret 或 `/etc/studio-chat/llm.key`），绝不出现在前端 —— 静态站把 Key 写进 HTML 等于公开，这是不可妥协的底线。

> ⚠️ 为什么不用单一 Worker：`*.workers.dev` 在中国大陆无法直连，内网/国内访客会全部失败并表现为「客服没答上来」。2026-09 事故复盘：fetch 跟随 nginx 的 301 时会丢失 POST body，前端请求务必带尾斜杠（`/chat-api/`），nginx 侧 `location = /chat-api` 精确匹配兜底。

前端只有三段代码在 `index.html`，搜注释即可定位：

| 部分 | 注释标记 |
| --- | --- |
| 样式 | `/* ===== AI 客服「小影」 ===== */` |
| 结构 | `<!-- ===== AI 客服「小影」 ===== -->` |
| 逻辑 | 同名注释的 IIFE |

### 服务端能力（`deploy/chat/chat-proxy.py`，零依赖 Python 标准库）

| 能力 | 说明 |
| --- | --- |
| System Prompt 注入 | 业务铁律（档期转人工/禁承诺/禁折扣）+ 已知信息表，前端伪造 `system` 角色会被过滤 |
| 话题守卫 | 正则硬拦越界请求，命中直接 SSE 返回拒绝话术、不调模型（省 token；业务白名单优先放行防误杀） |
| 三层限流 | 单 IP 6/分钟 · 60/天 · 全站 3000/天 |
| 高峰降级链 | 免费档流式通道撞智谱 1305 限流时：流式→非流式包 SSE→备用模型，响应头 `X-Chat-Model` 标实际模型 |
| SSE 流式透传 | `X-Accel-Buffering: no` 防 nginx 缓冲，保打字机效果 |
| CORS 白名单 | 见文件内 `ALLOWED_ORIGINS`，改站点地址记得同步 |

Worker 版（`deploy/worker/`）功能等价，部署：`npx wrangler secret put GLM_API_KEY` + `npx wrangler deploy`。

### 自托管部署（Linux + systemd + nginx）

```bash
sudo mkdir -p /opt/studio-chat /etc/studio-chat
sudo install -m 644 deploy/chat/chat-proxy.py /opt/studio-chat/
echo '你的智谱KEY' | sudo tee /etc/studio-chat/llm.key && sudo chmod 600 /etc/studio-chat/llm.key
sudo cp deploy/chat/studio-chat.service /etc/systemd/system/
sudo systemctl enable --now studio-chat
# nginx 反代段参考 deploy/host-nginx.conf 的 location /chat-api 两块
```

### 测试

```bash
cd deploy/chat && node test-local.mjs   # 17 项端到端：CORS/守卫/限流/降级/SSE，零依赖（Node 18+）
```

### 层级与排障约定

聊天组件 `z-index: 1900`，刻意低于灯箱（2000）与缩放容器（3000），灯箱打开时自动淡出。前端错误处理按状态码区分文案（403 未授权 / 429 太快 / 502 模型异常），外层 `catch` 用 `navigator.onLine` 区分真断网与跨域被拒 —— CORS 白名单缺失的 403 常被误读成「网络中断」。

---

## ⚡ 性能与安全基线（2026-09 优化）

| 项 | 做法 |
| --- | --- |
| 图片 | Unsplash 全量 `fm=webp`；Hero 首图 `fetchpriority=high` + preload，其余 `loading=lazy decoding=async`；srcset 三档响应式 |
| 连接 | `preconnect` + `dns-prefetch` 到 images.unsplash.com |
| 协议 | 宿主机 nginx 开 **HTTP/2**；全站 301→HTTPS（自签证书，公网换可信证书） |
| 安全头 | HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy（见 `deploy/host-nginx.conf`） |
| 缓存 | 容器内静态资源 30d；gzip 含 `image/svg+xml` |
| SEO/分享 | canonical + `og:image`/`twitter:image` + JSON-LD（Person，含小红书 sameAs） |
| PWA | `manifest.json` 已去除 UTF-8 BOM（带 BOM 会导致部分浏览器解析失败、安装提示不出现） |

---

## 🐳 自托管部署（Docker）

```bash
docker compose up -d --build     # 站点起在 :8082
```

HTTPS / 客服 API / 安全头等宿主机反代配置见 `deploy/host-nginx.conf`（含 80→443 跳转、/oauth/ Decap 代理、/chat-api/ 客服路由三段）。

---

## 🔧 最近修复（main 分支）

最新提交解决了若干历史问题，便于后续维护参考：

- `admin/config.yml`：适配 Decap 3.x schema（`media_folder`/`public_folder`、页面 `name` 字段）。
- `index.html`：替换失效的 Unsplash 图片链接、修复「我的上传」过滤、`/uploads/` 路径归一化、地图改用高德瓦片并保留 OSM 回退、管理链接改为相对路径、加载 CMS 画廊与首页内容、补全真实联系方式。
- `manifest.json`：相对 `start_url`/`scope` 以兼容子路径部署。
- `service-worker.js`：基于 `registration.scope` 的域相对资源缓存（修复根目录访问 `self.registration` 导致 worker 失效的问题）。
- `index.html`（安全）：画廊与灯箱动态拼接的 HTML 属性值（`src`、`data-id`）全部转义，杜绝 CMS 数据注入 XSS。
- `index.html`（地图）：内置与 CMS 作品分配稳定 id（`g*` / `cms*`），地图弹窗改为按 id 查找，修复 CMS 数据异步加载后灯箱索引错位的问题。
- `index.html`（UI）：滚动后导航栏改为毛玻璃透明态（半透明底 + `backdrop-filter` 模糊/提饱和，暗色模式同步适配）。
- `index.html`（UI）：Hero 按钮悬停样式优化——次按钮悬停为半透明白，主按钮悬停反转为透明 + 白边，保持主次区分。
- `index.html`（新功能）：接入 AI 智能客服「小影」——浮动按钮 + 流式聊天面板，复用站点 CSS 变量自动跟随暗色模式；`z-index: 1900` 垫在灯箱之下并在灯箱打开时淡出，修复了客服按钮遮挡幻灯片控件的问题；免责声明文字对比度提升至 5.73:1 满足 WCAG AA。
- `index.html` + `deploy/`（2026-09 性能与客服迁移）：Unsplash 全量 webp、懒加载、preconnect、HTTP/2、四件套安全头、SEO 元信息、manifest 去 BOM；客服后端从「仅 Cloudflare Worker」升级为「内网自托管代理 + 公网 Worker」双模式自适应（workers.dev 大陆不可达是迁移动因），新增 429→非流式→备用模型降级链；修复 `/chat-api` 缺尾斜杠被 301 剥掉 POST body 导致客服全员"没答上来"的事故；站点 Docker 化入库（Dockerfile/compose/nginx.conf/deploy 参考配置）。
- `index.html`（客服排障）：请求失败提示按状态码区分（403 未授权 / 429 频率超限 / 502 模型异常），外层 `catch` 用 `navigator.onLine` 区分真断网与跨域被拒 —— 此前一律显示"连接中断"，会把 CORS 白名单问题误导成网络故障。

---

## 📄 License

未声明许可证。如需开源使用，请自行添加 LICENSE 文件。

---

<p align="center">Made with 📷 and vanilla JS.</p>
