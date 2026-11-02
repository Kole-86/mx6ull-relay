#include "mqttlink.h"
#include <QMutexLocker>
#include <QDebug>
void MqttLink::configure(QString h, int p, QString u, QString password) {
    QMutexLocker lock(&mutex); host=h;port=p;user=u;pass=password;++generation;
}
void MqttLink::publish(QString topic,QByteArray payload,bool retained) {
    QMutexLocker lock(&mutex);
    for(auto &message:queue)if(message.topic==topic){message.payload=payload;message.retained=retained;return;}
    if(queue.size()<32)queue.append({topic,payload,retained});
}
int MqttLink::received(void *context,char *topic,int length,MQTTClient_message *message) {
    auto self=static_cast<MqttLink*>(context);
    QString name=QString::fromUtf8(topic,length?length:int(strlen(topic)));
    if(message->payloadlen<=64)emit self->commandReceived(QByteArray(static_cast<char*>(message->payload),message->payloadlen),name);
    else qWarning()<<"MQTT oversized control payload ignored";
    MQTTClient_freeMessage(&message);MQTTClient_free(topic);return 1;
}
void MqttLink::disconnected(void *context,char *) {static_cast<MqttLink*>(context)->lost=true;}
void MqttLink::run() {
    int retry=2000;
    while(!isInterruptionRequested()) {
        QString server,username,password;int version;
        {QMutexLocker lock(&mutex);server=QString("ssl://%1:%2").arg(host).arg(port);username=user;password=pass;version=generation;}
        if(password.isEmpty()) {
            emit connectionChanged(false,"请在设置中输入 MQTT 密码");
            while(!isInterruptionRequested()){msleep(100);QMutexLocker lock(&mutex);if(version!=generation)break;}
            continue;
        }
        MQTTClient client=nullptr;
        QByteArray address=server.toUtf8(),userBytes=username.toUtf8(),passBytes=password.toUtf8();
        int rc=MQTTClient_create(&client,address.constData(),"DR_WEI_ARM",MQTTCLIENT_PERSISTENCE_NONE,nullptr);
        lost=false;
        if(rc==MQTTCLIENT_SUCCESS)rc=MQTTClient_setCallbacks(client,this,disconnected,received,nullptr);
        MQTTClient_connectOptions opts=MQTTClient_connectOptions_initializer;
        MQTTClient_SSLOptions ssl=MQTTClient_SSLOptions_initializer;
        MQTTClient_willOptions will=MQTTClient_willOptions_initializer;
        ssl.trustStore="/etc/ssl/certs/ca-certificates.crt";ssl.enableServerCertAuth=1;ssl.verify=1;
        will.topicName="dr_wei/will";will.message="Unexpected disconnection";will.qos=1;will.retained=1;
        opts.ssl=&ssl;opts.will=&will;opts.username=userBytes.constData();opts.password=passBytes.constData();
        opts.cleansession=1;opts.keepAliveInterval=20;opts.connectTimeout=8;opts.MQTTVersion=MQTTVERSION_3_1_1;
        qInfo()<<"MQTT connecting"<<server;
        if(rc==MQTTCLIENT_SUCCESS)rc=MQTTClient_connect(client,&opts);
        qInfo()<<"MQTT CONNECT result"<<rc;
        if(rc==MQTTCLIENT_SUCCESS) {
            char ledTopic[]="dr_wei/led",cameraTopic[]="dr_wei/camera/cmd";
            char *topics[]={ledTopic,cameraTopic};int qos[]={1,1};
            rc=MQTTClient_subscribeMany(client,2,topics,qos);
            qInfo()<<"MQTT SUBACK"<<rc<<qos[0]<<qos[1];
            if(rc==MQTTCLIENT_SUCCESS&&(qos[0]!=1||qos[1]!=1))rc=128;
        }
        if(rc==MQTTCLIENT_SUCCESS) {
            retry=2000;emit connectionChanged(true,QString());publish("dr_wei/will","Online");
            while(!isInterruptionRequested()&&!lost) {
                QVector<Message> messages;
                {QMutexLocker lock(&mutex);if(version!=generation)break;messages.swap(queue);}
                for(const auto &message:messages) {
                    MQTTClient_message outgoing=MQTTClient_message_initializer;
                    QByteArray topic=message.topic.toUtf8();
                    outgoing.payload=const_cast<char*>(message.payload.constData());outgoing.payloadlen=message.payload.size();
                    outgoing.qos=1;outgoing.retained=message.retained;
                    MQTTClient_deliveryToken token;
                    rc=MQTTClient_publishMessage(client,topic.constData(),&outgoing,&token);
                    if(rc==MQTTCLIENT_SUCCESS)rc=MQTTClient_waitForCompletion(client,token,3000);
                    if(rc!=MQTTCLIENT_SUCCESS){lost=true;break;}
                }
                msleep(50);
            }
        }
        if(client) {
            if(MQTTClient_isConnected(client)) {
                if(isInterruptionRequested()) {
                    MQTTClient_deliveryToken token;
                    if(MQTTClient_publish(client,"dr_wei/will",7,const_cast<char*>("Offline"),1,1,&token)==0)
                        MQTTClient_waitForCompletion(client,token,1000);
                }
                MQTTClient_disconnect(client,1000);
            }
            MQTTClient_destroy(&client);
        }
        emit connectionChanged(false,isInterruptionRequested()?QString():QString("MQTT 已断开（%1），正在重连").arg(rc));
        if(isInterruptionRequested())break;
        for(int elapsed=0;elapsed<retry&&!isInterruptionRequested();elapsed+=100){
            msleep(100);QMutexLocker lock(&mutex);if(version!=generation)break;
        }
        retry=qMin(30000,retry*2);
    }
}
