#pragma once
#include "backend.h"
#include <QWidget>
#include <QPainter>
class Trend : public QWidget {
public:
    Backend *backend;
    int minutes = 15;
    explicit Trend(Backend *b, QWidget *p = nullptr) : QWidget(p), backend(b) { setMinimumSize(400, 250); }
    void paintEvent(QPaintEvent *) override;
    static void draw(QPainter &p, const QRectF &rect, const QVector<Sample> &samples, int minutes, bool compact = false);
};
class Dashboard : public QWidget {
    Q_OBJECT
public:
    explicit Dashboard(Backend *backend);
    Backend *backend;
    QString toast;
    void showHistory();
    void showSettings();
protected:
    void paintEvent(QPaintEvent *) override;
    void mouseReleaseEvent(QMouseEvent *) override;
    void keyPressEvent(QKeyEvent *) override;
private:
    void notify(const QString &text);
};
