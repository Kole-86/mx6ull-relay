# -*- coding: utf-8 -*-
"""MaixCAM Pro 触摸屏 + 按住说话 AI 聊天客户端（在 MaixVision 中运行）。

在 maixcam_relay_client.py 的基础上改写，联网部分（sing-box 本机代理 HTTP CONNECT、
TLS 证书校验、断线重连、cloud offline 重发）保持不变，新增：
  * 触摸屏界面：顶部连接状态，中间可拖动滚动的聊天区（中文自动换行），
    底部输入框 + 发送、快捷问题（QUICK_QUESTIONS）、英文 / 拼音 / 数字键盘；
  * 「按住说话」：按住录音（16 kHz 单声道 16 位 PCM，最长 VOICE_MAX_SECONDS 秒），
    松开后分块上传到云端识别，识别结果显示成「我」的气泡，再显示 AI 回答。
识别和语音合成由电脑端完成，MaixCAM 接收语音文件并播放。

联网放在后台线程的 asyncio 循环里，界面主循环不会被阻塞，两边用线程安全队列传数据。

参考的 MaixPy 官方文档 / 例程：
  屏幕       https://wiki.sipeed.com/maixpy/doc/zh/vision/display.html
  触摸       https://wiki.sipeed.com/maixpy/doc/zh/vision/touchscreen.html
  画图/字体  https://wiki.sipeed.com/maixpy/doc/zh/vision/image_ops.html
  录音       https://wiki.sipeed.com/maixpy/doc/zh/audio/record.html
  播放       https://wiki.sipeed.com/maixpy/doc/zh/audio/play.html
  WebSocket  https://wiki.sipeed.com/maixpy/doc/zh/network/websocket.html
使用前先连接网络；仅在需要时自行配置相机本地代理。
"""

# 私人配置单独上传，源码不存放口令。
import json as _config_json
import os as _config_os
_device_config_path = _config_os.path.join(_config_os.path.dirname(_config_os.path.abspath(__file__)), "config.local.json")
with open(_device_config_path, "r", encoding="utf-8") as _config_handle:
    _device_config = _config_json.load(_config_handle)
if not str(_device_config.get("relay_url", "")).startswith("wss://") or not _device_config.get("device_token"):
    raise RuntimeError("请先配置自己的中转地址和设备口令")
# ======== 设备配置 ========
USE_PROXY = bool(_device_config.get("use_proxy", False))
PROXY_HOST = str(_device_config.get("proxy_host", "127.0.0.1"))
PROXY_PORT = int(_device_config.get("proxy_port", 7890))
RELAY_URL = str(_device_config["relay_url"]).rstrip("/")
RELAY_TOKEN = str(_device_config["device_token"])
DEVICE_ID = str(_device_config.get("device_id", "maixcam_01"))
REPLY_TIMEOUT = 10      # 等云端「已收到」确认的秒数（超时只提示，继续等回答）
AI_TIMEOUT = 240
CONNECT_TIMEOUT = 30    # 建立连接的超时秒数
RETRY_DELAY = 5         # 断线后重试间隔秒数
OFFLINE_RETRIES = 0
QUEUE_CAPS = False
QUEUE_WARN_AFTER = 90   # 在中转排队超过这么多秒，提示用户电脑助手还没上线
QUEUE_GIVEUP = 300      # 排队超过这么多秒就放弃（与中转的排队过期时间一致）
DUP_TEXT_WINDOW = 120   # 同一句话还在排队/等回答时，这么多秒内再点一次不重复发送
PING_INTERVAL = 20      # 保活 ping 间隔秒数（websockets 库自带）
PING_TIMEOUT = 20
SSL_VERIFY = True       # wss 证书校验；板子若缺 CA 证书导致握手失败，可临时改 False 仅作测试
CA_FILE = None          # 可选：自带 CA 证书文件路径；None 时优先用 certifi，再用系统证书

# 快捷问题（点一下直接发送），建议 6 个
QUICK_QUESTIONS = [
    "你好，介绍一下你自己",
    "今天适合做什么？",
    "讲一个简短的笑话",
    "推荐一本好书",
    "用一句话解释人工智能",
    "给我一句鼓励的话",
]

# 屏幕与字体（MaixCAM Pro 屏幕为 640x480，程序按 disp.width()/height() 自动适配）
FONT_PATH = "/maixapp/share/font/SourceHanSansCN-Regular.otf"   # 系统自带中文字体
FONT_SIZE = 22          # 聊天区字号
FONT_SIZE_SMALL = 18    # 按钮 / 键盘字号

# 语音（按住说话 → 上传云端识别）
VOICE_ENABLED = True
VOICE_SAMPLE_RATE = 16000   # 上传格式固定 16 kHz 单声道 pcm_s16le
VOICE_MAX_SECONDS = 15      # 单次最长录音秒数
VOICE_MIN_SECONDS = 0.5     # 太短的录音不上传
MIC_VOLUME = 100            # 麦克风音量 0~100
AUDIO_CHUNK_BYTES = 2400    # 每块原始 PCM 字节数（base64 后约 3.2 KB，整帧 < 4 KB）
AUDIO_CHUNK_GAP = 0.02      # 两块之间的间隔秒数，避免一下子塞满中继
PLAY_DING = False
PART_IDLE_TIMEOUT = 60      # 分段回答：最后一段（final）迟迟不来时，最多显示「…」多少秒
RESEND_ASK_AFTER = 3        # 发现缺段（有 final 但中间缺）后等几秒再向云端要补发
FINAL_WAIT = 20             # 已收到部分段但没有 final：最后一段到达后多少秒没新段就问一次云端
RESEND_ASK_MAX = 5          # 同一条回答最多请求补发几次（间隔逐次翻倍）
REPLY_KEEP = 600            # 已完整的回答记录保留多少秒（用来识别重复段）
WRAP_MARGIN = 6             # 换行时每行预留的像素，防止 MaixPy draw_string 自己再折行
SPEAKER_VOLUME = 60
# 云端语音播放（v3 实验，见 TTS_CHANGES.md）：云端把合成好的 16 kHz 单声道 s16le PCM 分块发来，板子收齐后播放
TTS_ENABLED = True          # 回 hello 时声明支持 tts；False 时不声明，云端就不会发语音
TTS_MAX_BYTES = 320000      # 一段语音最多多少字节（约 10 秒），更大的直接拒收
TTS_RESEND_WAIT = 1.0       # 收到 tts_end 后发现缺块：等这么多秒再向云端要补发（每轮）
TTS_RESEND_MAX = 2          # 最多要几轮补发，之后放弃（显示「语音播放失败」）
TTS_END_TIMEOUT = 4.0       # 收到块之后这么多秒没等到 tts_end，当作已结束（按缺块处理）
TTS_PLAY_BLOCK = 3200       # 每次交给喇叭的字节数（0.1 秒），方便中途被新语音 / 按住说话打断
TTS_BUSY_WAIT = 15          # 正在按住说话时，语音最多等多少秒再播；还在录音就放弃
# 拍照提问（v5，见 IMAGE_CHANGES.md）：点「拍照」拍一张，下一个问题（按住说话或文字）带上这张照片
PHOTO_ENABLED = bool(_device_config.get("photo_enabled", False))
PHOTO_W, PHOTO_H = 640, 480
PHOTO_QUALITY = 90          # 640x480 q90 实测约 33 KB，上传 14 帧（q70 17 KB 偏糊）
FOCUS_AID = True            # 取景界面显示「清晰度 N」（中心小块的拉普拉斯方差，每 FOCUS_EVERY 帧算一次），拧镜头到 N 最大
FOCUS_EVERY = 10            # 每几帧算一次清晰度（约 1~2 ms/次，摊到每帧 < 0.2 ms）
FOCUS_WARN_RATIO = 0.6      # 照片清晰度低于本次取景最高值的 60% → 确认界面提示「可能有点虚」
PREVIEW_FPS_LOG = 5         # 取景时每隔几秒在控制台打一行实测 fps
PHOTO_WARMUP = 3            # 摄像头一直开着：拍照时先丢掉几帧旧缓冲，拿最新画面
PHOTO_BUFF_NUM = 2          # 摄像头缓冲帧数（默认 3；2 省约 0.9 MB）
PREVIEW_TIMEOUT = 90        # 取景 / 确认界面这么多秒没操作就自动回聊天
PHOTO_TTL = 120             # 拍好后这么多秒没用就作废；用过一次也作废
THUMB_W, THUMB_H = 160, 120
IMAGE_CHUNK_BYTES = 2400    # 每块原始字节（base64 后 3200，整帧 < 4 KB）
IMAGE_ACK_TIMEOUT = 8       # 发完 image_end 后等云端 image_ack 的秒数，超时从头重传
IMAGE_MAX_TRIES = 3         # 最多传几遍（首次 + 2 次重传），之后算失败
IMAGE_KEEP = 300            # 网络线程里照片记录最多保留多少秒
# ================================

import asyncio
import base64
import gc
import http.client
import inspect
import json
import math
import queue
import random
import ssl
import struct
import sys
import threading
import time
import zlib
from urllib.parse import urlsplit
try:
    from urllib.parse import quote
except Exception:
    quote = lambda x: x

import websockets

try:
    from maix import app as _maix_app   # 在板子上可用，用于响应 MaixVision 的停止按钮
except Exception:
    _maix_app = None

_stop_flag = threading.Event()          # 程序内部的退出标志（退出按钮 / 自测用）


def need_exit():
    if _stop_flag.is_set():
        return True
    return _maix_app is not None and _maix_app.need_exit()


def request_exit():
    _stop_flag.set()
    if _maix_app is not None:
        try:
            _maix_app.set_exit_flag(True)
        except Exception:
            pass


# 控制台统一按 UTF-8 输出（板子 locale 不是 UTF-8 时 print 中文也不会出错）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except Exception:
    pass

_ZERO_WIDTH = set("\u200b\u200c\u200d\u2060\ufeff\ufe0e\ufe0f")


def to_text(s):
    """把任何输入变成干净的 str：bytes 按 UTF-8 解码；去掉控制字符、零宽字符、孤立代理项；
    思源黑体里没有的 emoji 等（U+10000 以上）换成「□」。之后所有切片都按字符（码点）进行。"""
    if s is None:
        return ""
    if isinstance(s, (bytes, bytearray)):
        s = bytes(s).decode("utf-8", "replace")
    s = str(s).replace("\r\n", "\n").replace("\r", "\n").replace("\t", "  ")
    out = []
    for ch in s:
        o = ord(ch)
        if ch == "\n":
            out.append(ch)
        elif o < 0x20 or 0x7f <= o < 0xa0 or ch in _ZERO_WIDTH or 0xd800 <= o <= 0xdfff:
            continue
        elif o > 0xffff:
            out.append("□")
        else:
            out.append(ch)
    return "".join(out)


def log(stage, msg):
    msg = to_text(msg)
    if RELAY_TOKEN:
        msg = msg.replace(RELAY_TOKEN, "***")
    t = time.time()
    line = "[%s.%03d][%s] %s\n" % (time.strftime("%H:%M:%S", time.localtime(t)), int(t * 1000) % 1000, stage, msg)
    # 整行一次写出并立即 flush，尽量不让控制台把一个汉字的 UTF-8 字节拆到两次输出里
    try:
        sys.stdout.write(line)
        sys.stdout.flush()
    except Exception:
        pass


def server_url():
    return "%s?role=device&id=%s" % (RELAY_URL, quote(DEVICE_ID))


def shown_url():
    return server_url()


# ---------------------------------------------------------------------------
# 联网（与 maixcam_relay_client.py 相同的连接逻辑）
# ---------------------------------------------------------------------------
def make_ssl():
    if not server_url().startswith("wss://"):
        return None
    cafile = CA_FILE
    if cafile is None:
        try:
            import certifi
            cafile = certifi.where()
        except Exception:
            cafile = None
    ctx = ssl.create_default_context(cafile=cafile)
    if not SSL_VERIFY:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _open_proxy_socket(host, port):
    """HTTP CONNECT opens a TCP tunnel; WebSocket handles TLS afterwards."""
    connection = http.client.HTTPConnection(PROXY_HOST, PROXY_PORT,
                                            timeout=CONNECT_TIMEOUT)
    try:
        connection.set_tunnel(host, port)
        connection.connect()
        sock = connection.sock
        sock.setblocking(False)
        connection.sock = None  # Transfer ownership to the caller.
        return sock
    finally:
        connection.close()


def _close_unused_proxy_socket(future):
    try:
        future.result().close()
    except BaseException:
        pass


async def connect_relay(connection_kwargs):
    """Use a preconnected socket on both older and newer websockets."""
    kwargs = dict(connection_kwargs)
    kwargs["subprotocols"] = ["codex-lab.v1", "auth." + RELAY_TOKEN]
    url = server_url()
    target = urlsplit(url)
    ctx = make_ssl()
    if ctx is not None:
        kwargs["ssl"] = ctx
        kwargs["server_hostname"] = target.hostname
    if "proxy" in inspect.signature(websockets.connect).parameters:
        kwargs["proxy"] = None
    sock = None
    try:
        if USE_PROXY:
            log("代理", "通过 %s:%d 建立中继隧道" % (PROXY_HOST, PROXY_PORT))
            port = target.port or (443 if target.scheme == "wss" else 80)
            pending = asyncio.get_running_loop().run_in_executor(
                None, _open_proxy_socket, target.hostname, port)
            try:
                sock = await asyncio.shield(pending)
            except BaseException:
                pending.add_done_callback(_close_unused_proxy_socket)
                raise
            kwargs["sock"] = sock
            log("代理", "HTTP CONNECT 已建立，开始 TLS / WebSocket 握手")
        else:
            log("连接", "使用直连模式")
        ws = await websockets.connect(url, **kwargs)
        sock = None
        return ws
    finally:
        if sock is not None:
            sock.close()


