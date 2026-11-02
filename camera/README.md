# MaixCAM 语音入口

MaixCAM Pro 的 Linux 系统介绍、sing-box 本机代理和 VPN 接入方式，见 [系统与联网说明](LINUX_NETWORK.md)。

把 `maixcam_voice.py` 和运行 `npm run configure` 生成的 `.local/camera/config.local.json` 放在相机同一目录，然后在 MaixVision 中运行脚本。先连好 Wi-Fi。

口令和中转地址只放私人配置里，不改源码。确实需要代理时，在电脑私人配置中填写 cameraUseProxy、cameraProxyHost、cameraProxyPort，再重新运行配置命令。

默认启用语音模式；需要图片提问时，可在相机私人配置中将 photo_enabled 设为 true。USB 视频需要单独配置。
