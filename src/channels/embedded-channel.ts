/**
 * 嵌入式 channel 接口。
 * 实现类在 chat 进程内运行，生命周期跟随 chat 进程。
 * 关 chat 进程即关 channel；常驻请用独立 CLI 子命令。
 */
export interface EmbeddedChannel {
  /** 启动 transport，开始接收入站消息 */
  start(): Promise<void>;
  /** 断开连接，释放资源 */
  cleanup(): Promise<void>;
}
