#pragma once
#include <QThread>
#include <QImage>
#include <QString>
class Camera : public QThread {
    Q_OBJECT
public:
    QString device = "/dev/video1", destination = "192.0.2.10";
    quint16 port = 5004;
    explicit Camera(QObject *parent = nullptr) : QThread(parent) {}
    ~Camera() override { requestInterruption(); wait(); }
    void run() override;
signals:
    void frameReady(QImage image);
    void cameraState(bool active, QString detail);
    void statistics(quint64 frames, quint64 sent, quint64 errors);
};
