#!/usr/bin/env python3
"""Native desktop MQTT/UDP monitor. Passwords stay in memory."""
import csv
import json
import math
import os
import socket
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from PyQt5.QtCore import Qt, QObject, pyqtSignal, QTimer, QRectF, QPointF, QSettings
from PyQt5.QtGui import QColor, QPainter, QPen, QPainterPath, QImage, QPixmap, QFont
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QLabel, QPushButton,
    QVBoxLayout, QHBoxLayout, QGridLayout, QFrame, QDialog, QFormLayout, QLineEdit,
    QSpinBox, QDialogButtonBox, QMessageBox, QFileDialog, QComboBox)
from PyQt5.QtNetwork import QUdpSocket, QHostAddress
from PyQt5.QtCore import QProcess
import paho.mqtt.client as mqtt

BEIJING = timezone(timedelta(hours=8))
TOPIC = 'dr_wei/'
DATA = Path.home() / '.local/share/smart-monitor-pc'


def beijing(stamp=None):
    return datetime.fromtimestamp(time.time() if stamp is None else stamp, BEIJING)


class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        self.db.execute('CREATE TABLE IF NOT EXISTS samples (time REAL PRIMARY KEY, temperature REAL, light REAL)')

    def add(self, stamp, temperature, light):
        self.db.execute('INSERT OR REPLACE INTO samples VALUES (?,?,?)', (stamp, temperature, light))
        self.db.commit()

    def rows(self, seconds=86400):
        return list(self.db.execute('SELECT * FROM samples WHERE time>=? ORDER BY time', (time.time()-seconds,)))


class Link(QObject):
    status = pyqtSignal(bool, str)
    message = pyqtSignal(str, bytes, bool)

    def __init__(self):
        super().__init__()
        self.client = None
        self.online = False

    def stop(self):
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
            self.client = None
        self.online = False

    def start(self, host, port, username, password):
        self.stop()
        # Both distro Paho 1.x and current 2.x support these legacy callbacks.
        kwargs = {'client_id': 'DR_WEI_PC_' + uuid.uuid4().hex[:12]}
        if hasattr(mqtt, 'CallbackAPIVersion'):
            kwargs['callback_api_version'] = mqtt.CallbackAPIVersion.VERSION1
        c = mqtt.Client(**kwargs)
        self.client = c
        c.username_pw_set(username, password)
        c.tls_set()  # System CA store, hostname verification enabled.
        c.reconnect_delay_set(2, 30)
        c.on_connect = self.connected
        c.on_disconnect = self.disconnected
        c.on_subscribe = self.subscribed
        c.on_message = lambda client, userdata, msg: self.message.emit(msg.topic, bytes(msg.payload), msg.retain) if len(msg.payload) <= 16384 else None
        c.on_connect_fail = lambda client, userdata: self.status.emit(False, '连接失败，正在重试')
        c.connect_async(host, port, 30)
        c.loop_start()
        self.status.emit(False, '正在连接…')

    def connected(self, client, userdata, flags, rc):
        if rc:
            self.status.emit(False, '认证或连接失败：%s' % mqtt.connack_string(rc))
            return
        client.subscribe([(TOPIC+t, 1) for t in ['temperature','light','status','led/status','camera/status','will']])

    def subscribed(self, client, userdata, mid, granted):
        self.online = bool(granted) and all(q in (0, 1, 2) for q in granted)
        self.status.emit(self.online, '已连接 · 订阅成功' if self.online else '订阅被拒绝')

    def disconnected(self, client, userdata, rc):
        self.online = False
        self.status.emit(False, '连接已断开，自动重连中' if rc else '已断开')

    def send(self, topic, payload):
        if not self.online:
            return False
        return self.client.publish(TOPIC+topic, payload, qos=1, retain=False).rc == mqtt.MQTT_ERR_SUCCESS