class NetWorker(object):
    """后台线程：维持中继连接，发送文字 / 语音，把解析后的结果放进 ui_q。

    放进 ui_q 的事件（都是元组）：
      ("status", 文字, 是否已连接)
      ("ack", mid)                    云端已收到，开始思考
      ("asr", mid, 识别文字)           语音识别结果
      ("ai", mid, 回答文字, seq, final)   分段回答，seq 从 1 开始，final=True 为最后一段
      ("warn", mid, 提示文字)          还在等待，不是失败
      ("error", mid, 原因)             这条消息失败了
      ("queued", mid, 提示文字)        电脑助手不在线，中转已排队（文字）或板子先保留录音（语音）
      ("photo_fail", image_id, 原因)   照片没传上去（v5）
      ("photo_note", mid, 提示文字)    云端说这个问题的照片没收到，只按文字回答（v5）

    可靠性（见 RELIABILITY_CHANGES.md）：
      * 每收到一段 ai_reply 都回 {type:reply_ack, device_id, reply_to, seq}；重复段照样确认，但不再显示。
      * 「收到第一段」和「完整回答」分开：按 final 段的 seq 检查缺段，缺了发
        {type:reply_resend, device_id, reply_to, missing:[…], have:[…]}，云端从 pending/ 或 sent/ 补发。
      * 回答没收全之前 pending 不删（但云端已确认的问题不会重发）。
      * message_id 前缀是每次启动随机的 10 位十六进制（如 t3f9a01c2d4_v_001），重启后不会和旧 id 撞。
      * 排队（新版中转）：收到 {type:queued} 后不再重发；文字由中转保存，电脑助手上线后中转按顺序重放；
        语音（mode=hold）由板子保留录音，收到 {type:status,event:cloud_online} 后用同一 message_id 从头重传。
        所有重发都用原 message_id，云端按 (device_id, message_id) 去重。
    """

    def __init__(self, ui_q):
        self.ui_q = ui_q
        self.out_q = queue.Queue()
        self.stop = threading.Event()
        self.pending = {}            # mid -> 状态字典，只在网络线程里访问
        self.prefix = "t%010x" % random.getrandbits(40)   # 会话前缀：10 位十六进制
        self.replies = {}            # mid -> 回答收集状态（段号集合、final、补发次数），只在网络线程里访问
        self.tx = []                 # 待发送的控制消息（reply_ack / reply_resend），网络线程里发出
        self.counter = 0
        self.counter_lock = threading.Lock()
        self.waiting_texts = {}      # 文字 -> (mid, 提交时间)：还在排队/等回答的问题，防止连点重复发送
        self.cloud_online = None     # 新版中转告诉我们的电脑助手状态（旧版中转不会发，保持 None）
        self.cloud_image = None      # v5：bridge 是否支持收照片（caps_query.cloud_caps / cloud_caps 消息）；旧 bridge → False
        self.images = {}             # image_id -> 上传状态（只在网络线程里改；界面线程只读 state）
        self.tts = TtsAssembler(DEVICE_ID) if TTS_ENABLED else None   # 云端语音分块的组装（只在网络线程里用）
        self.thread = threading.Thread(target=self._thread_main, name="net", daemon=True)

    # ---- 给界面线程调用 ----
    def new_mid(self, kind):
        with self.counter_lock:
            self.counter += 1
            return "%s_%s_%03d" % (self.prefix, kind, self.counter)

    def send_text(self, text):
        return self.send_text_dedup(text)[0]

    def send_text_dedup(self, text, image_id=None):
        """返回 (mid, 是否重复)。同一句话还在排队/等回答（DUP_TEXT_WINDOW 秒内）时不再发，返回原来的 mid。
        带照片的问题按「文字 + 照片」去重（同一句话配不同照片算新问题）。"""
        now = time.time()
        key = text if not image_id else text + "\x00" + image_id
        with self.counter_lock:
            old = self.waiting_texts.get(key)
            if old is not None and now - old[1] < DUP_TEXT_WINDOW:
                return old[0], True
            self.counter += 1
            mid = "%s_%s_%03d" % (self.prefix, "q", self.counter)
            self.waiting_texts[key] = (mid, now)
        item = {"kind": "text", "mid": mid, "text": text}
        if image_id:
            item["image_id"] = image_id
        self.out_q.put(item)
        return mid, False

    # ---- 照片（v5）：界面线程调用 ----
    def send_image(self, image_id, data, w, h):
        """拍好的 JPEG 交给网络线程：云端支持且在线时马上上传（和提问无关，提问时只带 image_id）。"""
        self.out_q.put({"kind": "image", "iid": image_id, "data": data, "w": w, "h": h})

    def drop_image(self, image_id):
        self.out_q.put({"kind": "image_drop", "iid": image_id})

    def image_state(self, image_id):
        r = self.images.get(image_id)
        return r.get("state") if r else None

    def _release_text(self, mid):
        with self.counter_lock:
            for k, v in list(self.waiting_texts.items()):
                if v[0] == mid:
                    del self.waiting_texts[k]

    def tts_stop(self):
        """界面线程调用：按了录音键 / 发了新问题，停掉正在念的回答（网络线程里处理）。"""
        if self.tts is not None:
            self.out_q.put({"kind": "tts_stop"})

    def _do_tts_stop(self):
        acts, rt, recent = self.tts.cancel(time.time())
        self._tts_actions(acts)
        if rt and recent:
            # 只有最近还在收这个回答的语音时才告诉云端（避免没必要的消息）
            self.tx.append({"type": "tts_stop", "device_id": DEVICE_ID, "reply_to": rt})
            log("语音", "停止朗读 %s，通知云端不再发后面的语音" % rt)

    def send_audio(self, pcm, t_release=None, image_id=None):
        mid = self.new_mid("v")
        item = {"kind": "audio", "mid": mid, "pcm": pcm, "t_release": t_release}
        if image_id:
            item["image_id"] = image_id
        self.out_q.put(item)
        return mid

    def start(self):
        self.thread.start()

    def close(self, wait=3.0):
        self.stop.set()
        self.thread.join(wait)

    # ---- 网络线程内部 ----
    def _stopped(self):
        return self.stop.is_set() or need_exit()

    def _ui(self, *event):
        self.ui_q.put(event)

    def _thread_main(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._main())
        except Exception as e:
            log("错误", "网络线程退出：%s: %s" % (type(e).__name__, e))
        finally:
            try:
                loop.close()
            except Exception:
                pass

    async def _main(self):
        log("环境", "websockets=%s；代理=%s；证书校验=%s" % (
            getattr(websockets, "__version__", "unknown"), USE_PROXY, SSL_VERIFY))
        n = 0
        while not self._stopped():
            n += 1
            await self._session(n)
            if self._stopped():
                break
            self._ui("status", "已断开，%d 秒后重连" % RETRY_DELAY, False)
            log("重试", "%d 秒后重新连接" % RETRY_DELAY)
            t_end = time.time() + RETRY_DELAY
            while time.time() < t_end and not self._stopped():
                await asyncio.sleep(0.2)

    async def _send_json(self, ws, obj, p=None):
        await ws.send(json.dumps(obj, ensure_ascii=False))
        if p is not None:
            p["frames"] += 1

    def _restart(self, p):
        """开始（或重新开始）发送一条消息。"""
        p["sent_at"] = time.time()
        p["retry_at"] = None
        p["warned"] = False
        p["seq"] = 0 if p["kind"] == "audio" else None
        p["streaming"] = p["kind"] == "audio"
        p["started"] = False
        p["frames"] = 0               # 本轮已发出的帧数
        p["err_skip"] = 0             # 上一轮还可能陆续回来的 cloud offline 错误数
        p["queued"] = None            # 中转回 queued 后为 "text" / "hold"；queued_at 不重置（排队总时长）

    async def _pump_one(self, ws, mid, p):
        """发送这条消息的下一段；文字一次发完，语音每次发一块。"""
        if p["kind"] == "text":
            m = {"type": "text", "device_id": DEVICE_ID, "message_id": mid, "text": p["text"]}
            if p.get("image_id"):
                m["image_id"] = p["image_id"]
            await self._send_json(ws, m, p)
            p["streaming"] = False
            log("发送", "%s：%s%s" % (mid, p["text"], "（重发 %d）" % p["attempts"] if p["attempts"] else ""))
            p["started"] = True
            return
        pcm = p["pcm"]
        n = (len(pcm) + AUDIO_CHUNK_BYTES - 1) // AUDIO_CHUNK_BYTES
        if not p["started"]:
            m = {"type": "audio_start", "device_id": DEVICE_ID, "message_id": mid,
                 "sample_rate": VOICE_SAMPLE_RATE, "format": "pcm_s16le", "channels": 1}
            if p.get("image_id"):
                m["image_id"] = p["image_id"]
            await self._send_json(ws, m, p)
            p["started"] = True
            log("发送", "%s：开始上传语音 %.1f 秒，共 %d 块%s" % (
                mid, len(pcm) / 2.0 / VOICE_SAMPLE_RATE, n,
                "（重发 %d）" % p["attempts"] if p["attempts"] else ""))
            return
        i = p["seq"]
        if i < n:
            chunk = pcm[i * AUDIO_CHUNK_BYTES:(i + 1) * AUDIO_CHUNK_BYTES]
            await self._send_json(ws, {"type": "audio_chunk", "device_id": DEVICE_ID,
                                       "message_id": mid, "seq": i,
                                       "data": base64.b64encode(chunk).decode("ascii")}, p)
            p["seq"] = i + 1
            return
        m = {"type": "audio_end", "device_id": DEVICE_ID, "message_id": mid, "chunks": n}
        if p.get("image_id"):
            m["image_id"] = p["image_id"]
        await self._send_json(ws, m, p)
        p["streaming"] = False
        p["sent_at"] = time.time()
        log("发送", "%s：语音上传完成，等待云端识别" % mid)
        log("时间点", "上传完成 %s%s" % (mid, self._since(p)))

    def _queue_hello(self):
        self.tx = [m for m in self.tx if m.get("type") != "hello"]
        self.tx.append(self._hello())

    def _hello(self):
        """能力声明：v3 bridge 只给声明了 tts 的设备发语音；旧 bridge 收到会当作格式错误忽略（无害）。"""
        caps = ["reply_ack", "reply_resend"] + (["tts", "tts_queue"] if TTS_ENABLED else []) \
            + (["image"] if PHOTO_ENABLED else [])
        return {"type": "hello", "device_id": DEVICE_ID, "caps": caps,
                "tts": {"sample_rate": 16000, "format": "s16le", "channels": 1, "max_bytes": TTS_MAX_BYTES}}

    def _tts_actions(self, actions):
        for a in actions or ():
            if a[0] == "send":
                self.tx.append(a[1])
            elif a[0] == "play":
                self._ui("tts_play", a[1], a[2], a[3] if len(a) > 3 else None)
            elif a[0] == "fail":
                self._ui("tts_fail", a[1], a[2], a[3] if len(a) > 3 else None)
            elif a[0] == "log":
                log("语音", a[1])

    # ---- 照片上传（v5），只在网络线程里 ----
    def _image_new(self, item):
        data = item["data"]
        iid = item["iid"]
        self.images[iid] = {"iid": iid, "data": data, "bytes": len(data), "crc": zlib.crc32(data) & 0xFFFFFFFF,
                            "n": (len(data) + IMAGE_CHUNK_BYTES - 1) // IMAGE_CHUNK_BYTES,
                            "w": item.get("w"), "h": item.get("h"), "state": "wait", "todo": [],
                            "started": False, "tries": 0, "offline": 0, "retry_at": None, "deadline": None,
                            "t": time.time(), "t_up": None}
        log("照片", "%s 待上传：%d 字节 %d 块" % (iid, len(data), self.images[iid]["n"]))

    def _image_fail(self, r, reason):
        r["state"], r["data"], r["todo"] = "failed", None, []
        log("照片", "%s 上传失败：%s" % (r["iid"], reason))
        self._ui("photo_fail", r["iid"], reason)

    def _images_pause(self, why):
        """断线 / 云端离线：正在传的照片退回等待，恢复后从头重传（云端按 image_id 去重）。"""
        for r in self.images.values():
            if r["state"] in ("sending", "sent"):
                r["state"] = "wait"
                r["tries"] = max(0, r["tries"] - 1)
                log("照片", "%s %s，恢复后重传" % (r["iid"], why))

    async def _image_tick(self, ws, now):
        """每轮最多给每张照片发一帧（和语音一样穿插发送，不堵界面 / 语音）。返回是否还在发。"""
        busy = False
        for iid, r in list(self.images.items()):
            if now - r["t"] > IMAGE_KEEP:
                del self.images[iid]
                continue
            st = r["state"]
            if st == "wait":
                if self.cloud_image is not True or self.cloud_online is False:
                    continue
                if r["retry_at"] is not None and now < r["retry_at"]:
                    continue
                if r["tries"] >= IMAGE_MAX_TRIES:
                    self._image_fail(r, "传了 %d 遍云端都没确认" % r["tries"])
                    continue
                r["tries"] += 1
                r.update(state="sending", started=False, todo=list(range(r["n"])), retry_at=None)
                r["t_up"] = r["t_up"] or now
                st = "sending"
            if st == "sending":
                await self._image_pump(ws, r)
                busy = True
            elif st == "sent" and now > r["deadline"]:
                log("照片", "%s 发完 %d 秒没等到云端确认，从头重传" % (iid, IMAGE_ACK_TIMEOUT))
                r["state"] = "wait"
        return busy

    async def _image_pump(self, ws, r):
        iid, data = r["iid"], r["data"]
        base = {"device_id": DEVICE_ID, "message_id": iid, "image_id": iid}
        if not r["started"]:
            m = dict(base, type="image_start", bytes=r["bytes"], crc32=r["crc"], w=r["w"], h=r["h"],
                     fmt="jpeg", chunks=r["n"])
            await ws.send(json.dumps(m))
            r["started"] = True
            log("照片", "%s 开始上传（第 %d 遍）" % (iid, r["tries"]))
            return
        if r["todo"]:
            seq = r["todo"].pop(0)
            chunk = data[seq * IMAGE_CHUNK_BYTES:(seq + 1) * IMAGE_CHUNK_BYTES]
            await ws.send(json.dumps(dict(base, type="image_chunk", seq=seq,
                                          data=base64.b64encode(chunk).decode("ascii"))))
            return
        await ws.send(json.dumps(dict(base, type="image_end", chunks=r["n"])))
        r["state"], r["deadline"] = "sent", time.time() + IMAGE_ACK_TIMEOUT

    def _image_msg(self, t, data, r):
        iid = r["iid"]
        if t == "image_ack":
            if data.get("ok"):
                if r["state"] != "acked":
                    ms = (time.time() - r["t_up"]) * 1000 if r.get("t_up") else 0
                    log("照片", "%s 云端已收到%s（上传 %.0f ms）" % (iid, "（重复）" if data.get("duplicate") else "", ms))
                    log("时间点", "照片上传完成 %s %.0f ms" % (iid, ms))
                r["state"], r["data"], r["todo"] = "acked", None, []
                return
            reason = to_text(data.get("reason") or "unknown")
            if reason == "no_cap" and r["tries"] < IMAGE_MAX_TRIES:
                # bridge 刚重启还没收到 hello：重新声明能力，稍后重传
                self._queue_hello()
                r["state"], r["retry_at"] = "wait", time.time() + 1.0
                return
            if r["state"] not in ("acked", "failed"):
                self._image_fail(r, reason)
        elif t == "image_resend":
            if r["data"] is None or r["state"] not in ("sending", "sent"):
                return
            miss = [i for i in (data.get("missing") or []) if isinstance(i, int) and 0 <= i < r["n"]]
            log("照片", "%s 云端要补发 %d 块：%s" % (iid, len(miss), miss[:10]))
            r["todo"] = sorted(set(miss) | set(r["todo"]))
            r["started"], r["state"] = True, "sending"
        elif t == "error":
            reason = to_text(data.get("reason") or "")
            if r["state"] in ("acked", "failed"):
                return
            if reason == "cloud offline" and r["offline"] < OFFLINE_RETRIES:
                if r["state"] != "wait":
                    r["offline"] += 1
                    r["tries"] = max(0, r["tries"] - 1)
                    r["state"], r["retry_at"] = "wait", time.time() + RETRY_DELAY
                    log("照片", "%s：电脑助手不在线，%d 秒后重传" % (iid, RETRY_DELAY))
                return
            self._image_fail(r, reason or "error")

    def _handle(self, raw):
        try:
            data = json.loads(raw)
        except Exception:
            log("接收", "收到非 JSON 内容（已忽略，长度 %d）" % len(raw or ""))
            return
        if not isinstance(data, dict):
            return
        t = data.get("type")
        mid = data.get("reply_to")
        if t in ("image_ack", "image_resend") or (t == "error" and mid in self.images):
            r = self.images.get(data.get("image_id") or mid)
            if r is not None:
                self._image_msg(t, data, r)
            return
        p = self.pending.get(mid) if mid else None
        if t == "reply":
            if p is not None:
                p["acked"] = True
                p["queued"] = None
            log("回复", "reply_to=%s：%s%s" % (mid, data.get("text"), "（重复问题，云端补发确认）" if data.get("duplicate") else ""))
            self._ui("ack", mid)
        elif t == "asr_result":
            text = to_text(data.get("text")).strip()
            log("识别", "reply_to=%s：%s" % (mid, text or "（没听清）"))
            log("时间点", "收到识别结果 %s%s" % (mid, self._since(p)))
            self._ui("asr", mid, text)
            if p is not None:
                p["streaming"] = False
        elif t == "ai_reply":
            # 分段回答：seq 从 1 开始，final=true 表示最后一段；老格式没有 seq/final，当作 seq=1、final=true
            text = to_text(data.get("text"))
            has_seq = "seq" in data
            try:
                seq = int(data.get("seq")) if has_seq else 1
            except (TypeError, ValueError):
                seq = 1
            final = bool(data.get("final")) if "final" in data else (not has_seq)
            if not mid:
                return
            self._on_reply_part(mid, p, text, seq, final)
        elif t == "caps_query":
            cc = data.get("cloud_caps")
            self.cloud_image = isinstance(cc, list) and "image" in cc   # 旧 bridge 不带 → False
            self._queue_hello()
        elif t == "cloud_caps":
            cc = data.get("caps")
            self.cloud_image = isinstance(cc, list) and "image" in cc
            log("接收", "云端能力：%s" % (cc,))
        elif t == "image_status":
            log("照片", "%s 的照片云端没收到（%s），只按文字回答" % (mid, data.get("reason")))
            self._ui("photo_note", mid, to_text(data.get("text") or "照片没传上，先按文字回答"))
        elif t in ("tts_start", "tts_chunk", "tts_end"):
            if self.tts is not None:
                self._tts_actions(self.tts.on_message(data, time.time()))
        elif t == "tts_cancel":
            # 云端停掉了这个回答的朗读（来了新问题）：丢掉半截的语音和排队的条目，不提示
            if self.tts is not None:
                self._tts_actions(self.tts.on_cancel(data))
                self._ui("tts_drop", mid)
        elif t == "tts_truncated":
            log("语音", "%s 的朗读超过上限，后面只显示文字" % mid)
            self._ui("tts_notice", mid, "truncated")
        elif t == "tts_skip":
            log("语音", "%s 第 %s 条云端没念出来：%s" % (mid, data.get("item"), data.get("reason")))
            self._ui("tts_fail", data.get("tts_id"), "cloud: %s" % data.get("reason"), mid)
        elif t == "queued":
            if p is None:
                log("排队", "reply_to=%s 已排队（本地已不在等待）" % mid)
                return
            mode = "hold" if data.get("mode") == "hold" else "text"
            first = not p.get("queued_at")
            p["queued"] = mode
            p["queued_at"] = p.get("queued_at") or time.time()
            p["retry_at"] = None
            p["streaming"] = False      # 停止上传 / 停止重发
            p["started"] = True
            if mode == "hold":
                log("排队", "%s：电脑助手不在线，录音先留在板子上，上线后自动重传" % mid)
                if first or not data.get("duplicate"):
                    self._ui("queued", mid, "电脑助手还没上线，录音已保存，上线后自动上传…")
            else:
                log("排队", "%s：已在中转排队（第 %s 位%s）" % (mid, data.get("position"),
                                                           "，重复提交" if data.get("duplicate") else ""))
                if first:
                    self._ui("queued", mid, "已排队，等电脑助手上线…")
        elif t == "status" and data.get("event") in ("cloud_online", "cloud_offline"):
            ev = data.get("event")
            self.cloud_online = ev == "cloud_online"
            log("接收", "中转通知：电脑助手%s" % ("已上线" if self.cloud_online else "离线"))
            if not self.cloud_online:
                self.cloud_image = None
                self._images_pause("电脑助手离线")
                return
            self._queue_hello()                # bridge 可能刚重启：重新声明能力
            now = time.time()
            for qmid, q in list(self.pending.items()):
                if not q.get("queued") or q.get("acked"):
                    continue
                if q["queued"] == "hold":
                    log("排队", "%s：电脑助手上线，从头重传录音" % qmid)
                    q["attempts"] += 1
                    self._restart(q)           # 同一个 message_id
                else:
                    # 中转已经把排队的文字重放给云端；超时没确认再用同一 message_id 重发一次
                    q["queued"] = None
                    q["sent_at"] = now
                    q["warned"] = False
                    q["online_check"] = True
                self._ui("warn", qmid, "电脑助手已上线，正在处理…")
        elif t == "error":
            reason = to_text(data.get("reason") or "未知错误")
            if p is None:
                log("错误", "云端错误：%s%s" % (reason, "（reply_to=%s）" % mid if mid else ""))
                if not mid:
                    return
                self._ui("error", mid, reason)
                return
            if reason == "cloud offline":
                # 语音一条消息有很多帧，每帧都可能回一次 cloud offline，每轮只处理第一次
                if p["retry_at"] is not None:
                    p["pending_skip"] = max(0, p.get("pending_skip", 0) - 1)
                    return
                if p["err_skip"] > 0:
                    p["err_skip"] -= 1
                    return
                if p["attempts"] < OFFLINE_RETRIES:
                    p["attempts"] += 1
                    skip = max(0, p["frames"] - 1)
                    p["streaming"] = False
                    p["retry_at"] = time.time() + RETRY_DELAY
                    p["pending_skip"] = skip
                    log("等待", "电脑助手 bridge 暂未在线，%d 秒后重发 %s" % (RETRY_DELAY, mid))
                    self._ui("warn", mid, "云端暂未在线，%d 秒后重发（第 %d 次）" % (RETRY_DELAY, p["attempts"]))
                    return
            log("错误", "%s 未被处理：%s" % (mid, reason))
            self.pending.pop(mid, None)
            self._release_text(mid)
            if reason == "queue full":
                reason = "电脑助手不在线，排队已满，请稍后再问"
            elif reason == "queue expired":
                reason = "电脑助手一直没上线，排队已过期，请稍后再问"
            self._ui("error", mid, reason)
        else:
            # status 等其他消息：只打印解析后的文字，不打印原始 JSON
            info = data.get("text") or data.get("event") or data.get("reason") or ""
            log("接收", "其他消息 type=%s %s" % (t, info))

    def _since(self, p):
        if not p:
            return ""
        t0 = p.get("t_release") or p.get("t_submit")
        return "（距%s %.2f 秒）" % ("松手" if p.get("t_release") else "提交", time.time() - t0) if t0 else ""

    def _on_reply_part(self, mid, p, text, seq, final):
        now = time.time()
        # 不管是不是重复段都先确认，云端收到确认才把这段归档、停止重发
        self.tx.append({"type": "reply_ack", "device_id": DEVICE_ID, "reply_to": mid, "seq": seq})
        st = self.replies.get(mid)
        if st is None:
            st = {"parts": set(), "final": None, "t_first": now, "t_last": now, "asks": 0,
                  "asked_at": 0.0, "complete": False, "p": p}
            self.replies[mid] = st
        if seq in st["parts"]:
            log("回答", "reply_to=%s 第 %d 段重复（已确认，不重复显示）" % (mid, seq))
            return
        st["parts"].add(seq)
        st["t_last"] = now
        if final:
            st["final"] = seq
        log("回答", "reply_to=%s 第 %d 段%s：%s" % (mid, seq, "（完）" if final else "", text))
        log("时间点", "收到回答 %s 第 %d 段%s" % (mid, seq, self._since(st["p"])))
        if p is not None:
            # 收到回答说明云端肯定收到了问题：之后断线重连也不再重发这条问题
            p["acked"] = True
            p["answering"] = True
            p["queued"] = None
        self._release_text(mid)
        self._ui("ai", mid, text, seq, final)
        fs = st["final"]
        if fs is not None and all(i in st["parts"] for i in range(1, fs + 1)) and not st["complete"]:
            st["complete"] = True
            self.pending.pop(mid, None)
            log("时间点", "回答完整 %s 共 %d 段%s" % (mid, fs, self._since(st["p"])))

    def _check_replies(self, now):
        """缺段检测：有 final 时按 1..final 找缺口；没有 final 时等 FINAL_WAIT 秒后问一次云端。"""
        for mid, st in list(self.replies.items()):
            if st["complete"]:
                if now - st["t_last"] > REPLY_KEEP:
                    del self.replies[mid]
                continue
            parts = st["parts"]
            fs = st["final"]
            top = fs if fs is not None else max(parts)
            missing = [i for i in range(1, top + 1) if i not in parts]
            if now - st["t_last"] > AI_TIMEOUT:
                st["complete"] = True
                self.pending.pop(mid, None)
                self._release_text(mid)
                why = "缺第 %s 段" % ",".join(str(i) for i in missing) if missing else "最后一段没有到"
                log("回答", "%s 回答不完整（%s），已放弃等待" % (mid, why))
                self._ui("error", mid, "回答不完整（%s）" % why)
                continue
            if st["asks"] >= RESEND_ASK_MAX:
                continue
            wait = RESEND_ASK_AFTER if (missing or fs is not None) else FINAL_WAIT
            wait *= 2 ** st["asks"]
            if now - max(st["t_last"], st["asked_at"]) < wait:
                continue
            st["asks"] += 1
            st["asked_at"] = now
            log("回答", "%s 缺段 %s%s，请求云端补发（第 %d 次）" % (
                mid, missing or "无", "" if fs is not None else "，还没收到最后一段", st["asks"]))
            self.tx.append({"type": "reply_resend", "device_id": DEVICE_ID, "reply_to": mid,
                            "missing": missing, "have": sorted(parts)})

    async def _flush_tx(self, ws):
        while self.tx:
            await ws.send(json.dumps(self.tx[0], ensure_ascii=False))
            self.tx.pop(0)

    async def _session(self, session_no):
        log("连接", "第 %d 次连接 %s ..." % (session_no, shown_url()))
        self._ui("status", "连接中…", False)
        kwargs = dict(ping_interval=PING_INTERVAL, ping_timeout=PING_TIMEOUT, max_size=64 * 1024)
        try:
            ws = await asyncio.wait_for(connect_relay(kwargs), timeout=CONNECT_TIMEOUT)
        except asyncio.TimeoutError:
            log("连接", "失败：%d 秒内未建立连接" % CONNECT_TIMEOUT)
            self._ui("status", "连接超时", False)
            return
        except Exception as e:
            hint = ""
            if isinstance(e, ConnectionRefusedError) and USE_PROXY:
                hint = "（检查 sing-box 是否已启动，本机代理端口应为 7890）"
            elif "401" in str(e):
                hint = "（token 不对）"
            elif "CERTIFICATE" in str(e).upper() or "SSL" in type(e).__name__.upper():
                hint = "（TLS 证书问题：检查相机时间和 CA_FILE；保持证书校验开启）"
            log("连接", "失败：%s: %s%s" % (type(e).__name__, e, hint))
            self._ui("status", "连接失败%s" % hint, False)
            return
        log("连接", "连接成功，设备 %s" % DEVICE_ID)
        self._ui("status", "已连接", True)
        # 不在连上时主动发 hello：电脑助手不在线时任何设备消息都会让中转发唤醒请求。
        # hello 只在收到云端的 caps_query（bridge 看到 device_connected 后发）或 cloud_online 时回。
        self.tx = [m for m in self.tx if m.get("type") != "hello"]
        self.cloud_image = None             # 等 caps_query / cloud_caps 重新告诉我们
        self._images_pause("重新连上")
        # 断线前还没被云端确认的消息，重连后从头再发一次
        for p in self.pending.values():
            if not p["acked"]:
                self._restart(p)
        try:
            while not self._stopped():
                while True:
                    try:
                        item = self.out_q.get_nowait()
                    except queue.Empty:
                        break
                    if item.get("kind") == "tts_stop":
                        self._do_tts_stop()
                        continue
                    if item.get("kind") == "image":
                        self._image_new(item)
                        continue
                    if item.get("kind") == "image_drop":
                        if self.images.pop(item["iid"], None) is not None:
                            log("照片", "%s 已取消" % item["iid"])
                        continue
                    item.update(attempts=0, acked=False, answering=False)
                    item.setdefault("t_submit", time.time())
                    self._restart(item)
                    self.pending[item["mid"]] = item
                now = time.time()
                busy = await self._image_tick(ws, now)
                for mid, p in list(self.pending.items()):
                    if p["retry_at"] is not None and now >= p["retry_at"]:
                        skip = p.get("pending_skip", 0)
                        self._restart(p)
                        p["err_skip"] = skip
                    if p["streaming"] or (p["kind"] == "text" and not p["started"] and p["retry_at"] is None):
                        await self._pump_one(ws, mid, p)
                        busy = busy or p["streaming"]
                        continue
                    if p["retry_at"] is not None:
                        continue
                    if p.get("queued"):
                        qw = now - p["queued_at"]
                        if qw > QUEUE_GIVEUP:
                            self.pending.pop(mid, None)
                            self._release_text(mid)
                            log("排队", "%s 排队 %d 秒电脑助手仍未上线，放弃" % (mid, qw))
                            self._ui("error", mid, "电脑助手一直没上线（已等 %d 秒），请稍后再问" % qw)
                        elif qw > QUEUE_WARN_AFTER and not p.get("queue_warned"):
                            p["queue_warned"] = True
                            log("排队", "%s 已排队 %d 秒，电脑助手还没上线" % (mid, qw))
                            self._ui("warn", mid, "电脑助手还没上线（已等 %d 秒），继续排队…" % qw)
                        continue
                    waited = now - p["sent_at"]
                    if p.get("online_check") and not p["acked"] and waited > REPLY_TIMEOUT:
                        # 电脑助手上线后中转应已重放；没确认就用同一 message_id 重发一次（云端会去重）
                        p["online_check"] = False
                        p["attempts"] += 1
                        log("排队", "%s 电脑助手上线后 %d 秒未确认，用原 message_id 重发" % (mid, REPLY_TIMEOUT))
                        self._restart(p)
                        continue
                    if not p["acked"] and not p["warned"] and waited > REPLY_TIMEOUT:
                        p["warned"] = True
                        self._ui("warn", mid, "云端还没确认收到，继续等待…")
                    if waited > AI_TIMEOUT and not p.get("answering"):
                        self.pending.pop(mid, None)
                        self._release_text(mid)
                        log("接收", "等待 %s 的回答超时（%d 秒）" % (mid, AI_TIMEOUT))
                        self._ui("error", mid, "等待 AI 回答超时")
                self._check_replies(now)
                if self.tts is not None:
                    self._tts_actions(self.tts.tick(now))
                await self._flush_tx(ws)
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=AUDIO_CHUNK_GAP if busy else 0.1)
                except asyncio.TimeoutError:
                    continue
                self._handle(raw)
                await self._flush_tx(ws)
        except websockets.exceptions.ConnectionClosed as e:
            log("断开", "连接已关闭：%s" % e)
        except Exception as e:
            log("错误", "通信阶段出错：%s: %s" % (type(e).__name__, e))
        finally:
            try:
                await ws.close()
            except Exception:
                pass
            self._images_pause("连接断开")
            self._ui("status", "已断开", False)


