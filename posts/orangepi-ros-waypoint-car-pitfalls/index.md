---
title: ROS 航点小车调试踩坑合集：从 YAML 解析到相机取帧
published: 2026-11-16
description: "打点网页漏读 YAML、after 空值崩溃、到点卡死、相机旧帧、模型懒加载……一次 ROS 航点小车的踩坑与修复合集。"
tags: ["ROS", "Orange Pi", "调试", "YAML", "OpenCV"]
category: 踩坑记录
draft: false
---

环境：Orange Pi 5 Ultra（RK3588），Ubuntu 20.04 + ROS Noetic，Python 3.8；USB 摄像头（UVC，1280×1024 MJPG）；航点导航 + 到点拍照，交给 RKNN 模型做识别。

最近这套系统连续踩了一串坑：打点网页读不了配置、导航启动直接崩、到点卡死在离目标 6 cm 处、拍出来的照片和航点对不上、模型加载慢到停车等两秒……每一个单独看都很怪，串起来其实都是“边界条件 + 默认值”的问题。本文按类别汇总，每个坑给出**现象 → 根因 → 处理**，方便以后直接搜。

其中相机取到旧帧那个坑单独写了一篇详细复盘：[摄像头旧帧排查](/posts/orangepi-ros-camera-stale-frame/)。

---

## 0. 问题总览

| # | 现象 | 根因 | 处理 |
|---|---|---|---|
| 1 | 打点网页打开带注释的路线只有 2 个点 | YAML 解析器没剥离行尾注释 | 解析前剥注释 + 航点数校验 |
| 2 | `./nav.sh` 启动报 `'NoneType' object is not iterable` | `after:` 空值被解析成 `None` | 数据补 `after: []`，校验层兜底 |
| 3 | 导航在离目标 6 cm 处停住，8 秒后报错 | 速度指令掉进底盘死区 | 量化四舍五入 + 抬高最小速度 + 停住自愈 |
| 4 | 相机被网页服务占用，识别打不开设备 | systemd 用户服务常驻占设备 | 改手动 `camera` 命令启停 |
| 5 | 拍照慢到 4.6 秒才出图 | 相机协商成 YUYV，只有 1.6 fps | 强制 MJPG，87 fps |
| 6 | 照片上下颠倒 | 相机倒装 | 配置 `rotation: 180` |
| 7 | 停车后要等 1~2 秒才识别 | 首次调用才加载 RKNN 模型 | 启动预热 + 推理转后台 |
| 8 | **照片和航点对不上，P2/P4 存成起始画面** | **V4L2 缓冲积压 4 帧旧画面** | **缓冲降为 1 + 拍照前冲刷** |
| 9 | 红绿灯/车牌识别不了 | 模型注册表 13 项只有 5 个有文件 | 补模型或改注册表 |
| 10 | 板子 `git push` 报无法解析 github.com | 板子 DNS 失效 | bundle + scp 中转 |
| 11 | 提交里 `.gitignore` 95 行全变 | Python 读写把 CRLF 全转成 LF | amend 恢复原始换行 + force-with-lease |
| 12 | `data/camera_process` 删不掉 | `sudo` 跑导航，目录属 root | `sudo rm` 或 chown 回来 |

## 1. 配置与解析

### 1.1 打点网页读不了带注释的 YAML

**现象**：`route_viewer.html` 导入 `right_turn.yaml` 后只显示 `HOME`、`P1` 两个点，没有任何报错。

**根因**：页面内置的迷你 YAML 解析器里，`stripComment()` 定义了却**从未被调用**。于是：

```yaml
P2:                               # A区第一个人物立牌
```

被当成「键 = `P2`，值 = `'# A区第一个人物立牌'`」，P2 下面的 `x/y/motion` 全部丢失；缩进层级对不上后，解析循环直接结束，后面的点被静默丢弃。

**处理**：

```js
// tokenize 里先剥掉行尾注释，再切分行
var body = stripComment(raw.slice(indent)).replace(/\s+$/, '');
if (body === '') continue;
```

再加一层保险：统计 `points:` 段里缩进 2 空格的键数量，解析结果少于它就直接报错，而不是少几个点还假装成功。

**经验**：解析器里“定义了没调用”的辅助函数，往往就是 bug 现场；无报错的静默丢数据，比抛异常难查得多。

### 1.2 `after:` 空值导致导航启动崩溃

**现象**：

```text
TypeError: 'NoneType' object is not iterable
  validate_actions(point.get("after", []))
```

**根因**：下面这种写法，YAML 解析出来是 `None` 而不是空列表：

```yaml
    after:
    # TODO: 识别人物立牌（识别程序待接入，此处暂空）
```

