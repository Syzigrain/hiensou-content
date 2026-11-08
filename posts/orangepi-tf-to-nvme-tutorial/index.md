---
title: 把 Orange Pi 的 TF 卡系统完整迁移到 NVMe SSD
published: 2026-11-08
description: "Orange Pi 5 Ultra 从 TF 卡迁移到 NVMe：安装 SPI 引导、Etcher 整盘克隆、GParted 扩容，再拔卡验证独立启动。"
tags: ["Orange Pi", "NVMe", "RK3588", "系统迁移", "Linux"]
category: 教程
draft: false
---

环境：Orange Pi 5 Ultra（RK3588），Ubuntu 20.04，64GB TF 卡、128GB NVMe SSD。TF 卡上的系统已经配置好 ROS 和工作区，希望原样迁移，拔掉 TF 卡后独立启动。

采用官方手册里的方案：**安装 SPI 引导 → Etcher 整盘克隆 → 扩容 → 拔卡启动**。不用重新安装 Ubuntu，也不用重新配置 ROS。

最终形态：

- SPI Flash 保存 U-Boot 等早期引导程序
- NVMe 第一分区是 FAT，挂载到 `/boot`
- NVMe 第二分区是 ext4，挂载到 `/`，保存系统、软件和用户文件
- 正常启动不需要 TF 卡，也不应依赖 USB-TTL

本文的终端命令都在 **Orange Pi 的 Ubuntu 系统上用 bash 执行**。Etcher 和 GParted 在板子的图形桌面中操作；SSH 用于检查状态和执行命令。

---

## 1. 先认清启动链路

```text
上电
 └─ SPI Flash：U-Boot
     └─ NVMe 第一分区：启动脚本、内核、设备树、initramfs
         └─ NVMe 第二分区：Ubuntu 根文件系统
```

**SPI 里有引导程序，不等于 `/boot` 在 SPI 里。** 本文方案的 `/boot` 在 NVMe 上；SPI 负责找到它并继续引导。

迁移后的磁盘结构：

```text
SPI Flash                   16MB，保存引导程序
NVMe SSD                    119.2GiB
├── nvme0n1p1               1GiB，FAT，挂载 /boot
└── nvme0n1p2               118.2GiB，ext4，挂载 /
```

## 2. 确认源盘和目标盘

插着 TF 卡启动，执行：

```bash
findmnt -no SOURCE,FSTYPE /
findmnt -no SOURCE,FSTYPE /boot
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT
```

本机迁移前的源盘：

```text
/dev/mmcblk0p2 ext4       # 当前根分区
/dev/mmcblk0p1 vfat       # 当前启动分区

mmcblk0       59.5G
├─mmcblk0p1      1G vfat  opi_boot /boot
└─mmcblk0p2   57.8G ext4  opi_root /
nvme0n1      119.2G
```

| 用途 | 本机设备名 | 操作 |
|---|---|---|
| 源盘：TF 卡 | `/dev/mmcblk0` | 读取并克隆整块盘 |
| 目标盘：NVMe | `/dev/nvme0n1` | 覆盖为 TF 卡的副本 |
| SPI Flash | `/dev/mtdblock0` | 由安装工具写入引导程序 |

**以自己的 `lsblk` 输出为准。** 官方手册截图里的 TF 卡可能叫 `mmcblk1`，不能直接照抄。本机实际是 `mmcblk0`。

整盘克隆要求目标盘不小于源盘的实际容量，不只是大于已用空间。本例 128GB SSD 大于 64GB TF 卡，满足要求。

**目标 NVMe 上的现有分区和数据会被覆盖。** 如果此前在 SSD 上改过代码，而 TF 卡里没有这些修改，先把它们备份到其他存储设备。克隆不会合并两个系统。

## 3. 安装 SPI 引导：选项 7

保持 TF 卡启动，在板子终端执行：

```bash
sudo nand-sata-install
```

选择：

```text
7  Install/Update the bootloader on SPI Flash
```

确认 `Yes`，等待出现 `Done`。写入期间不要断电。

这里使用当前 Orange Pi 5 Ultra 系统附带的引导镜像，不要拿其他型号的 SPI 镜像混用。

这一步只安装引导程序，**系统复制由下一步的 Etcher 完成**。本教程不选择选项 4，也不需要提前用 `parted` 给 SSD 建单个 ext4 分区；整盘克隆会复制源盘的分区表。

## 4. 用 Etcher 克隆整块 TF 卡

先关闭 ROS 节点、下载、编辑器等会持续写盘的程序；数据库等服务要正常停止，然后执行：

```bash
sync
```

官方手册演示的是在 TF 卡系统运行时克隆。关闭写入任务可以降低文件不一致的风险，但 `sync` 不会冻结文件系统，Etcher 校验通过也不代表应用数据具有事务一致性。需要严格一致的副本时，应先正常关机，再通过读卡器和 SSD 硬盘盒在另一台电脑上离线克隆。

