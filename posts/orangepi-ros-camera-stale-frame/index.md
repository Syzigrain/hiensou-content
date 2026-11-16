---
title: 摄像头拍到的总是几分钟前的画面：一次 V4L2 缓冲排查
published: 2026-11-16
description: "到点拍照却拿到起步画面：用位姿元数据和帧时间戳定位，最终发现 V4L2 的 4 帧缓冲在行车期间积压了旧画面。"
tags: ["ROS", "OpenCV", "V4L2", "摄像头", "Orange Pi"]
category: 踩坑记录
draft: false
---

环境：Orange Pi 5 Ultra（RK3588），Ubuntu 20.04 + ROS Noetic，Python 3.8；USB 摄像头（DHZJ，UVC，最高 1280×1024 MJPG）；导航节点按航点行驶，到点拍照后交给 RKNN 做人物识别。

现象很怪：导航明明走到 P6 了，P6 文件夹里的照片却是**起步时**看到的画面；而且“上一次运行 P2 拍的照片”和“这一次 P6 拍的照片”几乎一模一样。

本文记录从现象到根因的完整排查过程，以及修复方式。结论先放在这里：**摄像头 V4L2 默认有 4 帧缓冲，行车期间没人读帧，缓冲里一直积压着旧画面；到点拍照时只丢一帧就去取图，拿到的是几分钟前的场景。**

> 这次调试遇到的其他问题（YAML 解析、到点死区、相机格式等）汇总在另一篇 [ROS 航点小车调试踩坑合集](/posts/orangepi-ros-waypoint-car-pitfalls/)。

---

## 1. 现象

| 观察 | 具体表现 |
|---|---|
| 照片与航点不符 | P2/P4 文件夹里是“起始点”的画面 |
| 两张不同位置的照片雷同 | “上次 P2”和“这次 P6”看起来一模一样 |
| 前几张必然错 | 每次运行的前 2 张照片都不对，第 3 张起就正常 |
| 识别时好时坏 | 错误照片 0 检出，正常照片能稳定检出 3 个目标 |

最后一条其实是个重要线索：**识别模型没问题，是给它的图像不对。**

## 2. 先排除“存错文件夹”

拍照程序按到达航点建目录，并记录每张图的拍摄时间。翻日志看时间戳：

```text
P2  21:57:31
P4  21:57:43
P6  21:57:55
P7  21:58:02
P9  21:58:18
P12 21:58:41
```

时间随行驶递增，顺序与路线一致 —— 目录归属没问题。

## 3. 再加位姿记录，验证“拍摄时的位置和朝向”

给拍照逻辑补上机器人位姿（ROS 里程计），写进 `results.json` 并打印到控制台：

```text
CAMERA person @ P6: 1280x1024  拍照 41 ms  位置=(3.418,1.927) 朝向=179°
```

| 航点 | 规划坐标 | 实际拍照位姿 | 朝向 | 偏差 |
|---|---|---|---|---|
| P6 | (3.44, 1.87) | (3.418, 1.927) | 179° | 6 cm |
| P12 | (2.7, 1.204) | (2.699, 1.239) | −89° | 3 cm |
| P12_2 | (2.7, 1.204) | (2.744, 1.241) | +89° | 4 cm |
| P14 | (1.807, 1.828) | (1.768, 1.814) | 0° | 4 cm |

位置误差都在 6 cm 内，朝向与“转 90°/180°”的动作序列完全吻合。

**也就是说：元数据全对，位置对、朝向对、时间对 —— 唯独画面不对。** 这种情况下，问题基本可以锁定在“图像采集”这一端。

## 4. 关键证据：两张“不同位姿”的照片几乎是同一张

把同一次运行里的照片两两做像素级对比（平均绝对差 MAD，越小越像）：

| 对比 | 位姿差异 | MAD |
|---|---|---|
| 新 P6 vs 新 P12 | 位置差 1 m、朝向差 90° | **4.28** |
| 新 P6 vs 新 P14 | — | 55.76 |
| 新 P12_2 vs 新 P14 | — | 51.74 |

同一视角出现在相隔 1 米、朝向差 90° 的两个点上，物理上不可能。**只能是取到了旧帧。**

## 5. 用帧时间戳定位：缓冲深度 4

OpenCV 的 `CAP_PROP_POS_MSEC` 对 V4L2 返回的是帧的采集时间。做个实验：打开相机、读两帧后**空闲 5 秒**（模拟行驶期间不取帧），再连读 6 帧并打印时间戳。

```python
import cv2, time
cap = cv2.VideoCapture("/dev/video1", cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1024)
for _ in range(2):
    cap.read()
time.sleep(5)                      # 模拟行车期间没人读帧
for i in range(10):
    cap.read()
    print(i + 1, cap.get(cv2.CAP_PROP_POS_MSEC))
```

结果：

```text
buffersize = 4.0
第 1 帧  POS_MSEC=6457036.9
第 2 帧  POS_MSEC=6457040.8
第 3 帧  POS_MSEC=6457076.9
第 4 帧  POS_MSEC=6457108.9
第 5 帧  POS_MSEC=6462144.8     ← 时间跳了 5 秒
```

前四帧的时间戳比当前落后整整 5 秒，**第 5 帧才追上当前时刻**。

