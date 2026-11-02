#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local sing-box controller for MaixCAM; no additional Python packages."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "maixcam-vpn.json")
BINARY = os.path.join(BASE, "sing-box")
PIDFILE = os.path.join(BASE, "maixcam-vpn.pid")
LOGFILE = os.path.join(BASE, "maixcam-vpn.log")

def load_config():
    with open(CONFIG, encoding="utf-8") as handle:
        return json.load(handle)

def api(method="GET", payload=None):
    settings = load_config()["experimental"]["clash_api"]
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "http://" + settings["external_controller"] + "/proxies/PROXY",
        data=data, method=method,
        headers={"Authorization": "Bearer " + settings["secret"],
                 "Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=3) as response:
        body = response.read()
    return json.loads(body) if body else {}

def current():
    try:
        return api().get("now")
    except (OSError, ValueError):
        return None

def start():
    if current():
        print("代理已经运行，当前节点：" + current())
        return
    os.chmod(CONFIG, 0o600)
    with open(LOGFILE, "ab") as log:
        checked = subprocess.run([BINARY, "check", "-c", CONFIG],
                                 stdout=log, stderr=log)
        if checked.returncode:
            print("配置检查失败，请查看日志：" + LOGFILE)
            return
        process = subprocess.Popen([BINARY, "run", "-c", CONFIG],
                                   stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log,
                                   start_new_session=True)
    with open(PIDFILE, "w", encoding="ascii") as handle:
        handle.write(str(process.pid))
    for _ in range(20):
        time.sleep(0.25)
        if current():
            print("代理已启动，当前节点：" + current())
            print("本机代理地址：http://127.0.0.1:7890")
            return
        if process.poll() is not None:
            break
    print("尚未确认启动成功，请查看日志：" + LOGFILE)

def choose():
    cfg = load_config()
    selector = next(p for p in cfg["outbounds"] if p["tag"] == "PROXY")
    selected = current()
    print("当前运行节点：" + (selected or "代理未运行"))
    names = selector["outbounds"]
    for number, name in enumerate(names, 1):
        marker = " ← 当前" if name == selected else ""
        if selected is None and name == selector["default"]:
            marker = " ← 默认"
        print("%2d. %s%s" % (number, name, marker))
    answer = input("输入节点编号；直接回车取消：").strip()
    if not answer:
        return
    if not answer.isdigit() or not 1 <= int(answer) <= len(names):
        print("编号无效。")
        return
    name = names[int(answer) - 1]
    if selected:
        api("PUT", {"name": name})
    selector["default"] = name
    temporary = CONFIG + ".tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(cfg, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, CONFIG)
    print("已选择并保存：" + name)

def test():
    if not current():
        print("请先选择 1 启动代理。")
        return
    inbound = load_config()["inbounds"][0]
    proxy = "http://127.0.0.1:%d" % inbound["listen_port"]
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    try:
        with opener.open(load_config().get("test_url", "https://www.cloudflare.com/cdn-cgi/trace"), timeout=20) as response:
            status = response.status
        print("HTTPS 测试返回状态：%s（200 表示本次测试通过）" % status)
        print("这只表示测试地址可访问；中转站、口令和 AI 助手还需要在聊天程序中确认。")
    except Exception as error:
        print("测试未通过：%s；可尝试切换节点或查看日志。" % type(error).__name__)

def stop():
    try:
        with open(PIDFILE, encoding="ascii") as handle:
            process_id = int(handle.read().strip())
        if process_id <= 1:
            raise ValueError()
        with open("/proc/%d/cmdline" % process_id, "rb") as handle:
            arguments = handle.read().split(b"\0")
        if os.fsencode(BINARY) not in arguments or os.fsencode(CONFIG) not in arguments:
            print("记录的进程不匹配，未执行停止。")
            return
        os.kill(process_id, signal.SIGTERM)
        os.unlink(PIDFILE)
        print("已发送停止请求。")
    except (OSError, ValueError):
        print("没有找到由此工具启动的代理进程。")

def main():
    print("MaixCAM 代理控制；退出菜单后代理可继续在后台运行。")
    actions = {"1": start, "2": choose, "3": test, "4": stop}
    while True:
        print("\n1 启动代理   2 选择节点   3 测试联网   4 停止代理   0 退出菜单")
        try:
            answer = input("请选择：").strip()
            if answer == "0":
                return
            action = actions.get(answer)
            if action:
                action()
        except (EOFError, KeyboardInterrupt):
            print("\n已退出菜单。")
            return
        except Exception as error:
            print("操作未完成：" + type(error).__name__)

if __name__ == "__main__":
    main()
