# 人工复核文件读取边界：恢复收尾中的窄修复

先核实：assistant-quality-files.ts 的 lstat/fstat 前检和读后检查能拒绝变大文件，但 readFileSync(fd) 在拒绝前按 EOF 分配，不能保证最大读取量。Kimi 部分输出指出此 P2；该轮超时，无完整批准票。本修复不改变授权、原生路径选择或复核协议。

设计：保留 native picker、非链接/普通文件、dev/ino、大小/mtime、finally close 检查。最多分配 maxBytes+1 缓冲区，用 readSync 循环处理短读；到 EOF 或填满立即停止。多读的一字节仅用于判超限，不返回部分成功。最大允许参数仍 4,000,000，无新增路径入口。

实现前对抗自审：文件在 fstat 后增长不能在拒绝前无限读；短读不能误作 EOF；UTF-8 在最后统一解码；错误和超限关闭原 FD；撤权 save 的原 guard 不动。普通 oversize、symlink 和文件替换继续原失败方向。

先加回归：真实临时文件在 held fstat 回执后追加 1 MiB，测量生产入口真正消费的字节总量（同时观察旧 readFileSync 与新 readSync，不在测试重实现读取逻辑），要求不超过 max+1。再覆盖短读和完整 UTF-8。先红后改 production，修改后由不同模型 Kimi 静态复审，重新 build/unsigned package/GUI，不沿用先前包。
