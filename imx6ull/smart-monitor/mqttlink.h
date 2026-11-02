#pragma once
#include <QThread>
#include <QMutex>
#include <QVector>
#include <QString>
#include <QByteArray>
#include <atomic>
#include "MQTTClient.h"
class MqttLink : public QThread {
    Q_OBJECT
public:
    explicit MqttLink(QObject *parent = nullptr) : QThread(parent) {}
    ~MqttLink() override { requestInterruption(); wait(); }
    void configure(QString host, int port, QString user, QString pass);
    void publish(QString topic, QByteArray payload, bool retained = true);
    void run() override;
signals:
    void connectionChanged(bool connected, QString error);
    void commandReceived(QByteArray payload, QString topic);
private:
    struct Message { QString topic; QByteArray payload; bool retained; };
    QMutex mutex;
    QVector<Message> queue;
    QString host, user, pass;
    int port = 8883, generation = 0;
    std::atomic<bool> lost{false};
    static int received(void *context, char *topic, int length, MQTTClient_message *message);
    static void disconnected(void *context, char *cause);
};
