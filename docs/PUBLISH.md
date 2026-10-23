# 发布与分发

## 一句话结论

**不用先把东西发给 Decent。** 插件和皮肤都支持"用户自己装"，你把两个 zip 放到 GitHub Release
（或任何可下载的网址）就能发给客户。只有想让它**随 Decaid 内置/自动下载**时，才需要找官方。

---

## 1. 要发出去的两个包

`build.ps1` 一次生成两个（都在 `dist/`）：

| 包 | 内容 | 大小 |
|---|---|---|
| `crystal-grinder-0.2.0.zip` | `manifest.json` + `plugin.js` + `README.md`（根目录） | ~6 KB |
| `streamline-crystal-0.2.17-crystal.1.zip` | `index.html` + `skin-manifest.json` + `src/`（根目录） | ~3 MB |

```powershell
cd crystal-grinder
.\build.ps1
```

不要把 `AppData` 下的整份 `web-ui` 或整个 `plugins` 目录打包发出去——里面混着别人的皮肤和本机数据。

---

## 2. 用户怎么装（发给客户的说明）

### 插件

1. Decaid → **Plugins** → 齿轮 → **Install plugin**
2. 选 **ZIP file** → `crystal-grinder-0.2.0.zip`
3. 装完确认状态是 loaded；磨豆机第一次连上时扫到 `CRYSTAL-xxxx` 即可

### 皮肤

1. 设置 → WebUI / 皮肤 → 安装皮肤（选 **ZIP** 或 **URL**）
2. 选 `streamline-crystal-0.2.17-crystal.1.zip`
3. 在皮肤列表里选 **Streamline · CRYSTAL**，设为默认

> 皮肤也可以发一个 URL 让用户填：把 zip 放到任意静态地址即可。

### 前置版本

需要 **Decaid ≥ 0.9.1-beta.1**（2026-10-21）。这一版才包含 BLE 插件驱动
（`transport.ble`、`host.devices.bindDriver`）。旧版本的清单校验会直接拒绝这个插件。

---

## 3. 自己发 Release（推荐路径）

1. 建仓库，把 `crystal-grinder.reaplugin/`（或它的内容）和 `skin/streamline-crystal/` 推上去
2. 打 tag：`v0.2.0`（必须等于插件 manifest 的 `version`，去掉前导 `v`）
   - 皮肤不受 tag 规则约束，但建议同 tag
3. 新建 Release，**只挂一个 zip**（插件和皮肤分两个 Release 更清晰，避免安装器"多个 zip 不敢猜"）
4. 用户就能用 **Install plugin → GitHub Release** 装，并且以后能"检查更新"

Decaid 的安装器规则（插件）：

- tag 必须是 `X.Y.Z` 或 `vX.Y.Z`，且等于 `manifest.version`，否则拒绝
- release 里若挂了多个 `.zip`，安装器会要求指定 asset，不会猜
- 从 GitHub 装会记录 `.rea_source.json`，用于后续更新检查

---

## 4. 皮肤这条路的两个坑

1. **它是 streamline.js 的分支**。上游一发新版，你的分支不会自动跟进；
   要跟进就得把 `src/` 再同步一次，然后重放我们的三处改动（`index.html` 两行、
   `crystal-grinder-panel.js`、`crystal-grinder.css`）。文档里记了这三处，方便 rebase。
2. **皮肤 id 变了**（`streamline-crystal`），所以用户原来选的 `streamline.js` 不会自动切过来，
   需要手动选一次默认皮肤。

如果以后改动稳定了，可以考虑把面板做成**独立小皮肤**（只依赖 `web-ui` 的 API + 一个 iframe/浮层），
就不再被 streamline 的版本牵着走。

---

## 5. 什么时候需要找官方

| 目标 | 需要做什么 |
|---|---|
| 用户自己装 | 不用找官方 |
| 让 Decaid 启动时**自动下载**皮肤 | 在 `decentespresso/decaid` 的 `skin_sources.json` 里加一项（PR） |
| 让插件**随 App 内置** | 插件清单在 `plugin_loader_service.dart` 的 `_getBundledPluginPaths` 里硬编码，需要 PR 并接受维护 |
| 想在 Decent 商店/官网露出 | 走官方渠道沟通，通常会要求：开源仓库、版本 tag、README、支持邮箱 |

注意：`transport.ble` 和 `host.devices.bindDriver` 在文档里仍标注为 **Work in Progress (#809)**。
功能在我们这台 0.9.1-beta.1 上跑通了，但官方随时可能调整契约。所以：

- **建议先自托管发布**，收集真实用户反馈；
- 等接口稳定后再提"内置"或"官方收录"，避免跟着 API 变动返工。

---

## 6. 发布前检查清单

- [ ] `.\build.ps1` 生成两个 zip，大小正常（插件 < 20 KB，皮肤 ~3 MB）
- [ ] 插件 zip 根目录就是 `manifest.json` / `plugin.js`（不要再套一层目录）
- [ ] 皮肤 zip 根目录就是 `index.html` / `skin-manifest.json`
- [ ] 找一台**没装过**的机器，按第 2 节走一遍：能装、能加载、能连磨豆机
- [ ] 磨豆机固件版本记录在 Release notes 里（协议目前对应 `bleRPM` 那版）
- [ ] Release notes 写明最低 Decaid 版本 `0.9.1-beta.1`
- [ ] 附上已知限制：不配对、需要先在 Devices 里扫到设备、绑定配方只做关联

---

## 7. 给客户的极简说明（可直接复制）

> 1. 安装 Decaid 0.9.1 或更新版本（Windows/macOS/Linux 均可）
> 2. Plugins → Install plugin → ZIP → 选 `crystal-grinder-x.y.z.zip`
> 3. 设置 → 皮肤 → 安装 → 选 `streamline-crystal-x.y.zip`，设为默认
> 4. 打开磨豆机电源，Devices 页扫描，连上 `CRYSTAL-xxxx`
> 5. 右上角浮动窗：点大数字改配方，左右滑动或点 ‹ › 切换配方，SET/START/STOP 控制研磨
