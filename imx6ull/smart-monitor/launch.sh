#!/bin/sh
# 运行前设置 MQTT_PASS；不将密码保存在文件中。
export QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0
export LANG=en_US.UTF-8
export QT_QPA_FONTDIR=/usr/share/fonts/ttf
export QT_PLUGIN_PATH=/usr/lib/plugins
export QT_QPA_EVDEV_TOUCHSCREEN_PARAMETERS=/dev/input/event1
unset QT_QPA_FB_TSLIB
cd /home/root/smart-monitor || exit 1
exec ./smart_monitor
