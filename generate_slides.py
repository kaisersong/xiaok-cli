#!/usr/bin/env python3
OUTPUT_PATH = "/Users/song/Downloads/金蝶灵基-CEO-V19-幻灯片.html"
TITLE = "金蝶灵基 for CEO V1.9"
SUBTITLE = "2 周冲刺研发计划 · 5/10 评审版"

theme_css = """
:root {
  --bg: #ffffff;
  --bg-dark: #0a0a0a;
  --text: #0a0a0a;
  --text-light: #ffffff;
  --text-muted: #666666;
  --red: #ff3300;
  --grid-line: rgba(0, 0, 0, 0.05);
}
body { background: var(--bg); font-family: "Nunito", -apple-system, "PingFang SC", sans-serif; color: var(--text); margin: 0; }
html { scroll-snap-type: y mandatory; height: 100%; }
body { height: 100%; }
.slide {
  width: 100vw; height: 100vh; height: 100dvh;
  scroll-snap-align: start; display: flex; flex-direction: column;
  position: relative; overflow: hidden;
}
.slide-content { flex: 1; display: flex; flex-direction: column; justify-content: center; max-height: 100%; overflow: hidden; padding: clamp(1.5rem, 4vw, 4rem); }
.reveal { opacity: 0; transform: translateY(30px); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }
.slide.visible .reveal { opacity: 1; transform: translateY(0); }
.reveal:nth-child(1) { transition-delay: 0.1s; }
.reveal:nth-child(2) { transition-delay: 0.2s; }
.reveal:nth-child(3) { transition-delay: 0.3s; }
.reveal:nth-child(4) { transition-delay: 0.4s; }
.reveal:nth-child(5) { transition-delay: 0.5s; }

.swiss-grid {
  position: fixed; inset: 0;
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: calc(100vw / 12) 100vh; pointer-events: none; z-index: 0;
}
.swiss-title { font-family: "Archivo Black", sans-serif; font-size: clamp(32px, 7vw, 72px); font-weight: 900; color: var(--text); line-height: 1.0; letter-spacing: -0.02em; text-transform: uppercase; }
.swiss-body { font-family: "Nunito", sans-serif; font-size: clamp(12px, 1.4vw, 15px); font-weight: 400; color: var(--text); line-height: 1.55; max-width: 55ch; }
.swiss-label { font-family: "Archivo", sans-serif; font-size: clamp(10px, 1.1vw, 12px); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.swiss-stat { font-family: "Archivo Black", sans-serif; font-size: clamp(48px, 8vw, 96px); font-weight: 900; color: var(--text); line-height: 1.0; }
.accent { color: var(--red); }
.hero-rule { width: clamp(40px, 8vw, 100px); height: 4px; background: var(--red); }
.hero-sub { font-family: "Nunito", sans-serif; font-size: clamp(12px, 1.4vw, 16px); color: var(--text-muted); line-height: 1.6; max-width: 32rem; }
.hero-stats { display: flex; flex-wrap: wrap; gap: clamp(20px, 3vw, 48px); }
.hero-stat-num { font-family: "Archivo Black", sans-serif; font-size: clamp(28px, 4vw, 48px); font-weight: 900; color: var(--red); line-height: 1; }
.hero-stat-label { font-family: "Nunito", sans-serif; font-size: clamp(9px, 0.85vw, 11px); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.bg-num { position: absolute; right: clamp(2rem, 5vw, 5rem); top: 0; font-family: "Archivo Black", sans-serif; font-weight: 900; font-size: clamp(8rem, 25vw, 18rem); color: #f0f0f0; line-height: 0.85; pointer-events: none; user-select: none; z-index: 0; }
.slide-num-label { position: absolute; top: 28px; right: 28px; font-family: "Archivo Black", sans-serif; font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(0, 0, 0, 0.18); z-index: 2; }
.slide-num-label.light { color: rgba(255, 255, 255, 0.28); }

.left-panel { width: 38%; background: var(--bg-dark); color: var(--text-light); display: flex; flex-direction: column; justify-content: center; padding: clamp(28px, 5vw, 56px); position: relative; }
.right-panel { width: 62%; display: flex; flex-direction: column; justify-content: center; padding: clamp(28px, 5vw, 56px); gap: clamp(16px, 2vw, 28px); }
.red-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: var(--red); }
.left-rule { width: 40px; height: 3px; background: var(--red); }
.pain-item { padding-left: clamp(12px, 2vw, 20px); border-left: 2px solid var(--grid-line); }
.accent-border { border-left-color: var(--red); }
.pain-num { font-family: "Archivo Black", sans-serif; font-size: clamp(16px, 2vw, 24px); font-weight: 900; color: var(--red); line-height: 1; }
.pain-title { font-family: "Archivo Black", sans-serif; font-size: clamp(13px, 1.5vw, 18px); font-weight: 900; text-transform: uppercase; }
.pain-desc { font-family: "Nunito", sans-serif; font-size: clamp(12px, 1.4vw, 16px); color: var(--text-muted); line-height: 1.5; }

.stat-row { display: flex; align-items: center; gap: clamp(20px, 3vw, 36px); }
.stat-divider { width: 2px; align-self: stretch; background: var(--text); }
.stat-copy { display: flex; flex-direction: column; gap: 6px; }
.stat-label { font-family: "Archivo Black", sans-serif; font-size: clamp(12px, 1.3vw, 16px); font-weight: 900; color: var(--text); text-transform: uppercase; letter-spacing: 0.06em; }
.stat-value { font-family: "Nunito", sans-serif; font-size: clamp(12px, 1.4vw, 16px); color: var(--text-muted); line-height: 1.5; }

.disc-header { padding-top: clamp(48px, 8vh, 80px); display: flex; flex-direction: column; gap: 12px; }
.disc-body { display: flex; gap: clamp(20px, 4vw, 60px); align-items: center; }
.disc-steps { display: flex; flex-direction: column; gap: clamp(12px, 1.5vw, 20px); flex: 1; }
.disc-step { display: flex; gap: 12px; align-items: flex-start; }
.disc-step-num { font-family: "Archivo Black", sans-serif; font-size: clamp(18px, 2.5vw, 32px); font-weight: 900; color: var(--red); line-height: 1; min-width: 36px; }
.disc-step-title { font-family: "Archivo Black", sans-serif; font-size: clamp(13px, 1.4vw, 18px); font-weight: 900; color: var(--text); text-transform: uppercase; line-height: 1.2; }
.disc-step-desc { font-family: "Nunito", sans-serif; font-size: clamp(12px, 1.4vw, 16px); color: var(--text-muted); line-height: 1.45; }

.data-table { width: 100%; border-collapse: collapse; font-size: clamp(11px, 1.2vw, 14px); }
.data-table th { text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--text); font-family: "Archivo Black", sans-serif; text-transform: uppercase; letter-spacing: 0.06em; font-size: clamp(10px, 1vw, 12px); }
.data-table td { padding: 10px 12px; border-bottom: 1px solid var(--grid-line); }
.data-table tr:hover td { background: rgba(0,0,0,0.02); }

.timeline-track { position: relative; height: 2px; background: var(--grid-line); margin: 40px 0; }
.timeline-dot { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; border-radius: 50%; background: var(--red); border: 2px solid var(--bg); }
.timeline-label { position: absolute; top: -28px; transform: translateX(-50%); font-family: "Archivo Black", sans-serif; font-size: clamp(10px, 1vw, 12px); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); white-space: nowrap; }
.timeline-event { position: absolute; top: 20px; transform: translateX(-50%); font-family: "Nunito", sans-serif; font-size: clamp(11px, 1.1vw, 13px); color: var(--text); text-align: center; max-width: 140px; line-height: 1.4; }

#present-btn { position: fixed; top: 16px; right: 16px; z-index: 1000; background: var(--bg-dark); color: #fff; border: none; border-radius: 4px; padding: 8px 16px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer; }
#present-counter { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 1000; font-family: "Archivo Black", sans-serif; font-size: 12px; color: var(--text-muted); display: none; }
body.presenting .slide { display: none; }
body.presenting .slide.p-on { display: flex; }
body.presenting #present-counter { display: block; }
body.presenting .nav-dots { display: none; }
.nav-dots { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 100; }
.nav-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--grid-line); border: none; cursor: pointer; transition: background 0.2s; }
.nav-dot.active { background: var(--red); }
.progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--red); z-index: 100; transition: width 0.3s; }

@media (max-width: 768px) {
  .left-panel, .right-panel { width: 100%; }
  #slide-2, #slide-4, #slide-6, #slide-8, #slide-10 { flex-direction: column; }
  .bg-num { font-size: 6rem; }
}
@media (max-height: 600px) { .nav-dots { display: none; } }
@media print { #present-btn, .nav-dots, .progress-bar { display: none !important; } }
"""