# ---------------------------------------------------------------------------
# 语音：按住录音（maix.audio.Recorder），松开后交给 NetWorker 上传
# ---------------------------------------------------------------------------
class VoiceRecorder(object):
    """状态：loading / ready / recording / disabled。录音在自己的线程里读，不卡界面。"""

    def __init__(self, on_audio):
        self.on_audio = on_audio      # 回调 on_audio(pcm_bytes)，在录音线程里调用
        self.state = "loading"
        self.reason = ""
        self.rec_started = 0.0
        self.t_release = None
        self._recording = threading.Event()
        self._go = threading.Event()
        self.thread = threading.Thread(target=self._thread_main, name="voice", daemon=True)

    def start_thread(self):
        if not VOICE_ENABLED:
            self.state, self.reason = "disabled", "VOICE_ENABLED = False"
            return
        self.thread.start()

    def press(self):
        if self.state == "ready":
            self.rec_started = time.time()
            self.state = "recording"
            self._recording.set()
            self._go.set()

    def release(self):
        if self._recording.is_set():
            self.t_release = time.time()
            log("时间点", "松手（录音 %.2f 秒）" % (self.t_release - self.rec_started))
        self._recording.clear()

    def elapsed(self):
        return time.time() - self.rec_started if self.state == "recording" else 0.0

    def _thread_main(self):
        try:
            from maix import audio
            self.rec = audio.Recorder(sample_rate=VOICE_SAMPLE_RATE, format=audio.Format.FMT_S16_LE,
                                      channel=1, block=False)
            self.rec.volume(MIC_VOLUME)
            self.rate = int(self.rec.sample_rate())
            self.channels = int(self.rec.channel())
            log("语音", "麦克风就绪：采样率 %d，声道 %d" % (self.rate, self.channels))
            if self.rate % VOICE_SAMPLE_RATE != 0:
                raise RuntimeError("麦克风采样率 %d 无法转换成 16000" % self.rate)
        except Exception as e:
            self.state, self.reason = "disabled", "麦克风初始化失败：%s" % e
            log("语音", self.reason)
            return
        self.state = "ready"
        while not need_exit():
            if not self._go.wait(0.2):
                continue
            self._go.clear()
            try:
                pcm = self._record_once()
            except Exception as e:
                log("语音", "录音出错：%s: %s" % (type(e).__name__, e))
                pcm = b""
            self.state = "ready"
            secs = len(pcm) / 2.0 / VOICE_SAMPLE_RATE
            if secs < VOICE_MIN_SECONDS:
                log("语音", "录音太短（%.1f 秒），已丢弃" % secs)
                self.on_audio(None)
                continue
            log("语音", "录音 %.1f 秒，准备上传" % secs)
            self.on_audio(pcm)

    def _record_once(self):
        r = self.rec
        chunks = []
        r.reset(True)                 # 非阻塞录音：先打开音频流（官方 record.md 写法）
        try:
            need = int(50 * self.rate / 1000)
            while self._recording.is_set() and not need_exit():
                if time.time() - self.rec_started > VOICE_MAX_SECONDS:
                    break
                if r.get_remaining_frames() > need:
                    data = r.record(50)
                    if data:
                        chunks.append(bytes(data))
                else:
                    time.sleep(0.01)
        finally:
            r.reset(False)
            self._recording.clear()
        return to_mono_16k(b"".join(chunks), self.rate, self.channels)


