# CRYSTAL 磨豆机 BLE 协议（插件实现口径）

本文件记录插件实际依赖的协议细节。依据：

- `98 V2/CRYSTAL磨豆机的蓝牙协议 - R1.docx`（下称 R1）
- `小方/20261017 弹粉优化 -1.08/GrinderAPP - MetalESP32/src/bleRPM.cpp` 与 `bleRPM.h`
  （与 `98 V2/程序/V2程序/20260925 阻塞优化 -1.06/GrinderAPP - V2ESP32/src/` 下的实现逐字节相同）

R1 没有写数据类型和字节序，这两项来自固件实现，属于**协议的事实来源**，不是猜测。

## 1. 广播与服务

| 项 | 值 |
|---|---|
| 广播名 | `CRYSTAL-` + 4 位 MAC（`sprintf("CRYSTAL-%02X%02X", mac[4], mac[5])`），如 `CRYSTAL-E57C` |
| 广播内容 | 设备名 + 主服务 UUID；广播间隔 100–200 ms |
| 连接参数 | min 18.75 ms / max 37.5 ms / latency 0 / supervision 6 s（Apple 建议值） |
| Service | `7fa2d10c-12f3-4b9e-9d77-1a9b65432100` |
| 配对 | `NimBLEDevice::setSecurityAuth(true, false, false)`：**bond = true**，MITM = false，Secure Connections = false；IO cap = NoInputNoOutput（Just Works） |

## 2. 特征值

| 功能 | UUID | 属性 | 范围 | 插件用途 |
|---|---|---|---|---|
| 电机转速 `MT_RPM` | `…65432101` | READ / WRITE / NOTIFY | 0–1500 | `rpm` 控制 + 快照 `rpm` |
| 下豆转速 `XD_RPM` | `…65432102` | READ / WRITE / NOTIFY | 0–150 | 仅内部回读，v1 不暴露 |
| 启动项 `BOOT_SIGN` | `…65432103` | READ / WRITE / NOTIFY | 0–10 | 启停、写入研磨度 |
| 系统状态 `SYS_STATE` | `…65432104` | READ / NOTIFY | 0–1（固件也给了 WRITE） | `state`：0 空闲 / 1 忙碌 |
| 当前研磨度 `SERVO_ANGLE` | `…65432105` | READ / NOTIFY | 0–1500 | 快照 `setting` |
| 目标研磨度 `TF_ANGLE` | `…65432106` | READ / WRITE / NOTIFY | 0–1500 | 写研磨度 |

R1 把 `SYS_STATE`、`SERVO_ANGLE` 写成 READ/NOTIFY，固件实际对 6 个特征都注册了
`READ | WRITE | NOTIFY`。插件按“读 + 订阅”使用，不依赖这两个的写权限。

## 3. 数据格式

- 每个特征值固定 **2 字节，uint16，大端**（高字节在前）。
- 固件写响应：`data[0] << 8 | data[1]`；通知：`{(v >> 8), (v & 0xFF)}`。
- 写入长度不等于 2 时，固件把当前值回写进特征值并直接返回，**不通知**。
- 写入值超出该特征范围时，固件忽略本次写入（不回写、不通知）。
- 插件的 BLE 桥用 base64 传字节，例如 1500 = `0x05 0xDC` = `"Bdw="`。

## 4. 启动项 `BOOT_SIGN`

| 值 | 含义（R1） | 插件何时发送 |
|---|---|---|
| 1 | 手动启动电机 | 设置项 `startMode = 手动` 时，`start()` |
| 2 | 定时启动电机 | 设置项 `startMode = 定时` 时，`start()` |
| 3 | 智能启动（自动启停） | 默认；`start()` |
| 4 | 停止电机 | `stop()` |
| 5 | 将目标研磨度写入当前研磨度 | `setGrindSetting()` 第二步 |

`setGrindSetting(v)` 的顺序固定为：先写 `TF_ANGLE = v`，再写 `BOOT_SIGN = 5`。
固件侧 `BOOT_SIGN` 是 Modbus 保持寄存器 0x08 的镜像，真正的动作由主控执行。

## 5. 状态与通知

- `SYS_STATE` 0 → `idle`，1 → `grinding`；插件另外有 `unknown`（连接时读不到状态）。
- 固件对每个特征做去重通知（值不变不通知），另有 1 s 兜底同步 `syncModbusToBle()`。
- 断线重连时 `onConnect` 会重置去重缓存，保证重连后首轮数据一定会发出。
- 因此**不能**假设“写进去就一定有通知回来”；插件不会等待通知来完成命令，只在收到通知时更新快照。

## 6. 加密与配对（已实测：不需要配对）

固件开了 bonding + encryption，但 `createCharacteristic` 没有设置
`BLE_GATT_CHR_F_READ_ENC` / `WRITE_ENC` 之类的访问权限，所以未加密链路也能读写。

**2026-10-23 实测确认**（Windows 10/11，Decaid 0.9.1-beta.1，样机 CRYSTAL-E580）：

- 没有在系统里配对，直接扫描 → 连接成功；
- 读取 `SYS_STATE` / `SERVO_ANGLE` / `MT_RPM` 成功，首帧 `{state: "idle", setting: "0", rpm: 0}`；
- 写入 `MT_RPM` 成功（`PUT /api/v1/grinder/rpm {"rpm":0}` 返回 200）。

所以 Windows 上**不需要先配对**。这仍然是固件层面的"允许"，不是"强制"：将来若把特征改成
加密访问（`setAccessPermissions(..._READ_ENC)`），Decaid 端没有配对入口就会连不上，
那时需要改固件或在 Decaid 原生侧增加 `pair()` 调用。

## 7. R1 未覆盖、需要厂家确认的点

以下问题不影响当前插件跑通，但会影响第二版行为：

1. **定时启动（2）的时长**从哪里来？固件里没有 BLE 可写的时间参数。
2. `XD_RPM` 的物理含义（下豆转速 = 进豆螺杆转速？）与 0–150 的单位。
3. `SERVO_ANGLE` 的 0–1500 与用户刻度（例如 0–15.0）的换算关系；当前按原始整数显示。
   实测连上后读到 `SERVO_ANGLE = 0`，需要确认这是"未标定/静止"的正常值，还是读取时机问题。
4. 写入 5 之后 `SERVO_ANGLE` 何时更新（舵机到位后？），是否需要插件等待并确认。
5. 电机 0–1500 是否就是刀盘转速 rpm，还是驱动器内部标度。
