#!/bin/bash
set -e
source /opt/fsl-imx-x11/4.1.15-2.1.0/environment-setup-cortexa7hf-neon-poky-linux-gnueabi
project_dir=$(cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$project_dir/build"
cd "$project_dir/build"
qmake ../smart_monitor.pro
make -j2