def to_mono_16k(pcm, rate, channels):
    """把 s16le PCM 转成 16 kHz 单声道（只处理整数倍降采样，例如 48000 → 16000）。"""
    if len(pcm) % 2:
        pcm = pcm[:-1]
    if channels == 1 and rate == VOICE_SAMPLE_RATE:
        return pcm
    import array
    a = array.array("h")
    a.frombytes(pcm)
    if channels > 1:
        a = array.array("h", a[0::channels])
    step = max(1, rate // VOICE_SAMPLE_RATE)
    if step > 1:
        out = array.array("h", [0]) * (len(a) // step)
        for i in range(len(out)):
            s = 0
            base = i * step
            for k in range(step):
                s += a[base + k]
            out[i] = s // step
        a = out
    return a.tobytes()


# ---------------------------------------------------------------------------
# 云端语音（tts_start / tts_chunk / tts_end）：组装（纯逻辑，可离线测试）+ 播放线程
# ---------------------------------------------------------------------------
class TtsAssembler(object):
    """把云端发来的语音分块拼回完整 PCM。不依赖 maix，返回「动作」列表交给调用方执行：
      ("send", 消息)          要发给云端的 tts_ack / tts_resend
      ("play", tts_id, pcm)   收齐且 CRC 正确，可以播放
      ("fail", tts_id, 原因)   这段语音放弃（界面显示「语音播放失败」，文字回答不受影响）
      ("log", 文字)
    协议：tts_start {tts_id, sample_rate:16000, format:'s16le', channels:1, total_bytes, chunks, crc32}
          tts_chunk {tts_id, seq(1..chunks), data(base64)}   tts_end {tts_id, chunks}
    新的 tts_start 会顶替还没完成的旧语音。
    v4 回答朗读：tts_start 带 reply_to / item / queue:true；("play", tts_id, pcm, meta) 的 meta 里带上这些，
    播放线程按回答排队播放。cancel() 之后同一回答迟到的条目直接回 ok:false reason:"cancelled"。"""

    def __init__(self, device_id, max_bytes=None, resend_wait=None, resend_max=None, end_timeout=None):
        self.device_id = device_id
        self.max_bytes = TTS_MAX_BYTES if max_bytes is None else max_bytes
        self.resend_wait = TTS_RESEND_WAIT if resend_wait is None else resend_wait
        self.resend_max = TTS_RESEND_MAX if resend_max is None else resend_max
        self.end_timeout = TTS_END_TIMEOUT if end_timeout is None else end_timeout
        self.cur = None
        self.done_ids = []           # 最近完成/放弃的 tts_id（迟到的重复块直接忽略）
        self.cancelled = []          # 已被打断的回答 reply_to（迟到的条目直接拒收）
        self.last_reply_to = None    # 最近一条排队语音所属的回答
        self.last_queue_at = 0.0

    def _ack(self, tts_id, ok, reason=None):
        m = {"type": "tts_ack", "device_id": self.device_id, "tts_id": tts_id, "ok": bool(ok)}
        if reason:
            m["reason"] = reason
        return ("send", m)

    def _finish(self, tts_id):
        self.cur = None
        self.done_ids = (self.done_ids + [tts_id])[-8:]

    def _fail(self, tts_id, reason, reply_to=None):
        if reply_to is None and self.cur is not None and self.cur["tts_id"] == tts_id:
            reply_to = self.cur.get("reply_to")
        self._finish(tts_id)
        return [self._ack(tts_id, False, reason), ("fail", tts_id, reason, reply_to),
                ("log", "语音 %s 放弃：%s" % (tts_id, reason))]

    def _mark_cancelled(self, rt):
        if rt and rt not in self.cancelled:
            self.cancelled = (self.cancelled + [rt])[-16:]

    def cancel(self, now=None):
        """按了录音键 / 发新问题：打断最近的回答。返回 (动作, reply_to, 云端是否可能还在发)。"""
        now = time.time() if now is None else now
        rt = self.last_reply_to
        out = []
        c = self.cur
        if c is not None and c.get("queue"):
            rt = c.get("reply_to") or rt
            out.append(self._ack(c["tts_id"], False, "cancelled"))
            out.append(("log", "语音 %s 被打断（cancelled）" % c["tts_id"]))
            self._finish(c["tts_id"])
        recent = bool(rt) and rt not in self.cancelled and (c is not None or now - self.last_queue_at < 30)
        self._mark_cancelled(rt)
        return out, rt, recent

    def on_cancel(self, d):
        """云端发来 tts_cancel：丢掉这个回答正在收的语音（云端已经不等确认了，不回 ack）。"""
        rt = d.get("reply_to")
        self._mark_cancelled(rt)
        c = self.cur
        if c is not None and ((rt and c.get("reply_to") == rt) or c["tts_id"] == d.get("tts_id")):
            self._finish(c["tts_id"])
            return [("log", "云端取消了语音 %s（%s）" % (c["tts_id"], rt))]
        return [("log", "云端取消了 %s 的朗读" % rt)]

    def missing(self):
        c = self.cur
        return [] if c is None else [i for i in range(1, c["chunks"] + 1) if i not in c["parts"]]

    def on_message(self, d, now):
        t = d.get("type")
        if t == "tts_start":
            return self._start(d, now)
        c = self.cur
        tid = d.get("tts_id")
        if c is None or tid != c["tts_id"]:
            if tid not in self.done_ids:
                return [("log", "忽略不认识的语音消息 %s（%s）" % (t, tid))]
            return []
        c["last_rx"] = now
        if t == "tts_chunk":
            seq = d.get("seq")
            if not isinstance(seq, int) or isinstance(seq, bool) or not 1 <= seq <= c["chunks"]:
                return [("log", "语音 %s 块号不对：%r" % (tid, seq))]
            if seq in c["parts"]:
                return []
            try:
                data = base64.b64decode(d.get("data") or "", validate=True)
            except Exception:
                return [("log", "语音 %s 第 %d 块 base64 错误，当作缺块" % (tid, seq))]
            c["parts"][seq] = data
            c["got"] += len(data)
            if c["got"] > c["total"]:
                return self._fail(tid, "size mismatch")
            if c["ended"] and not self.missing():
                return self._complete()
            return []
        if t == "tts_end":
            c["ended"] = True
            if not self.missing():
                return self._complete()
            if c["ask_at"] is None or c["ask_at"] - now > self.resend_wait:
                c["ask_at"] = now + self.resend_wait
            return []
        return []

    def _start(self, d, now):
        tid = d.get("tts_id")
        out = []
        if not isinstance(tid, str) or not tid:
            return [("log", "tts_start 缺 tts_id，忽略")]
        rt = d.get("reply_to")
        if rt and rt in self.cancelled:
            if self.cur is not None and self.cur["tts_id"] == tid:
                return []
            if tid in self.done_ids:
                return []
            self.done_ids = (self.done_ids + [tid])[-8:]
            return [self._ack(tid, False, "cancelled"), ("log", "%s 已被打断，不再接收语音 %s" % (rt, tid))]
        if d.get("queue") is True and rt:
            self.last_reply_to, self.last_queue_at = rt, now
        if self.cur is not None:
            old = self.cur["tts_id"]
            if old == tid:
                return []            # 重复的 tts_start
            out.append(("log", "新语音 %s 顶替还没播完的 %s" % (tid, old)))
            out.append(self._ack(old, False, "replaced"))
            self._finish(old)
        total, chunks = d.get("total_bytes"), d.get("chunks")
        if d.get("sample_rate") != 16000 or d.get("format") != "s16le" or d.get("channels") != 1:
            return out + self._fail(tid, "unsupported format", rt)
        if not isinstance(total, int) or not isinstance(chunks, int) or total <= 0 or chunks <= 0 or total % 2:
            return out + self._fail(tid, "bad header", rt)
        if total > self.max_bytes:
            return out + self._fail(tid, "too large", rt)
        if chunks > total:
            return out + self._fail(tid, "bad header", rt)
        self.cur = {"tts_id": tid, "total": total, "chunks": chunks, "crc": d.get("crc32"),
                    "parts": {}, "got": 0, "ended": False, "rounds": 0, "ask_at": None,
                    "t_start": now, "last_rx": now, "reply_to": rt,
                    "item": d.get("item"), "queue": d.get("queue") is True}
        out.append(("log", "开始接收语音 %s：%d 字节 %d 块（%.1f 秒）" % (tid, total, chunks, total / 32000.0)))
        return out

    def _complete(self):
        c = self.cur
        tid = c["tts_id"]
        pcm = b"".join(c["parts"][i] for i in range(1, c["chunks"] + 1))
        if len(pcm) != c["total"]:
            return self._fail(tid, "size mismatch")
        if (zlib.crc32(pcm) & 0xFFFFFFFF) != c["crc"]:
            return self._fail(tid, "crc mismatch")
        meta = {"reply_to": c.get("reply_to"), "item": c.get("item"), "queue": c.get("queue")}
        if c.get("queue"):
            self.last_queue_at = time.time()
        self._finish(tid)
        return [self._ack(tid, True), ("play", tid, pcm, meta),
                ("log", "语音 %s 收齐（%d 字节，补发 %d 轮）" % (tid, len(pcm), c["rounds"]))]

    def tick(self, now):
        c = self.cur
        if c is None:
            return []
        if not c["ended"] and now - c["last_rx"] > self.end_timeout:
            c["ended"] = True              # tts_end 丢了：按缺块处理
            c["ask_at"] = now
        if not c["ended"] or c["ask_at"] is None or now < c["ask_at"]:
            return []
        miss = self.missing()
        if not miss:
            return self._complete()
        if c["rounds"] >= self.resend_max:
            return self._fail(c["tts_id"], "missing chunks")
        c["rounds"] += 1
        c["ask_at"] = now + self.resend_wait + self.end_timeout   # 等补发的块和新的 tts_end
        c["ended"] = False
        c["last_rx"] = now
        return [("send", {"type": "tts_resend", "device_id": self.device_id, "tts_id": c["tts_id"],
                          "missing": miss[:200]}),
                ("log", "语音 %s 缺 %d 块，请求补发（第 %d 轮）" % (c["tts_id"], len(miss), c["rounds"]))]


class TtsPlayer(object):
    """独立线程播放云端语音。按住说话时不播（等松手，最多 TTS_BUSY_WAIT 秒）。
      * 普通语音（固定短句等，meta 没有 queue）：新语音顶替旧语音（和 v3 一样）。
      * 回答朗读（meta = {reply_to, item, queue: True}）：同一回答的条目按 item 排队，一条播完再播下一条，
        不重叠；来了另一个回答的条目就清掉旧回答的队列（打断）。
      * stop_all()：按录音键 / 发新问题时调用，停止正在播的并清空队列，这个回答迟到的条目也不再播。
    player_factory() 返回带 volume()/play(bytes) 的对象，默认 maix.audio.Player；测试时可替换。"""

    def __init__(self, is_busy=None, on_error=None, player_factory=None):
        self.is_busy = is_busy or (lambda: False)
        self.on_error = on_error or (lambda tid, why: None)
        self.player_factory = player_factory
        self.player = None
        self.gen = 0
        self.queue = []              # [(item, 到达序号, gen, tts_id, pcm)]，按 item 排序
        self.q_reply_to = None       # 队列属于哪个回答
        self.dropped = []            # 被打断的回答（迟到的条目不播）
        self.reply_of = {}           # tts_id -> reply_to（界面按回答去重失败提示用）
        self.n = 0
        self.playing = None          # 正在播的 tts_id
        self.lock = threading.Lock()
        self.ev = threading.Event()
        self.played = []             # (tts_id, 字节数, 是否完整播完)，便于测试 / 排查
        self.thread = threading.Thread(target=self._main, name="tts", daemon=True)
        self.thread.start()

    def play(self, tts_id, pcm, meta=None):
        meta = meta or {}
        rt = meta.get("reply_to")
        with self.lock:
            self.n += 1
            if rt:
                self.reply_of[tts_id] = rt
                if len(self.reply_of) > 64:
                    self.reply_of.pop(next(iter(self.reply_of)))
            if meta.get("queue") and rt:
                if rt in self.dropped:
                    log("语音", "%s 已被打断，不播 %s" % (rt, tts_id))
                    return False
                if rt != self.q_reply_to:
                    if self.q_reply_to is not None or self.playing is not None:
                        log("语音", "新回答 %s 的朗读打断旧的" % rt)
                    self.gen += 1
                    self.queue = []
                    self.q_reply_to = rt
                item = meta.get("item") if isinstance(meta.get("item"), int) else 0
                self.queue.append((item, self.n, self.gen, tts_id, pcm))
                self.queue.sort(key=lambda j: (j[0], j[1]))
            else:
                self.gen += 1
                self.q_reply_to = None
                self.queue = [(0, self.n, self.gen, tts_id, pcm)]
        self.ev.set()
        return True

    def stop_all(self, why="停止"):
        """停止播放并清空队列。返回是否真的停掉了东西。"""
        with self.lock:
            had = bool(self.queue) or self.playing is not None
            self.gen += 1
            self.queue = []
            if self.q_reply_to:
                self.dropped = (self.dropped + [self.q_reply_to])[-16:]
            self.q_reply_to = None
        if had:
            log("语音", "%s：停止播放并清空语音队列" % why)
        return had

    def drop(self, reply_to):
        """云端取消了某个回答的朗读：如果正在排队/播放的是它，就停掉。"""
        with self.lock:
            if reply_to and reply_to not in self.dropped:
                self.dropped = (self.dropped + [reply_to])[-16:]
            mine = reply_to is not None and reply_to == self.q_reply_to
        if mine:
            self.stop_all("云端取消朗读")

    def _make(self):
        if self.player is None:
            if self.player_factory is not None:
                self.player = self.player_factory()
            else:
                from maix import audio
                self.player = audio.Player(sample_rate=16000, channel=1)
            try:
                self.player.volume(SPEAKER_VOLUME)
            except Exception:
                pass
        return self.player

    def _next(self):
        with self.lock:
            while self.queue:
                job = self.queue.pop(0)
                if job[2] == self.gen:
                    self.playing = job[3]
                    return job
            return None

    def _main(self):
        while not need_exit():
            job = self._next()
            if job is None:
                self.ev.wait(0.2)
                self.ev.clear()
                continue
            try:
                self._play_job(job)
            finally:
                with self.lock:
                    self.playing = None

    def _play_job(self, job):
        item, _n, gen, tid, pcm = job
        t_end = time.time() + TTS_BUSY_WAIT
        while self.is_busy() and time.time() < t_end and gen == self.gen and not need_exit():
            time.sleep(0.05)
        if gen != self.gen:
            return
        if self.is_busy():
            log("语音", "一直在按住说话，放弃播放 %s" % tid)
            self.played.append((tid, 0, False))
            return
        done = 0
        try:
            p = self._make()
            log("语音", "开始播放 %s（%.1f 秒%s）" % (tid, len(pcm) / 32000.0, "，第 %d 条" % item if item else ""))
            for i in range(0, len(pcm), TTS_PLAY_BLOCK):
                if gen != self.gen or need_exit():
                    log("语音", "%s 被打断" % tid)
                    break
                if self.is_busy():
                    log("语音", "开始按住说话，停止播放 %s" % tid)
                    break
                p.play(pcm[i:i + TTS_PLAY_BLOCK])
                done = i + len(pcm[i:i + TTS_PLAY_BLOCK])
            self.played.append((tid, done, done == len(pcm)))
        except Exception as e:
            self.player = None
            self.played.append((tid, done, False))
            log("语音", "播放 %s 失败：%s: %s" % (tid, type(e).__name__, e))
            self.on_error(tid, "player error")


_ding_pcm = None
_tts_player = None           # main() 里创建的 TtsPlayer


def speak_answer(text, pcm=None, tts_id=None, meta=None):
    """回答到达时的语音输出。

    MaixCAM Pro 没有板载中文 TTS（官方 MeloTTS 只支持 MaixCAM2）：
      * 文字回答（pcm=None）：只「叮」一声（PLAY_DING）；
      * 云端合成好的语音（pcm = 16 kHz 单声道 s16le）：交给播放线程 TtsPlayer。
    """
    if pcm is not None:
        if _tts_player is None:
            log("语音", "播放器未初始化，跳过 %s" % tts_id)
            return False
        return _tts_player.play(tts_id, pcm, meta)
    if not PLAY_DING:
        return

    def _play():
        global _ding_pcm
        try:
            from maix import audio
            if _ding_pcm is None:
                rate, n = 16000, 16000 * 18 // 100
                _ding_pcm = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 880 * i / rate)
                                                           * (1 - float(i) / n))) for i in range(n))
            p = audio.Player(sample_rate=16000, channel=1)
            p.volume(SPEAKER_VOLUME)
            p.play(_ding_pcm)
        except Exception as e:
            log("提示音", "播放失败：%s" % e)

    threading.Thread(target=_play, daemon=True).start()


