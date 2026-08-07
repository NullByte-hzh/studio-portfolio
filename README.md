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
| CMS 字段 | `admin/config.yml` |

---

## 🔧 最近修复（main 分支）

最新提交解决了若干历史问题，便于后续维护参考：

- `admin/config.yml`：适配 Decap 3.x schema（`media_folder`/`public_folder`、页面 `name` 字段）。
- `index.html`：替换失效的 Unsplash 图片链接、修复「我的上传」过滤、`/uploads/` 路径归一化、地图改用高德瓦片并保留 OSM 回退、管理链接改为相对路径、加载 CMS 画廊与首页内容、补全真实联系方式。
- `manifest.json`：相对 `start_url`/`scope` 以兼容子路径部署。
- `service-worker.js`：基于 `registration.scope` 的域相对资源缓存（修复根目录访问 `self.registration` 导致 worker 失效的问题）。

---

## 📄 License

未声明许可证。如需开源使用，请自行添加 LICENSE 文件。

---

<p align="center">Made with 📷 and vanilla JS.</p>
