# A C9 删除门增量案首轮票

BLOCK，当前仅重新读取active0/blockedfalse仍不能证明原dispose时journal已关闭。

已完整读C9-root-gate-increment-plan.md及实际services:2927、executionCoordinator.snapshot、store.close/isClosed。明确可操作反例：真实ordinary lease active1 → await原dispose fulfill（services当时不close store）→原ticket.release使active0 → fixture cleanup新三门fulfilled/active0/blockedfalse全满足，却rm仍open journal。原计划负例把lease一直持到cleanup之后，未覆盖这个门检查时间差。

最低修订：保留当前coordinator/runtime附加门，并只读实际journal关闭证据（fixture已持原db，可要求db.isOpen===false，缺失/非bool/异常均retain+报错；不主动close）。store.isClosed单独不够：store.close先置flag再调用db.close，后者可能throw。新增release-before-cleanup与hold-through-cleanup两真实轨迹，叶rm精确保护保留，先红再修。Node24.16/最低22.22实际nativeAPI true→close后false已probe，原日志A-C9-isOpen-probe-*.log，不能把API探针当production全链验收。

不成功task snapshot检查移到dispose前合理：保留原not-completed断言，避免dispose已关闭CodexDB后再recover的非法生命周期。原失败130pass1fail仍保留，最终需修后五whole24/22.22新日志。