本机官方桌面系统已经安装 Etcher。从应用菜单打开，或者在板子的桌面终端运行：

```bash
/opt/balenaEtcher/balena-etcher-electron
```

如果这个路径不存在，先检查桌面菜单或官方手册的软件安装说明，不要随意下载其他架构的安装包。

按以下顺序操作：

1. 点击 **Clone drive**。
2. 源盘选择 **`/dev/mmcblk0`**，容量约 64GB／59.5GiB。
3. 点击 **Select target**；看不到 SSD 时展开 **Show hidden**。
4. 目标选择 **`/dev/nvme0n1`**，容量约 128GB／119.2GiB。
5. 再核对一次源盘和目标盘，点击 **Flash**。
6. 确认覆盖提示，输入板子当前用户的密码。
7. 等待复制和校验全部成功，期间不要继续修改系统或项目。

**源盘选整块 `mmcblk0`，不是 `mmcblk0p1` 或 `mmcblk0p2`。** 启动分区和根分区都要复制。

如果复制或校验失败，先排查错误，不要把失败的副本当作可启动系统继续使用。

复制完成后检查：

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT
```

此时应该看到：

```text
nvme0n1      119.2G
├─nvme0n1p1      1G vfat  opi_boot
└─nvme0n1p2   57.8G ext4  opi_root
```

第二分区仍和 TF 卡一样大，这是正常的；剩余空间下一步扩容。如果仍只有原来的一个 ext4 分区，先确认 Etcher 是否完成，以及内核是否刷新了分区表。

## 5. 扩容 NVMe 根分区

在 Orange Pi 桌面终端运行：

```bash
sudo gparted
```

如果未安装：

```bash
# 在 Orange Pi 的 Ubuntu 上执行
sudo apt update
sudo apt install gparted
```

操作顺序：

1. 右上角选择 **`/dev/nvme0n1`，119.2GiB**。
2. 如果提示 GPT 没有使用整块磁盘空间，确认提示对象是 NVMe 后选择 **Fix**。
3. 如果 NVMe 分区被桌面自动挂载，先右键 **Unmount**；不要卸载正在运行的 TF 卡根分区。
4. 右键 **`/dev/nvme0n1p2` → Resize/Move**。
5. **保持左边界不变，只将右边界拖到最右端**，使用后面的空闲空间。
6. 点击 **Resize/Move → 绿色勾号 → Apply**，等待完成。

第一个 FAT 分区保持不动。GParted 会同时处理分区和 ext4 文件系统的扩容。

再次检查：

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT
```

本机结果：

```text
nvme0n1      119.2G
├─nvme0n1p1      1G vfat  opi_boot
└─nvme0n1p2  118.2G ext4  opi_root
```

## 6. 关机拔卡，验证独立启动

```bash
sync
sudo poweroff
```

等关机完成后断电，拔掉 TF 卡，再重新上电。验证不依赖串口时，也要断开 USB-TTL。

**克隆会复制文件系统 UUID 和分区标识。首次测试必须拔掉 TF 卡**，避免系统混用两块盘的分区。原卡先保留作救援备份；需要长期同时连接两块盘时，再单独处理标识冲突，并同步修改对应的引导配置和 `fstab`。

进入系统后执行：

```bash
# 两项都要在 NVMe 上，不能只看根分区
findmnt -no SOURCE,FSTYPE /
findmnt -no SOURCE,FSTYPE /boot

# 确认文件系统容量也已扩展
df -h / /boot

# 查看本次内核实际收到的根分区参数
cat /proc/cmdline
```

本机迁移后的实际输出：

```text
/dev/nvme0n1p2 ext4
/dev/nvme0n1p1 vfat

文件系统          容量  已用  可用  已用% 挂载点
/dev/nvme0n1p2    117G   12G  104G    11% /
/dev/nvme0n1p1   1022M  121M  902M    12% /boot
```

`lsblk` 中的分区大小与 `df` 中的文件系统容量略有差异，是正常现象。

到这里可以确认系统和启动文件都在 SSD 上。再检查自己的 ROS 工作区、用户文件和常用服务是否完整。

## 7. 验证启动稳定性

一次启动成功只能证明这一轮正常。尤其是此前出现过偶发故障的机器，建议保持 TF 卡、TTL 都断开，分别测试：

- 3 次正常重启：`sudo reboot`
- 3 次冷启动：`sudo poweroff`，关机完成后断电约 10 秒，再上电

每次都确认能进入系统，且 `/`、`/boot` 仍来自 NVMe。不要在系统运行时直接拔电源来模拟冷启动。

本文记录的是迁移、扩容以及一次拔卡后的挂载验证结果，不把尚未完成的多次启动测试当作已通过。

## 8. 这次踩过的坑

