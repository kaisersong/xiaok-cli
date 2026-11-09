// Test-only physical stdout pipe owner. No native hook, credential provider,
// authority substitute or syscall interception. fd 3 controls only pipe reads.
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int write_all(int fd, const void *buffer, size_t length) {
    const char *bytes = buffer;
    while (length) {
        ssize_t written = write(fd, bytes, length);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return -1;
        bytes += written;
        length -= (size_t)written;
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 2 || argv[1][0] != '/') return 64;
    int output[2];
    if (pipe(output)) return 65;
    // Measure this actual pipe before the native exists, then remove every
    // calibration byte. Never inject filler into a live protocol stream.
    int flags = fcntl(output[1], F_GETFL);
    if (flags < 0 || fcntl(output[1], F_SETFL, flags | O_NONBLOCK)) return 77;
    char calibration[65536] = {0};
    size_t capacity = 0;
    for (;;) {
        ssize_t written = write(output[1], calibration, sizeof(calibration));
        if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0 || capacity > 1024 * 1024) return 78;
        capacity += (size_t)written;
    }
    size_t remaining = capacity;
    while (remaining) {
        ssize_t drained = read(output[0], calibration, remaining < sizeof(calibration) ? remaining : sizeof(calibration));
        if (drained < 0 && errno == EINTR) continue;
        if (drained <= 0) return 79;
        remaining -= (size_t)drained;
    }
    if (fcntl(output[1], F_SETFL, flags)) return 80;
    pid_t native = fork();
    if (native < 0) return 66;
    if (native == 0) {
        close(output[0]);
        if (dup2(output[1], STDOUT_FILENO) < 0) _exit(67);
        close(output[1]);
        close(3);
        execl(argv[1], argv[1], "--strict-config", (char *)NULL);
        _exit(68);
    }
    close(output[1]);
    close(STDIN_FILENO);
    signal(SIGPIPE, SIG_IGN);
    dprintf(3, "{\"event\":\"started\",\"nativePid\":%d,\"actualPipe\":true,\"pipeCapacityBytes\":%zu}\n", native, capacity);
    bool held = false, reaped = false, eof = false;
    int status = 0;
    char command[64];
    size_t command_length = 0;
    while (!reaped || !eof) {
        if (!reaped) {
            pid_t waited = waitpid(native, &status, WNOHANG);
            if (waited == native) {
                reaped = true;
                dprintf(3, "{\"event\":\"native-exit\",\"nativePid\":%d,\"code\":%d,\"signal\":%d,\"reaped\":true}\n",
                        native, WIFEXITED(status) ? WEXITSTATUS(status) : -1,
                        WIFSIGNALED(status) ? WTERMSIG(status) : 0);
            } else if (waited < 0 && errno != EINTR) return 69;
        }
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(3, &readable);
        if (!held && !eof) FD_SET(output[0], &readable);
        struct timeval timeout = {.tv_sec = 0, .tv_usec = 50000};
        int max_fd = output[0] > 3 ? output[0] : 3;
        int ready = select(max_fd + 1, &readable, NULL, NULL, &timeout);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return 70;
        if (FD_ISSET(3, &readable)) {
            char byte;
            ssize_t received = read(3, &byte, 1);
            if (received <= 0) {
                // A failed fixture must not leave its original native behind.
                kill(native, SIGKILL);
                if (!reaped) while (waitpid(native, &status, 0) < 0 && errno == EINTR) {}
                return 71;
            }
            if (byte != '\n') {
                if (command_length + 1 >= sizeof(command)) return 72;
                command[command_length++] = byte;
            } else {
                command[command_length] = '\0';
                if (!strcmp(command, "hold")) held = true;
                else if (!strcmp(command, "resume")) held = false;
                else if (strcmp(command, "status")) return 73;
                int buffered = -1;
                if (ioctl(output[0], FIONREAD, &buffered)) return 74;
                dprintf(3, "{\"event\":\"control\",\"command\":\"%s\",\"held\":%s,\"bufferedBytes\":%d}\n",
                        command, held ? "true" : "false", buffered);
                command_length = 0;
            }
        }
        if (!held && !eof && FD_ISSET(output[0], &readable)) {
            char bytes[8192];
            ssize_t received = read(output[0], bytes, sizeof(bytes));
            if (received == 0) eof = true;
            else if (received < 0 && errno != EINTR) return 75;
            else if (received > 0 && write_all(STDOUT_FILENO, bytes, (size_t)received)) return 76;
        }
    }
    close(output[0]);
    close(3);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
