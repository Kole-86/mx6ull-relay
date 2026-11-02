# MaixCAM Pro 的 Linux 系统与 VPN／代理接入

## 先了解设备系统

MaixCAM Pro 是运行嵌入式 Linux 的 AI 开发设备。MaixPy 提供摄像头、屏幕、麦克风和扬声器等 Python 接口，MaixVision 用于编程、运行和调试；通过 MaixVision 终端或 SSH，还可以管理设备文件和后台进程。[官方 Linux 基础说明](https://wiki.sipeed.com/maixpy/doc/zh/basic/linux_basic.html)

MaixCAM 系列的官方系统采用 Linux 内核和 Buildroot 构建的文件系统。MaixCAM Pro 基于 SG2002，支持运行 Linux 的 RISC-V 大核；安装软件前应先确认实际固件和架构，选择匹配的可执行文件。[硬件说明](https://wiki.sipeed.com/hardware/zh/maixcam/maixcam_pro.html)

在相机终端查看：

```sh
uname -m
uname -r
```

本项目曾在 `riscv64`、Linux 5.10.4 的设备上运行 sing-box 1.14.4，完成本机代理启动和 HTTPS 联网测试。其他固件以实际输出为准；软件架构、运行库及版本兼容性需要自行确认。

## 本项目采用哪种联网方式

本项目采用 **sing-box 本机代理 + 程序显式使用 HTTP CONNECT** 的方式：

```text
相机上的聊天程序
  → 127.0.0.1:7890（相机自身的 sing-box HTTP 代理入口）
  → 使用者自己的代理节点
  → Cloudflare 中转站的 443 端口
  → 隧道内完成 TLS / WebSocket 握手
```

sing-box 的 mixed 入口可同时接收 HTTP 和 SOCKS 代理请求，本项目客户端使用其中的 HTTP CONNECT。[mixed 入口说明](https://sing-box.sagernet.org/configuration/inbound/mixed/)

这里的“VPN接入”具体指应用层代理：聊天程序明确连接本机代理，其他应用是否走代理取决于各自配置。本方案不要求启用 TUN 或接管整台设备的路由。此前只确认过 `/dev/net/tun` 节点存在，尚未验证系统级 TUN VPN 的完整连接。

如果设备可以直接访问自己的中转站，可保持 `cameraUseProxy: false`，跳过代理配置。

## 1. 准备 sing-box 和自己的节点配置

从 [sing-box 官方发布页](https://github.com/SagerNet/sing-box/releases) 获取与设备架构、固件兼容的版本。将可执行文件重命名为 `sing-box`，与本目录的 `network/vpn-control.py` 放到相机同一目录，例如：

```text
/root/ai-terminal-network/
  sing-box
  vpn-control.py
  maixcam-vpn.json
```

`maixcam-vpn.json` 是使用者自己的私人配置。可从 [示例配置](network/maixcam-vpn.example.json) 复制后修改；示例中的 Trojan 出站只是格式示例，需要替换为自己实际使用的节点协议和参数，不包含可用服务。

为配合管理脚本，自己的配置应保留：

- mixed 入口：`127.0.0.1:7890`。
- 名为 `PROXY` 的 selector，列出自己的节点标签。
- Clash API 管理入口：`127.0.0.1:9090`，并设置自己的随机管理密钥。

代理密码、节点参数和管理密钥只填写到私人 `maixcam-vpn.json`。它们与项目的 `deviceToken`、`bridgeToken` 用途不同，不应混用。源码包不包含这些真实值，也不包含 sing-box 二进制。

在相机终端检查：

```sh
cd /root/ai-terminal-network
chmod 755 sing-box
chmod 600 maixcam-vpn.json
./sing-box version
./sing-box check -c maixcam-vpn.json
```

配置检查通过后，再运行管理脚本。

## 2. 启动和测试代理

```sh
python3 /root/ai-terminal-network/vpn-control.py
```

| 输入 | 操作 |
| --- | --- |
| `1` | 检查配置并启动后台代理。 |
| `2` | 选择节点，并保存选择结果。 |
| `3` | 通过本机 HTTP 代理访问 HTTPS 测试地址。 |
| `4` | 停止由该工具启动的代理。 |
| `0` | 退出管理菜单，保持后台代理运行。 |

测试返回 200，表示该 HTTPS 测试地址此次访问成功。之后仍需用聊天程序确认中转站连接、设备口令和 AI 服务端是否正常。

当前工具没有配置开机自启；设备断电或重启后，需要重新启动代理。运行日志 `maixcam-vpn.log` 和进程记录保存在脚本所在目录，留在自己的设备上即可。

## 3. 让聊天程序使用代理

在电脑端私人 `config.local.json` 中设置以下三项，其余配置保持不变：

```json
{
  "cameraUseProxy": true,
  "cameraProxyHost": "127.0.0.1",
  "cameraProxyPort": 7890
}
```

运行 `npm run configure`，将更新后的 `.local/camera/config.local.json` 上传到相机，与 `maixcam_voice.py` 放在同一目录。先启动代理，再运行聊天程序。

`127.0.0.1` 指相机自身，不是电脑或 IMX6ULL 的地址。仅启动 sing-box 不会自动让聊天程序使用它，必须同步上述配置。

正常连接时，聊天程序会依次提示：通过本机代理建立隧道、HTTP CONNECT 已建立、TLS / WebSocket 握手、连接成功。请保留 TLS 证书校验。

## 常见问题

| 现象 | 检查方向 |
| --- | --- |
| 可执行文件无法运行或提示格式错误 | 确认下载架构与 `uname -m` 一致，并检查运行库兼容性和执行权限。 |
| 连接 `127.0.0.1:7890` 被拒绝 | sing-box 是否运行、入口端口是否正确、配置检查是否通过。 |
| 代理已启动，但联网测试失败 | 检查自己的节点、DNS、路由及运行日志，可切换节点重试。 |
| CONNECT 成功，TLS 握手失败 | 检查设备时间、CA证书和目标域名。 |
| 中转站连接成功，但提示 `cloud offline` | 检查 AI 服务端是否运行；这是中转站没有找到在线 AI 接收端的提示。 |

详细配置以使用的 sing-box 版本为准：[selector](https://sing-box.sagernet.org/configuration/outbound/selector/)、[Clash API](https://sing-box.sagernet.org/configuration/experimental/clash-api/)。