注意：`point.get("after", [])` 的默认值只在**键不存在**时生效，键存在但值是 `null` 时会拿到 `None`，于是 `for action in None` 崩了。

**处理**：数据改成 `after: []`；同时在校验层兜底：

```python
if "after" in point and point["after"] is None:
    point["after"] = []
```

**经验**：配置里的“空值”和“缺键”是两回事，`dict.get(k, default)` 不是万能兜底。

## 2. 导航控制

### 2.1 到点卡死：速度指令掉进底盘死区

**现象**：导航停在离目标 5.9 cm 处不动，位置在 ±1 mm 抖动十几秒，最后报 `no progress for 8 seconds`。

**根因**（一串小问题叠加）：

1. 剩余 5.9 cm 时，比例项 `0.025 × 0.0593 = 0.0015`，低于最小速度 `0.002`，被抬到下限；
2. 车头误差缩放 0.94 后变成 `0.00188`；
3. 底盘量化用的是 `int(v*1000)` **向零截断**，`1.88 → 1`，实际只下发 1 mm/s；
4. 1 mm/s 低于底盘死区，车完全不动；
5. 看门狗要求误差改善 5 mm 才算“有进展”，抖动不够，8 秒后直接抛错终止整条路线。

**处理**：

```python
# 1) 量化改为四舍五入
def quantize(value, sign=1.):
    scaled = value * sign * 1000.
    return int(math.copysign(math.floor(abs(scaled) + .5), scaled))

# 2) 最小速度 0.002 → 0.003
# 3) 停住自愈：有平移指令却 1.2 s 没位移，逐级 +1 mm/s（保持 0.5 s 再回收）
# 4) 看门狗先给一次机会，再判失败
```

**经验**：低速控制里，“最小指令”和“量化误差”会互相叠加；死区、截断、容差要一起核对，单独调一个参数容易顾此失彼。

> 遗留项：实测指令 `0.004` 对应约 `0.4 m/s`，量级差约 100 倍，底盘协议单位还需要实测标定（发不同整数、量位移），否则“把速度设成多少 m/s”只是名义值。

## 3. 相机与视觉

### 3.1 相机被网页服务占用

**现象**：`cv2.VideoCapture('/dev/video1')` 打不开；`fuser -v /dev/video1` 显示被 `lan_capture_web.py` 占用。

**处理**：两条路——

- 让识别走网页服务的帧：配置 `frame_url: http://127.0.0.1:8088/api/frame.jpg`；
- 或者停掉网页服务，识别直接开设备（延迟更低）。

### 3.2 相机服务改成手动启停

**现象**：网页采集服务开机自启（systemd 用户级单元 + `Linger=yes`），和导航抢相机。

**处理**：

```bash
systemctl --user stop zhsq-capture-web.service
systemctl --user disable zhsq-capture-web.service
```

再包一个 `camera` 命令（安装到 `/usr/local/bin/camera`）：

```bash
camera start     # 启动，占用 /dev/video1
camera stop      # 停止，释放给导航识别
camera restart
camera status
```

脚本里两个细节值得抄：**等真正出图再返回**（服务起来后相机还要几秒 ready，直接取帧会 503）；**禁止 sudo 运行**（用户级服务会被切到 root 的 systemd 实例）。

### 3.3 YUYV 只有 1.6 fps，MJPG 有 87 fps

**现象**：单次拍照要 4.6 秒。

**根因**：UVC 默认协商成 YUYV（未压缩），1280×1024 下带宽不够，实测只有 1.6 fps。

| 格式 | 帧率 | 10 帧耗时 |
|---|---|---|
| YUYV（默认） | 1.6 fps | 6270 ms |
| MJPG | **87.7 fps** | **114 ms** |

**处理**：

```python
cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1024)
```

**经验**：UVC 相机一定要显式指定 FOURCC，别信默认协商结果。

### 3.4 照片上下颠倒

**现象**：画面倒置，人物模型几乎检不出目标。

**处理**：配置 `rotation: 180`，取帧后先 `cv2.rotate(frame, cv2.ROTATE_180)` 再推理。

**经验**：模型对倒置画面非常敏感，“识别率低”先确认画面方向。

### 3.5 停车后要等很久才出识别结果

**现象**：到点后停 1~2 秒才开始推理。

**根因**：推理工作进程是懒加载的，第一次调用才启动子进程并加载 RKNN 模型（`load_ms ≈ 600 ms`，加上 Python 启动更久）。

**处理**：

- 导航启动时后台预热：打开相机 + 加载本次路线用到的模型（约 1.9 s，发生在车动之前）；
- 到点只拍照（约 40~75 ms），推理丢给后台线程，车立即继续走。

实测：`submit` 返回 37~55 ms；推理 40~80 ms 在后台完成，结果照常打印。

