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
- **AI 智能客服「小影」** — 右下角浮动按钮唤出聊天面板，流式打字机输出，复用站点配色与暗色模式；接智谱 GLM-4-Flash，经 Cloudflare Worker 代理，**API Key 不出现在前端**。内置话题守卫，只答摄影业务。
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
| AI 客服 | 智谱 GLM-4-Flash + Cloudflare Workers 代理（SSE 流式） |
| 部署 | GitHub Pages（支持子路径部署） |

---

## 📁 目录结构

```
.
├── index.html          # 全部前端（结构 + 样式 + 脚本）唯一入口
├── manifest.json       # PWA 清单（图标、名称、显示模式等）
├── service-worker.js   # Service Worker：离线缓存与路由策略
├── icon-192.svg        # PWA 图标
└── admin/
    ├── index.html      # Decap CMS 入口（加载 decap-cms.js）
    └── config.yml      # CMS 集合与字段定义（GitHub 后台）
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
| 客服接口地址 | `index.html` → `const CHAT_API = '...'`（换成你自己的 Worker 地址） |
| 客服欢迎语 / 快捷问题 | `index.html` → `GREETING` 与 `.chat-chip` 按钮 |
| 客服业务知识 / 话术 | Worker 端 `SYSTEM_PROMPT`（不在本仓库，见下方说明） |
| CMS 字段 | `admin/config.yml` |

---

## 🤖 AI 智能客服「小影」

右下角浮动按钮唤出，回答套餐价格、拍摄流程、改期规则等问题。

### 架构

```
访客浏览器 → Cloudflare Worker（持有 API Key）→ 智谱 GLM-4-Flash
```

**API Key 只存在于 Worker 的加密环境变量里，绝不出现在前端代码。** 静态站没有后端，若把 Key 写进 `index.html`，按 F12 就能扒走并刷爆你的额度 —— 所以必须有这层代理。

前端只有三段代码在 `index.html`，搜注释即可定位：

| 部分 | 注释标记 |
| --- | --- |
| 样式 | `/* ===== AI 客服「小影」 ===== */` |
| 结构 | `<!-- ===== AI 客服「小影」 ===== -->` |
| 逻辑 | 同名注释的 IIFE |

### Worker 端不在本仓库

服务端代码（含业务话术、限流、话题守卫）独立维护，本仓库只有前端。**Fork 后客服无法直接使用**，需要自建：

1. 建一个 Cloudflare Worker，代理你选的模型 API（免费的可用智谱 GLM-4-Flash、通义 qwen-turbo）
2. Key 用 `wrangler secret put` 存进环境变量，**不要写进代码**
3. Worker 里配 CORS 白名单，只放行你自己的域名
4. 把 `index.html` 的 `CHAT_API` 改成你的 Worker 地址

### 两个值得注意的实现细节

**代码层话题守卫。** 小模型压不住 System Prompt 的"只答业务"约束 —— 实测 GLM-4-Flash 会照样写完整代码、做翻译、讲量子力学，把你的客服当免费 ChatGPT 用。可靠做法是在 Worker 里用正则硬拦越界请求，命中直接返回拒绝话术、不调模型（顺带省 token）。同时要配业务白名单优先放行，否则会误杀正常提问 —— **误杀客户比漏拦更糟**。

**403 会伪装成"网络中断"。** 当访问地址不在 Worker 的 CORS 白名单里时（换域名、内网部署、用 IP 访问），浏览器不允许前端读跨域失败的响应体，代码走的是外层 `catch` 而非 `!res.ok` 分支，用户看到的是"连接不上"，排查方向容易被带偏。前端错误处理两头都要管：按状态码给不同文案（403 授权 / 429 太快 / 502 模型异常），外层 `catch` 再用 `navigator.onLine` 区分真断网和跨域被拒。

### 层级约定

聊天组件 `z-index: 1900`，**刻意低于**灯箱（2000）和图片缩放容器（3000），并在灯箱打开时自动淡出（`body.lb-open`）。改动这块时留意别让按钮浮到幻灯片控件上面。

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
- `index.html`（客服排障）：请求失败提示按状态码区分（403 未授权 / 429 频率超限 / 502 模型异常），外层 `catch` 用 `navigator.onLine` 区分真断网与跨域被拒 —— 此前一律显示"连接中断"，会把 CORS 白名单问题误导成网络故障。

---

## 📄 License

未声明许可证。如需开源使用，请自行添加 LICENSE 文件。

---

<p align="center">Made with 📷 and vanilla JS.</p>
