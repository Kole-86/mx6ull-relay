#include "dashboard.h"
#include <QLinearGradient>
#include <QPainterPath>
#include <QMouseEvent>
#include <QKeyEvent>
#include <QDialog>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QPushButton>
#include <QLineEdit>
#include <QFormLayout>
#include <QSpinBox>
#include <QHostAddress>
#include <QComboBox>
#include <QDebug>
#include <cmath>

static QColor navy("#0d2854"), muted("#6883a4"), green("#08bd83"), blue("#2878ff");
static void label(QPainter &p, QRectF r, const QString &text, int size, QColor color = navy,
                  bool bold = false, int flags = Qt::AlignLeft | Qt::AlignVCenter) {
    QFont font = p.font(); font.setPixelSize(size); font.setBold(bold); p.setFont(font); p.setPen(color); p.drawText(r, flags, text);
}
static void card(QPainter &p, QRectF r, QColor color = Qt::white, int radius = 13) {
    p.setPen(QPen(QColor("#dbe7f4"), 1)); p.setBrush(color); p.drawRoundedRect(r, radius, radius);
}
static void dot(QPainter &p, QPointF c, bool active, int radius = 5) {
    p.setPen(Qt::NoPen); p.setBrush(active ? green : QColor("#a9b7c9")); p.drawEllipse(c, radius, radius);
}
// 原生矢量图标，不依赖系统图标或图片字体。
static void icon(QPainter &p, const QString &name, QRectF rect, QColor color) {
    p.save(); p.translate(rect.topLeft()); p.scale(rect.width()/40, rect.height()/40);
    p.setPen(QPen(color, 2.5, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin)); p.setBrush(Qt::NoBrush);
    if (name == "chip") {
        p.drawRoundedRect(QRectF(9,9,22,22),3,3); p.drawRect(QRectF(14,14,12,12));
        for (int i=13;i<=27;i+=7) { p.drawLine(i,3,i,8); p.drawLine(i,32,i,37); p.drawLine(3,i,8,i); p.drawLine(32,i,37,i); }
    } else if (name == "camera") {
        p.drawRoundedRect(QRectF(3,12,34,24),4,4); p.drawEllipse(QPointF(20,24),7,7); p.drawLine(12,11,16,6); p.drawLine(16,6,26,6); p.drawLine(26,6,29,11);
    } else if (name == "sun") {
        p.setBrush(QColor("#ffbc24")); p.setPen(Qt::NoPen); p.drawEllipse(QPointF(20,20),9,9);
        p.setPen(QPen(QColor("#ffbc24"),3,Qt::SolidLine,Qt::RoundCap));
        for(int a=0;a<8;++a) { p.save(); p.translate(20,20); p.rotate(a*45); p.drawLine(0,14,0,18); p.restore(); }
    } else if (name == "thermo") {
        p.setPen(QPen(blue,3)); p.drawRoundedRect(QRectF(14,3,12,25),6,6); p.drawEllipse(QPointF(20,29),9,9);
        p.setPen(QPen(QColor("#ff794b"),4,Qt::SolidLine,Qt::RoundCap)); p.drawLine(20,14,20,28);
        p.setBrush(QColor("#ff794b")); p.setPen(Qt::NoPen); p.drawEllipse(QPointF(20,29),5,5);
    } else if (name == "bulb") {
        QPainterPath path; path.moveTo(14,28); path.cubicTo(14,23,7,23,7,15); path.cubicTo(7,-1,33,-1,33,15); path.cubicTo(33,23,26,23,26,28); path.closeSubpath(); p.drawPath(path);
        p.drawLine(14,32,26,32); p.drawLine(17,37,23,37);
    } else if (name == "chart") {
        p.setPen(QPen(color,5,Qt::SolidLine,Qt::RoundCap)); p.drawLine(8,34,8,20); p.drawLine(20,34,20,7); p.drawLine(32,34,32,15);
    } else if (name == "cloud") {
        QPainterPath path; path.moveTo(10,32); path.cubicTo(-2,32,0,17,10,17); path.cubicTo(9,1,32,1,31,18); path.cubicTo(43,18,41,32,31,32); path.closeSubpath(); p.drawPath(path);
    } else if (name == "settings") {
        p.drawEllipse(QPointF(20,20),11,11); p.drawEllipse(QPointF(20,20),4,4);
        for(int a=0;a<8;++a) { p.save(); p.translate(20,20); p.rotate(a*45); p.drawLine(0,12,0,17); p.restore(); }
    } else if (name == "clock") {
        p.drawEllipse(QPointF(20,20),16,16); p.drawLine(20,20,20,9); p.drawLine(20,20,29,20);
    } else {
        p.drawRoundedRect(QRectF(8,4,25,32),4,4); p.drawLine(14,12,27,12); p.drawLine(14,20,27,20); p.drawLine(14,28,23,28);
    }
    p.restore();
}
static void button(QPainter &p, QRectF r, const QString &text, const QString &glyph, QColor first, QColor last, bool selected = false) {
    QLinearGradient gradient(r.topLeft(), r.bottomRight()); gradient.setColorAt(0, first); gradient.setColorAt(1, last);
    p.setBrush(gradient); p.setPen(QPen(selected ? QColor("#082d62") : QColor(Qt::transparent), selected ? 2 : 0));
    p.drawRoundedRect(r, 11, 11);
    icon(p, glyph, QRectF(r.x()+18, r.y()+(r.height()-32)/2,32,32), Qt::white);
    label(p, QRectF(r.x()+58,r.y(),r.width()-62,r.height()),text,20,Qt::white,true,Qt::AlignCenter);
}
void Trend::draw(QPainter &p, const QRectF &rect, const QVector<Sample> &samples, int minutes, bool compact) {
    QDateTime end = QDateTime::currentDateTime();
    qint64 finish = end.toMSecsSinceEpoch(), start = finish - qint64(minutes)*60000;
    double low = 0, high = 80;
    for(const auto &s : samples) if (s.time.toMSecsSinceEpoch() >= start && std::isfinite(s.temperature)) {
        high = qMax(high, std::ceil(s.temperature/10)*10); low = qMin(low, std::floor(s.temperature/10)*10);
    }
    QRectF plot = rect.adjusted(compact?24:40, 10, -12, compact?-22:-32);
    p.setPen(QPen(QColor("#e5eef8"),1));
    for(int i=0;i<5;++i) {
        double y=plot.bottom()-plot.height()*i/4;
        p.setPen(QPen(QColor("#e5eef8"),1));
        p.drawLine(QPointF(plot.left(),y),QPointF(plot.right(),y));
        label(p,QRectF(rect.left(),y-8,compact?20:34,16),QString::number(low+(high-low)*i/4,'f',0),compact?10:12,muted,false,Qt::AlignRight|Qt::AlignVCenter);
    }
    for(int i=0;i<3;++i) {
        double x=plot.left()+i*plot.width()/2;
        p.setPen(QPen(QColor("#e5eef8"),1)); p.drawLine(QPointF(x,plot.top()),QPointF(x,plot.bottom()));
        QString time=QDateTime::fromMSecsSinceEpoch(start+(finish-start)*i/2).toString("HH:mm");
        label(p,QRectF(x-22,plot.bottom()+4,44,18),time,compact?10:12,muted,false,Qt::AlignCenter);
    }
    QPainterPath path; bool begin=true; qint64 last=0; QPointF final;
    int count=0;
    for(const auto &s:samples) {
        qint64 t=s.time.toMSecsSinceEpoch();
        if(t<start || t>finish || !std::isfinite(s.temperature)) continue;
        QPointF point(plot.left()+double(t-start)/(finish-start)*plot.width(),plot.bottom()-(s.temperature-low)/(high-low)*plot.height());
        if(begin || t-last>90000) path.moveTo(point); else path.lineTo(point);
        begin=false; last=t; final=point; ++count;
    }
    p.setBrush(Qt::NoBrush); p.setPen(QPen(blue,compact?2.5:3,Qt::SolidLine,Qt::RoundCap)); p.drawPath(path);
    if(count) { p.setPen(Qt::NoPen); p.setBrush(blue); p.drawEllipse(final,3.5,3.5); }
    if(!count) label(p,plot,"等待采样",compact?12:18,muted,false,Qt::AlignCenter);
}
void Trend::paintEvent(QPaintEvent *) { QPainter p(this); p.setRenderHint(QPainter::Antialiasing); p.fillRect(rect(),Qt::white); draw(p,rect().adjusted(10,10,-10,-10),backend->history,minutes); }

