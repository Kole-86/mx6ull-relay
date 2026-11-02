QT += core gui widgets network
CONFIG += c++11 release
TARGET = smart_monitor
SOURCES += main.cpp backend.cpp camera.cpp dashboard.cpp mqttlink.cpp
HEADERS += backend.h camera.h dashboard.h mqttlink.h
QMAKE_CXXFLAGS += -Wall -Wextra

INCLUDEPATH += $$(PAHO_PREFIX)/include
LIBS += -L$$(PAHO_PREFIX)/lib -lpaho-mqtt3cs