slides = [
  # Slide 1: Cover
  ('''
  <section class="slide" id="slide-1" data-notes="封面：金蝶灵基 CEO V1.9 研发计划，2 周冲刺，5/10 评审">
    <div class="bg-num">01</div>
    <div class="slide-num-label">01 / 12</div>
    <div class="slide-content" style="justify-content: center; align-items: flex-start; gap: 24px;">
      <div class="reveal hero-rule"></div>
      <div class="reveal swiss-label" style="color: var(--red);">金蝶灵基 for CEO V1.9</div>
      <h1 class="reveal swiss-title" style="max-width: 70vw;">2 周冲刺<br>研发计划</h1>
      <p class="reveal hero-sub">5 大里程碑 · 46 项任务 · 13 项演示验收闸 · 截止 5/10</p>
      <div class="reveal hero-stats" style="margin-top: 24px;">
        <div><div class="hero-stat-num">46</div><div class="hero-stat-label">任务</div></div>
        <div><div class="hero-stat-num">85</div><div class="hero-stat-label">人天</div></div>
        <div><div class="hero-stat-num">5/10</div><div class="hero-stat-label">评审日</div></div>
      </div>
    </div>
  </section>
  '''),

  # Slide 2: 总体计划
  ('''
  <section class="slide" id="slide-2" data-notes="总体计划：5 大里程碑时间窗与关键产出">
    <div class="bg-num">02</div>
    <div class="slide-num-label">02 / 12</div>
    <div class="left-panel reveal">
      <div class="red-bar"></div>
      <div class="left-rule" style="margin-bottom: 16px;"></div>
      <div class="swiss-label" style="color: rgba(255,255,255,0.5); margin-bottom: 8px;">总体计划</div>
      <h2 class="swiss-title" style="font-size: clamp(24px, 4vw, 40px); color: #fff;">5 大里程碑<br>并行推进</h2>
      <p class="hero-sub" style="color: rgba(255,255,255,0.6); margin-top: 12px;">W1 含五一加班，M1+M2 并行；W2 进入 M3+M4+M5。</p>
    </div>
    <div class="right-panel reveal">
      <div class="disc-steps">
        <div class="disc-step">
          <div class="disc-step-num">M1</div>
          <div><div class="disc-step-title">信息架构 + 视觉焦点</div><div class="disc-step-desc">W1 4/29–5/4 · 简报精简、外部洞察 4 类、日程四分类</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">M2</div>
          <div><div class="disc-step-title">置信度 + 信息澄清 + KPI 三动作</div><div class="disc-step-desc">W1 同期 · 置信度模型、转发/追问/进一步分析</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">M3</div>
          <div><div class="disc-step-title">数据源接入 + KBC 3.0</div><div class="disc-step-desc">W2 5/6–5/10 · 1 号报告、亏损减亏、websearch、苍穹审批</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">M4</div>
          <div><div class="disc-step-title">消息智能体 + 调整关注 + 埋点</div><div class="disc-step-desc">W2 同期 · 云之间 IM、全局 follow、14 个埋点</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">M5</div>
          <div><div class="disc-step-title">内部灰度 + Demo</div><div class="disc-step-desc">W2 同期 · 灰度名单、E2E、压测、Demo 演练</div></div>
        </div>
      </div>
    </div>
  </section>
  '''),

  # Slide 3: M1 详情
  ('''
  <section class="slide" id="slide-3" data-notes="M1 任务清单：9 项任务，聚焦简报精简与视觉焦点">
    <div class="bg-num">03</div>
    <div class="slide-num-label">03 / 12</div>
    <div class="slide-content">
      <div class="reveal swiss-label" style="color: var(--red); margin-bottom: 8px;">M1 · W1</div>
      <h2 class="reveal swiss-title" style="font-size: clamp(24px, 4vw, 40px); margin-bottom: 24px;">信息架构 + 视觉焦点</h2>
      <div class="reveal" style="overflow-x: auto;">
        <table class="data-table">
          <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>P</th><th>估工</th></tr></thead>
          <tbody>
            <tr><td>1.1</td><td>外部洞察 4 类 chip + 数据</td><td>FE</td><td style="color:var(--red); font-weight:700;">P0</td><td>0.5d</td></tr>
            <tr><td>1.3</td><td>简报概览文本精简 + 关键加粗</td><td>FE+DS</td><td style="color:var(--red); font-weight:700;">P0</td><td>3d</td></tr>
            <tr><td>1.5</td><td>视觉焦点规则前端实现</td><td>FE</td><td style="color:var(--red); font-weight:700;">P0</td><td>1.5d</td></tr>
            <tr><td>1.7</td><td>日程四分类字段 schema</td><td>BE</td><td style="color:var(--red); font-weight:700;">P0</td><td>0.5d</td></tr>
            <tr><td>1.9</td><td>简报"今日日程"四分类徽标</td><td>FE</td><td style="color:var(--red); font-weight:700;">P0</td><td>1d</td></tr>
          </tbody>
        </table>
      </div>
      <p class="reveal hero-sub" style="margin-top: 16px;">关键交付：简报区 4 段结构，每段字数压减 ≥50%，每段仅 1 处主焦加粗。</p>
    </div>
  </section>
  '''),

  # Slide 4: M2 详情
  ('''
  <section class="slide" id="slide-4" data-notes="M2 任务清单：置信度体系与 KPI 三动作">
    <div class="bg-num">04</div>
    <div class="slide-num-label">04 / 12</div>
    <div class="left-panel reveal">
      <div class="red-bar"></div>
      <div class="left-rule" style="margin-bottom: 16px;"></div>
      <div class="swiss-label" style="color: rgba(255,255,255,0.5);">M2 · W1</div>
      <h2 class="swiss-title" style="font-size: clamp(24px, 4vw, 40px); color: #fff;">置信度 +<br>KPI 三动作</h2>
    </div>
    <div class="right-panel reveal">
      <div class="disc-steps">
        <div class="disc-step">
          <div class="disc-step-num">2.1</div>
          <div><div class="disc-step-title">置信度评分模型</div><div class="disc-step-desc">4 子项 + 权重 · AI+BE · P0 · 2d</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">2.3</div>
          <div><div class="disc-step-title">信息澄清面板组件</div><div class="disc-step-desc">≤3 问 + 三按钮 · FE · P0 · 2d</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">2.5</div>
          <div><div class="disc-step-title">KPI 卡通用组件</div><div class="disc-step-desc">头部 + mini 趋势线 + 三动作 · FE+DS · P0 · 2d</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">2.6</div>
          <div><div class="disc-step-title">「转发」选人面板</div><div class="disc-step-desc">Top3 推荐 + 卡片快照 · FE+BE · P0 · 1.5d</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">2.8</div>
          <div><div class="disc-step-title">「进一步分析」路由专家</div><div class="disc-step-desc">财务→经营分析 / 客户→关键客户 · AI+FE · P0 · 1.5d</div></div>
        </div>
      </div>
    </div>
  </section>
  '''),

  # Slide 5: M3 详情
  ('''
  <section class="slide" id="slide-5" data-notes="M3 任务清单：数据源接入与 KBC 3.0，11 项任务">
    <div class="bg-num">05</div>
    <div class="slide-num-label">05 / 12</div>
    <div class="slide-content">
      <div class="reveal swiss-label" style="color: var(--red); margin-bottom: 8px;">M3 · W2</div>
      <h2 class="reveal swiss-title" style="font-size: clamp(24px, 4vw, 40px); margin-bottom: 24px;">数据源接入 + KBC 3.0</h2>
      <div class="reveal" style="overflow-x: auto;">
        <table class="data-table">
          <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>估工</th></tr></thead>
          <tbody>
            <tr><td>3.1</td><td>KBC 3.0 名单导入（管理员后台）</td><td>BE+FE</td><td>1.5d</td></tr>
            <tr><td>3.3</td><td>关键客户区接入 KBC 3.0 数据</td><td>FE</td><td>1.5d</td></tr>
            <tr><td>3.4</td><td>客户异动判定规则（6 类）</td><td>AI+BE</td><td>2d</td></tr>
            <tr><td>3.5</td><td>1 号报告 API 对接 + 缓存 + 降级</td><td>BE</td><td>2d</td></tr>
            <tr><td>3.8</td><td>websearch 客户档案爬取服务</td><td>BE+AI</td><td>3d</td></tr>
          </tbody>
        </table>
      </div>
      <p class="reveal hero-sub" style="margin-top: 16px;">关键依赖：KBC 3.0 名单 API 未就绪时，Excel 导入兜底（3.1）。</p>
    </div>
  </section>
  '''),

  # Slide 6: M4 + M5
  ('''
  <section class="slide" id="slide-6" data-notes="M4 消息智能体与 M5 灰度收尾">
    <div class="bg-num">06</div>
    <div class="slide-num-label">06 / 12</div>
    <div class="left-panel reveal">
      <div class="red-bar"></div>
      <div class="left-rule" style="margin-bottom: 16px;"></div>
      <div class="swiss-label" style="color: rgba(255,255,255,0.5);">M4 · W2</div>
      <h2 class="swiss-title" style="font-size: clamp(20px, 3vw, 32px); color: #fff;">消息智能体<br>+ 调整关注<br>+ 埋点</h2>
      <p class="hero-sub" style="color: rgba(255,255,255,0.5); margin-top: 12px;">云之间 IM OAuth、拉消息、摘要生成、一键回复、14 个埋点。</p>
    </div>
    <div class="right-panel reveal">
      <div class="swiss-label" style="color: var(--red); margin-bottom: 8px;">M5 · W2 收尾</div>
      <h2 class="swiss-title" style="font-size: clamp(20px, 3vw, 32px); margin-bottom: 20px;">内部灰度 + Demo</h2>
      <div class="disc-steps">
        <div class="disc-step">
          <div class="disc-step-num">5.1</div>
          <div><div class="disc-step-title">灰度名单 + feature flag</div><div class="disc-step-desc">5 名 CEO 灰度名单（PD 签字）</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">5.3</div>
          <div><div class="disc-step-title">关键路径 E2E 用例 30 条</div><div class="disc-step-desc">自动化通过率 100%</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">5.4</div>
          <div><div class="disc-step-title">性能压测</div><div class="disc-step-desc">LCP ≤1.5s · websearch FPS ≥50 · IM 1h 不掉线</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">5.5</div>
          <div><div class="disc-step-title">5/10 Demo 演练 + 评审</div><div class="disc-step-desc">Demo 走查 ×2（5/9）+ 现场演示 ≤7min</div></div>
        </div>
      </div>
    </div>
  </section>
  '''),

  # Slide 7: Demo 验收闸
  ('''
  <section class="slide" id="slide-7" data-notes="13 项演示级验收闸，每项对应可演示证据">
    <div class="bg-num">07</div>
    <div class="slide-num-label">07 / 12</div>
    <div class="slide-content">
      <div class="reveal swiss-label" style="color: var(--red); margin-bottom: 8px;">Demo 验收闸</div>
      <h2 class="reveal swiss-title" style="font-size: clamp(24px, 4vw, 40px); margin-bottom: 24px;">13 项演示必过</h2>
      <div class="reveal" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div class="pain-item accent-border"><div class="pain-num">V1</div><div class="pain-title">简报精简</div><div class="pain-desc">字数压减 ≥50%</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V2</div><div class="pain-title">视觉焦点</div><div class="pain-desc">每屏主焦色 1 处</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V3</div><div class="pain-title">外部洞察</div><div class="pain-desc">4 类 chip 顺序正确</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V4</div><div class="pain-title">日程四分类</div><div class="pain-desc">错分率 ≤5%</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V5</div><div class="pain-title">KBC 3.0</div><div class="pain-desc">名单 ≥50 家可见</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V6</div><div class="pain-title">KPI 三动作</div><div class="pain-desc">≥10 张卡有三按钮</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V7</div><div class="pain-title">经营分析新卡</div><div class="pain-desc">数据非 mock</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V8</div><div class="pain-title">消息智能体</div><div class="pain-desc">IM 端到端闭环</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V9</div><div class="pain-title">调整关注</div><div class="pain-desc">4 操作演示完整</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V10</div><div class="pain-title">置信度圆点</div><div class="pain-desc">全卡覆盖</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V11</div><div class="pain-title">信息澄清</div><div class="pain-desc">Low 卡自动展开</div></div>
        <div class="pain-item accent-border"><div class="pain-num">V12</div><div class="pain-title">14 个埋点</div><div class="pain-desc">字段完整性 100%</div></div>
      </div>
    </div>
  </section>
  '''),

  # Slide 8: 风险与应对
  ('''
  <section class="slide" id="slide-8" data-notes="8 项重点风险与依赖，含 API、IM、法规、时间等">
    <div class="bg-num">08</div>
    <div class="slide-num-label">08 / 12</div>
    <div class="left-panel reveal">
      <div class="red-bar"></div>
      <div class="left-rule" style="margin-bottom: 16px;"></div>
      <div class="swiss-label" style="color: rgba(255,255,255,0.5);">风险管理</div>
      <h2 class="swiss-title" style="font-size: clamp(24px, 4vw, 40px); color: #fff;">8 项重点<br>风险与依赖</h2>
    </div>
    <div class="right-panel reveal">
      <div class="disc-steps">
        <div class="disc-step">
          <div class="disc-step-num">R1</div>
          <div><div class="disc-step-title">KBC 3.0 名单 API 未就绪</div><div class="disc-step-desc">影响 M3 · 应对：Excel 导入兜底</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">R2</div>
          <div><div class="disc-step-title">云之间 IM Open API 权限</div><div class="disc-step-desc">影响 M4 · 应对：W1 提前对接</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">R4</div>
          <div><div class="disc-step-title">websearch 法规版权</div><div class="disc-step-desc">影响法务 · 应对：白名单 + 来源留痕</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">R8</div>
          <div><div class="disc-step-title">时间紧（5/10 deadline）</div><div class="disc-step-desc">影响全线 · 应对：并行 + QA 早介入</div></div>
        </div>
      </div>
    </div>
  </section>
  '''),

  # Slide 9: 人力概览
  ('''
  <section class="slide" id="slide-9" data-notes="工时与人力概览：~85 人天，7 人核心 + 2 人临时支援">
    <div class="bg-num">09</div>
    <div class="slide-num-label">09 / 12</div>
    <div class="slide-content">
      <div class="reveal swiss-label" style="color: var(--red); margin-bottom: 8px;">人力概览</div>
      <h2 class="reveal swiss-title" style="font-size: clamp(24px, 4vw, 40px); margin-bottom: 24px;">~85 人天 · 7 人核心</h2>
      <div class="reveal" style="overflow-x: auto;">
        <table class="data-table">
          <thead><tr><th>角色</th><th>W1</th><th>W2</th><th>总计</th><th>主要任务</th></tr></thead>
          <tbody>
            <tr><td><strong>FE × 2</strong></td><td>~14</td><td>~14</td><td>~28</td><td>简报、KPI 卡、IM、置信度 UI</td></tr>
            <tr><td><strong>BE</strong></td><td>~5</td><td>~16</td><td>~21</td><td>1 号报告、KBC、IM、审批</td></tr>
            <tr><td><strong>AI</strong></td><td>~6</td><td>~6</td><td>~12</td><td>置信度模型、客户异动、IM 摘要</td></tr>
            <tr><td><strong>QA</strong></td><td>~1</td><td>~7</td><td>~8</td><td>E2E、性能、灰度</td></tr>
            <tr><td><strong>DS / PD / DA</strong></td><td>~6</td><td>~9</td><td>~15</td><td>视觉焦点、规则评审、埋点 schema</td></tr>
          </tbody>
        </table>
      </div>
      <div class="reveal stat-row" style="margin-top: 24px;">
        <div class="stat-copy"><div class="stat-label">核心团队</div><div class="stat-value">7 人 + 2 人临时支援</div></div>
        <div class="stat-divider"></div>
        <div class="stat-copy"><div class="stat-label">加班窗口</div><div class="stat-value">五一 5/1–5/4 + 5/9–5/10</div></div>
      </div>
    </div>
  </section>
  '''),

  # Slide 10: 评审决议映射
  ('''
  <section class="slide" id="slide-10" data-notes="评审决议与任务对应表，22 条决议映射到具体任务">
    <div class="bg-num">10</div>
    <div class="slide-num-label">10 / 12</div>
    <div class="left-panel reveal">
      <div class="red-bar"></div>
      <div class="left-rule" style="margin-bottom: 16px;"></div>
      <div class="swiss-label" style="color: rgba(255,255,255,0.5);">评审闭环</div>
      <h2 class="swiss-title" style="font-size: clamp(20px, 3vw, 32px); color: #fff;">评审决议<br>→ 任务<br>对应表</h2>
      <p class="hero-sub" style="color: rgba(255,255,255,0.5); margin-top: 12px;">22 条评审决议已全部映射到具体任务编号。</p>
    </div>
    <div class="right-panel reveal">
      <div class="disc-steps">
        <div class="disc-step"><div class="disc-step-num">01</div><div><div class="disc-step-title">简报正文精简</div><div class="disc-step-desc">1.3 / 1.6</div></div></div>
        <div class="disc-step"><div class="disc-step-num">02</div><div><div class="disc-step-title">视觉焦点单点</div><div class="disc-step-desc">1.4 / 1.5</div></div></div>
        <div class="disc-step"><div class="disc-step-num">03</div><div><div class="disc-step-title">日程模块（含四分类）</div><div class="disc-step-desc">1.7 / 1.8 / 1.9</div></div></div>
        <div class="disc-step"><div class="disc-step-num">04</div><div><div class="disc-step-title">KPI 组件通用化 + 三动作</div><div class="disc-step-desc">2.5 / 2.6 / 2.7 / 2.8</div></div></div>
        <div class="disc-step"><div class="disc-step-num">05</div><div><div class="disc-step-title">消息智能体（云之间 IM）</div><div class="disc-step-desc">4.1 / 4.2 / 4.3 / 4.4 / 4.5</div></div></div>
        <div class="disc-step"><div class="disc-step-num">06</div><div><div class="disc-step-title">关键客户 KBC 3.0</div><div class="disc-step-desc">3.1 / 3.2 / 3.3 / 3.4</div></div></div>
      </div>
    </div>
  </section>
  '''),

  # Slide 11: 下一步行动
  ('''
  <section class="slide" id="slide-11" data-notes="下一步行动：W1 启动 M1+M2，提前对接 IM API，启动 websearch 合规审查">
    <div class="bg-num">11</div>
    <div class="slide-num-label">11 / 12</div>
    <div class="slide-content" style="justify-content: center;">
      <div class="reveal hero-rule"></div>
      <div class="reveal swiss-label" style="color: var(--red); margin-top: 16px;">下一步行动</div>
      <h2 class="reveal swiss-title" style="font-size: clamp(24px, 4vw, 40px); margin-top: 8px;">立即启动<br>3 件事</h2>
      <div class="reveal disc-steps" style="margin-top: 32px; max-width: 600px;">
        <div class="disc-step">
          <div class="disc-step-num">01</div>
          <div><div class="disc-step-title">W1 启动 M1 + M2 并行</div><div class="disc-step-desc">FE 优先简报精简与置信度 UI，AI 启动模型训练</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">02</div>
          <div><div class="disc-step-title">提前对接云之间 IM Open API</div><div class="disc-step-desc">W1 内完成文档与权限申请，消除 M4 阻塞风险</div></div>
        </div>
        <div class="disc-step">
          <div class="disc-step-num">03</div>
          <div><div class="disc-step-title">启动 websearch 法规审查</div><div class="disc-step-desc">第一时间启动 PD+Legal 白名单与合规意见书</div></div>
        </div>
      </div>
    </div>
  </section>
  '''),

  # Slide 12: Closing
  ('''
  <section class="slide" id="slide-12" data-notes="结尾：5/10 Demo 见，进度建议沉淀为 Live Artifact 周更看板">
    <div class="bg-num">12</div>
    <div class="slide-num-label light" style="color: rgba(255,255,255,0.25);">12 / 12</div>
    <div class="slide-content" style="background: var(--bg-dark); color: #fff; justify-content: center; align-items: flex-start; gap: 20px;">
      <div class="reveal hero-rule"></div>
      <div class="reveal swiss-label" style="color: var(--red);">金蝶灵基 for CEO V1.9</div>
      <h2 class="reveal swiss-title" style="color: #fff; font-size: clamp(28px, 5vw, 56px);">5/10 Demo<br>见分晓</h2>
      <p class="reveal hero-sub" style="color: rgba(255,255,255,0.5); max-width: 40ch;">进度建议沉淀为「Live Artifact」周更看板，让评审会直接看 Plan→进度→剩余风险。</p>
      <div class="reveal hero-stats" style="margin-top: 24px;">
        <div><div class="hero-stat-num" style="color: var(--red);">5/10</div><div class="hero-stat-label" style="color: rgba(255,255,255,0.4);">评审日</div></div>
        <div><div class="hero-stat-num" style="color: var(--red);">≤7min</div><div class="hero-stat-label" style="color: rgba(255,255,255,0.4);">演示时长</div></div>
      </div>
    </div>
  </section>
  '''),
]