### 3.6 照片和航点对不上（V4L2 旧帧）

**现象**：P2/P4 文件夹里是起步画面；不同位姿拍出来的两张图几乎一模一样。

**根因**：V4L2 默认 4 帧缓冲，行车期间不读帧，缓冲填满后停住；到点拍照只丢一帧就取图，拿到的是几分钟前的画面。前两张必然错，第三张起才正常。

**处理**：

```python
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)          # 只保留 1 帧
...
buffers = int(cap.get(cv2.CAP_PROP_BUFFERSIZE) or 1)
for _ in range(max(2, buffers + 1)):          # 冲刷积压帧
    cap.read()
ok, frame = cap.read()
```

详细排查过程见同目录另一篇。

### 3.7 模型注册表和文件对不上

**现象**：红绿灯、车牌任务没有结果。

**根因**：`zhaji/models.yaml` 注册了 13 个模型，实际只有 5 个 `.rknn` 存在（`biaozhi`、`community_person`、`trash_bins`、`trash_stickers`、`ebike`），`light`、`card`、`person` 等 8 个缺失；另外有个 `person_rk3588_int8.rknn` 没被任何条目引用。

**处理**：补齐模型文件，或把注册表指向实际存在的文件；任务里先用 `models: []` 只存原图占位。

## 4. 工程与运维

### 4.1 拍照归档结构

按“启动时间 / 航点”两级建目录，同一航点多次拍照自动加序号：

```text
data/camera_process/
└── 20261116_222239/
    ├── P2/  original.jpg  community_person.jpg  results.json
    ├── P12/
    └── P12_2/
```

`results.json` 里额外记录拍照位姿，排查时可以直接确认“这张图是站在哪、朝哪拍的”：

```json
"pose": {"x": 3.44, "y": 0.58, "yaw_deg": 180.0}
```

### 4.2 sudo 跑导航，输出目录属 root

**现象**：普通用户 `rm -rf data/camera_process` 删不掉。

**根因**：`nav.sh` 需要 sudo 开串口，拍照进程也以 root 身份创建目录。

**处理**：

```bash
sudo rm -rf data/camera_process
# 或
sudo chown -R orangepi:orangepi data/camera_process
```

**经验**：清理/调试前先看目录属主，别以为是权限坏了。

### 4.3 板子 DNS 失效，无法直接 push

**现象**：板子上 `git push` 报 `Could not resolve hostname github.com`。

**处理**：板子提交 → 打包增量 bundle → scp 回本机 → 本机 push：

```bash
# 板子
git bundle create /tmp/up.bundle main --not <last-pushed-sha>

# 本机
git fetch up.bundle main:refs/heads/opi-up
git merge --ff-only opi-up
git push origin main
```

**经验**：现场网络不可靠时，bundle 是最稳的同步方式，不依赖对方访问外网。

### 4.4 `.gitignore` 整文件被改写

**现象**：只追加了 3 行忽略规则，diff 却显示 95 行变更。

**根因**：原文件是 CRLF（混少量 LF），用 Python `read_text`/`write_text` 处理时换行被统一成 LF。

**处理**：按原始字节恢复文件（保留 CRLF），只追加需要的内容，再 `--amend` 并 `--force-with-lease` 推送。

**经验**：改配置类文本前先 `file` 看一下换行风格；批量脚本写文件容易把整个文件“翻新”。

## 5. 经验总结

1. **静默成功最坑**：解析器少读几个点、状态机悄悄退出，都要加断言/计数校验。
2. **“元数据对、内容不对”优先查采集端**：时间、位姿、目录都对，就别再查业务逻辑。
3. **低速运动要一起看三个量**：最小指令、量化误差、到点容差；单独调一个大概率换种方式卡住。
4. **相机默认值不可信**：FOURCC、分辨率、缓冲深度都要显式设置。
5. **部署脚本要么全自动、要么全手动**：开机自启和导航抢设备，是最典型的现场事故。
6. **给数据加自描述字段**（位姿、时间戳、任务名），排查成本会低一个数量级。

## 附：常用排查命令

```bash
# 相机设备与格式
ls -l /dev/video*; v4l2-ctl --list-devices
v4l2-ctl -d /dev/video1 --list-formats-ext
fuser -v /dev/video1

# 相机服务状态（用户级）
systemctl --user status zhsq-capture-web.service
camera status

# 导航预览（不启动硬件）
./nav.sh --preview

# 单张拍照验证（不启动导航）
python3 tools/camera_process.py --config config/B_straight.yaml --task person --image /tmp/test.jpg

# 拍照缓冲/耗时观测
grep -E "CAMERA|DRIVE TRACE|no progress" /tmp/zhsq-nav.* | tail -50
```
