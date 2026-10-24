# 上传到 GitHub（自己操作版）

要上传的东西都在 `crystal-grinder/` 下：

| 文件 | 用途 |
|---|---|
| `publish/` | **仓库源码**：209 个文件，7.1 MB，整个文件夹拖进仓库即可 |
| `dist/crystal-grinder-0.2.0.zip` | 插件包 → 作为 Release 附件 |
| `dist/streamline-crystal-0.2.17-crystal.1.zip` | 皮肤包 → 作为 Release 附件 |
| `dist/crystal-grinder-repo-source.zip` | 上面 `publish/` 的压缩版，备用 |

> 许可证已按上游处理：皮肤基于 `allofmeng/streamline_project`（GPL-3.0-or-later），
> 所以仓库根目录放了 GPL-3.0 全文，`skin/streamline-crystal/LICENSE` 保留了上游版权声明。
> 仓库必须是**公开**的，GPL 也要求随二进制提供源码。

---

## 步骤 1：建仓库

GitHub → 右上 **+** → **New repository**

- Repository name：`crystal-grinder`
- 选 **Public**
- **不要**勾 Add a README / .gitignore / license（避免和我们要传的冲突）
- Create repository

---

## 步骤 2：把 `publish/` 传上去

### 方案 A：GitHub Desktop（推荐，最省事）

1. 装 [GitHub Desktop](https://desktop.github.com/)，登录你的账号
2. File → **Clone repository** → 选刚建的 `crystal-grinder` → 选本地目录 → Clone
3. 打开那个本地目录，把 `publish/` 里的**所有内容**（不是 publish 文件夹本身）拷进去
4. 回 GitHub Desktop：Summary 填 `v0.2.0: CRYSTAL grinder plugin + skin`，点 **Commit to main**
5. 点 **Push origin**

> `.github` 是隐藏文件夹，拷贝时确认它也在（资源管理器需开启"显示隐藏项目"）。
> 它只是 CI 配置，没传上也不影响安装，只是以后打 tag 不会自动发 Release。

### 方案 B：网页拖拽（不装软件）

1. 打开仓库页 → **Add file** → **Upload files**
2. 把 `publish/` 里的内容分批拖进去。**单次最多 100 个文件**，`skin/src/` 有 170 多个，建议分三批：
   - 第一批：`README.md`、`LICENSE`、`.gitignore`、`build.ps1`、`crystal-grinder.reaplugin/`、`docs/`、`test/`
   - 第二批：`skin/streamline-crystal/index.html`、`skin-manifest.json`、`LICENSE`、`src/css/`、`src/modules/`
   - 第三批：`skin/streamline-crystal/src/` 下其余目录（`ui/`、`vendor/` 等）
3. 每次填 commit message（例如 `add plugin` / `add skin part 1`），点 **Commit changes**
4. 网页拖拽传不了隐藏的 `.github`，可以跳过

### 方案 C：懒人版（不建源码仓库）

只发 Release，用户下 zip 装。跳过步骤 2，直接做步骤 3。
缺点：用户不能"从 GitHub 安装"，也收不到更新提示。

---

## 步骤 3：发两个 Release

**插件（先发这个）**

1. 仓库页右侧 **Releases** → **Create a new release**
2. **Choose a tag** → 输入 `v0.2.0` → **Create new tag on publish**
   > tag 必须等于 `manifest.json` 里的 `version`（`0.2.0`，去掉前导 v），否则安装器拒绝
3. Title：`CRYSTAL Grinder plugin 0.2.0`
4. 附件：拖入 `dist/crystal-grinder-0.2.0.zip` —— **只放这一个 zip**
5. 说明复制这段：

```
Decaid plugin for CRYSTAL grinders (BLE: service 7fa2d10c-12f3-4b9e-9d77-1a9b65432100).

Requires Decaid 0.9.1-beta.1 or newer.

Install: Dashboard → Plugins → ⋮ → Install plugin → ZIP file.
```
6. **Publish release**

**皮肤**

1. 再 **Create a new release**
2. Tag：`skin-v0.2.17-crystal.1`（皮肤不受 tag 规则约束，这样命名是为了不和插件版本混）
3. 附件：`dist/streamline-crystal-0.2.17-crystal.1.zip`，同样**只放一个 zip**
4. 说明：

```
CRYSTAL grinder panel on top of the official streamline.js skin.
Based on allofmeng/streamline_project (GPL-3.0-or-later).

Install: Settings → Skins → install → pick this ZIP, or paste the asset URL.
```
5. **Publish release**

---

## 步骤 4：把地址发给用户

发布完成后，地址是这种格式（把 `<你的用户名>` 换掉）：

- 仓库：`https://github.com/<你的用户名>/crystal-grinder`
- 插件 Release：`https://github.com/<你的用户名>/crystal-grinder/releases/tag/v0.2.0`
- 皮肤 Release：`https://github.com/<你的用户名>/crystal-grinder/releases/tag/skin-v0.2.17-crystal.1`

用户两种装法：

- **下载 zip 手动装**：解压/选 zip → Dashboard → Plugins → Install plugin → ZIP
- **从 GitHub 装**：Install plugin → GitHub Release → 填 `<你的用户名>/crystal-grinder`

---

## 发完自检

- [ ] 仓库是 Public，打开能直接看到 `crystal-grinder.reaplugin/manifest.json`
- [ ] 两个 Release 各自只有 **一个** zip 附件
- [ ] 插件 Release 的 tag 是 `v0.2.0`，和 manifest 的 `version` 一致
- [ ] 找一台干净机器：装插件 → 装皮肤 → 连磨豆机 → 点 START 能转
- [ ] 密码 `apple050034A` 已经改掉（它在这段对话里出现过）

---

## 如果以后想发新版本

1. 改 `crystal-grinder.reaplugin/manifest.json` 的 `version`（比如 `0.2.1`）
2. 本地跑 `.\build.ps1`
3. 新建 Release，tag 打 `v0.2.1`，挂新的插件 zip
4. 皮肤同理，tag 用 `skin-v...`

---

## 关于换行符警告

GitHub Desktop 可能弹出：

- `This file uses 'LF' line endings, but Git is configured to convert them to 'CRLF'`
- `This file uses 'CRLF' line endings, but Git is configured to convert them to 'LF'`

这是 Windows 版 Git 的 `core.autocrlf=true` 和文件实际换行不一致导致的**警告，不是错误**。
仓库里已经放了 `.gitattributes`：

```gitattributes
* text=auto eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
*.bat text eol=crlf
*.png binary
*.zip binary
```

- 所有文本文件统一 LF（含 `.yml`、`.md`、`.gitignore`）
- 只有 `build.ps1` 保持 CRLF（和规则一致，不会报警）
- 如果文件已经提交过才加 `.gitattributes`，跑一次 `git add --renormalize .` 再提交