class CloudLink(QObject):
    status = pyqtSignal(bool, str)
    message = pyqtSignal(str, bytes, bool)
    result = pyqtSignal(bool, str)
    def __init__(self):
        super().__init__(); self.online=False; self.buffer=bytearray(); self.process=QProcess(self)
        self.process.readyReadStandardOutput.connect(self.read)
        self.process.finished.connect(self.finished)
    def start(self):
        self.process.setWorkingDirectory(str(Path(__file__).resolve().parent))
        self.process.start('node', ['cloud_adapter.mjs'])
        self.status.emit(False,'正在连接…')
    def finished(self,*args):
        self.online=False; self.status.emit(False,'连接程序已退出，请检查共享目录和 Node 环境')
    def read(self):
        self.buffer.extend(bytes(self.process.readAllStandardOutput()))
        while b'\n' in self.buffer:
            line,_,rest=self.buffer.partition(b'\n'); self.buffer=bytearray(rest)
            try: m=json.loads(line)
            except (ValueError,UnicodeError): continue
            kind=m.get('type')
            if kind=='connection': self.online=bool(m.get('online')); self.status.emit(self.online,m.get('detail',''))
            elif kind=='offline': self.message.emit(TOPIC+'will',b'Offline',False)
            elif kind=='mini_state':
                state={'temperature':m.get('temperature_c'),'light':m.get('illuminance_lux'),'led':'1' if m.get('led_on') is True else '0' if m.get('led_on') is False else 'unknown'}
                self.message.emit(TOPIC+'status',json.dumps(state).encode(),False)
            elif kind=='result': self.result.emit(bool(m.get('ok')),str(m.get('reason') or '状态未确认'))
    def send(self,topic,payload):
        if not self.online or topic!='led' or payload not in ('0','1'): return False
        return self.process.write((json.dumps({'type':'set_led','value':payload=='1'})+'\n').encode())>0
    def stop(self):
        self.process.terminate(); self.process.waitForFinished(1500); self.online=False


class Chart(QWidget):
    def __init__(self, store):
        super().__init__()
        self.store, self.seconds = store, 900
        self.setMinimumSize(240, 145)

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        area = QRectF(42, 16, self.width()-58, self.height()-46)
        rows = self.store.rows(self.seconds)
        vals = [r[1] for r in rows if r[1] is not None]
        low, high = (min(vals)-5, max(vals)+5) if vals else (0, 80)
        now = time.time()
        p.setFont(QFont('Noto Sans CJK SC', 9))
        for i in range(5):
            y = area.bottom() - area.height()*i/4
            p.setPen(QColor('#e1ebf5')); p.drawLine(QPointF(area.left(), y), QPointF(area.right(), y))
            p.setPen(QColor('#7890ae')); p.drawText(QRectF(0,y-9,36,18), Qt.AlignRight, '%.0f' % (low+(high-low)*i/4))
        path, prev = QPainterPath(), None
        for stamp, value, _ in rows:
            if value is None:
                prev = None
                continue
            point = QPointF(area.left()+(stamp-(now-self.seconds))/self.seconds*area.width(), area.bottom()-(value-low)/(high-low)*area.height())
            if prev is None or stamp-prev > 90: path.moveTo(point)
            else: path.lineTo(point)
            p.setPen(QPen(QColor('#347cff'), 4)); p.drawPoint(point)
            prev = stamp
        p.setPen(QPen(QColor('#347cff'), 2)); p.drawPath(path)
        p.setPen(QColor('#7890ae'))
        for i in range(3):
            x = area.left()+i*area.width()/2
            p.drawText(QRectF(x-27,area.bottom()+8,54,20),Qt.AlignCenter,beijing(now-self.seconds+i*self.seconds/2).strftime('%H:%M'))


class Settings(QDialog):
    def __init__(self, window):
        super().__init__(window)
        self.setWindowTitle('连接设置')
        self.setMinimumWidth(440)
        form = QFormLayout(self)
        self.host = QLineEdit(window.config.value('host','mqtt.example.invalid'))
        self.port = QSpinBox(); self.port.setRange(1,65535); self.port.setValue(int(window.config.value('port',8883)))
        self.user = QLineEdit(window.config.value('user','example-user'))
        self.password = QLineEdit(window.password); self.password.setEchoMode(QLineEdit.Password)
        self.board = QLineEdit(window.config.value('board','192.0.2.20'))
        for title, field in [('MQTT 服务器',self.host),('TLS 端口',self.port),('用户名',self.user),('密码（仅本次运行）',self.password),('开发板 IPv4',self.board)]: form.addRow(title,field)
        note = QLabel('视频接收端口：UDP 5004\n请在板端设置中，将视频接收 IP 设为本电脑连接开发板的 IPv4。')
        note.setWordWrap(True); form.addRow(note)
        buttons=QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept); buttons.rejected.connect(self.reject); form.addRow(buttons)


