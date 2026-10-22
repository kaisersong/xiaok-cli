# B11 D6 实测与分区替换

A/B/C新案与A/C修后实码APPROVE。原full823 D6未达真实open的红保留；C抓到局部open遮蔽helper的首静态BLOCK也保留。最终仅重命名submittedOpen，三源码SHA见B-D6-results.json。

B-D6-family-green为三个完整文件69/69，exit0/reaped/PGID55390空：process原17、native Worker原33、IO原19全执行。D6自身3370ms，默认runner5s保持。D6明确subject100改2000，属于已批准的测试逻辑预算修订，不能称runner校准或声称D6原100保留。D7实际100及原CPU、heartbeat和Worker退出断言保持，所有生产未改。

新D6先证明CPU facts/exit后原open真正返回原Promise，提交在原deadline前且尚未settle；再等真实timeout持久报告和500ms outward grace实际拒绝，之后检查原inFlight、business completed、host unknown和cleanupPending。

B-D6-late-writer精确副本诊断为1通过、16名称过滤，exit0/reaped/PGID58977空，不计原17人口。全部原ownership谓词通过后才启动独立writer59163，owner59045。writer真正打开FIFO写端配对并close退出0，没有写伪PDF。同一owner的raw顺序：submitted674.300ms、timeout持久2577.002、verifier拒绝3078.216、原open迟到resolve3109.133、原FileHandle close调用3109.375/resolve3109.473、host真drain3146.956。最终inFlight=false、readerCleanup=settled。

3000ms helper及默认5s未改。副本316f6cd已归档后精确删除。派生审计首版将重复timeout stage的最后rev3覆盖首次rev2边界，导致派生断言失败；已改为明确核对首次边界，raw、源码和测试结果均未改。纠正记录保存在B-D6-writer-analysis.json。

B-host-related-node22-22四完整文件65/65，exit0/reaped/PGID62902空，包含projection whole21并绑定host79650281。它补足最低支持点的host兄弟验证，不能代替签名Loop原8。最终原8本机Node24正在运行；22.22由root新CI真实矩阵闭环，未见CI绿前保持pending。

上述targeted groups实核为空；B full823和最终Loop8仍活动，不能称本席所有groups0。full的process旧失败由本whole17最终源结果替换，相关69只计一次，晚writer诊断单列。其他full新红由root/C各自完整分区替换，本票不宣称Desktop全绿。