Dashboard::Dashboard(Backend *b) : backend(b) {
    setWindowTitle("智能监控终端"); setFixedSize(1024,600);
    setAttribute(Qt::WA_AcceptTouchEvents, false);
    connect(b,&Backend::changed,this,QOverload<>::of(&Dashboard::update));
    connect(b,&Backend::newFrame,this,[this]{ update(QRect(585,90,419,414)); });
    auto timer = new QTimer(this); timer->start(1000);
    connect(timer,&QTimer::timeout,this,QOverload<>::of(&Dashboard::update));
}
void Dashboard::paintEvent(QPaintEvent *) {
    QPainter p(this); p.setRenderHints(QPainter::Antialiasing | QPainter::TextAntialiasing);
    QLinearGradient bg(0,75,1024,600); bg.setColorAt(0,QColor("#eef6fc")); bg.setColorAt(1,QColor("#e5f0fa")); p.fillRect(rect(),bg);
    QLinearGradient header(0,0,1024,75); header.setColorAt(0,QColor("#204e83")); header.setColorAt(1,QColor("#102d56")); p.fillRect(QRect(0,0,1024,75),header);
    QPainterPath accent; accent.moveTo(330,0); accent.lineTo(412,0); accent.lineTo(355,75); accent.lineTo(278,75); accent.closeSubpath(); p.fillPath(accent,QColor(75,141,191,45));
    icon(p,"chip",QRectF(24,18,39,39),Qt::white); label(p,QRectF(82,8,350,58),"智能监控终端",31,Qt::white,true);
    dot(p,QPointF(544,37),backend->network); label(p,QRectF(556,13,110,45),backend->network?"网络已连接":"网络未连接",14,Qt::white);
    icon(p,"cloud",QRectF(666,22,29,29),Qt::white); dot(p,QPointF(708,37),backend->mqttConnected);
    label(p,QRectF(720,13,126,45),backend->mqttConnected?"MQTT已连接":"MQTT未连接",14,Qt::white);
    label(p,QRectF(856,9,112,23),QDateTime::currentDateTime().toString("yyyy-MM-dd"),13,QColor("#d8e8ff"));
    label(p,QRectF(856,29,112,30),QDateTime::currentDateTime().toString("HH:mm:ss"),22,Qt::white,true);
    icon(p,"settings",QRectF(980,22,29,29),Qt::white);

    card(p,QRectF(18,93,550,184));
    p.setPen(QPen(QColor("#dce7f4"),1)); p.drawLine(198,111,198,258); p.drawLine(369,111,369,258);
    icon(p,"thermo",QRectF(30,151,39,63),blue);
    label(p,QRectF(78,115,115,29),"当前温度",19,navy,true);
    label(p,QRectF(77,150,104,60),std::isfinite(backend->temperature)?QString::number(backend->temperature,'f',1):"--",39,navy,true);
    label(p,QRectF(162,181,32,22),"°C",15,muted);
    label(p,QRectF(34,228,160,25),"数据来源：芯片温度",12,muted);
    icon(p,"sun",QRectF(208,158,42,42),QColor("#ffbc24"));
    label(p,QRectF(252,115,110,29),"当前光照",19,navy,true);
    label(p,QRectF(250,150,105,60),std::isfinite(backend->light)?QString::number(backend->light,'f',0):"--",37,navy,true);
    label(p,QRectF(338,185,28,20),"lx",14,muted);
    label(p,QRectF(210,228,155,25),"数据来源：光照传感器",12,muted);
    label(p,QRectF(386,109,170,26),"实时温度趋势  / °C",13,navy,true);
    Trend::draw(p,QRectF(382,141,174,116),backend->history,5,true);

    card(p,QRectF(18,292,550,212));
    icon(p,"settings",QRectF(36,305,28,28),navy); label(p,QRectF(74,300,200,38),"设备控制",21,navy,true);
    QString ledText=backend->led=="1"?"常亮":backend->led=="2"?"呼吸灯":backend->led=="0"?"已关闭":"未知";
    label(p,QRectF(390,301,158,37),"LED · "+ledText,13,muted,false,Qt::AlignRight|Qt::AlignVCenter);
    button(p,QRectF(31,346,168,65),"LED开","bulb",QColor("#23cf99"),QColor("#08ae7d"),backend->led=="1");
    button(p,QRectF(209,346,168,65),"LED关","bulb",QColor("#9bb0c9"),QColor("#748da9"),backend->led=="0");
    button(p,QRectF(387,346,168,65),"历史曲线","chart",QColor("#438bff"),QColor("#1d57e8"));
    button(p,QRectF(31,424,257,65),"摄像头开启","camera",QColor("#9782ff"),QColor("#7266ef"),backend->cameraActive);
    button(p,QRectF(299,424,256,65),"摄像头关闭","camera",QColor("#899fb9"),QColor("#607996"),!backend->cameraActive);

    card(p,QRectF(585,93,421,411));
    icon(p,"camera",QRectF(603,108,32,30),QColor("#315a88")); label(p,QRectF(647,102,190,42),"摄像头画面",22,navy,true);
    QRectF badge(868,110,121,29); p.setPen(QPen(backend->cameraActive?QColor("#7cdeb5"):QColor("#ccd9e8"))); p.setBrush(backend->cameraActive?QColor("#e7fff3"):QColor("#edf2f7")); p.drawRoundedRect(badge,14,14);
    dot(p,QPointF(882,124),backend->cameraActive,4); label(p,QRectF(892,110,93,29),backend->cameraActive?"摄像头已开启":"摄像头已关闭",11,backend->cameraActive?QColor("#08a46c"):muted,true);
    QRectF video(597,151,397,318); p.setPen(Qt::NoPen); p.setBrush(QColor("#122139")); p.drawRoundedRect(video,9,9);
    if(!backend->frame.isNull()) {
        QSize scaled=backend->frame.size(); scaled.scale(video.size().toSize(),Qt::KeepAspectRatio);
        QRectF target(QPointF(video.center().x()-scaled.width()/2.,video.center().y()-scaled.height()/2.),scaled);
        p.setRenderHint(QPainter::SmoothPixmapTransform,true); p.drawImage(target,backend->frame);
    } else {
        icon(p,"camera",QRectF(765,254,58,54),QColor("#607b9b"));
        label(p,QRectF(610,320,370,34),backend->cameraDetail,17,QColor("#b9cbe0"),false,Qt::AlignCenter);
    }
    label(p,QRectF(605,474,380,20),backend->cameraActive?QString("OV5640  ·  176×144  ·  UDP已发送 %1 帧").arg(backend->sent):"单一采集源 · 本地预览 / 网络视频",11,muted);

    card(p,QRectF(18,521,988,61));
    for(int x:{249,504,767}) { p.setPen(QPen(QColor("#dce7f4"))); p.drawLine(x,534,x,569); }
    icon(p,"device",QRectF(38,536,28,28),navy); label(p,QRectF(83,528,150,20),"设备状态",12,navy);
    dot(p,QPointF(89,559),true); label(p,QRectF(102,546,140,26),"设备运行中",16,green,true);
    icon(p,"cloud",QRectF(270,536,32,28),navy); label(p,QRectF(321,528,170,20),"MQTT状态",12,navy);
    dot(p,QPointF(327,559),backend->subscribed); label(p,QRectF(340,546,160,26),backend->subscribed?"已连接 · 可接收控制":backend->mqttConnected?"正在订阅":"离线 · 本地可用",14,backend->subscribed?green:muted,true);
    icon(p,"chip",QRectF(527,535,31,31),navy); label(p,QRectF(577,528,180,20),"开发板信息",12,navy); label(p,QRectF(577,547,180,26),"IMX6ULL",17,navy,true);
    icon(p,"clock",QRectF(789,535,30,30),navy); label(p,QRectF(837,528,160,20),"程序运行时间",12,navy);
    qint64 seconds=backend->uptime.elapsed()/1000;
    QString elapsed=QString("%1天 %2:%3:%4").arg(seconds/86400).arg(seconds/3600%24,2,10,QChar('0')).arg(seconds/60%60,2,10,QChar('0')).arg(seconds%60,2,10,QChar('0'));
    label(p,QRectF(837,547,160,26),elapsed,16,navy,true);
    if(!toast.isEmpty()) { card(p,QRectF(290,245,444,65),QColor("#13355d")); label(p,QRectF(300,250,424,55),toast,19,Qt::white,false,Qt::AlignCenter); }
    else if(!backend->errorText.isEmpty()) label(p,QRectF(22,583,980,16),backend->errorText,10,QColor("#b5673a"));
}
void Dashboard::notify(const QString &text) { toast=text; update(); QTimer::singleShot(2000,this,[this]{toast.clear();update();}); }
void Dashboard::mouseReleaseEvent(QMouseEvent *event) {
    QPoint pos=event->pos(); if(event->button()!=Qt::LeftButton) return;
    if(QRect(31,346,168,65).contains(pos)) notify(backend->setLed("1","touch")?"LED 已开启":"LED 操作失败");
    else if(QRect(209,346,168,65).contains(pos)) notify(backend->setLed("0","touch")?"LED 已关闭":"LED 操作失败");
    else if(QRect(387,346,168,65).contains(pos)) showHistory();
    else if(QRect(31,424,257,65).contains(pos)) backend->setCamera(true);
    else if(QRect(299,424,256,65).contains(pos)) backend->setCamera(false);
    else if(QRect(970,8,54,64).contains(pos)) showSettings();
}
void Dashboard::keyPressEvent(QKeyEvent *event) {
    if(event->key()==Qt::Key_F11) { if(isFullScreen()) showNormal(); else showFullScreen(); }
    else QWidget::keyPressEvent(event);
}
static QString dialogStyle() { return "QDialog{background:#f0f6fc;color:#0d2854;} QLabel{color:#173b65;font-size:18px;} QPushButton{background:#2878ff;color:white;border:0;border-radius:8px;min-height:44px;padding:4px 15px;font-size:18px;} QLineEdit,QSpinBox,QComboBox{background:white;border:1px solid #ccd9e8;border-radius:6px;min-height:38px;padding:2px 8px;font-size:17px;}"; }
void Dashboard::showHistory() {
    QDialog dialog(this); dialog.setWindowTitle("温度历史曲线"); dialog.setFixedSize(900,480); dialog.setStyleSheet(dialogStyle());
    QVBoxLayout layout(&dialog); QHBoxLayout top;
    QLabel title("温度历史曲线 · 芯片温度 °C"); QComboBox range; range.addItems({"最近15分钟","最近1小时","最近24小时"}); QPushButton close("返回");
    top.addWidget(&title); top.addStretch(); top.addWidget(&range); top.addWidget(&close); layout.addLayout(&top);
    Trend trend(backend); layout.addWidget(&trend,1);
    QLabel note("每30秒记录一次 · CSV按日保存 · 时钟采用开发板系统时间"); note.setStyleSheet("font-size:13px;color:#6883a4;"); layout.addWidget(&note);
    connect(&close,&QPushButton::clicked,&dialog,&QDialog::accept);
    connect(&range,QOverload<int>::of(&QComboBox::currentIndexChanged),&trend,[&trend](int i){trend.minutes=i==0?15:i==1?60:1440;trend.update();});
    connect(backend,&Backend::changed,&trend,QOverload<>::of(&Trend::update)); dialog.exec();
}
static void keyboard(QLineEdit *target, QWidget *parent) {
    QDialog dialog(parent); dialog.setWindowTitle("输入"); dialog.setFixedSize(820,470); dialog.setStyleSheet(dialogStyle());
    QVBoxLayout layout(&dialog); QLineEdit input(target->text()); input.setEchoMode(target->echoMode()); layout.addWidget(&input);
    QGridLayout grid; QStringList rows={"1234567890","qwertyuiop","asdfghjkl","zxcvbnm.-","_@:/!#$%&*"};
    bool upper=false;
    QList<QPushButton*> keys;
    for(int y=0;y<rows.size();++y) for(int x=0;x<rows[y].size();++x) {
        QString value=rows[y].mid(x,1); auto key=new QPushButton(value=="&"?"&&":value,&dialog); key->setMinimumWidth(48); grid.addWidget(key,y,x); keys.append(key);
        QObject::connect(key,&QPushButton::clicked,&dialog,[&input,&upper,value]{input.insert(upper?value.toUpper():value);});
    }
    layout.addLayout(&grid); QHBoxLayout bottom; QPushButton shift("大小写"), erase("退格"), clear("清空"), cancel("取消"), accept("确定");
    for(auto b:{&shift,&erase,&clear,&cancel,&accept}) bottom.addWidget(b); layout.addLayout(&bottom);
    QObject::connect(&shift,&QPushButton::clicked,&dialog,[&upper,&keys]{upper=!upper; for(auto k:keys) k->setText(upper?k->text().toUpper():k->text().toLower());});
    QObject::connect(&erase,&QPushButton::clicked,&input,&QLineEdit::backspace); QObject::connect(&clear,&QPushButton::clicked,&input,&QLineEdit::clear);
    QObject::connect(&cancel,&QPushButton::clicked,&dialog,&QDialog::reject); QObject::connect(&accept,&QPushButton::clicked,&dialog,&QDialog::accept);
    if(dialog.exec()==QDialog::Accepted) target->setText(input.text());
}
void Dashboard::showSettings() {
    QDialog dialog(this); dialog.setFixedSize(860,470); dialog.setWindowTitle("连接设置"); dialog.setStyleSheet(dialogStyle());
    QVBoxLayout layout(&dialog); QLabel heading("连接设置  /  密码仅在本次运行中使用"); layout.addWidget(&heading); QFormLayout form;
    QLineEdit broker(backend->broker), port(QString::number(backend->brokerPort)), user(backend->username), pass, ip(backend->videoIp); pass.setEchoMode(QLineEdit::Password); pass.setPlaceholderText("留空保留当前密码");
    auto row=[&](QString text,QLineEdit *field) { auto container=new QWidget(&dialog); auto h=new QHBoxLayout(container); h->setContentsMargins(0,0,0,0); auto key=new QPushButton("键盘",container); h->addWidget(field,1); h->addWidget(key); form.addRow(text,container); connect(key,&QPushButton::clicked,&dialog,[field,&dialog]{keyboard(field,&dialog);}); };
    row("MQTT服务器",&broker); row("TLS端口",&port); row("用户名",&user); row("MQTT密码",&pass); row("UDP接收端IPv4",&ip); layout.addLayout(&form);
    QLabel note("MQTT：TLS证书校验开启 · UDP：5004端口 · 本地硬件操作不依赖云端"); note.setStyleSheet("font-size:13px;"); layout.addWidget(&note);
    QLabel error; error.setStyleSheet("color:#c4513b;font-size:14px;"); layout.addWidget(&error);
    QHBoxLayout actions; QPushButton cancel("返回"), save("保存并重连"); actions.addWidget(&cancel); actions.addWidget(&save); layout.addLayout(&actions);
    connect(&cancel,&QPushButton::clicked,&dialog,&QDialog::reject);
    connect(&save,&QPushButton::clicked,&dialog,[&]{bool ok;int p=port.text().toInt(&ok);QHostAddress address(ip.text().trimmed());
        if(broker.text().trimmed().isEmpty()||user.text().isEmpty()||!ok||p<1||p>65535||address.protocol()!=QAbstractSocket::IPv4Protocol){error.setText("请输入有效服务器、用户名、端口及IPv4地址");return;}
        backend->applySettings(broker.text().trimmed(),p,user.text(),pass.text(),ip.text().trimmed());dialog.accept();}); dialog.exec();
}