# ---------------------------------------------------------------------------
# 界面
# ---------------------------------------------------------------------------
KB_ROWS = [list("1234567890"), list("qwertyuiop"), list("asdfghjkl") + ["退格"],
           list("zxcvbnm") + ["空格", "清空"]]


# ---------------------------------------------------------------------------
# 拍照（v5.1）：摄像头启动时在主线程打开一次、一直不关；点「拍照」进取景界面，按快门才拍，确认「用这张」才上传
# ---------------------------------------------------------------------------
def _jpeg_encode(img, image_mod):
    """优先 to_jpeg(quality=q)；老固件退回 to_jpeg(q) / to_format(FMT_JPEG)。"""
    try:
        return img.to_jpeg(quality=PHOTO_QUALITY)
    except TypeError:
        return img.to_jpeg(PHOTO_QUALITY)
    except AttributeError:
        return img.to_format(image_mod.Format.FMT_JPEG)


def _jpeg_bytes(jimg):
    b = jimg.to_bytes()
    if not isinstance(b, (bytes, bytearray)):
        b = bytes(b)
    return bytes(b)


class PhotoCapture(object):
    """拍照（v5.1 修复）：摄像头在 main() 里、主线程、屏幕初始化之后打开一次，整个程序运行期间一直开着，
    绝不 close()。真板实测：cam.close() 会把整个 MMF 多媒体系统（VI/VPSS/VENC，屏幕也在用）一起释放，
    屏幕还在用时就 SIGSEGV(11) 整个程序退出。官方 FAQ 也写明屏幕驱动和摄像头驱动是绑在一起初始化的。
    所有摄像头调用（打开 / read）都只在主线程（界面循环）里做：
      read_frame()   取景界面每一帧调用；
      capture()      按快门时调用：丢几帧旧缓冲 + 读最新一帧 + 编码 JPEG（约 0.3 秒）。
    摄像头打不开时 available=False，按钮点了只提示原因，不会退出程序。
    on_done(res, err) 保留给以后（例如云端要求开摄像头）复用；现在取景界面直接调 ChatUI.on_photo_done。"""

    def __init__(self, on_done, camera_factory=None):
        self.on_done = on_done
        self.camera_factory = camera_factory
        self.cam = None
        self.available = False
        self.reason = "摄像头还没打开"
        self.busy = False            # 兼容旧界面代码（取景界面在主线程里同步拍，不会出现「拍照中」）
        self.lock = threading.Lock()

    def open(self):
        """在主线程调用一次（屏幕初始化之后）。失败不抛异常。"""
        t0 = time.time()
        try:
            if self.camera_factory is not None:
                self.cam = self.camera_factory()
            else:
                from maix import camera, image as image_mod
                try:
                    self.cam = camera.Camera(PHOTO_W, PHOTO_H, image_mod.Format.FMT_RGB888, buff_num=PHOTO_BUFF_NUM)
                except TypeError:
                    self.cam = camera.Camera(PHOTO_W, PHOTO_H, image_mod.Format.FMT_RGB888)
            self.available, self.reason = True, ""
            log("拍照", "摄像头已打开（%dx%d，一直开着不关），用时 %.0f ms" % (PHOTO_W, PHOTO_H, (time.time() - t0) * 1000))
        except Exception as e:
            self.cam, self.available = None, False
            self.reason = "摄像头打不开：%s: %s" % (type(e).__name__, e)
            log("拍照", self.reason + "（拍照按钮停用，问答照常）")
        return self.available

    def read_frame(self, skip=0):
        """主线程调用：读一帧（预览 / 快门）。读不到返回 None，不抛异常。"""
        if not self.available or self.cam is None:
            return None
        for _ in range(skip):
            try:
                self.cam.read()
            except Exception:
                pass
        for _ in range(3):
            try:
                img = self.cam.read()
            except Exception as e:
                log("拍照", "读帧出错：%s" % e)
                img = None
            if img is not None:
                return img
        return None

    def capture(self):
        """快门：在主线程读最新一帧并编码。返回 (res, frame)；res = {data, w, h, thumb, ms}，
        frame 是原图（确认界面显示用，调用方用完就丢）。失败抛异常，由调用方显示「拍照失败」。"""
        if not self.available or self.cam is None:
            raise RuntimeError(self.reason or "摄像头不可用")
        t0 = time.time()
        img = self.read_frame(skip=PHOTO_WARMUP)
        if img is None:
            raise RuntimeError("摄像头读不到画面")
        t_frame = time.time()
        res = self.encode(img)
        res["ms"] = int((time.time() - t0) * 1000)
        log("拍照", "完成：%dx%d %d 字节；出图 %.0f ms，编码 %.0f ms（摄像头保持打开）" % (
            res["w"], res["h"], len(res["data"]), (t_frame - t0) * 1000, (time.time() - t_frame) * 1000))
        return res, img

    @staticmethod
    def encode(img):
        from maix import image as image_mod
        data = _jpeg_bytes(_jpeg_encode(img, image_mod))
        if len(data) < 4 or data[:2] != b"\xff\xd8":
            raise RuntimeError("JPEG 编码结果不对（%d 字节）" % len(data))
        thumb = None
        try:
            thumb = img.resize(THUMB_W, THUMB_H)
        except Exception as e:
            log("拍照", "缩略图失败（不影响上传）：%s" % e)
        try:
            w, h = img.width(), img.height()
        except Exception:
            w, h = PHOTO_W, PHOTO_H
        return {"data": data, "w": w, "h": h, "thumb": thumb, "ms": 0}


