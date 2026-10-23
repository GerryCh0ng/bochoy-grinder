# CRYSTAL Grinder (Decaid plugin)

Decaid 插件：通过 BLE 连接 CRYSTAL 磨豆机（ESP32-S3），提供研磨启停、研磨度、转速。

- 插件 id：`com.crystal.grinder`
- 版本：0.1.0
- 需要 Decaid 的 `transport.ble` 插件能力（BLE grinder driver）

## 文件

| 文件 | 说明 |
|---|---|
| `manifest.json` | 驱动声明：`grinder` + `startStop` / `grindSetting` / `rpmControl`，BLE 匹配 `CRYSTAL-` 前缀 |
| `plugin.js` | BLE 协议实现（见 `docs/PROTOCOL.md`） |

## 行为

- 连接后读取 `SYS_STATE` / `SERVO_ANGLE` / `MT_RPM` 并发布首个快照，然后订阅 5 个特征。
- `start()` 按设置项写 `BOOT_SIGN`（默认 3 = 智能自动启停）；`stop()` 写 4。
- `setGrindSetting(v)` 先写 `TF_ANGLE`，再写 `BOOT_SIGN = 5`。
- `setRpm(v)` 写 `MT_RPM`。
- `XD_RPM` 只订阅不回读暴露（v1 决定）。

## 安装

Decaid → Plugins → 齿轮 → Install plugin → Folder snapshot（选本目录），或打成 zip 用 ZIP file。

## 已知前提

固件虽然开了 bonding，但特征值没有强制加密访问：Windows 上未配对即可连接、读、写
（2026-10-23 样机 CRYSTAL-E580 实测）。详见 `docs/PROTOCOL.md` 第 6 节。
