#pragma once
#include <QtCore>
#include <QtNetwork>
#include <functional>
#include <cstdio>
static void eventLog(const QString&s){auto b=(QDateTime::currentDateTimeUtc().toString("yyyy-MM-ddTHH:mm:ss.zzzZ")+" "+s+"\n").toUtf8();fwrite(b.data(),1,b.size(),stdout);fflush(stdout);}
class MiniTransport:public QObject {
 QSslSocket socket;QTimer tick,retry;QElapsedTimer clock;QByteArray rx,key,fragments;int fragmentOpcode=0;
 QString token,proxy;bool local=false,ready=false,waiting=false;int backoff=1,pongs=0,connections=0;qint64 opened=0,lastPing=0,pingAt=0;
 qint64 now(){return clock.elapsed();}
 void down(const QString&why){eventLog(why);bool was=ready;ready=false;waiting=false;socket.abort();rx.clear();fragments.clear();fragmentOpcode=0;if(was&&onDisconnected)onDisconnected();if(!retry.isActive()){retry.start(backoff*1000+int(QRandomGenerator::global()->bounded(501)));backoff=qMin(30,backoff*2);}}
 void log(const QString&s){eventLog(s);}
 void message(QByteArray b){if(b=="pong"){waiting=false;++pongs;return;}QJsonParseError e;auto d=QJsonDocument::fromJson(b,&e);if(!e.error&&d.isObject()&&onMessage)onMessage(d.object());}
 bool frame(QByteArray data,int opcode=1){if(!ready||socket.bytesToWrite()>262144||data.size()>32768)return false;QByteArray b;b.append(char(0x80|opcode));if(data.size()<126)b.append(char(0x80|data.size()));else{b.append(char(0xfe));b.append(char(data.size()>>8));b.append(char(data.size()));}quint32 m=QRandomGenerator::global()->generate();QByteArray mask(reinterpret_cast<const char*>(&m),4);b+=mask;for(int i=0;i<data.size();++i)data[i]=data[i]^mask[i%4];b+=data;return socket.write(b)==b.size();}
 void read(){rx+=socket.readAll();if(rx.size()>131072){down("RX_LIMIT");return;}
 if(!ready){int end=rx.indexOf("\r\n\r\n");if(end<0){if(rx.size()>16384)down("HEADER_LIMIT");return;}auto header=rx.left(end).split('\n');QMap<QByteArray,QByteArray> h;for(int i=1;i<header.size();++i){int c=header[i].indexOf(':');if(c>0){auto n=header[i].left(c).trimmed().toLower();if(h.contains(n))h[n]+=",";h[n]+=header[i].mid(c+1).trimmed();}}
 auto accept=QCryptographicHash::hash(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11",QCryptographicHash::Sha1).toBase64();
 if(!header[0].startsWith("HTTP/1.1 101 ")||h["sec-websocket-accept"]!=accept||h["sec-websocket-protocol"]!="codex-lab.v1"||h["upgrade"].toLower()!="websocket"||!h["connection"].toLower().split(',').contains("upgrade")){down("HANDSHAKE_REJECTED (headers withheld)");return;}
 rx.remove(0,end+4);ready=true;opened=lastPing=now();++connections;log(local?"HANDSHAKE_OK local ws via SSH; selected_protocol=codex-lab.v1":"HANDSHAKE_OK TLS verified; selected_protocol=codex-lab.v1");if(onConnected)onConnected();}
 while(ready&&rx.size()>=2){quint8 a=quint8(rx[0]),b=quint8(rx[1]);bool fin=a&128;int op=a&15;quint64 len=b&127;int off=2;if((a&0x70)||(b&128)){down("FRAME_PROTOCOL_ERROR");return;}if(len==126){if(rx.size()<4)return;len=(quint8(rx[2])<<8)|quint8(rx[3]);off=4;}else if(len==127){if(rx.size()<10)return;len=0;for(int i=2;i<10;++i)len=(len<<8)|quint8(rx[i]);off=10;}if(len>32768||(op>=8&&(!fin||len>125))){down("FRAME_LIMIT");return;}if(quint64(rx.size())<len+off)return;QByteArray data=rx.mid(off,int(len));rx.remove(0,off+int(len));if(op==8){down("SERVER_CLOSE");return;}if(op==9){frame(data,10);continue;}if(op==10)continue;if(op==1||op==2){if(fragmentOpcode){down("FRAME_FRAGMENT_ERROR");return;}if(fin){if(op==1)message(data);}else{fragmentOpcode=op;fragments=data;}}else if(op==0){if(!fragmentOpcode||fragments.size()+data.size()>32768){down("FRAME_FRAGMENT_ERROR");return;}fragments+=data;if(fin){if(fragmentOpcode==1)message(fragments);fragmentOpcode=0;fragments.clear();}}else{down("FRAME_OPCODE_ERROR");return;}}
 }

 void handshake(){QByteArray random;for(int i=0;i<4;++i){quint32 n=QRandomGenerator::global()->generate();random.append(reinterpret_cast<const char*>(&n),4);}key=random.toBase64();QByteArray host=local?"127.0.0.1:18789":qgetenv("CLOUD_RELAY_HOST");
 QByteArray req="GET /mini/ws?kind=board HTTP/1.1\r\nHost: "+host+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key+"\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: codex-lab.v1, auth."+token.toUtf8()+"\r\n\r\n";socket.write(req);}
 void connectNow(){opened=now();if(local)socket.connectToHost("127.0.0.1",18789);else if(QDateTime::currentDateTimeUtc().date().year()<2025)down("CLOCK_INVALID");else socket.connectToHostEncrypted(qgetenv("CLOUD_RELAY_HOST"),443);}
public:
 std::function<void(QJsonObject)> onMessage;std::function<void()> onConnected,onDisconnected;
 bool isReady()const{return ready;}
 bool send(QJsonObject o){o["device_id"]="imx6ull_temp_led_01";return frame(QJsonDocument(o).toJson(QJsonDocument::Compact));}
 bool start(QString secret,QString mode,QString configuredProxy){token=secret;proxy=configuredProxy;local=mode=="local";clock.start();
 if(!local){auto ssl=QSslConfiguration::defaultConfiguration();auto certs=QSslCertificate::fromPath("/etc/ssl/certs/ca-certificates.crt");if(certs.isEmpty())return false;ssl.setCaCertificates(certs);ssl.setPeerVerifyMode(QSslSocket::VerifyPeer);ssl.setProtocol(QSsl::TlsV1_2OrLater);socket.setSslConfiguration(ssl);}
 if(!local&&!proxy.isEmpty()){QUrl u("http://"+proxy);socket.setProxy(QNetworkProxy(QNetworkProxy::HttpProxy,u.host(),quint16(u.port())));}else socket.setProxy(QNetworkProxy(QNetworkProxy::NoProxy));
 connect(&socket,&QSslSocket::encrypted,this,[this]{handshake();});connect(&socket,&QSslSocket::connected,this,[this]{if(local)handshake();});
 connect(&socket,&QSslSocket::readyRead,this,[this]{read();});connect(&socket,&QSslSocket::disconnected,this,[this]{down("DISCONNECTED");});
 connect(&socket,QOverload<QAbstractSocket::SocketError>::of(&QSslSocket::error),this,[this](QAbstractSocket::SocketError e){down("NETWORK_ERROR "+QString::number(int(e)));});
 connect(&socket,QOverload<const QList<QSslError>&>::of(&QSslSocket::sslErrors),this,[](const QList<QSslError>&){eventLog("TLS_VALIDATION_FAILED");});
 retry.setSingleShot(true);connect(&retry,&QTimer::timeout,this,[this]{connectNow();});connect(&tick,&QTimer::timeout,this,[this]{qint64 t=now();if(!ready&&!retry.isActive()&&t-opened>30000)down("CONNECT_TIMEOUT");if(ready){if(t-opened>60000)backoff=1;if(waiting&&t-pingAt>10000)down("PONG_TIMEOUT");else if(!waiting&&t-lastPing>=20000){pingAt=lastPing=t;waiting=frame("ping");}}});tick.start(200);connectNow();return true;}
};