nav_dots = "".join(f'<button class="nav-dot" data-slide="{i+1}"></button>' for i in range(len(slides)))

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black:wght@900&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<style>
{theme_css}
</style>
</head>
<body data-preset="Swiss Modern">
<div class="swiss-grid"></div>
<div class="progress-bar" id="progress-bar"></div>
<button id="present-btn">Present</button>
<div id="present-counter">1 / {len(slides)}</div>
<div class="nav-dots" id="nav-dots">
{nav_dots}
</div>
{''.join(slides)}
<div class="slide-credit" id="slide-credit">By kai-slide-creator v1.0 · Swiss Modern</div>

<script>
const slides = document.querySelectorAll('.slide');
const total = slides.length;
const presentBtn = document.getElementById('present-btn');
const counter = document.getElementById('present-counter');
const progressBar = document.getElementById('progress-bar');
const navDots = document.querySelectorAll('.nav-dot');
let current = 0;
let presenting = false;

function update(index) {{
  current = Math.max(0, Math.min(total - 1, index));
  slides.forEach((s, i) => {{
    s.classList.toggle('visible', i === current);
    s.classList.toggle('p-on', i === current);
  }});
  navDots.forEach((d, i) => d.classList.toggle('active', i === current));
  counter.textContent = (current + 1) + ' / ' + total;
  progressBar.style.width = ((current + 1) / total * 100) + '%';
}}