class Window(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('智能监控终端 · 电脑上位机')
        self.resize(1200,800); self.setMinimumSize(1000,800)
        self.config=QSettings('DrWei','SmartMonitorPC')
        self.password=os.environ.get('MQTT_PASS','')
        self.store=Store(DATA/'history.sqlite3')
        self.link=CloudLink(); self.link.status.connect(self.connection); self.link.message.connect(self.receive); self.link.result.connect(self.cloud_result)
        self.last_live=0; self.last_sample=0; self.last_frame=0; self.frames=0; self.board_uptime=0
        self.temperature=None; self.light=None; self.camera_active=False; self.camera_detail='等待设备状态'
        self.image=None; self.started=time.monotonic(); self.pending={}
        root=QWidget(); self.setCentralWidget(root); layout=QVBoxLayout(root); layout.setContentsMargins(20,16,20,16); layout.setSpacing(18)
        header=QFrame(); header.setObjectName('header'); h=QHBoxLayout(header)
        title=QLabel('▦  智能监控终端'); title.setObjectName('title'); h.addWidget(title); h.addStretch()
        self.connection_label=QLabel('● 云端未连接'); h.addWidget(self.connection_label)
        self.clock=QLabel(); h.addWidget(self.clock)
        settings=QPushButton('⚙  设置'); settings.clicked.connect(self.settings); h.addWidget(settings); layout.addWidget(header)
        grid=QGridLayout(); grid.setSpacing(18); layout.addLayout(grid,1)
        sensor, sl=self.card('环境监测')
        sensor.setMinimumHeight(370)
        sl.setSpacing(2)
        metrics=QHBoxLayout(); self.temp_label=self.create_metric(metrics,'当前温度','芯片温度 · °C'); self.light_label=self.create_metric(metrics,'当前光照','AP3216C · lx'); sl.addLayout(metrics)
        sl.addWidget(QLabel('实时温度趋势 / °C')); self.chart=Chart(self.store); sl.addWidget(self.chart)
        self.updated=QLabel('等待设备上报'); sl.addWidget(self.updated); grid.addWidget(sensor,0,0)
        control, cl=self.card('设备控制'); self.led_label=QLabel('LED：等待设备状态'); cl.addWidget(self.led_label)
        buttons=QGridLayout(); cl.addLayout(buttons)
        self.controls=[]
        for i,(name,topic,payload,color) in enumerate([('LED 开','led','1','#12bb94'),('LED 关','led','0','#758da9'),('呼吸灯','led','2','#387cff'),('摄像头开启','camera/cmd','on','#8769f5'),('摄像头关闭','camera/cmd','off','#758da9')]):
            b=QPushButton(name); b.setMinimumHeight(46); b.setStyleSheet('background:%s;color:white;font-weight:bold'%color)
            b.clicked.connect(lambda checked=False,t=topic,p=payload:self.command(t,p)); buttons.addWidget(b,i//3,i%3); self.controls.append(b)
        history=QPushButton('历史曲线 / 导出 CSV'); history.clicked.connect(self.history); buttons.addWidget(history,1,2)
        self.command_label=QLabel('控制结果以设备状态回报为准'); self.command_label.setWordWrap(True); cl.addWidget(self.command_label); grid.addWidget(control,1,0)
        video, vl=self.card('摄像头画面'); self.video_status=QLabel('等待设备状态'); vl.addWidget(self.video_status)
        self.video=QLabel('等待视频信号'); self.video.setAlignment(Qt.AlignCenter); self.video.setMinimumSize(420,320); self.video.setStyleSheet('background:#102443;color:#b5cbe8;border-radius:12px;font-size:20px;'); vl.addWidget(self.video,1)
        self.video_note=QLabel('UDP 5004 · 176 × 144 · RGB565'); vl.addWidget(self.video_note); grid.addWidget(video,0,1,2,1); grid.setColumnStretch(0,1); grid.setColumnStretch(1,1)
        footer, fl=self.card(''); self.device_label=QLabel('● 设备状态未知'); self.uptime_label=QLabel(''); footer_row=QHBoxLayout(); footer_row.addWidget(self.device_label); footer_row.addStretch(); footer_row.addWidget(self.uptime_label); fl.addLayout(footer_row); layout.addWidget(footer)
        self.setStyleSheet('''QMainWindow{background:#edf5ff} QWidget{font-family:"Noto Sans CJK SC";font-size:14px;color:#16375d} QFrame#card{background:white;border:1px solid #cfe1f0;border-radius:15px} QFrame#header{background:#183e6b;border-radius:12px} QFrame#header QLabel{color:white} QLabel#title{font-size:27px;font-weight:bold} QLabel#section{font-size:20px;font-weight:bold} QPushButton{border:1px solid #d6e4f2;border-radius:9px;padding:10px;background:#f1f6ff} QPushButton:disabled{background:#dae3ee;color:#8796a8} QLineEdit,QSpinBox,QComboBox{padding:7px;border:1px solid #b6cde3;border-radius:5px;background:white}''')
        self.udp=QUdpSocket(self)
        if not self.udp.bind(QHostAddress.AnyIPv4,5004): self.video_note.setText('视频端口占用：'+self.udp.errorString())
        self.udp.readyRead.connect(self.datagrams)
        self.timer=QTimer(self); self.timer.timeout.connect(self.tick); self.timer.start(1000); self.tick()
        QTimer.singleShot(100,self.link.start)

    def card(self,title):
        frame=QFrame(); frame.setObjectName('card'); layout=QVBoxLayout(frame); layout.setContentsMargins(18,15,18,15)
        if title:
            label=QLabel(title); label.setObjectName('section'); layout.addWidget(label)
        return frame,layout

    def create_metric(self,layout,title,unit):
        box=QVBoxLayout(); box.addWidget(QLabel(title)); value=QLabel('—'); value.setStyleSheet('font-size:42px;font-weight:bold'); box.addWidget(value); box.addWidget(QLabel(unit)); layout.addLayout(box); return value

    def settings(self):
        QMessageBox.information(self, "云端连接", "温度、光照和 LED 使用现有云端中转。视频仍使用局域网 UDP；呼吸灯和摄像头远程控制暂不可用。")
        return
        d=Settings(self)
        if d.exec_()!=QDialog.Accepted: return
        try: socket.inet_aton(d.board.text().strip())
        except OSError: QMessageBox.warning(self,'设置错误','请输入有效的开发板 IPv4'); return
        if not d.host.text().strip() or not d.password.text(): QMessageBox.warning(self,'设置错误','请输入服务器和密码'); return
        for key,value in [('host',d.host.text().strip()),('port',d.port.value()),('user',d.user.text()),('board',d.board.text().strip())]: self.config.setValue(key,value)
        self.password=d.password.text(); self.connect_mqtt()

    def connect_mqtt(self):
        try: self.link.start(self.config.value('host','mqtt.example.invalid'),int(self.config.value('port',8883)),self.config.value('user','example-user'),self.password)
        except (OSError,ValueError) as e: self.connection(False,str(e))

    def connection(self,online,detail):
        self.connection_label.setText('● 云端 '+detail)
        if not online: self.last_live=0
        self.tick()

    def receive(self,topic,payload,retained):
        name=topic.removeprefix(TOPIC) if hasattr(str,'removeprefix') else topic[len(TOPIC):]
        try:
            text=payload.decode('utf-8')
            if name=='status':
                state=json.loads(text)
                if not isinstance(state,dict): return
                for key in ['temperature','light']:
                    value=state.get(key)
                    if isinstance(value,(float,int)) and math.isfinite(value): setattr(self,key,float(value))
                self.led_label.setText('LED：'+{'0':'已关闭','1':'常亮','2':'呼吸灯'}.get(str(state.get('led')),'未知'))
                self.camera_active=state.get('camera') is True; self.camera_detail=str(state.get('camera_detail',''))
                self.board_uptime=state.get('uptime',0)
                self.confirm('led',str(state.get('led')),retained); self.confirm('camera/cmd','on' if self.camera_active else 'off',retained)
            elif name in ['temperature','light']:
                value=float(text)
                if not math.isfinite(value): return
                setattr(self,name,value)
            elif name=='led/status':
                self.led_label.setText('LED：'+{'0':'已关闭','1':'常亮','2':'呼吸灯'}.get(text,'未知')); self.confirm('led',text,retained)
            elif name=='camera/status':
                self.camera_active=text=='on'; self.confirm('camera/cmd',text,retained)
            elif name=='will' and text!='Online':
                self.last_live=0; self.temperature=None; self.light=None
                self.temp_label.setText('—'); self.light_label.setText('—'); self.led_label.setText('LED：设备离线')
                self.tick(); return
            if not retained and name in ['status','temperature','light']:
                self.last_live=time.time()
                if name=='status' and time.time()-self.last_sample>=25 and self.temperature is not None:
                    self.store.add(time.time(),self.temperature,self.light); self.last_sample=time.time()
            self.temp_label.setText('%.1f'%self.temperature if self.temperature is not None else '—')
            self.light_label.setText('%.1f'%self.light if self.light is not None else '—')
            self.chart.update(); self.tick()
        except (ValueError,UnicodeError,TypeError): pass

    def confirm(self,topic,payload,retained):
        if not retained and topic in self.pending and self.pending[topic][0]==payload:
            del self.pending[topic]; self.command_label.setText('设备已确认：'+('LED' if topic=='led' else '摄像头')+' '+payload)

    def command(self,topic,payload):
        if self.link.send(topic,payload):
            self.pending[topic]=(payload,time.monotonic()); self.command_label.setText('指令已发送，等待设备回报…')
        else: self.command_label.setText('发送失败：请检查云端连接')

    def cloud_result(self, ok, reason):
        self.pending.pop("led", None)
        self.command_label.setText("设备已确认 LED 操作" if ok else "LED 操作失败：" + reason)

    def datagrams(self):
        newest=None
        while self.udp.hasPendingDatagrams():
            data,host,port=self.udp.readDatagram(65535)
            if host.toString()!=self.config.value('board','192.0.2.20') or len(data)!=176*144*2: continue
            newest=data
        if newest is not None:
            self.image=QImage(newest,176,144,352,QImage.Format_RGB16).copy(); self.last_frame=time.time(); self.frames+=1; self.show_frame()

    def show_frame(self):
        if self.image is not None: self.video.setPixmap(QPixmap.fromImage(self.image).scaled(self.video.size(),Qt.KeepAspectRatio,Qt.SmoothTransformation))

    def resizeEvent(self,event):
        super().resizeEvent(event)
        if hasattr(self,'image'): self.show_frame()

    def tick(self):
        self.clock.setText(beijing().strftime('%Y-%m-%d\n%H:%M:%S 北京时间'))
        fresh=self.link.online and 0<time.time()-self.last_live<45
        self.device_label.setText('● IMX6ULL 设备在线' if fresh else '● 等待设备实时上报 / 数据可能已过期')
        self.updated.setText('最近实时上报：'+beijing(self.last_live).strftime('%H:%M:%S') if self.last_live else '尚未收到实时上报（保留消息仅作参考）')
        for i,b in enumerate(self.controls): b.setEnabled(fresh and i < 2)
        self.uptime_label.setText('设备运行 %s 秒  ·  上位机运行 %s 秒'%(self.board_uptime,int(time.monotonic()-self.started)))
        self.video_status.setText(('摄像头已开启 · ' if self.camera_active else '摄像头未采集 · ')+self.camera_detail)
        if time.time()-self.last_frame>3:
            self.video.clear(); self.video.setText('等待视频信号' if self.camera_active else self.camera_detail or '摄像头已关闭')
        self.video_note.setText('UDP 5004 · 176 × 144 · 已显示 %d 帧'%self.frames if self.udp.state()==self.udp.BoundState else 'UDP 5004 绑定失败：'+self.udp.errorString())
        for topic,(_,stamp) in list(self.pending.items()):
            if time.monotonic()-stamp>8: del self.pending[topic]; self.command_label.setText('设备确认超时，请检查设备状态')
        self.chart.update()

    def history(self):
        d=QDialog(self); d.setWindowTitle('历史温度曲线 · 北京时间'); d.resize(850,500); v=QVBoxLayout(d)
        choices=QComboBox(); choices.addItems(['最近 15 分钟','最近 1 小时','最近 24 小时']); v.addWidget(choices)
        chart=Chart(self.store); v.addWidget(chart,1)
        choices.currentIndexChanged.connect(lambda i:(setattr(chart,'seconds',[900,3600,86400][i]),chart.update()))
        export=QPushButton('导出当前时间范围 CSV'); v.addWidget(export)
        def save():
            path,_=QFileDialog.getSaveFileName(d,'导出历史数据','monitor-history.csv','CSV (*.csv)')
            if path:
                try:
                    with open(path,'w',encoding='utf-8-sig',newline='') as f:
                        writer=csv.writer(f); writer.writerow(['北京时间','芯片温度°C','光照lx'])
                        writer.writerows((beijing(t).isoformat(),temp,light) for t,temp,light in self.store.rows(chart.seconds))
                except OSError as e: QMessageBox.warning(d,'导出失败',str(e))
        export.clicked.connect(save); timer=QTimer(d); timer.timeout.connect(chart.update); timer.start(3000); d.exec_()

    def closeEvent(self,event):
        self.link.stop(); self.udp.close(); self.store.db.close(); event.accept()


if __name__=='__main__':
    app=QApplication(sys.argv); window=Window(); window.show(); sys.exit(app.exec_())
