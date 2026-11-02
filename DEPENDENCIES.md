# 依赖与来源

语音模型由下载脚本另行获取。硬件驱动、字体和交叉编译 SDK 由设备运行环境提供，第三方组件遵循各自的许可证。

- 板端：Qt 5、Linux V4L2、I2C 和 Eclipse Paho C，具体配置见板端 README。
- 可选桌面监控工具 `imx6ull/smart-monitor/pc/`：Python、PyQt5、paho-mqtt。AI 助手使用项目根目录的 `npm start`。注意 PyQt5 的 GPL/商业许可选择。
- 语音：NumPy、SciPy、sherpa-onnx、OpenCC。版本记录在 requirements.txt。
- 语音模型：setup_models.py 从 sherpa-onnx 官方 GitHub 发布页下载 SenseVoice、Matcha、Vocos 和 Silero VAD；模型及训练数据许可需按对应发布内容核对。本包不重新分发权重。
- 相机：MaixPy、websockets，以及设备自带驱动和字体，均由使用者在自己的设备上提供。
- 可选网络代理：sing-box，使用者自行获取兼容版本并配置自己的节点；本包仅提供命令行管理脚本和不含凭据的示例配置。
- 中转站：Cloudflare Workers / Durable Objects、Wrangler。
- AI：调用使用者本机自己的 Codex 环境，不包含、导出或同步任何账号登录凭据。
- 天气：Open-Meteo，https://open-meteo.com/en/docs 。

Codex 接口资料：https://learn.chatgpt.com/docs/app-server 。
