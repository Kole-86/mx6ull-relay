#include "dashboard.h"
#include "cloudlink.h"
#include <QApplication>
#include <QRegularExpression>
#include <QFile>
#include <cmath>
#include <QCoreApplication>
#include <QLocalServer>
#include <QLocalSocket>
#include <QJsonDocument>
#include <QFontDatabase>
#include <QMouseEvent>
#include <QDialog>
#include <QDebug>
#include <cstdio>
#include <csignal>

static volatile sig_atomic_t interrupted = 0;
static void signalHandler(int) { interrupted = 1; }
static const char *socketName = "imx-smart-monitor";
int main(int argc, char **argv) {
    bool cli = argc >= 2 && (QByteArray(argv[1]) == "--status" || QByteArray(argv[1]) == "--action");
    if (cli) {
        QCoreApplication app(argc,argv); QLocalSocket socket;
        socket.connectToServer(socketName);
        if (!socket.waitForConnected(1500)) { fprintf(stderr,"监控终端未运行\n");return 1; }
        QString action = QByteArray(argv[1]) == "--status" ? "status" : (argc>2?QString::fromLocal8Bit(argv[2]):QString());
        socket.write(QJsonDocument(QJsonObject{{"action",action}}).toJson(QJsonDocument::Compact)+'\n'); socket.waitForBytesWritten(1000);
        if (!socket.waitForReadyRead(5000)) { fprintf(stderr,"维护接口响应超时\n");return 1; }
        QByteArray response=socket.readAll(); fwrite(response.constData(),1,response.size(),stdout); return response.contains("\"ok\":false")?1:0;
    }
    QApplication app(argc,argv);
    QCoreApplication::setOrganizationName("DrWei"); QCoreApplication::setApplicationName("SmartMonitor");
    setvbuf(stdout,nullptr,_IOLBF,0); setvbuf(stderr,nullptr,_IOLBF,0);
    QLocalSocket probe; probe.connectToServer(socketName);
    if(probe.waitForConnected(200)) { qWarning()<<"监控终端已经运行";return 1; }
    QLocalServer::removeServer(socketName);
    QLocalServer server; server.setSocketOptions(QLocalServer::UserAccessOption);
    if(!server.listen(socketName)) { qWarning()<<server.errorString();return 1; }
    QFont font("Source Han Sans CN"); font.setPixelSize(16); app.setFont(font);
    Backend backend; Dashboard dashboard(&backend);
    QObject::connect(&server,&QLocalServer::newConnection,&app,[&]{
        while(server.hasPendingConnections()) {
            QLocalSocket *socket=server.nextPendingConnection();
            auto buffer = new QByteArray;
            QObject::connect(socket,&QLocalSocket::disconnected,socket,&QObject::deleteLater);
            QObject::connect(socket,&QObject::destroyed,[buffer]{delete buffer;});
            QTimer::singleShot(6000,socket,[socket]{socket->disconnectFromServer();});
            QObject::connect(socket,&QLocalSocket::readyRead,&app,[&,socket,buffer]{
                buffer->append(socket->readAll());
                if(buffer->size()>2048) {socket->disconnectFromServer();return;}
                if(!buffer->contains('\n'))return;
                QString action=QJsonDocument::fromJson(*buffer).object().value("action").toString();buffer->clear(); bool ok=true;
                if(action=="status") {}
                else if(action.startsWith("led:")) ok=backend.setLed(action.mid(4).toLatin1(),"local-ipc");
                else if(action=="camera:on")backend.setCamera(true);
                else if(action=="camera:off")backend.setCamera(false);
                else if(action.startsWith("snapshot:")) {
                    QWidget *view=QApplication::activeModalWidget();
                    if(!view)view=&dashboard;
                    ok=view->grab().save(action.mid(9));
                }
                else if(action.startsWith("tap:")) {
                    auto parts=action.split(':');bool xok=false,yok=false;
                    int x=parts.value(1).toInt(&xok),y=parts.value(2).toInt(&yok);
                    ok=xok&&yok&&parts.size()==3&&x>=0&&x<1024&&y>=0&&y<600;
                    if(ok) {
                        QTimer::singleShot(50,&dashboard,[&,x,y]{
                            QWidget *target=QApplication::activeModalWidget();
                            if(!target)target=&dashboard;
                            QPoint local=target->mapFromGlobal(dashboard.mapToGlobal(QPoint(x,y)));
                            QWidget *child=target->childAt(local);
                            if(child){local=child->mapFrom(target,local);target=child;}
                            QMouseEvent press(QEvent::MouseButtonPress,local,Qt::LeftButton,Qt::LeftButton,Qt::NoModifier);
                            QMouseEvent release(QEvent::MouseButtonRelease,local,Qt::LeftButton,Qt::NoButton,Qt::NoModifier);
                            QApplication::sendEvent(target,&press);QApplication::sendEvent(target,&release);
                        });
                    }
                } else if(action=="close-dialog") {
                    auto modal=qobject_cast<QDialog*>(QApplication::activeModalWidget());if(modal)modal->reject();else ok=false;
                } else ok=false;
                QJsonObject result=backend.status();result.insert("ok",ok);
                QWidget *modal=QApplication::activeModalWidget();
                result.insert("dialog",modal?modal->windowTitle():QString());
                socket->write(QJsonDocument(result).toJson(QJsonDocument::Compact)+'\n'); socket->flush();socket->disconnectFromServer();
            });
        }
    });
    std::signal(SIGINT,signalHandler);std::signal(SIGTERM,signalHandler);
    QTimer signalTimer;QObject::connect(&signalTimer,&QTimer::timeout,&app,[&]{if(interrupted)app.quit();});signalTimer.start(200);
    dashboard.showFullScreen();backend.start();
    qInfo()<<"smart monitor started";
    QString cloudToken, cloudMode="production", cloudProxy;
    QFile cloudConf("/etc/imx6ull-temp-led-test/relay.conf");
    if (cloudConf.open(QIODevice::ReadOnly)) {
        for (auto line : cloudConf.readAll().split('\n')) {
            int split = line.indexOf('=');
            if (split <= 0) continue;
            auto key = QString::fromUtf8(line.left(split)).trimmed();
            auto value = QString::fromUtf8(line.mid(split + 1)).trimmed();
            if (key == "LAB_DEVICE_TOKEN") cloudToken = value;
            else if (key == "MODE") cloudMode = value;
            else if (key == "PROXY") cloudProxy = value;
        }
    }
    MiniTransport cloud;
    QMap<QString, QJsonObject> cloudResults;
    QStringList cloudOrder;
    auto sendCloud = [&] {
        if (!cloud.isReady()) return;
        QJsonObject state{{"type", "mini_state"}, {"observed_at", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
        state.insert("temperature_c", std::isfinite(backend.temperature) && backend.temperature >= -40 && backend.temperature <= 150 ? QJsonValue(backend.temperature) : QJsonValue());
        state.insert("illuminance_lux", std::isfinite(backend.light) && backend.light >= 0 && backend.light <= 30000 ? QJsonValue(backend.light) : QJsonValue());
        if (backend.led == "0" || backend.led == "1") { state.insert("led_mode", "steady"); state.insert("led_on", backend.led == "1"); }
        else if (backend.led == "2") { state.insert("led_mode", "nonsteady"); state.insert("led_on", QJsonValue()); }
        else { state.insert("led_mode", "error"); state.insert("led_on", QJsonValue()); }
        cloud.send(state);
    };
    cloud.onMessage = [&](QJsonObject message) {
        if (message.value("type").toString() != "mini_command" || message.value("command").toString() != "set_led" || !message.value("value").isBool()) return;
        QString id = message.value("request_id").toString();
        if (!QRegularExpression("^[A-Za-z0-9_.-]{1,64}$").match(id).hasMatch()) return;
        if (cloudResults.contains(id)) { cloud.send(cloudResults.value(id)); return; }
        bool desired = message.value("value").toBool();
        bool written = backend.setLed(desired ? "1" : "0", "cloud");
        bool steady = backend.led == "0" || backend.led == "1";
        bool actualOn = backend.led == "1";
        bool success = written && steady && actualOn == desired;
        QJsonObject result{{"type", "mini_result"}, {"request_id", id}, {"ok", success}};
        result.insert("led_on", steady ? QJsonValue(actualOn) : QJsonValue());
        if (!success) result.insert("reason", "hardware_write_or_readback_failed");
        cloudResults.insert(id, result); cloudOrder.append(id);
        if (cloudOrder.size() > 64) cloudResults.remove(cloudOrder.takeFirst());
        cloud.send(result); sendCloud();
    };
    cloud.onConnected = sendCloud;
    QTimer cloudTimer;
    QObject::connect(&cloudTimer, &QTimer::timeout, &app, sendCloud);
    if (QRegularExpression("^[A-Za-z0-9_.~-]{32,512}$").match(cloudToken).hasMatch() && (cloudMode == "local" || cloudMode == "production")) {
        if (cloud.start(cloudToken, cloudMode, cloudProxy)) { cloudTimer.start(2000); qInfo() << "cloud relay enabled"; }
        else qWarning() << "cloud relay not started";
    } else qInfo() << "cloud relay config missing; local monitor continues";
    return app.exec();
}