function next() {{ if (presenting && current < total - 1) update(current + 1); }}
function prev() {{ if (presenting && current > 0) update(current - 1); }}

presentBtn.addEventListener('click', () => {{
  presenting = !presenting;
  document.body.classList.toggle('presenting', presenting);
  presentBtn.textContent = presenting ? 'Exit' : 'Present';
  if (presenting) update(current);
  else {{ slides.forEach(s => s.classList.remove('p-on')); }}
}});

document.addEventListener('keydown', e => {{
  if (!presenting) return;
  if (e.key === 'ArrowRight' || e.key === ' ') next();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'Escape') {{ presenting = false; document.body.classList.remove('presenting'); presentBtn.textContent = 'Present'; slides.forEach(s => s.classList.remove('p-on')); }}
}});

navDots.forEach((d, i) => d.addEventListener('click', () => {{ update(i); if (presenting) slides.forEach((s, j) => s.classList.toggle('p-on', j === i)); }}));

const observer = new IntersectionObserver(entries => {{
  entries.forEach(e => {{ if (e.isIntersecting) update(Array.from(slides).indexOf(e.target)); }});
}}, {{ threshold: 0.5 }});
slides.forEach(s => observer.observe(s));

update(0);
</script>
</body>
</html>
'''

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Slides written to {OUTPUT_PATH}")
