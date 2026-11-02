#include "backend.h"
#include <QFile>
#include <QDir>
#include <QSettings>
#include <QNetworkInterface>
#include <QJsonDocument>
#include <QDebug>
#include <QTextStream>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/i2c-dev.h>
#include <cmath>

static QByteArray readFile(const QString &path) {
    QFile file(path); return file.open(QIODevice::ReadOnly) ? file.readAll().trimmed() : QByteArray();
}
static bool writeFile(const QString &path, const QByteArray &data) {
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly) || file.write(data) != data.size()) {
        qWarning() << "hardware write failed:" << path << file.errorString(); return false;
    }
    return true;
}
static QString dataDir() {
    QString path = QDir::homePath() + "/.local/share/smart-monitor";
    QDir().mkpath(path); return path;
}
Backend::Backend(QObject *parent) : QObject(parent), camera(this), mqtt(this) {
    QSettings settings;
    broker = settings.value("broker", "mqtt.example.invalid").toString();
    brokerPort = settings.value("port", 8883).toInt();
    username = settings.value("username", "example-user").toString();
    videoIp = settings.value("videoIp", "192.0.2.10").toString();
    password = QString::fromLocal8Bit(qgetenv("MQTT_PASS"));
    gateway = QString::fromLocal8Bit(qgetenv("BOARD_GATEWAY"));
    if (gateway.isEmpty()) gateway = "192.0.2.10";
    connect(&routeTimer, &QTimer::timeout, this, &Backend::checkRoute);
    connect(&routeCheck, QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished), this,
            [this](int result, QProcess::ExitStatus) {
        QByteArray routes = routeCheck.readAllStandardOutput();
        if (result != 0 || routes.contains(("default via " + gateway + " dev eth1").toLatin1())) return;
        auto repair = new QProcess(this);
        connect(repair, QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished), this,
                [repair](int code, QProcess::ExitStatus) {
            qInfo() << "default gateway repair result" << code << repair->readAllStandardError();
            repair->deleteLater();
        });
        repair->start("/sbin/ip", {"route", "replace", "default", "via", gateway, "dev", "eth1"});
    });
    uptime.start();
    connect(&sensorTimer, &QTimer::timeout, this, &Backend::readSensors);
    connect(&publishTimer, &QTimer::timeout, this, &Backend::publishSensors);
    connect(&heartbeatTimer, &QTimer::timeout, this, [this] { readLed(); publishState(); });
    connect(&mqtt, &MqttLink::connectionChanged, this, [this](bool online, const QString &error) {
        mqttConnected = subscribed = online; errorText = error;
        qInfo() << "MQTT connection" << online << error;
        if(online) { publishSensors(); publishState(); }
        emit changed();
    });
    connect(&mqtt, &MqttLink::commandReceived, this, [this](const QByteArray &message, const QString &topic) {
        qInfo() << "MQTT control" << topic << "length" << message.size();
        if(topic == "dr_wei/led") setLed(message, "mqtt");
        else if(topic == "dr_wei/camera/cmd") {
            if(message == "on") setCamera(true);
            else if(message == "off") setCamera(false);
            else qWarning() << "invalid camera command";
        }
    });
    connect(&camera, &Camera::frameReady, this, [this](const QImage &image) { frame = image; emit newFrame(); });
    connect(&camera, &Camera::cameraState, this, [this](bool active, const QString &detail) {
        cameraActive = active; cameraDetail = detail;
        if (!active) frame = QImage();
        publishState(); emit changed();
    });
    connect(&camera, &Camera::statistics, this, [this](quint64 f, quint64 s, quint64 e) {
        frames = f; sent = s; videoErrors = e;
    });
    connect(&camera, &QThread::finished, this, [this] {
        if (desiredCamera && cameraDetail == "摄像头已关闭" && !exiting) camera.start();
    });
}
Backend::~Backend() {
    exiting = true; desiredCamera = false;
    camera.requestInterruption(); camera.wait();
    mqtt.requestInterruption(); mqtt.wait();
    if (i2c >= 0) ::close(i2c);
}
void Backend::start() {
    loadHistory();
    i2c = ::open("/dev/i2c-0", O_RDWR);
    if (i2c >= 0 && ioctl(i2c, I2C_SLAVE_FORCE, 0x1e) == 0) {
        unsigned char reset[] = {0, 4}, activate[] = {0, 3};
        ::write(i2c, reset, 2); usleep(10000); ::write(i2c, activate, 2);
    } else { if (i2c >= 0) ::close(i2c); i2c = -1; }
    readSensors(); readLed();
    sensorTimer.start(2000); publishTimer.start(30000); heartbeatTimer.start(10000);
    routeTimer.start(5000); checkRoute();
    QTimer::singleShot(500, this, &Backend::connectMqtt);
    setCamera(true);
}
void Backend::checkRoute() {
    if (routeCheck.state() != QProcess::NotRunning) return;
    // 此板通过 eth1 -> 虚拟机 NAT 上云；只修复已配置的板端默认路由。
    if (!QNetworkInterface::interfaceFromName("eth1").flags().testFlag(QNetworkInterface::IsRunning)) return;
    routeCheck.start("/sbin/ip", {"route", "show", "default"});
}
void Backend::readSensors() {
    bool ok = false;
    double raw = readFile("/sys/class/thermal/thermal_zone0/temp").toDouble(&ok);
    temperature = ok ? raw / 1000.0 : std::numeric_limits<double>::quiet_NaN();
    light = std::numeric_limits<double>::quiet_NaN();
    if (i2c >= 0) {
        unsigned char lo = 0, hi = 0, reg = 0x0c;
        bool valid = ::write(i2c, &reg, 1) == 1 && ::read(i2c, &lo, 1) == 1;
        reg = 0x0d;
        valid = valid && ::write(i2c, &reg, 1) == 1 && ::read(i2c, &hi, 1) == 1;
        if (valid) light = ((hi << 8) | lo) * 0.36;
    }
    network = false;
    for (const auto &iface : QNetworkInterface::allInterfaces())
        if (!(iface.flags() & QNetworkInterface::IsLoopBack) && (iface.flags() & QNetworkInterface::IsRunning))
            for (const auto &entry : iface.addressEntries())
                if (entry.ip().protocol() == QAbstractSocket::IPv4Protocol) network = true;
    readLed(); emit changed();
}
void Backend::readLed() {
    QByteArray trigger = readFile("/sys/class/leds/sys-led/trigger");
    if (trigger.contains("[heartbeat]")) led = "2";
    else {
        QByteArray value = readFile("/sys/class/leds/sys-led/brightness");
        led = value.isEmpty() ? "unknown" : (value == "0" ? "0" : "1");
    }
}
bool Backend::setLed(const QByteArray &command, const QString &source) {
    if (command != "0" && command != "1" && command != "2") {
        qWarning() << "ignored invalid LED payload, length" << command.size(); return false;
    }
    bool ok = writeFile("/sys/class/leds/sys-led/trigger", command == "2" ? "heartbeat" : "none");
    if (ok && command != "2") ok = writeFile("/sys/class/leds/sys-led/brightness", command);
    readLed(); lastCommandSource = source;
    if (!ok) errorText = "LED 写入失败";
    qInfo() << "LED" << command << "source" << source << "ok" << ok;
    publishState(); emit changed(); return ok;
}
void Backend::setCamera(bool enabled) {
    desiredCamera = enabled;
    if (enabled && !camera.isRunning()) {
        camera.destination = videoIp; cameraDetail = "正在启动"; camera.start();
    } else if (!enabled && camera.isRunning()) {
        cameraDetail = "正在关闭"; camera.requestInterruption();
    }
    emit changed();
}
void Backend::connectMqtt() {
    mqtt.configure(broker, brokerPort, username, password);
    if (!mqtt.isRunning()) mqtt.start();
}
void Backend::publishSensors() {
    saveHistory();
    if (!mqttConnected) return;
    if (std::isfinite(temperature)) mqtt.publish("dr_wei/temperature", QByteArray::number(temperature, 'f', 1));
    if (std::isfinite(light)) mqtt.publish("dr_wei/light", QByteArray::number(light, 'f', 1));
    publishState();
}
void Backend::publishState() {
    if (!mqttConnected) return;
    mqtt.publish("dr_wei/led/status", led.toLatin1());
    mqtt.publish("dr_wei/camera/status", cameraActive ? "on" : "off");
    mqtt.publish("dr_wei/status", QJsonDocument(status()).toJson(QJsonDocument::Compact));
}
QJsonObject Backend::status() const {
    return {{"temperature", std::isfinite(temperature) ? QJsonValue(temperature) : QJsonValue()},
        {"light", std::isfinite(light) ? QJsonValue(light) : QJsonValue()},
        {"led", led}, {"mqtt", mqttConnected}, {"subscribed", subscribed}, {"network", network},
        {"camera", cameraActive}, {"camera_detail", cameraDetail}, {"frames", double(frames)},
        {"udp_sent", double(sent)}, {"udp_errors", double(videoErrors)}, {"uptime", double(uptime.elapsed()/1000)},
        {"last_command_source", lastCommandSource}, {"history_samples", history.size()}, {"error", errorText}};
}
void Backend::saveHistory() {
    if (!std::isfinite(temperature)) return;
    Sample sample = {QDateTime::currentDateTime(), temperature, light};
    if (!history.isEmpty()) {
        qint64 delta = history.last().time.secsTo(sample.time);
        if (delta >= 0 && delta < 20) return;
    }
    history.append(sample);
    while (history.size() > 2880) history.removeFirst();
    QFile file(dataDir() + "/" + sample.time.toString("yyyy-MM-dd") + ".csv");
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append)) { qWarning() << "history write failed"; return; }
    QTextStream stream(&file);
    stream << sample.time.toString(Qt::ISODate) << ',' << QString::number(temperature,'f',1) << ',';
    if (std::isfinite(light)) stream << QString::number(light,'f',1);
    stream << '\n';
}
void Backend::loadHistory() {
    QDir dir(dataDir());
    QStringList names = dir.entryList({"*.csv"}, QDir::Files, QDir::Name);
    for (const QString &name : names.mid(qMax(0, names.size()-2))) {
        QFile file(dir.filePath(name)); if (!file.open(QIODevice::ReadOnly)) continue;
        while (!file.atEnd()) {
            auto parts = file.readLine().trimmed().split(',');
            if (parts.size() != 3) continue;
            bool ok; double t = parts[1].toDouble(&ok); QDateTime time = QDateTime::fromString(parts[0], Qt::ISODate);
            if (ok && time.isValid()) history.append({time, t, parts[2].isEmpty() ? std::numeric_limits<double>::quiet_NaN() : parts[2].toDouble()});
        }
    }
    while (history.size() > 2880) history.removeFirst();
}
void Backend::applySettings(QString host, int port, QString user, QString pass, QString ip) {
    broker = host; brokerPort = port; username = user; videoIp = ip;
    if (!pass.isEmpty()) password = pass;
    QSettings settings; settings.setValue("broker", broker); settings.setValue("port", brokerPort);
    settings.setValue("username", username); settings.setValue("videoIp", videoIp);
    connectMqtt();
    if (camera.isRunning()) { desiredCamera = true; camera.requestInterruption(); }
}