## 6. 原理：为什么缓冲里会积压旧帧

V4L2 的采集默认使用 MMAP 队列，OpenCV 这边 `CAP_PROP_BUFFERSIZE` 是 **4**：

- 驱动持续把画面填进空闲 buffer；
- 如果应用不读，4 个 buffer 填满后驱动就停在那里（没有空闲 buffer 可写）；
- 应用恢复读取时，`read()` 是从队列头部按顺序出队，拿到的自然是**最后几次读帧之后几十毫秒**捕获的旧画面。

而原来的拍照代码只丢 1 帧就去取图：

```python
cap.read()   # 丢掉一帧
cap.read()   # 取一帧 —— 仍然是旧帧
```

每次拍照消耗 2 帧，所以要拍到**第 3 张**、缓冲里的 4 个旧帧被耗尽之后，画面才是实时的。这正好解释了“前两张错、后面全对”：

| 拍摄顺序 | 消耗的缓冲 | 结果 |
|---|---|---|
| 第 1 张 | 旧帧 1、2 | ❌ 起步画面 |
| 第 2 张 | 旧帧 3、4 | ❌ 起步画面 |
| 第 3 张起 | 新填充帧 | ✅ 实时 |

## 7. 修复

两处改动，`tools/camera_process.py`：

**（1）开设备时把缓冲降到 1**

```python
cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1024)
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)      # 只保留 1 帧，避免积压
```

**（2）拍照前按缓冲深度冲刷**

```python
def _grab(self):
    cap = self._ensure_capture()
    with self.cap_lock:
        buffers = int(cap.get(cv2.CAP_PROP_BUFFERSIZE) or 1)
        for _ in range(max(2, buffers + 1)):   # 冲掉缓冲里的旧帧
            cap.read()
        ok, frame = cap.read()
    return frame
```

代价很小：2 帧 MJPG 约 25 ms，实测单次拍照仍是 **75 ms**。

## 8. 验证

同样“空闲 5 秒再读”的实验，设 `BUFFERSIZE=1` 后：

```text
设置后 buffersize = 1.0
第 1 帧  POS_MSEC=6476585.0     ← 唯一的旧帧
第 2 帧  POS_MSEC=6481613.9     ← 当前
第 3 帧  POS_MSEC=6481641.9
```

只有 1 帧是旧的，丢 2 帧足够。修复后再测“取到的帧与 0.5 秒后那帧”的时间差，只有 28 ms，说明取的确实是当前帧。

上板实跑：P2/P4/P6/P12/P14 每张照片的位置、朝向、画面一一对应，人物识别稳定检出。

## 9. 顺带修掉的几个“拍照慢/拍不对”问题

这次排查还顺手处理了几个相关坑，都影响“停车→拍照→继续走”的体验：

| 问题 | 现象 | 处理 |
|---|---|---|
| 默认协商成 YUYV | 1280×1024 只有 **1.6 fps**（约 600 ms/帧） | 强制 **MJPG**，实测 **87 fps**（约 12 ms/帧） |
| 相机倒装 | 图像上下颠倒 | 配置 `rotation: 180`，识图前先转正 |
| 首次调用要现加载模型 | 停车后要等 0.6~2 s 才出结果 | 导航启动即在后台预热相机与模型（约 1.9 s，发生在车动之前） |
| 推理阻塞行驶 | 停车时间 = 拍照 + 推理 | 停车只拍（约 50 ms），推理放后台线程与行驶并行 |
| 归档难查 | 每张图一个时间戳目录 | 以启动时间建大文件夹，按航点建子文件夹 |

归档结构：

```text
data/camera_process/
└── 20261116_222239/         本次启动时间
    ├── P2/
    │   ├── original.jpg
    │   ├── community_person.jpg
    │   └── results.json     含 pose: {x, y, yaw_deg}
    ├── P12/
    └── P12_2/               同一航点第二次拍照
```

## 10. 经验

1. **“元数据全对、内容不对”优先怀疑陈旧帧。** 位置、朝向、时间都对，就别再查业务逻辑了，直接看采集端。
2. **抓拍程序不能只丢一帧。** 只要存在“长时间不读、偶尔读一次”的用法，就必须排空缓冲，或把 `BUFFERSIZE` 降到 1。
3. **给数据结构加上位姿/时间戳。** 这次能快速定位，靠的就是给 `results.json` 补了 `pose` 字段并打印到控制台，否则只能靠“看起来像”。
4. **加一层自检更省事**：拍照后比较帧时间戳与当前时刻，偏差超过 0.5 s 就重拍并告警，这类问题会立刻暴露，而不是表现出“照片拍错了点位”。

## 附：排查用命令速查

```bash
# 摄像头与格式信息
ls -l /dev/video*
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video1 --list-formats-ext

# 谁占用相机
fuser -v /dev/video1

# 缓冲/时间戳实验：空闲后连读，看 POS_MSEC 是否落后
python3 - <<'PY'
import cv2, time
cap = cv2.VideoCapture("/dev/video1", cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1024)
print("buffersize =", cap.get(cv2.CAP_PROP_BUFFERSIZE))
for _ in range(2): cap.read()
time.sleep(5)
for _ in range(6):
    cap.read(); print(cap.get(cv2.CAP_PROP_POS_MSEC))
cap.release()
PY
```
