# 磨豆机接口（给 Skin 用）

插件把 CRYSTAL 磨豆机变成一个标准的 Decaid 磨豆机设备。Skin 不需要知道 BLE，
只用下面这些 HTTP / WebSocket 接口；咖啡机（DE1）仍然走 Decaid 原有的 machine 接口。
两者可以在同一个页面里同时控制。

## 1. 安装插件

插件包目录：`crystal-grinder/crystal-grinder.reaplugin/`（`manifest.json` + `plugin.js`）。

- 界面：**Plugins → 齿轮 → Install plugin → Folder snapshot**，选这个目录；
- 或者把目录压成 zip 后选 **ZIP file**；
- 安装后自动加载，插件 id：`com.crystal.grinder`。

## 2. 发现与连接

1. `GET /api/v1/devices/scan?connect=false` — 扫描。磨豆机广播名以 `CRYSTAL-` 开头即被本插件认领。
2. `GET /api/v1/devices` — 在返回的 `id` 里找到 `plugin:com.crystal.grinder:crystal:<BLE 地址>`。
3. `PUT /api/v1/devices/connect`，body `{"deviceId": "plugin:com.crystal.grinder:crystal:<BLE 地址>"}`。

连接成功后磨豆机是 Decaid 的“当前磨豆机”，`/api/v1/grinder/*` 全部指向它。

> Windows 前提：如果固件强制加密，先在系统设置里配对 `CRYSTAL-xxxx`。详见 `PROTOCOL.md` 第 6 节。

## 3. 设置项

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `startMode` | enum | 智能（自动启停） | 决定 `start()` 写 3 / 1 / 2；`stop()` 永远是 4 |

## 4. REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/grinder/info` | 设备 id、能力、有效控制范围（0–1500 / 0–1500） |
| GET | `/api/v1/grinder/state` | 最近一次快照 |
| PUT | `/api/v1/grinder/state/grinding` | 开始研磨 |
| PUT | `/api/v1/grinder/state/idle` | 停止研磨 |
| PUT | `/api/v1/grinder/setting` | `{"setting":"830"}`，0–1500 的整数字符串 |
| PUT | `/api/v1/grinder/rpm` | `{"rpm":1200}`，0–1500 |
| WS | `/ws/v1/grinder/snapshot` | 快照流 |

```bash
# 开始 / 停止
curl -X PUT http://localhost:8080/api/v1/grinder/state/grinding
curl -X PUT http://localhost:8080/api/v1/grinder/state/idle

# 研磨度 830（插件内部：TF_ANGLE=830，然后 BOOT_SIGN=5）
curl -X PUT http://localhost:8080/api/v1/grinder/setting \
  -H 'content-type: application/json' -d '{"setting":"830"}'

# 转速 1200
curl -X PUT http://localhost:8080/api/v1/grinder/rpm \
  -H 'content-type: application/json' -d '{"rpm":1200}'
```

`GET /api/v1/grinder/state` 示例：

```json
{ "timestamp": "2026-10-23T11:20:31.412Z", "state": "idle", "setting": "830", "rpm": 900 }
```

## 5. WebSocket

```js
const ws = new WebSocket("ws://localhost:8080/ws/v1/grinder/snapshot");
ws.onmessage = (event) => {
  const snapshot = JSON.parse(event.data);
  // { timestamp, state: "idle" | "grinding" | "error" | "unknown", setting?, rpm? }
};
```

- 新订阅者会立刻收到当前快照（如果已连接）。
- 断开或换设备时会话清空，订阅保持静默，不会收到过期帧。

## 6. 状态映射

| 设备 `SYS_STATE` | Decaid `state` |
|---|---|
| 0 | `idle` |
| 1 | `grinding` |
| 读不到 | `unknown` |

`setting` = `SERVO_ANGLE`（当前研磨度，字符串整数）；`rpm` = `MT_RPM`。

## 7. 和咖啡机同屏

咖啡机不用这个插件，直接用 Decaid 的 machine 接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/machine/state` | 当前状态与子状态 |
| PUT | `/api/v1/machine/state/espresso` | 开始萃取 |
| PUT | `/api/v1/machine/state/idle` | 回到空闲（停止） |
| GET | `/api/v1/machine/info` | 机型 / 固件 / 能力 |
| WS | `/ws/v1/machine/snapshot` | ~10 Hz 状态、温度、压力、流量 |

典型联动（在 skin 里写，不需要改插件）：

```js
// 先磨豆，等磨豆机回到 idle，再开始萃取
await fetch("/api/v1/grinder/state/grinding", { method: "PUT" });
const ws = new WebSocket("/ws/v1/grinder/snapshot");
ws.onmessage = async (event) => {
  const { state } = JSON.parse(event.data);
  if (state !== "idle") return;
  ws.close();
  await fetch("/api/v1/machine/state/espresso", { method: "PUT" });
};
```

## 8. 错误

| 情况 | 返回 |
|---|---|
| 没有连接磨豆机 | `503` |
| 未声明的操作 | `code: "unsupported_operation"` |
| 研磨度/转速超出 0–1500，或不是整数 | `code: "invalid_argument"` |
| BLE 写入失败 / 链路断开 | 命令 reject，设备转 disconnected |
