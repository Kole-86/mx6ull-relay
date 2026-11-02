#include "camera.h"
#include <QElapsedTimer>
#include <QDebug>
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <cstring>
#include <vector>

void Camera::run() {
    struct Buffer { void *data; size_t size; };
    std::vector<Buffer> buffers;
    int fd = -1, sock = -1;
    bool streaming = false;
    QString error;
    quint64 frames = 0, sent = 0, errors = 0;
    auto capture = [&]() {
        fd = ::open(device.toLocal8Bit().constData(), O_RDWR | O_NONBLOCK);
        if (fd < 0) { error = QString::fromLocal8Bit(strerror(errno)); return; }
        v4l2_format fmt = {};
        fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        fmt.fmt.pix.width = 176; fmt.fmt.pix.height = 144;
        fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_RGB565;
        if (ioctl(fd, VIDIOC_S_FMT, &fmt) < 0 || fmt.fmt.pix.pixelformat != V4L2_PIX_FMT_RGB565) {
            error = "摄像头不支持 RGB565"; return;
        }
        int width = fmt.fmt.pix.width, height = fmt.fmt.pix.height;
        int stride = fmt.fmt.pix.bytesperline ? int(fmt.fmt.pix.bytesperline) : width * 2;
        if (width != 176 || height != 144 || stride != width * 2) {
            error = "摄像头格式与现有 UDP 协议不一致"; return;
        }
        v4l2_streamparm parm = {};
        parm.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        if (ioctl(fd, VIDIOC_G_PARM, &parm) == 0 && (parm.parm.capture.capability & V4L2_CAP_TIMEPERFRAME)) {
            parm.parm.capture.timeperframe.numerator = 1;
            parm.parm.capture.timeperframe.denominator = 15;
            ioctl(fd, VIDIOC_S_PARM, &parm);
        }
        v4l2_requestbuffers req = {};
        req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; req.memory = V4L2_MEMORY_MMAP; req.count = 4;
        if (ioctl(fd, VIDIOC_REQBUFS, &req) < 0) { error = "申请采集缓冲失败"; return; }
        for (unsigned i = 0; i < req.count; ++i) {
            v4l2_buffer b = {};
            b.type = req.type; b.memory = req.memory; b.index = i;
            if (ioctl(fd, VIDIOC_QUERYBUF, &b) < 0) { error = "查询采集缓冲失败"; return; }
            void *data = mmap(nullptr, b.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, b.m.offset);
            if (data == MAP_FAILED) { error = "映射采集缓冲失败"; return; }
            buffers.push_back({data, b.length});
            if (ioctl(fd, VIDIOC_QBUF, &b) < 0) { error = "入队失败"; return; }
        }
        int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        if (ioctl(fd, VIDIOC_STREAMON, &type) < 0) { error = "启动采集失败"; return; }
        streaming = true;
        sock = socket(AF_INET, SOCK_DGRAM, 0);
        sockaddr_in dest = {};
        dest.sin_family = AF_INET; dest.sin_port = htons(port);
        bool destinationValid = inet_pton(AF_INET, destination.toLatin1().constData(), &dest.sin_addr) == 1;
        emit cameraState(true, "176 × 144 · RGB565");
        QElapsedTimer preview, report;
        preview.start(); report.start();
        int timeouts = 0;
        while (!isInterruptionRequested()) {
            fd_set readfds; FD_ZERO(&readfds); FD_SET(fd, &readfds);
            timeval timeout = {0, 200000};
            int ready = select(fd + 1, &readfds, nullptr, nullptr, &timeout);
            if (ready < 0) { if (errno == EINTR) continue; error = "摄像头等待失败"; break; }
            if (!ready) {
                if (++timeouts >= 25) { error = "摄像头连续 5 秒无帧"; break; }
                continue;
            }
            v4l2_buffer b = {};
            b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE; b.memory = V4L2_MEMORY_MMAP;
            if (ioctl(fd, VIDIOC_DQBUF, &b) < 0) {
                if (errno == EAGAIN || errno == EINTR) continue;
                error = "摄像头取帧失败"; break;
            }
            if (b.index >= buffers.size()) { error = "摄像头缓冲索引异常"; break; }
            timeouts = 0;
            if (b.bytesused >= unsigned(stride * height) && b.bytesused <= buffers[b.index].size) {
                ++frames;
                if (sock >= 0 && destinationValid && b.bytesused <= 65507) {
                    ssize_t result = sendto(sock, buffers[b.index].data, b.bytesused, MSG_DONTWAIT,
                                            reinterpret_cast<sockaddr *>(&dest), sizeof(dest));
                    if (result == ssize_t(b.bytesused)) ++sent; else ++errors;
                } else ++errors;
                if (preview.elapsed() >= 100) {
                    QImage frame(static_cast<const uchar *>(buffers[b.index].data), width, height, stride, QImage::Format_RGB16);
                    emit frameReady(frame.copy()); preview.restart();
                }
            } else ++errors;
            if (ioctl(fd, VIDIOC_QBUF, &b) < 0) { error = "摄像头缓冲归还失败"; break; }
            if (report.elapsed() >= 1000) { emit statistics(frames, sent, errors); report.restart(); }
        }
    };
    capture();
    if (streaming) { int type = V4L2_BUF_TYPE_VIDEO_CAPTURE; ioctl(fd, VIDIOC_STREAMOFF, &type); }
    for (const auto &buffer : buffers) munmap(buffer.data, buffer.size);
    if (fd >= 0) close(fd);
    if (sock >= 0) close(sock);
    emit statistics(frames, sent, errors);
    emit cameraState(false, error.isEmpty() ? "摄像头已关闭" : error);
    if (!error.isEmpty()) qWarning() << "camera:" << error;
}