class ChatUI(object):
    def __init__(self, image_mod, disp, ts, net, voice, photo=None):
        self.image = image_mod
        self.disp = disp
        self.ts = ts
        self.net = net
        self.tts_notes = set()       # 已经提示过的 (种类, reply_to)：语音失败 / 超长截断，每个回答只提示一次
        self.voice = voice
        self.ui_q = net.ui_q
        self.W, self.H = disp.width(), disp.height()
        self.img = image_mod.Image(self.W, self.H, image_mod.Format.FMT_RGB888)
        self.entries = []            # {"who": me/ai/sys, "text", "mid"}
        self.by_mid = {}             # mid -> (me_entry, ai_entry)
        self.input = ""
        self.mode = "quick"          # quick / kb
        self.status, self.online = "启动中…", False
        self.scroll = 0              # 从底部往上滚了多少行
        self.dirty = True
        self.last_draw = 0
        self.width_cache = {}
        self.wrap_cache = {}
        self.no_wrap_ok = True
        self.font, self.font_s = "", ""
        self.c = lambda r, g, b: image_mod.Color.from_rgb(r, g, b)
        self.colors = dict(bg=self.c(18, 20, 26), bar=self.c(34, 38, 48), text=self.c(235, 235, 235),
                           me=self.c(120, 200, 255), ai=self.c(140, 230, 150), sys=self.c(170, 170, 170),
                           ok=self.c(90, 220, 120), bad=self.c(255, 110, 90), btn=self.c(52, 58, 72),
                           btn_on=self.c(70, 110, 170), edge=self.c(90, 98, 115), rec=self.c(210, 60, 60),
                           voice=self.c(40, 130, 90), dim=self.c(70, 70, 70), box=self.c(28, 30, 38))
        self._load_fonts()
        self._layout()
        self.press = None            # 当前按下的目标
        self.was_pressed = False
        self.last_xy = (0, 0)
        self.drag = None
        self._voice_state = None
        self.photo_cap = photo       # PhotoCapture（None = 不支持拍照）
        self.photo = None            # 已拍好、还没用的照片 {id, t, thumb, bytes}
        self.photo_lock = threading.Lock()   # 录音线程（submit_audio）也会取照片
        self.screen = "chat"         # chat / preview（取景）/ review（拍好了，确认用不用）
        self.cam_shot = None         # review 界面：(res, frame)
        self.cam_t = 0.0             # 进入取景/确认界面的时间（超时自动返回）
        self.cam_frames = 0
        self.cam_fps_t = 0.0
        self.cam_fps = 0.0
        self.cam_ov = {}             # 取景按钮 / 标题栏的预渲染小图（避免每帧画中文字）
        self.cam_ov_ok = True        # draw_image 不可用时退回每帧直接画
        self.focus_off = not FOCUS_AID
        self.focus, self.focus_peak, self.shot_focus = None, 0.0, None
        self.cam_log_t, self.cam_log_n = 0.0, 0
        self.add("sys", "点快捷问题、用键盘输入，或按住「按住说话」提问。")

    # ---- 字体与文字 ----
    def _load_fonts(self):
        im = self.image
        try:
            e1 = im.load_font("cjk", FONT_PATH, size=FONT_SIZE)
            e2 = im.load_font("cjk_s", FONT_PATH, size=FONT_SIZE_SMALL)
            im.set_default_font("cjk")
            self.font, self.font_s = "cjk", "cjk_s"
            log("字体", "已加载 %s（%s, %s）" % (FONT_PATH, e1, e2))
        except Exception as e:
            log("字体", "加载中文字体失败：%s（中文将无法显示，请检查 FONT_PATH）" % e)

    def _size(self, s, font):
        sz = self.image.string_size(s, font=font) if font else self.image.string_size(s)
        try:
            return sz.width(), sz.height()
        except AttributeError:
            return sz[0], sz[1]

    def char_w(self, ch, font):
        """一个字符占的「前进宽度」。
        注意：MaixPy 的 string_size 用的是 OpenCV FreeType2::getTextSize，返回的是墨迹外框宽度，
        不是字符前进宽度（例如 22 号字「，」墨迹只有约 6 像素，实际占 22 像素）。逐字相加会严重低估，
        所以这里用 宽(ch+ch) - 宽(ch) 求真正的前进宽度。"""
        key = (ch, font)
        w = self.width_cache.get(key)
        if w is None:
            if ch == " ":
                w = self._size("a a", font)[0] - self._size("aa", font)[0]
            else:
                one = self._size(ch, font)[0]
                w = self._size(ch + ch, font)[0] - one
                if w <= 0:
                    w = one
            w = max(1, w)
            self.width_cache[key] = w
        return w

    def text_w(self, s, font):
        return sum(self.char_w(ch, font) for ch in to_text(s))

    def wrap(self, text, width, font):
        """按字符（Unicode 码点）折行，从不按字节切。每行最后再用 string_size 实测一遍，
        保证交给 draw_string 的每一行都比可用宽度窄，MaixPy 不会再自己折行叠字。"""
        text = to_text(text)
        key = (text, width, font)
        hit = self.wrap_cache.get(key)
        if hit is not None:
            return hit
        width = max(10, width - WRAP_MARGIN)
        lines = []
        for para in text.split("\n"):
            cur, cw = [], 0
            for ch in para:
                w = self.char_w(ch, font)
                if cur and cw + w > width:
                    lines.append("".join(cur))
                    cur, cw = [], 0
                    if ch == " ":
                        continue
                cur.append(ch)
                cw += w
            lines.append("".join(cur))
        fixed = []
        for ln in lines:
            rest = ""
            while len(ln) > 1 and self._size(ln, font)[0] > width:
                ln, rest = ln[:-1], ln[-1] + rest
            fixed.append(ln)
            while rest:
                ln, rest = rest, ""
                while len(ln) > 1 and self._size(ln, font)[0] > width:
                    ln, rest = ln[:-1], ln[-1] + rest
                fixed.append(ln)
        if len(self.wrap_cache) > 400:
            self.wrap_cache.clear()
        self.wrap_cache[key] = fixed
        return fixed

    def draw_text(self, x, y, s, color, font=None):
        """画一行字。关掉 draw_string 自带的自动折行（wrap=False）：它折出来的下一行会
        画在 y + 字高 + 4 处，和我们自己排好的下一行（行距 FONT_SIZE+6）重叠，叠在一起的汉字就像乱码。"""
        font = self.font if font is None else font
        s = to_text(s)
        kw = {"font": font} if font else {}
        if self.no_wrap_ok:
            try:
                self.img.draw_string(x, y, s, color, wrap=False, **kw)
                return
            except TypeError:
                self.no_wrap_ok = False
                log("字体", "这个固件的 draw_string 不支持 wrap 参数，改用逐行实测宽度防折行")
        self.img.draw_string(x, y, s, color, **kw)

    # ---- 布局（按 640x480 设计，按比例适配其他尺寸）----
    def _layout(self):
        W, H = self.W, self.H
        sy = H / 480.0
        self.top_h = int(36 * sy)
        kb_h = int(136 * sy)
        tool_h = int(60 * sy)
        in_h = int(44 * sy)
        self.panel = (0, H - kb_h, W, kb_h)
        self.tool_y = H - kb_h - tool_h
        self.in_y = self.tool_y - in_h
        self.chat = (0, self.top_h, W, self.in_y - self.top_h)
        self.line_h = FONT_SIZE + 6
        bw = int(W * 0.16)
        self.r_exit = (W - int(W * 0.14), 0, int(W * 0.14), self.top_h)
        self.r_input = (4, self.in_y + 4, W - bw - 12, in_h - 8)
        self.r_send = (W - bw - 4, self.in_y + 4, bw, in_h - 8)
        tw = int(W * 0.18)
        self.r_tab_quick = (4, self.tool_y + 4, tw, tool_h - 8)
        self.r_tab_kb = (8 + tw, self.tool_y + 4, tw, tool_h - 8)
        if PHOTO_ENABLED:
            pw = int(W * 0.16)
            self.r_photo = (12 + 2 * tw, self.tool_y + 4, pw, tool_h - 8)
            self.r_voice = (16 + 2 * tw + pw, self.tool_y + 4, W - 20 - 2 * tw - pw, tool_h - 8)
        else:
            self.r_photo = (0, 0, 0, 0)
            self.r_voice = (12 + 2 * tw, self.tool_y + 4, W - 16 - 2 * tw, tool_h - 8)
        tw2, th2 = int(THUMB_W * W / 640.0), int(THUMB_H * H / 480.0)
        self.r_thumb = (W - tw2 - 8, self.top_h + 4, tw2, th2)
        self.r_thumb_x = (W - 8 - 40, self.top_h + 4, 40, 36)      # 缩略图右上角的「×」：取消照片
        px, py, pw, ph = self.panel
        self.quick_rects = []
        cols, rows = 3, 2
        cw, ch = (pw - 4) // cols, (ph - 4) // rows
        for i in range(min(len(QUICK_QUESTIONS), cols * rows)):
            r, c = divmod(i, cols)
            self.quick_rects.append((px + 4 + c * cw, py + 2 + r * ch, cw - 4, ch - 4))
        self.key_rects = []
        kh = (ph - 4) // len(KB_ROWS)
        unit = W // 10
        for r, row in enumerate(KB_ROWS):
            x = 0
            for label in row:
                w = unit
                if label in ("空格", "清空") and r == 3:
                    w = (W - 7 * unit) // 2
                self.key_rects.append((label, (x + 2, py + 2 + r * kh, w - 4, kh - 4)))
                x += w

    # ---- 聊天数据 ----
    def add(self, who, text, mid=None, photo=False):
        e = {"who": who, "text": to_text(text), "mid": mid}
        if photo:
            e["photo"] = True
        self.entries.append(e)
        if len(self.entries) > 200:
            self.entries = self.entries[-200:]
        self.scroll = 0
        self.dirty = True
        return e

    def submit_text(self, text, source="touch"):
        """统一的提问入口：触摸、键盘、以后的串口输入都调用这里。"""
        text = to_text(text).strip()
        if not text:
            return
        with self.photo_lock:
            ph = self.photo
            iid, note = self._photo_check(ph)
            mid, dup = self.net.send_text_dedup(text, iid)
            if dup:
                # 同一句话还在排队/等回答：不重复发送，避免云端回答好几遍（照片留着）
                self.add("sys", "这句话已经发出，正在等回答，没有重复发送")
                log("提问", "[%s] 重复点击，未重复发送（%s）：%s" % (source, mid, text))
                return
            self._photo_used(ph, iid)
        if note:
            self.add("sys", note)
        self.stop_speech("发了新问题")
        me = self.add("me", text, mid, photo=bool(iid))
        ai = self.add("ai", "发送中…" if self.online else "等待连接…", mid)
        self.by_mid[mid] = (me, ai)
        log("提问", "[%s] %s" % (source, text))

    def stop_speech(self, why):
        """停掉正在念的回答（本地播放队列 + 告诉云端别再发）。"""
        if _tts_player is not None:
            _tts_player.stop_all(why)
        try:
            self.net.tts_stop()
        except Exception as e:
            log("语音", "停止朗读出错：%s" % e)

    def submit_audio(self, pcm):
        """语音入口：录音线程调用，上传 16 kHz 单声道 PCM。"""
        if pcm is None:
            self.ui_q.put(("local", "录音太短，请按住按钮说完再松开"))
            return
        with self.photo_lock:
            ph = self.photo
            iid, note = self._photo_check(ph)
            mid = self.net.send_audio(pcm, getattr(self.voice, "t_release", None), iid)
            self._photo_used(ph, iid)
        if note:
            self.ui_q.put(("local", note))
        self.ui_q.put(("voice_sent", mid, len(pcm) / 2.0 / VOICE_SAMPLE_RATE, bool(iid)))

    # ---- 拍照（v5）----
    def _photo_check(self, ph):
        """提问时决定带不带照片：返回 (image_id 或 None, 本地提示 或 None)。照片用一次就作废。"""
        if ph is None:
            return None, None
        if time.time() - ph["t"] > PHOTO_TTL:
            return None, "照片超过 %d 秒没用，已作废，这次只发文字" % PHOTO_TTL
        net = self.net
        st = net.image_state(ph["id"])
        if st == "failed":
            return None, "照片没传上，先按文字回答"
        if net.cloud_image is False or (net.cloud_image is None and net.cloud_online is not False):
            # 旧版 bridge 不支持照片（电脑助手不在线时先带上，上线后会补传）
            return None, "云端暂不支持照片，先按文字回答"
        return ph["id"], None

    def _photo_used(self, ph, iid):
        if ph is None or self.photo is not ph:
            return
        self.photo = None
        self.dirty = True
        if not iid:
            self.net.drop_image(ph["id"])
        log("拍照", "%s %s" % (ph["id"], "随这个问题发出" if iid else "没带上，已作废"))

    def photo_drop(self, why):
        with self.photo_lock:
            ph, self.photo = self.photo, None
        if ph is not None:
            self.net.drop_image(ph["id"])
            log("拍照", "%s 已作废：%s" % (ph["id"], why))
        self.dirty = True
        return ph

    def take_photo(self):
        self.open_preview("button")

    # ---- 取景界面（v5.1）：点「拍照」→ 实时画面 → 按快门 → 重拍 / 用这张 → 回聊天 ----
    def open_preview(self, source="button"):
        """进入取景界面。source 以后可以是 "cloud"（云端要求开摄像头），现在只有按钮调用。"""
        if self.photo_cap is None:
            self.add("sys", "这台设备不支持拍照")
            return False
        if not getattr(self.photo_cap, "available", True):
            self.add("sys", "拍照失败：%s" % (getattr(self.photo_cap, "reason", "") or "摄像头不可用"))
            return False
        if self.voice.state == "recording":
            return False
        self.screen, self.cam_shot = "preview", None
        self.cam_t, self.cam_frames, self.cam_fps_t, self.cam_fps = time.time(), 0, time.time(), 0.0
        self.cam_log_t, self.cam_log_n = time.time(), 0
        self.focus, self.focus_peak, self.shot_focus = None, 0.0, None
        self.press, self.drag = None, None
        log("拍照", "进入取景界面（%s）" % source)
        return True

    def close_preview(self, why="返回"):
        self.screen, self.cam_shot = "chat", None
        self.press, self.drag = None, None
        self.dirty = True
        gc.collect()
        log("拍照", "退出取景界面：%s" % why)

    def _cam_rects(self):
        W, H = self.W, self.H
        bh, y = int(H * 0.16), H - int(H * 0.16) - 8
        if self.screen == "preview":
            return [("cam_back", "返回", (8, y, int(W * 0.22), bh)),
                    ("cam_shutter", "拍照", ((W - int(W * 0.30)) // 2, y, int(W * 0.30), bh))]
        return [("cam_back", "返回", (8, y, int(W * 0.20), bh)),
                ("cam_retake", "重拍", ((W - int(W * 0.24)) // 2, y, int(W * 0.24), bh)),
                ("cam_use", "用这张", (W - int(W * 0.26) - 8, y, int(W * 0.26), bh))]

    def cam_hit(self, x, y):
        for t, _label, r in self._cam_rects():
            if self.inside(x, y, r):
                return t
        return None

    def cam_click(self, t):
        if t == "cam_back":
            self.close_preview("返回")
        elif t == "cam_shutter" and self.screen == "preview":
            try:
                res, frame = self.photo_cap.capture()
                self.cam_shot = (res, frame)
                self.shot_focus = self._focus_score(frame)
                if self.shot_focus is not None:
                    log("拍照", "照片清晰度 %.0f（本次取景最高 %.0f）" % (self.shot_focus, self.focus_peak))
                self.screen, self.cam_t = "review", time.time()
                self.dirty = True
            except Exception as e:
                log("拍照", "失败：%s: %s" % (type(e).__name__, e))
                self.close_preview("拍照失败")
                self.add("sys", "拍照失败：%s" % e)
        elif t == "cam_retake":
            self.screen, self.cam_shot = "preview", None
            self.cam_t = time.time()
            self.dirty = True
            gc.collect()
        elif t == "cam_use" and self.cam_shot is not None:
            res = self.cam_shot[0]
            self.close_preview("用这张")
            self.on_photo_done(res, None)     # 这时才上传；下一个问题带上这张照片（和以前一样）

    def handle_touch_cam(self):
        x, y, pressed = self.ts.read()
        if pressed:
            self.last_xy = (x, y)
            if not self.was_pressed:
                self.press = self.cam_hit(x, y)
        elif self.was_pressed:
            lx, ly = self.last_xy
            if self.press is not None and self.cam_hit(lx, ly) == self.press:
                self.cam_click(self.press)
            self.press = None
        self.was_pressed = pressed

    def _draw_cam_overlay_direct(self, frame, title):
        """老写法（每帧直接在画面上画矩形和中文）：只在 draw_image 不可用时用，慢（实测取景约 15 fps）。"""
        C = self.colors
        try:
            fw, fh = frame.width(), frame.height()
        except Exception:
            fw, fh = self.W, self.H
        sx, sy = fw / float(self.W), fh / float(self.H)
        saved = self.img
        self.img = frame
        try:
            frame.draw_rect(0, 0, fw, int(self.top_h * sy), C["bar"], -1)
            self.draw_text(8, 4, title, C["text"], self.font_s)
            for t, label, r in self._cam_rects():
                rr = (int(r[0] * sx), int(r[1] * sy), int(r[2] * sx), int(r[3] * sy))
                fill = C["rec"] if t == "cam_shutter" else (C["voice"] if t == "cam_use" else C["btn"])
                self.button(rr, label, fill, font=self.font)
        finally:
            self.img = saved

    def _ov_image(self, w, h, paint):
        """新建一张 w×h 小图，在上面画一次（复用 button / draw_text），返回小图。"""
        im = self.image.Image(w, h, self.image.Format.FMT_RGB888)
        saved = self.img
        self.img = im
        try:
            paint(im)
        finally:
            self.img = saved
        return im

    def _cam_overlay_parts(self, fw, fh, title):
        """按钮按界面（preview / review）各渲染一次后缓存；标题栏只在文字变了时重画（约每秒一次）。"""
        C = self.colors
        sx, sy = fw / float(self.W), fh / float(self.H)
        key = (self.screen, fw, fh)
        btns = self.cam_ov.get(key)
        if btns is None:
            btns = []
            for t, label, r in self._cam_rects():
                x, y, w, h = int(r[0] * sx), int(r[1] * sy), max(8, int(r[2] * sx)), max(8, int(r[3] * sy))
                fill = C["rec"] if t == "cam_shutter" else (C["voice"] if t == "cam_use" else C["btn"])
                im = self._ov_image(w, h, lambda _im, w=w, h=h, label=label, fill=fill:
                                    self.button((0, 0, w, h), label, fill, font=self.font))
                btns.append((x, y, im))
            self.cam_ov[key] = btns
        bar_key = ("bar", fw, fh, title)
        bar = self.cam_ov.get("bar")
        if bar is None or bar[0] != bar_key:
            bh = max(8, int(self.top_h * sy))

            def paint(im):
                im.draw_rect(0, 0, fw, bh, C["bar"], -1)
                self.draw_text(8, 4, title, C["text"], self.font_s)
            bar = (bar_key, self._ov_image(fw, bh, paint))
            self.cam_ov["bar"] = bar
        return bar[1], btns

    def _draw_cam_overlay(self, frame, title):
        """把标题栏和按钮贴到摄像头画面上：贴预渲染好的小图（memcpy 级），不再每帧排版、画中文。"""
        try:
            fw, fh = frame.width(), frame.height()
        except Exception:
            fw, fh = self.W, self.H
        if self.cam_ov_ok:
            try:
                bar, btns = self._cam_overlay_parts(fw, fh, title)
                frame.draw_image(0, 0, bar)
                for x, y, im in btns:
                    frame.draw_image(x, y, im)
                return
            except Exception as e:
                self.cam_ov_ok, self.cam_ov = False, {}
                log("拍照", "预渲染按钮不可用，改回每帧直接画（会慢一些）：%s: %s" % (type(e).__name__, e))
        self._draw_cam_overlay_direct(frame, title)

    def _focus_score(self, frame):
        """清晰度：画面中心 160x120 绿色通道的拉普拉斯方差（越大越清楚；只和同一场景比）。
        用 image2cv(copy=False) 零拷贝 + cv2，约 1~2 ms。任何一步不支持就永久关掉，不影响取景。"""
        if self.focus_off:
            return None
        try:
            cv2 = getattr(self, "_cv2", None)
            if cv2 is None:
                import cv2
                from maix import image as _im
                self._cv2, self._image2cv = cv2, _im.image2cv
            a = self._image2cv(frame, ensure_bgr=False, copy=False)
            h, w = a.shape[0], a.shape[1]
            g = a[h // 2 - 60:h // 2 + 60, w // 2 - 80:w // 2 + 80, 1].copy()
            return float(cv2.Laplacian(g, cv2.CV_16S).var())
        except Exception as e:
            self.focus_off = True
            log("拍照", "清晰度提示不可用（不影响拍照）：%s: %s" % (type(e).__name__, e))
            return None

    def step_camera(self):
        """取景 / 确认界面的一帧。全部在主线程：读摄像头、贴按钮、显示。"""
        self.handle_touch_cam()
        if self.screen == "chat":
            return
        if time.time() - self.cam_t > PREVIEW_TIMEOUT:
            self.close_preview("超时")
            self.add("sys", "取景超过 %d 秒没操作，已返回" % PREVIEW_TIMEOUT)
            return
        if self.screen == "preview":
            frame = self.photo_cap.read_frame()
            if frame is None:
                self.close_preview("读不到画面")
                self.add("sys", "拍照失败：摄像头读不到画面")
                return
            self.cam_frames += 1
            self.cam_log_n += 1
            self.cam_total = getattr(self, "cam_total", 0) + 1
            if not self.focus_off and self.cam_total % max(1, FOCUS_EVERY) == 1 % max(1, FOCUS_EVERY):
                f = self._focus_score(frame)
                if f is not None:
                    self.focus = f
                    self.focus_peak = max(self.focus_peak, f)
            now = time.time()
            if now - self.cam_fps_t >= 1.0:
                self.cam_fps = self.cam_frames / (now - self.cam_fps_t)
                self.cam_frames, self.cam_fps_t = 0, now
            if now - self.cam_log_t >= PREVIEW_FPS_LOG:
                log("拍照", "取景实测 %.1f fps（%d 帧 / %.1f 秒）%s" % (
                    self.cam_log_n / (now - self.cam_log_t), self.cam_log_n, now - self.cam_log_t,
                    "" if self.focus is None else "，清晰度 %.0f（最高 %.0f）" % (self.focus, self.focus_peak)))
                self.cam_log_t, self.cam_log_n = now, 0
            title = "取景 %.0f fps" % self.cam_fps
            if self.focus is not None:
                title += "  清晰度 %d（最高 %d）" % (int(self.focus), int(self.focus_peak))
            self._draw_cam_overlay(frame, title)
            self.disp.show(frame)
            frame = None
        elif self.dirty or time.time() - self.last_draw > 1.0:
            res, frame = self.cam_shot
            title = "%d KB  用这张？" % (len(res["data"]) // 1024)
            sf = self.shot_focus
            if sf is not None and self.focus_peak > 0 and sf < FOCUS_WARN_RATIO * self.focus_peak:
                title = "照片可能有点虚，要重拍吗？"
            self._draw_cam_overlay(frame, title)
            self.disp.show(frame)
            self.last_draw, self.dirty = time.time(), False

    def on_photo_done(self, res, err):
        if err or not res:
            self.add("sys", "拍照失败：%s" % (err or "未知原因"))
            return
        old = self.photo_drop("重拍")
        iid = self.net.new_mid("p")
        self.net.send_image(iid, res["data"], res["w"], res["h"])
        with self.photo_lock:
            self.photo = {"id": iid, "t": time.time(), "thumb": res.get("thumb"), "bytes": len(res["data"])}
        self.add("sys", "已重拍，按住说话提问" if old else "已拍照，按住说话提问（点照片右上角 × 取消）")

    def poll_external_input(self):
        """扩展点：以后接串口 / 按键 / 其他输入时，在这里返回一条要发送的文字，没有就返回 None。"""
        return None

    def handle_event(self, ev):
        kind = ev[0]
        if kind == "status":
            self.status, self.online = ev[1], ev[2]
        elif kind == "tts_play":
            speak_answer(None, pcm=ev[2], tts_id=ev[1], meta=ev[3] if len(ev) > 3 else None)
            return
        elif kind == "tts_fail":
            rt = ev[3] if len(ev) > 3 else None
            if rt is None and _tts_player is not None:
                rt = _tts_player.reply_of.get(ev[1])
            log("语音", "%s 播放失败：%s" % (ev[1], ev[2]))
            if rt is None or ("fail", rt) not in self.tts_notes:
                if rt is not None:
                    self.tts_notes.add(("fail", rt))     # 同一个回答只提示一次
                self.add("sys", "语音播放失败")
        elif kind == "tts_notice":
            if ("trunc", ev[1]) not in self.tts_notes:
                self.tts_notes.add(("trunc", ev[1]))
                self.add("sys", "后面的内容请看文字")
        elif kind == "tts_drop":
            if _tts_player is not None:
                _tts_player.drop(ev[1])
            return
        elif kind == "local":
            self.add("sys", ev[1])
        elif kind == "photo_done":
            self.on_photo_done(ev[1], ev[2])
        elif kind == "photo_fail":
            ph = self.photo
            if ph is not None and ph["id"] == ev[1]:
                self.photo_drop("上传失败")
                self.add("sys", "照片没传上（%s），请重拍" % ev[2])
        elif kind == "photo_note":
            self.add("sys", ev[2])
        elif kind == "voice_sent":
            mid = ev[1]
            me = self.add("me", "（语音 %.1f 秒，识别中…）" % ev[2], mid, photo=len(ev) > 3 and ev[3])
            ai = self.add("ai", "上传中…", mid)
            self.by_mid[mid] = (me, ai)
        else:
            mid = ev[1]
            pair = self.by_mid.get(mid)
            if pair is None:
                if kind == "ai":
                    ai = self.add("ai", "", mid)
                    self.by_mid[mid] = (None, ai)
                    self.add_part(ai, ev)
                elif kind == "error":
                    self.add("sys", "错误：%s" % ev[2])
                self.dirty = True
                return
            me, ai = pair
            started = bool(ai.get("parts"))
            if kind == "ack":
                if not started and not ai.get("done"):
                    ai["text"] = "思考中…"
            elif kind == "asr":
                if me is not None:
                    me["text"] = ev[2] or "（没听清，请再说一次）"
                if not started and not ai.get("done"):
                    ai["text"] = "思考中…" if ev[2] else "—"
            elif kind in ("warn", "queued"):
                if not started and not ai.get("done"):
                    ai["text"] = ev[2]
            elif kind == "ai":
                self.add_part(ai, ev)
            elif kind == "error":
                if started:
                    if ai.get("typing"):
                        ai["typing"], ai["done"] = False, True
                        self.add("sys", "后续内容出错：%s" % ev[2])
                elif not ai.get("done"):
                    ai["who"], ai["text"], ai["done"] = "sys", "失败：%s" % ev[2], True
            self.scroll = 0
        self.dirty = True

    @staticmethod
    def _join_parts(parts):
        out = ""
        for k in sorted(parts):
            t = parts[k]
            if out and t and out[-1].isascii() and out[-1].isalnum() and t[0].isascii() and t[0].isalnum():
                out += " "
            out += t
        return out

    def add_part(self, ai, ev):
        """分段回答：按 seq 排好拼进同一个 AI 气泡；重复的段忽略；乱序到达也按 seq 放对位置。"""
        text = ev[2]
        seq = ev[3] if len(ev) > 3 else 1
        final = ev[4] if len(ev) > 4 else True
        parts = ai.setdefault("parts", {})
        if seq in parts:
            log("回答", "%s 第 %d 段重复，已忽略" % (ai.get("mid"), seq))
            return
        first = not parts
        if ai.get("who") == "sys":
            ai["who"] = "ai"       # 之前显示过失败（如触发结果不明），回答后来还是到了
        parts[seq] = text
        if final:
            ai["final_seq"] = seq
        ai["text"] = self._join_parts(parts) or "（空回答）"
        ai["last_part"] = time.time()
        fs = ai.get("final_seq")
        complete = fs is not None and all(i in parts for i in range(1, fs + 1))
        ai["typing"] = not complete
        ai["done"] = True          # 已经有回答了：之后的 ack / warn / error 不会再覆盖它
        if first:
            speak_answer(text)     # 只在第一段「叮」一声

    def check_typing(self):
        now = time.time()
        for e in self.entries:
            if e.get("typing") and now - e.get("last_part", now) > PART_IDLE_TIMEOUT:
                e["typing"] = False
                log("回答", "%s 等最后一段超过 %d 秒，不再显示「…」" % (e.get("mid"), PART_IDLE_TIMEOUT))
                self.dirty = True

    # ---- 触摸 ----
    @staticmethod
    def inside(x, y, r):
        return r[0] <= x < r[0] + r[2] and r[1] <= y < r[1] + r[3]

    def hit(self, x, y):
        if self.inside(x, y, self.r_exit):
            return "exit"
        if self.inside(x, y, self.r_send):
            return "send"
        if self.inside(x, y, self.r_tab_quick):
            return "tab_quick"
        if self.inside(x, y, self.r_tab_kb):
            return "tab_kb"
        if self.inside(x, y, self.r_voice):
            return "voice"
        if PHOTO_ENABLED and self.inside(x, y, self.r_photo):
            return "photo"
        if self.photo is not None and self.inside(x, y, self.r_thumb_x):
            return "photo_cancel"
        if self.inside(x, y, self.chat):
            return "chat"
        if self.mode == "quick":
            for i, r in enumerate(self.quick_rects):
                if self.inside(x, y, r):
                    return ("q", i)
        else:
            for label, r in self.key_rects:
                if self.inside(x, y, r):
                    return ("k", label)
        return None

    def click(self, t):
        if t == "exit":
            request_exit()
        elif t == "send":
            self.submit_text(self.input, "keyboard")
            self.input = ""
        elif t == "tab_quick":
            self.mode = "quick"
        elif t == "tab_kb":
            self.mode = "kb"
        elif t == "photo":
            self.take_photo()
        elif t == "photo_cancel":
            if self.photo_drop("用户取消") is not None:
                self.add("sys", "已取消照片")
        elif t == "voice" and self.voice.state == "disabled":
            self.add("sys", "语音不可用：%s" % self.voice.reason)
        elif isinstance(t, tuple) and t[0] == "q":
            self.submit_text(QUICK_QUESTIONS[t[1]], "quick")
        elif isinstance(t, tuple) and t[0] == "k":
            k = t[1]
            if k == "退格":
                self.input = self.input[:-1]
            elif k == "清空":
                self.input = ""
            elif k == "空格":
                self.input += " "
            elif len(self.input) < 200:
                self.input += k
        self.dirty = True

    def handle_touch(self):
        x, y, pressed = self.ts.read()
        if pressed:
            self.last_xy = (x, y)
            if not self.was_pressed:
                self.press = self.hit(x, y)
                if self.press == "voice":
                    self.stop_speech("按下录音键")
                    self.voice.press()
                    self.dirty = True
                elif self.press == "chat":
                    self.drag = (y, self.scroll)
            elif self.press == "chat" and self.drag:
                lines = int((y - self.drag[0]) / self.line_h)
                ns = max(0, self.drag[1] + lines)
                if ns != self.scroll:
                    self.scroll, self.dirty = ns, True
        elif self.was_pressed:
            lx, ly = self.last_xy
            if self.press == "voice":
                self.voice.release()
            elif self.press not in (None, "chat") and self.hit(lx, ly) == self.press:
                self.click(self.press)
            self.press, self.drag = None, None
            self.dirty = True
        self.was_pressed = pressed

    # ---- 绘制 ----
    def button(self, r, label, fill, font=None, center=True):
        C = self.colors
        self.img.draw_rect(r[0], r[1], r[2], r[3], fill, -1)
        self.img.draw_rect(r[0], r[1], r[2], r[3], C["edge"], 1)
        font = self.font_s if font is None else font
        lines = self.wrap(label, r[2] - 10, font)[:2]
        lh = (FONT_SIZE_SMALL if font == self.font_s else FONT_SIZE) + 4
        y = r[1] + (r[3] - lh * len(lines)) // 2
        for ln in lines:
            x = r[0] + (r[2] - self.text_w(ln, font)) // 2 if center else r[0] + 6
            self.draw_text(x, y, ln, C["text"], font)
            y += lh

    def render(self):
        C, img, W = self.colors, self.img, self.W
        img.draw_rect(0, 0, W, self.H, C["bg"], -1)
        # 顶部状态栏
        img.draw_rect(0, 0, W, self.top_h, C["bar"], -1)
        self.draw_text(8, (self.top_h - FONT_SIZE_SMALL) // 2 - 2, "AI 问答", C["text"], self.font_s)
        dot = C["ok"] if self.online else C["bad"]
        img.draw_rect(100, self.top_h // 2 - 5, 10, 10, dot, -1)
        self.draw_text(116, (self.top_h - FONT_SIZE_SMALL) // 2 - 2, self.status[:24], dot, self.font_s)
        self.button(self.r_exit, "退出", C["btn"])
        # 聊天区
        cx, cy, cw, ch = self.chat
        lines = []
        for e in self.entries:
            prefix = {"me": "我：", "ai": "AI：", "sys": "· "}[e["who"]]
            if e.get("photo"):
                prefix += "[照片] "
            suffix = " …" if e.get("typing") else ""
            for ln in self.wrap(prefix + e["text"] + suffix, cw - 16, self.font):
                lines.append((ln, C[e["who"]]))
            lines.append(("", None))
        visible = max(1, (ch - 4) // self.line_h)
        self.scroll = min(self.scroll, max(0, len(lines) - visible))
        end = len(lines) - self.scroll
        y = cy + 4
        for ln, color in lines[max(0, end - visible):end]:
            if ln:
                self.draw_text(cx + 8, y, ln, color)
            y += self.line_h
        if self.scroll:
            self.draw_text(W - 120, cy + 4, "已上翻 %d 行" % self.scroll, C["sys"], self.font_s)
        ph = self.photo
        if ph is not None:
            self.draw_thumb(ph)
        # 输入行
        r = self.r_input
        img.draw_rect(r[0], r[1], r[2], r[3], C["box"], -1)
        img.draw_rect(r[0], r[1], r[2], r[3], C["edge"], 1)
        shown = self.input or "用下方键盘输入（拼音 / 英文 / 数字）"
        while shown and self.text_w(shown, self.font_s) > r[2] - 12:
            shown = shown[1:]
        self.draw_text(r[0] + 6, r[1] + (r[3] - FONT_SIZE_SMALL) // 2 - 2, shown,
                       C["text"] if self.input else C["sys"], self.font_s)
        self.button(self.r_send, "发送", C["btn_on"] if self.input else C["btn"])
        # 工具行
        self.button(self.r_tab_quick, "快捷问题", C["btn_on"] if self.mode == "quick" else C["btn"])
        self.button(self.r_tab_kb, "键盘", C["btn_on"] if self.mode == "kb" else C["btn"])
        if PHOTO_ENABLED:
            if self.photo_cap is not None and self.photo_cap.busy:
                pl, pc = "拍照中…", C["dim"]
            elif self.photo is not None:
                pl, pc = "重拍", C["btn_on"]
            else:
                pl, pc = "拍照", C["btn"]
            self.button(self.r_photo, pl, pc)
        st = self.voice.state
        if st == "recording":
            vl, vc = "松开发送（%d/%d 秒）" % (int(self.voice.elapsed()), VOICE_MAX_SECONDS), C["rec"]
        elif st == "ready":
            vl, vc = "按住说话", C["voice"]
        elif st == "loading":
            vl, vc = "麦克风准备中…", C["dim"]
        else:
            vl, vc = "语音不可用", C["dim"]
        self.button(self.r_voice, vl, vc, self.font)
        # 底部面板
        if self.mode == "quick":
            for i, rr in enumerate(self.quick_rects):
                self.button(rr, QUICK_QUESTIONS[i], C["btn"])
        else:
            for label, rr in self.key_rects:
                self.button(rr, label, C["btn"])
        self.disp.show(img)
        self.last_draw = time.time()
        self.dirty = False

    def draw_thumb(self, ph):
        C, img = self.colors, self.img
        x, y, w, h = self.r_thumb
        th = ph.get("thumb")
        if th is not None:
            try:
                img.draw_image(x, y, th)
            except Exception as e:
                log("拍照", "画缩略图失败，改成文字框：%s" % e)
                ph["thumb"] = th = None
        if th is None:
            img.draw_rect(x, y, w, h, C["box"], -1)
            self.draw_text(x + 8, y + h // 2 - 10, "照片 %d KB" % (ph["bytes"] // 1024), C["text"], self.font_s)
        img.draw_rect(x, y, w, h, C["edge"], 2)
        left = max(0, int(PHOTO_TTL - (time.time() - ph["t"])))
        self.draw_text(x + 4, y + h - FONT_SIZE_SMALL - 4, "%d 秒" % left, C["text"], self.font_s)
        bx, by, bw, bh = self.r_thumb_x
        img.draw_rect(bx, by, bw, bh, C["rec"], -1)
        self.draw_text(bx + (bw - self.text_w("×", self.font)) // 2, by + (bh - FONT_SIZE) // 2 - 2, "×",
                       C["text"], self.font)

    # ---- 主循环 ----
    def step(self):
        if self.screen != "chat":
            self.step_camera()          # 取景时不显示聊天界面、没有按住说话键；后台消息照收，朗读照播
        else:
            self.handle_touch()
        ph = self.photo
        if ph is not None and time.time() - ph["t"] > PHOTO_TTL:
            if self.photo_drop("超时") is not None:
                self.add("sys", "照片超过 %d 秒没用，已作废" % PHOTO_TTL)
        while True:
            try:
                ev = self.ui_q.get_nowait()
            except queue.Empty:
                break
            self.handle_event(ev)
        self.check_typing()
        ext = self.poll_external_input()
        if ext:
            self.submit_text(ext, "external")
        vs = (self.voice.state, int(self.voice.elapsed()))
        if vs != self._voice_state:
            self._voice_state, self.dirty = vs, True
        if self.screen == "chat" and (self.dirty or time.time() - self.last_draw > 1.0):
            self.render()

    def run(self):
        while not need_exit():
            try:
                self.step()
            except Exception as e:      # 取景 / 拍照出任何错都只回到聊天界面，不让程序退出
                if self.screen == "chat":
                    raise
                log("拍照", "取景界面出错：%s: %s" % (type(e).__name__, e))
                self.close_preview("出错")
                self.add("sys", "拍照失败：%s" % e)
            # 取景时不额外睡：cam.read() 本身会等下一帧（60 fps 传感器），sleep(0) 只让出 GIL 给网络/录音线程
            time.sleep(0 if self.screen == "preview" else 0.02)


def main():
    from maix import display, image, touchscreen
    disp = display.Display()
    ts = touchscreen.TouchScreen()
    log("屏幕", "分辨率 %dx%d" % (disp.width(), disp.height()))
    ui_q = queue.Queue()
    net = NetWorker(ui_q)
    holder = {}
    voice = VoiceRecorder(lambda pcm: holder["ui"].submit_audio(pcm))
    photo = None
    if PHOTO_ENABLED:
        # 摄像头只在这里（主线程、屏幕之后、录音/播放/联网线程启动之前）打开一次，运行期间不关。
        photo = PhotoCapture(lambda res, err: ui_q.put(("photo_done", res, err)))
        photo.open()
    ui = ChatUI(image, disp, ts, net, voice, photo)
    holder["ui"] = ui
    global _tts_player
    if TTS_ENABLED:
        _tts_player = TtsPlayer(is_busy=lambda: voice.state == "recording",
                                on_error=lambda tid, why: ui_q.put(("tts_fail", tid, why)))
    net.start()
    voice.start_thread()
    try:
        ui.run()
    except KeyboardInterrupt:
        log("退出", "用户停止程序")
    finally:
        voice.release()
        net.close()
        log("退出", "程序结束")


if __name__ == "__main__":
    main()
