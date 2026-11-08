---
title: 在 ARM 开发板上用命令行跑 Clash
published: 2026-11-06
description: "在 Orange Pi 5 Ultra（arm64）上安装 mihomo，用 systemd 开机自启，配好规则分流与 TUN 一键开关，全程只用 SSH 和命令行。"
tags: ["mihomo", "Clash", "代理", "Orange Pi", "Linux"]
category: 教程
draft: false
---

环境：Orange Pi 5 Ultra（arm64），只有 SSH，无图形界面。

内核用 [mihomo](https://github.com/MetaCubeX/mihomo)（即 Clash.Meta）：单个静态二进制，纯命令行驱动。原版 `clash` 已于 2023 年停更，不要再用。

最终形态：

- 开机自动运行，监听 `127.0.0.1:7890`（HTTP + SOCKS5）
- 需要全局代理时 `clash on` 打开 TUN，`clash off` 关闭
- 网页面板通过 SSH 端口转发访问

---

## 1. 下载

在另一台能访问 GitHub 的机器上准备文件，再传到板子。

```bash
# mihomo 版本号，到 releases 页面看最新
VER=1.19.33

# 内核：linux / arm64 的静态二进制，官方以 .gz 压缩发布
curl -fLO https://github.com/MetaCubeX/mihomo/releases/download/v${VER}/mihomo-linux-arm64-v${VER}.gz

# 规则库
# geoip.metadb：IP 归属地库，规则里的 GEOIP,CN 依赖它
# geosite.dat ：域名分类库，规则里的 GEOSITE 依赖它
# 注意：内核首次启动会尝试自行下载这两个文件，目标机器不通 GitHub 时必须提前准备
BASE=https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest
curl -fLO $BASE/geoip.metadb
curl -fLO $BASE/geosite.dat

# 网页面板（可选），解压出来是一堆静态文件
curl -fLO https://github.com/MetaCubeX/metacubexd/releases/download/v1.274.4/compressed-dist.tgz
```

```bash
# 校验下载完整性：sha256 与 release 页面公布的值对照
sha256sum mihomo-linux-arm64-v${VER}.gz

# 确认架构，避免把 x86_64 的包传上去
gunzip -c mihomo-linux-arm64-v${VER}.gz | file -
# 期望输出：ELF 64-bit LSB executable, ARM aarch64, statically linked, stripped
```

## 2. 传输

```bash
# 方式一：rsync，会自己创建目标目录
rsync -av --progress ./ 用户名@板子IP:/tmp/mihomo/

# 方式二：先打包再 scp
tar czf /tmp/bundle.tgz -C ./ .
scp /tmp/bundle.tgz 用户名@板子IP:/tmp/
ssh 用户名@板子IP 'mkdir -p /tmp/mihomo && tar xzf /tmp/bundle.tgz -C /tmp/mihomo'
```

反向也可以——板子能连到你的机器时，在本地起个临时 HTTP 服务：

```bash
# 你的机器
cd /path/to/files && python3 -m http.server 8000

# 板子上
curl -O http://你的机器IP:8000/mihomo-linux-arm64-v1.19.33.gz
```

## 3. 安装

```bash
cd /tmp/mihomo

# 内核装到 PATH 里，755 保证可执行
sudo install -m 755 mihomo-linux-arm64-v1.19.33 /usr/local/bin/mihomo

# 配置目录：内核以 -d 参数指定的目录为工作目录
#   config.yaml   主配置
#   geoip.metadb  规则库
#   geosite.dat   规则库
#   providers/    订阅下载后缓存在这里
#   ui/           网页面板静态文件
sudo mkdir -p /etc/mihomo/providers /etc/mihomo/ui
sudo install -m 644 geoip.metadb geosite.dat /etc/mihomo/

# 解压面板；--strip-components=1 去掉压缩包顶层的目录结构
sudo tar xzf compressed-dist.tgz -C /etc/mihomo/ui --strip-components=1

mihomo -v
```

## 4. 配置

`sudo nano /etc/mihomo/config.yaml`：

```yaml
# ============ 监听 ============
mixed-port: 7890        # HTTP 与 SOCKS5 复用同一个端口
allow-lan: false        # 只监听 127.0.0.1；要让局域网设备也能用就改成 true
bind-address: "*"
mode: rule              # rule=按规则分流 / global=全部走代理 / direct=全部直连
log-level: info         # silent / error / warning / info / debug
ipv6: false             # 节点不支持 IPv6 时关掉，避免解析到 v6 地址后连不上

# ============ 控制接口 ============
external-controller: 127.0.0.1:9090   # RESTful API 与网页面板的地址
external-ui: ui                       # 面板目录，相对 -d 指定的工作目录
secret: ""                            # 设置后所有 API 请求需带 Bearer 认证

profile:
  store-selected: true  # 记住手动选中的节点，重启后恢复
  store-fake-ip: true   # 持久化 fake-ip 映射表

# ============ DNS ============
dns:
  enable: true
  listen: 0.0.0.0:1053
  enhanced-mode: fake-ip      # 对域名返回 198.18.x.x 的假地址，真实解析交给代理侧，规避污染
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:             # 以下域名不做 fake-ip，返回真实 IP（局域网设备、部分登录服务需要）
    - "*.lan"
    - "*.local"
    - "localhost.ptlogin2.qq.com"
  nameserver:                 # 国内 DNS，用于直连域名
    - https://223.5.5.5/dns-query
    - https://doh.pub/dns-query
  fallback:                   # 兜底 DNS，用于判定是否需要走代理
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query

# ============ 节点来源 ============
# 用 provider 而不是把节点写死：内核会自动下载并定期更新订阅
proxy-providers:
  airport:
    type: http                          # 从 URL 拉取
    url: "https://你的订阅链接"          # 必须是 Clash 格式的 yaml
    interval: 3600                      # 更新间隔（秒）
    path: ./providers/airport.yaml      # 落盘位置，相对工作目录
    proxy: DIRECT                       # 下载订阅本身的请求走直连
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204   # 用 204 探测，最省流量
      interval: 300                     # 探测间隔（秒）
    # 机场按 User-Agent 过滤订阅时打开：
    # header:
    #   User-Agent: ["clash-verge/v2.0.0"]

# ============ 策略组 ============
proxy-groups:
  - name: PROXY
    type: select                # 手动选择节点
    use: [airport]              # use 表示引入 provider 中的全部节点
  - name: AUTO
    type: url-test              # 自动选择延迟最低的节点
    use: [airport]
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50               # 延迟差小于 50ms 时不切换，避免频繁跳节点

# ============ 规则 ============
# 自上而下匹配，命中即停。最后一条 MATCH 是兜底
rules:
  - DOMAIN-SUFFIX,你的订阅域名,DIRECT   # 见下方说明
  - DOMAIN-SUFFIX,cn,DIRECT            # .cn 域名直连
  - GEOIP,CN,DIRECT                    # 解析到国内 IP 的直连
  - MATCH,PROXY                        # 其余全部走代理

# ============ TUN ============
# 默认关闭，由 clash on 通过 API 临时开启
tun:
  enable: false
  stack: system               # system 性能好；兼容性优先可换 gvisor / mixed
  dns-hijack: ["any:53"]      # 劫持发往 53 端口的 DNS 查询
  auto-route: true            # 自动接管默认路由
  auto-detect-interface: true # 自动识别出口网卡
```

**关于第一条 DIRECT 规则**：内核下载订阅时，这个请求本身也会经过规则引擎。若没有任何规则放行，它会命中 `MATCH,PROXY` 进入策略组，而策略组的节点正是要靠这次订阅才有——互相等待。所以策略组里的 `proxy: DIRECT` 和这条规则要同时存在，且规则必须放在最前面。

配置写完后先校验，不要直接重启：

```bash
# -t 只解析配置并退出，不启动监听
sudo mihomo -t -d /etc/mihomo
# 输出 configuration file ... test is successful 即通过
```

## 5. 开机自启

```bash
sudo tee /etc/systemd/system/mihomo.service >/dev/null <<'EOF'
[Unit]
Description=mihomo
After=network-online.target        # 等网络就绪再启动
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mihomo -d /etc/mihomo
Restart=on-failure                 # 异常退出自动拉起
RestartSec=3
LimitNOFILE=65535                  # 连接数上限，代理场景容易撞到默认值

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mihomo     # enable 开机自启，--now 立即启动

sudo systemctl status mihomo --no-pager
journalctl -u mihomo -n 30 --no-pager  # 看日志
```

改完配置后两种生效方式：

```bash
sudo systemctl restart mihomo                     # 重启，连接会断

# 或热加载，不断现有连接
curl -X PUT http://127.0.0.1:9090/configs \
  -H 'Content-Type: application/json' \
  -d '{"path":"/etc/mihomo/config.yaml"}'
```

## 6. 验证

```bash
# 1. 走代理能否访问
curl -x http://127.0.0.1:7890 -I https://www.google.com --max-time 15
# 期望 HTTP/2 200

# 2. 出口 IP 应为节点地址，而不是本地公网 IP
curl -x http://127.0.0.1:7890 -s https://api.ipify.org; echo

# 3. 国内域名应直连（响应应在几十毫秒量级）
curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' https://www.baidu.com
```

查询策略组与节点状态：

```bash
curl -s http://127.0.0.1:9090/proxies | python3 -m json.tool | head -40
curl -s http://127.0.0.1:9090/providers/proxies | python3 -m json.tool | head -20
```

## 7. 给单个命令配置代理

TUN 未开启时，程序不会自动走代理，需要显式指定。

```bash
# 当前 shell 的全部请求走代理
export http_proxy=http://127.0.0.1:7890
export https_proxy=$http_proxy
export all_proxy=socks5://127.0.0.1:7890

# 用完撤销
unset http_proxy https_proxy all_proxy
```

`sudo` 默认不继承环境变量，前缀加 `-E`，或用 `env` 显式传递：

```bash
sudo -E apt update
# 若提示 "you are not allowed to preserve the environment"：
sudo env http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 apt update
```

让 `apt` 永久走代理：

```bash
sudo tee /etc/apt/apt.conf.d/95proxy >/dev/null <<'EOF'
Acquire::http::Proxy "http://127.0.0.1:7890";
Acquire::https::Proxy "http://127.0.0.1:7890";
EOF
```

写进 `~/.bashrc` 做成开关别名：

```bash
echo 'alias proxyon="export http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890"' >> ~/.bashrc
echo 'alias proxyoff="unset http_proxy https_proxy all_proxy"' >> ~/.bashrc
```

## 8. TUN 与一键开关

TUN 模式会创建一块虚拟网卡并接管默认路由，此后所有流量自动按规则分流，无需任何环境变量。代价是需要 root 权限，且节点故障时整机外网中断，因此做成开关而非常开。

mihomo 支持运行时切换，无需重启：

```bash
# 打开
curl -X PATCH http://127.0.0.1:9090/configs \
  -H 'Content-Type: application/json' \
  -d '{"tun":{"enable":true,"stack":"system","dns-hijack":["any:53"],"auto-route":true,"auto-detect-interface":true}}'

# 关闭
curl -X PATCH http://127.0.0.1:9090/configs \
  -H 'Content-Type: application/json' \
  -d '{"tun":{"enable":false}}'
```

封装成 `/usr/local/bin/clash`：

```bash
#!/usr/bin/env bash
# 用法: clash {on|off|tun|notun|status|restart}
set -uo pipefail

API="http://127.0.0.1:9090"
SECRET=""          # 与 config.yaml 里的 secret 保持一致，留空表示不认证
UNIT="mihomo"

AUTH=()
[ -n "$SECRET" ] && AUTH=(-H "Authorization: Bearer $SECRET")

# 开 TUN 时要给出完整参数：未提供的字段会沿用上次的值
TUN_ON='{"tun":{"enable":true,"stack":"system","dns-hijack":["any:53"],"auto-route":true,"auto-detect-interface":true}}'
TUN_OFF='{"tun":{"enable":false}}'

die() { echo "✗ $*" >&2; exit 1; }

api() {
    local method=$1 path=$2 body=${3:-}
    if [ -n "$body" ]; then
        curl -fsS -m 8 -X "$method" "${AUTH[@]}" -H 'Content-Type: application/json' -d "$body" "$API$path"
    else
        curl -fsS -m 8 -X "$method" "${AUTH[@]}" "$API$path"
    fi
}

# 等 API 就绪，避免刚 systemctl start 就请求导致连接被拒
wait_api() {
    for _ in $(seq 1 30); do
        curl -fsS -m 1 "${AUTH[@]}" "$API/version" >/dev/null 2>&1 && return 0
        sleep 0.3
    done
    return 1
}

svc_active() { systemctl is-active --quiet "$UNIT"; }

# 读取当前 TUN 状态
tun_state() {
    api GET /configs 2>/dev/null |
        python3 -c 'import sys,json;print("on" if (json.load(sys.stdin).get("tun") or {}).get("enable") else "off")' 2>/dev/null ||
        echo "unknown"
}

case "${1:-status}" in
on | start)
    svc_active || sudo systemctl start "$UNIT" || die "服务启动失败，检查 journalctl -u $UNIT"
    wait_api || die "API 无响应，检查端口与 secret"
    api PATCH /configs "$TUN_ON" >/dev/null || die "TUN 开启失败，检查 /dev/net/tun 是否存在"
    sleep 1
    echo "TUN 已开启，默认路由：$(ip route show default | head -1)"
    ;;
off | stop)
    api PATCH /configs "$TUN_OFF" >/dev/null 2>&1 || true   # 先撤路由
    sudo systemctl stop "$UNIT" || die "停止失败"            # 再停服务
    echo "mihomo 已停止"
    ;;
tun)
    svc_active || die "服务未运行，先执行 clash on"
    api PATCH /configs "$TUN_ON" >/dev/null
    echo "TUN 已开启"
    ;;
notun)
    api PATCH /configs "$TUN_OFF" >/dev/null 2>&1 || true
    echo "TUN 已关闭"
    ;;
restart)
    sudo systemctl restart "$UNIT" && wait_api && echo "已重启"
    ;;
status)
    printf '服务    : %s\n' "$(svc_active && echo running || echo stopped)"
    printf 'TUN     : %s\n' "$(tun_state)"
    printf '默认路由: %s\n' "$(ip route show default 2>/dev/null | head -1 || echo '-')"
    svc_active && printf '出口 IP : %s\n' \
        "$(curl -s --max-time 8 -x http://127.0.0.1:7890 https://api.ipify.org 2>/dev/null || echo 获取失败)"
    ;;
*)
    echo "用法: clash {on|off|tun|notun|status|restart}" >&2
    exit 2
    ;;
esac
```

安装并免密（只对这一个服务放行）：

```bash
sudo install -m 755 clash /usr/local/bin/clash

sudo tee /etc/sudoers.d/50-mihomo >/dev/null <<'EOF'
orangepi ALL=(root) NOPASSWD: /usr/bin/systemctl start mihomo, /usr/bin/systemctl stop mihomo, /usr/bin/systemctl restart mihomo, /usr/bin/systemctl is-active mihomo
EOF
sudo chmod 440 /etc/sudoers.d/50-mihomo
sudo visudo -c     # 必须输出 parsed OK，否则立即删除该文件
```

## 9. 网页面板

```bash
# 把远端的 9090 映射到本地 9090
ssh -L 9090:127.0.0.1:9090 用户名@板子IP
```

浏览器打开 `http://127.0.0.1:9090/ui`。面板只能查看节点、测延迟、切换策略组——订阅必须在 `config.yaml` 的 `proxy-providers` 里配置，内核没有「导入订阅」这个接口。

## 10. 常用命令

```bash
clash on            # 启动服务并开启 TUN（全局代理）
clash off           # 关闭 TUN 并停止服务
clash tun           # 仅开启 TUN，保留 7890 端口
clash notun         # 仅关闭 TUN
clash status        # 服务 / TUN / 默认路由 / 出口 IP
clash restart       # 重启内核

mihomo -t -d /etc/mihomo                      # 校验配置
sudo systemctl restart mihomo                 # 重启
journalctl -u mihomo -f                       # 跟踪日志
curl -s 127.0.0.1:9090/proxies | python3 -m json.tool   # 查看节点
```

## 附：目录结构

```
/etc/mihomo/
├── config.yaml          主配置
├── geoip.metadb         IP 归属地库
├── geosite.dat          域名分类库
├── cache.db             运行时缓存（自动生成）
├── providers/
│   └── airport.yaml     订阅缓存，由内核自动更新
└── ui/                  网页面板静态文件
```