### 选项 4 搬迁与整盘克隆不是同一种结果

`nand-sata-install` 的选项 4 确实支持“SPI 引导、系统在 NVMe”。本机此前走这条路径时，目标是单个 ext4 分区，`/boot` 成为根分区中的普通目录；整盘克隆则保留 TF 卡原来的 FAT＋ext4 双分区结构。

单 ext4 分区本身不代表错误，但不能用“脚本支持”推导出“这台板子上一定稳定”。本机曾经从旧布局成功启动，也曾间歇性读取不到 `orangepiEnv.txt`。

失败时的链路是：

```text
orangepiEnv.txt 没有成功加载
 └─ boot.cmd 保留默认 rootdev=/dev/mmcblk0p1
     └─ 内核启动后寻找 TF 卡根分区
         └─ ALERT! /dev/mmcblk0p1 does not exist
```

后来在脚本中增加读取状态标记，确实观察到加载失败。把默认根分区改成 NVMe UUID 能兜底，但没有解释为什么读取失败，也不能据此宣布故障彻底解决。

本教程保留已能正常工作的 TF 卡分区布局，减少迁移引入的差异。旧布局的读取故障究竟来自 U-Boot 文件系统实现、NVMe 访问时序还是其他因素，需要失败时的完整串口日志进一步定位，不能直接归咎于 ext4。

### 插卡救援后，别改错 `/boot`

插回 TF 卡进入系统后，直接编辑 `/boot/orangepiEnv.txt`，可能改到 TF 卡那份。先用 `findmnt /boot` 确认来源。

需要检查 SSD 的配置时，在 TF 卡救援系统中显式挂载 NVMe 分区：

```bash
# 先检查挂载状态，避免重复挂载；以下只读挂载用于检查
lsblk -o NAME,FSTYPE,MOUNTPOINT
sudo mkdir -p /mnt/nvme-boot
sudo mount -o ro /dev/nvme0n1p1 /mnt/nvme-boot
cat /mnt/nvme-boot/orangepiEnv.txt
sudo umount /mnt/nvme-boot
```

由于克隆产生相同 UUID，插卡救援也可能混用分区。若启动来源不明确，先关机断电、暂时取下 NVMe，再确认 TF 卡可以独立启动；不要带电拆装 NVMe。

### 不要随意运行 `fix_mmc_ssd.sh`

官方手册提到这个脚本用于处理 TF 卡与 SSD 上相同系统带来的启动歧义。检查本机版本发现，它会将当前 `/boot/orangepiEnv.txt` 的 `rootdev` 改为 `/dev/mmcblk…p2`，并修改当前系统的 `/boot` 挂载项；它不是通用的 NVMe 修复工具，也不是给 SSD 生成新 UUID。

本教程通过关机拔掉 TF 卡完成首次验证，不需要运行这个脚本。其他镜像版本的实现可能不同，使用前先看脚本内容和当前挂载来源。

### 不插 TTL 黑屏，与 initramfs 报错要分开查

串口 RX 干扰有可能被 U-Boot 当作按键，打断自动启动；而已经显示 `ALERT! ... does not exist`，说明内核已经运行，排查重点应是根分区参数和设备识别。

如果有证据指向 RX 电平不稳定，可以检查板级上拉。本机尝试的接法是：

```text
物理 1 号脚（3.3V）── 4.7kΩ～10kΩ 电阻 ── 物理 10 号脚（UART2 RX）
```

只适用于已核对引脚定义的 Orange Pi 5 Ultra，务必断电接线；不要接 2／4 号脚的 5V，不要直接短接。**这不是所有迁移都必须做的一步**，加电阻后某次成功也不能单独证明根因。

## 9. 常用检查命令

```bash
findmnt /                              # 当前根分区来自哪块盘
findmnt /boot                          # 启动文件来自哪块盘
lsblk -o NAME,SIZE,FSTYPE,UUID,MOUNTPOINT
df -h / /boot                          # 文件系统容量、剩余空间
cat /proc/cmdline                      # 本次实际启动参数
cat /boot/orangepiEnv.txt               # 当前启动分区中的配置
cat /etc/fstab                         # 根分区、启动分区的挂载配置
sudo journalctl -b -k --no-pager        # 本次 Linux 内核日志，不包含完整 U-Boot 日志
```

## 参考

- 《OrangePi 5 Ultra RK3588 用户手册 v1.0》：第 57～58 页安装 SPI 引导，第 67～75 页克隆与扩容，第 61 页说明相同系统的 UUID 冲突。
- [Orange Pi 5 Ultra 官方 Wiki](http://www.orangepi.org/orangepiwiki/index.php/Orange_Pi_5_Ultra)：SPIFlash＋NVMe SSD 安装与调试串口说明。

本文设备名、容量和工具路径来自实际机器；其他型号或镜像版本请先核对，不要直接套用磁盘设备名。
