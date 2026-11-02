#pragma once
#include "camera.h"
#include <QObject>
#include "mqttlink.h"
#include <QTimer>
#include <QElapsedTimer>
#include <QDateTime>
#include <QJsonObject>
#include <QVector>
#include <QPointF>
#include <QProcess>
#include <limits>

struct Sample { QDateTime time; double temperature; double light; };
class Backend : public QObject {
    Q_OBJECT
public:
    explicit Backend(QObject *parent = nullptr);
    ~Backend() override;
    void start();
    bool setLed(const QByteArray &command, const QString &source);
    void setCamera(bool enabled);
    void applySettings(QString broker, int port, QString username, QString password, QString videoIp);
    QJsonObject status() const;
    QString broker, username, videoIp, errorText, led = "unknown", cameraDetail = "正在启动";
    int brokerPort = 8883;
    bool network = false, mqttConnected = false, subscribed = false, cameraActive = false;
    double temperature = std::numeric_limits<double>::quiet_NaN();
    double light = std::numeric_limits<double>::quiet_NaN();
    quint64 frames = 0, sent = 0, videoErrors = 0;
    QVector<Sample> history;
    QElapsedTimer uptime;
    QString lastCommandSource;
    Camera camera;
    QImage frame;
signals:
    void changed();
    void newFrame();
private:
    MqttLink mqtt;
    QTimer sensorTimer, publishTimer, heartbeatTimer;
    QTimer routeTimer;
    QProcess routeCheck;
    QString gateway;
    void checkRoute();
    int i2c = -1;
    bool desiredCamera = true, exiting = false;
    QString password;
    void readSensors();
    void readLed();
    void publishSensors();
    void publishState();
    void connectMqtt();
    void saveHistory();
    void loadHistory();
};
