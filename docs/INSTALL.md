# 安装与插件安装

## 1. 程序位置

Decaid 官方没有 Windows 安装包，发布物就是一个 zip，解压即用。

- 程序：`C:\Users\PC\Apps\Decaid\Decaid.exe`
- 桌面快捷方式：`C:\Users\PC\Desktop\Decaid.lnk`（指向上面这个 exe）
- 版本：`0.9.1+3012`（GitHub Release `v0.9.1-beta.1`，2026-10-21）
- 来源包：`decaid-windows-x64-0.9.1-beta.1.zip`
- 校验：SHA-256 `d4118d6cbf97ba6f7d2b49b36b042db9fb2ad5bd1032d1f0b5ed839a0b1eaf40`，
  与发布页 `decaid-0.9.1-beta.1-SHA256SUMS.txt` 一致
- 数据目录：`C:\Users\PC\AppData\Roaming\net.tadel\Decaid`

> **不要放在 `D:\我的文件\DS\Decent sync` 下。** 那个目录带 Low 完整性标签，
> 从里面启动的 `Decaid.exe` 会以低完整性运行，写不了 AppData，启动即失败
> （`Directory.create` 报 `OS Error: 拒绝访问, errno = 5`）。已在 `C:\Users\PC\Apps\Decaid` 验证：
> 进程为 Medium，正常创建 `logs/`、`store/`、`streamline_bridge.sqlite`。

## 2. 插件装在哪

```
C:\Users\PC\AppData\Roaming\net.tadel\Decaid\plugins\com.crystal.grinder\
  manifest.json
  plugin.js
  README.md
```

目录名就是 manifest 里的 `id`。装好后是 **loaded + autoLoad**（重启自动加载）。

## 3. 再次安装/更新的三种方式

1. **界面装目录**（最直观）：Plugins → 齿轮 → Install plugin → **Folder snapshot** →
   选 `D:\我的文件\DS\Decent sync\crystal-grinder\crystal-grinder.reaplugin`。
2. **界面装 zip**：同一入口选 **ZIP file** → `crystal-grinder\dist\crystal-grinder-0.2.0.zip`。
3. **REST**（脚本/CI 用）：

```powershell
# 装好后启用（会同时打开开机自动加载）
Invoke-RestMethod -Method Post http://localhost:8080/api/v1/plugins/com.crystal.grinder/enable

# 列出插件，确认 loaded=true
Invoke-RestMethod http://localhost:8080/api/v1/plugins | Where-Object id -eq 'com.crystal.grinder'
```

直接复制文件也行，复制完执行上面的 `enable`，或重启 Decaid。

## 4. 验证结果（2026-10-23）

| 项 | 结果 |
|---|---|
| 插件被发现 | `GET /api/v1/plugins` 出现 `com.crystal.grinder`，`drivers` 1 个 |
| 插件加载 | `loaded: true`，日志 `PluginManager - loaded: com.crystal.grinder` |
| 设备发现 | 扫描到 `CRYSTAL-E580`，`deviceId = plugin:com.crystal.grinder:crystal:3c:dc:75:78:e5:81` |
| 连接 | 未配对直接连上，`outcome: connected` |
| 读 | `GET /api/v1/grinder/state` → `{"state":"idle","setting":"0","rpm":0}` |
| 写 | `PUT /api/v1/grinder/rpm {"rpm":0}` → 200 |
| 皮肤 | `streamline-crystal` 装上、设为默认、窗口里正常渲染控制条 |
| 未验证 | `START` / `STOP`（会真的转电机）、写研磨度（会动舵机） |

## 5. 手动试

```powershell
# 状态
Invoke-RestMethod http://localhost:8080/api/v1/grinder/state

# 设定转速（不会转，等 start 才转）
Invoke-RestMethod -Method Put http://localhost:8080/api/v1/grinder/rpm -ContentType application/json -Body '{"rpm":900}'

# 开始 / 停止（会真的转动）
Invoke-RestMethod -Method Put http://localhost:8080/api/v1/grinder/state/grinding
Invoke-RestMethod -Method Put http://localhost:8080/api/v1/grinder/state/idle

# 写研磨度（会动舵机）
Invoke-RestMethod -Method Put http://localhost:8080/api/v1/grinder/setting -ContentType application/json -Body '{"setting":"830"}'
```

## 6. 控制皮肤

当前默认皮肤是官方 streamline.js 的分支 `streamline-crystal`（官方文件没动）：

```
C:\Users\PC\AppData\Roaming\net.tadel\Decaid\web-ui\streamline-crystal\
  index.html  skin-manifest.json
  src/modules/crystal-grinder-panel.js     控制条 + 编辑弹窗
  src/css/crystal-grinder.css
  ...（其余是 streamline.js 原样文件）
```

控制窗是一个**可拖动的浮动卡片**（默认右上角，位置记在皮肤 localStorage）：

1. ⋮⋮ 配方名 · 状态点 · ‹ 1/10 › · 编辑
2. 研磨度 / 转速 / 下豆（只读）
3. 手动 / 定时 / 自动
4. SET / START / STOP
5. 绑定咖啡配方（只读）

数值都在「编辑」弹窗里改，窗口本身只有显示和启停，尽量少占地方。

- 源码在 `crystal-grinder/skin/streamline-crystal/`，改完复制到上面的目录、重启 Decaid 生效。
- 换回原版皮肤：
  `Invoke-RestMethod -Method Put http://localhost:8080/api/v1/webui/skins/default -ContentType application/json -Body '{"skinId":"streamline.js"}'`
- 查看已装皮肤：`GET /api/v1/webui/skins`；当前端口：`GET /api/v1/webui/server/status`

> 为什么不直接改 `streamline.js`：它是从 GitHub 自动下载、带更新跟踪的皮肤，
> 直接改会在下次更新时被覆盖。分支的 id 是 `streamline-crystal`，名字 "Streamline · CRYSTAL"。

## 7. 插件 0.2.0 的厂商接口

Decaid 原生磨豆机接口只有 `setting` / `rpm` / 启停，没有下豆档位，也不能按次指定启动方式，
所以插件补了三个 HTTP 接口：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/v1/plugins/com.crystal.grinder/status` | `{connected, state, setting, rpm, feed}` |
| GET/POST | `/api/v1/plugins/com.crystal.grinder/feed` | 读/写 XD_RPM（0–150） |
| POST | `/api/v1/plugins/com.crystal.grinder/start` | `{"mode":"manual"\|"timer"\|"auto"}` → BOOT_SIGN 1/2/3 |

版本从 0.1.0 升到 0.2.0，清单里加了 `api` 权限和这三个端点。

## 8. 卸载

- 皮肤：删 `...\web-ui\streamline-crystal`，并在 Settings 里换回其他皮肤。
- 插件：Plugins 页 → 三点 → Remove，或删目录 `...\plugins\com.crystal.grinder`。
- 程序：删 `C:\Users\PC\Apps\Decaid` 和桌面快捷方式；数据目录
  `C:\Users\PC\AppData\Roaming\net.tadel\Decaid` 需要时一并删除。
