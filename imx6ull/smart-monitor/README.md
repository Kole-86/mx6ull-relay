# i.MX6ULL 智能监控终端（源码导出）

Qt 板端与 PyQt 桌面端：温度、AP3216C 光照、LED 和 V4L2 视频。板端通过 WSS mini 协议上报状态，桌面端通过同一中继读取数据并控制 LED。历史曲线和局域网 UDP 视频为原有功能。

本包不含云中继服务、账号、令牌、证书私钥、历史数据、二进制或设备配置。请自行部署兼容 `/mini/ws`、`codex-lab.v1`、`mini_state`、`mini_command`、`mini_result` 的中继，并使用自己的设备口令；仅部署本源码不能直接连上云端。LED 呼吸灯和摄像头远程控制目前未接入云端协议。

## 构建

需要适配目标的 Qt 5（Core/Gui/Widgets/Network）、ARM 交叉编译环境、Paho MQTT C 库（原板端代码仍依赖该库）。按环境修改 `build.sh` 中的 SDK 环境脚本，并在 qmake 之前设置 `PAHO_PREFIX` 为 Paho 安装前缀。示例：

```sh
export PAHO_PREFIX=/path/to/paho
./build.sh
```

板端按系统设置 Qt linuxfb 环境，配置 `/etc/imx6ull-temp-led-test/relay.conf` 为 root 所有、权限 600：

```ini
LAB_DEVICE_TOKEN=填写自己的设备口令
MODE=production
PROXY=
```

设置 `CLOUD_RELAY_HOST` 为自己中继的主机名（不含协议或路径），再运行板端程序。确保 CA 证书和系统时间正确；示例地址 `192.0.2.x` 必须替换成实际局域网地址。摄像头设备、分辨率、屏幕、触摸、传感器及 LED 路径依赖硬件，需要按实际设备适配。板端原有 MQTT 部分不参与桌面云端数据路径，可不配置密码。

## 桌面端

需要 Python 3、PyQt5、paho-mqtt（旧兼容代码仍引用）、Node.js 22 或提供全局 WebSocket 的版本。创建自己的私有口令文件（权限 600），内容为 `LAB_DEVICE_TOKEN=...`，通过环境变量配置：

```sh
export CLOUD_RELAY_HOST=your-relay.example.com
export CLOUD_TOKEN_FILE=/path/to/private-token-file
./pc/start.sh
```

不要把口令文件提交到代码仓库。视频依赖板端向电脑 UDP 5004 发送相应格式帧；上位机默认板子地址是文档示例地址，需在 `pc/monitor.py` 或本地配置中调整。

本包是从现有工作版本脱敏生成的源码快照；设备专用默认值已改为文档示例值。未包含开源许可证，发布前请由版权持有人自行选择并添加许可证，以及核对第三方依赖的许可。脱敏版未在另一台设备上实机验证。
