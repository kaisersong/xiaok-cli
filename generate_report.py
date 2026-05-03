#!/usr/bin/env python3
import hashlib
import datetime

SOURCE_PATH = "/Users/song/projects/xiaok-cli/source.md"
OUTPUT_PATH = "/Users/song/Downloads/金蝶灵基-CEO-V19-报告.html"
VERSION = "1.0.0"
THEME = "corporate-blue"

# Read source
with open(SOURCE_PATH, "r", encoding="utf-8") as f:
    source = f.read()

ir_hash = hashlib.sha256(source.encode()).hexdigest()[:16]
date_str = datetime.date.today().isoformat()

title = "金蝶灵基 for CEO V1.9 — 研发计划与任务清单（5/10 版）"
abstract = "基于 2026-04 V1.9 评审会议纪要，制定 2 周冲刺计划（4/29–5/10），覆盖 5 大里程碑、46 项任务、13 项演示验收闸，总工时约 85 人天。"

sections = [
    "总体计划",
    "M1 · W1：信息架构 + 视觉焦点",
    "M2 · W1：置信度 + 信息澄清 + KPI 三动作",
    "M3 · W2：数据源接入 + KBC 3.0",
    "M4 · W2：消息智能体 + 调整关注 + 埋点",
    "M5 · W2 收尾：内部灰度 + Demo",
    "Demo 验收闸",
    "重点风险与依赖",
    "工时与人力概览",
    "评审决议 → 任务对应表"
]

kpis = [
    {"label": "总任务数", "value": "46", "trend": "5 里程碑"},
    {"label": "总工时", "value": "~85", "trend": "人天"},
    {"label": "P0 占比", "value": "~87%", "trend": "高优先级"},
    {"label": "验收项", "value": "13", "trend": "演示必过"}
]

# Build TOC links
toc_links = ""
for s in sections:
    slug = s.lower().replace("·", "").replace("：", "").replace(" ", "-").replace("+", "").strip("-")
    toc_links += f'<a href="#section-{slug}" data-section="{s}">{s}</a>\n'

# Build KPI cards
kpi_cards = ""
for k in kpis:
    kpi_cards += f'''<div class="kpi-card" data-accent>
      <div class="kpi-label">{k["label"]}</div>
      <div class="kpi-value">{k["value"]}<span class="kpi-suffix">{k["trend"]}</span></div>
    </div>\n'''

# Content sections (simplified, key tables)
content = f'''
<section data-section="总体计划" data-summary="2 周冲刺，5 大里程碑并行推进，5/10 Demo 评审">
  <h2 id="section-总体计划">总体计划</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>里程碑</th><th>时间窗</th><th>主线目标</th><th>关键产出</th></tr></thead>
      <tbody>
        <tr><td><strong>M1：信息架构 + 视觉焦点</strong></td><td>W1 4/29–5/4</td><td>简报精简、视觉焦点、外部洞察 4 类、日程四分类</td><td>简报新版可演示</td></tr>
        <tr><td><strong>M2：置信度 + 信息澄清 + KPI 三动作</strong></td><td>W1 同期</td><td>置信度规则落地、KPI 转发/追问/进一步分析</td><td>全卡置信度 + 三动作可用</td></tr>
        <tr><td><strong>M3：数据源接入 + KBC 3.0</strong></td><td>W2 5/6–5/10</td><td>1 号报告、亏损减亏、KBC 3.0、websearch、苍穹审批</td><td>后端跑通真实数据</td></tr>
        <tr><td><strong>M4：消息智能体 + 调整关注 + 埋点</strong></td><td>W2 同期</td><td>云之间 IM、全局 follow、埋点</td><td>全功能闭环</td></tr>
        <tr><td><strong>M5：内部灰度 + Demo</strong></td><td>W2 同期</td><td>灰度名单、E2E、性能压测、Demo 演练</td><td>灰度上线 + 验收报告</td></tr>
      </tbody>
    </table>
  </div>
  <p>节奏说明：W1 含五一加班 5/1–5/4，M1 与 M2 并行；5/6 起进入 M3+M4+M5，QA 进 W2 即介入。</p>
</section>

<section data-section="M1 · W1：信息架构 + 视觉焦点" data-summary="9 项任务，聚焦简报精简、视觉焦点与日程四分类">
  <h2 id="section-m1-w1信息架构视觉焦点">M1 · W1：信息架构 + 视觉焦点</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>优先级</th><th>估工</th></tr></thead>
      <tbody>
        <tr><td>1.1</td><td>外部洞察实现 4 类 chip + 数据</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
        <tr><td>1.2</td><td>外部洞察数据填充（每条标置信度）</td><td>AI+FE</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
        <tr><td>1.3</td><td>简报概览文本精简 + 关键信息加粗</td><td>FE+DS</td><td><span class="badge badge--err">P0</span></td><td>3d</td></tr>
        <tr><td>1.4</td><td>视觉焦点规则文档 + Figma 标注</td><td>DS</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>1.5</td><td>视觉焦点规则前端实现</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>1.6</td><td>文本密度规则</td><td>PD+FE</td><td><span class="badge badge--warn">P1</span></td><td>1d</td></tr>
        <tr><td>1.7</td><td>日程四分类字段 schema</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
        <tr><td>1.8</td><td>日程四分类自动推断规则 + 置信度</td><td>AI</td><td><span class="badge badge--warn">P1</span></td><td>2d</td></tr>
        <tr><td>1.9</td><td>简报"今日日程"展示四分类徽标</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="M2 · W1：置信度 + 信息澄清 + KPI 三动作" data-summary="9 项任务，构建置信度体系与 KPI 通用三动作">
  <h2 id="section-m2-w1置信度信息澄清kpi三动作">M2 · W1：置信度 + 信息澄清 + KPI 三动作</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>优先级</th><th>估工</th></tr></thead>
      <tbody>
        <tr><td>2.1</td><td>置信度评分模型（4 子项 + 权重）</td><td>AI+BE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>2.2</td><td>置信度圆点组件</td><td>FE+DS</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>2.3</td><td>信息澄清面板组件</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>2.4</td><td>澄清答复写回 Memory</td><td>FE+BE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>2.5</td><td>KPI 卡通用组件 &lt;KpiCard&gt;</td><td>FE+DS</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>2.6</td><td>「转发」选人面板</td><td>FE+BE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>2.7</td><td>「追问」打开 split chat</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>2.8</td><td>「进一步分析」路由到专家</td><td>AI+FE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>2.9</td><td>决策卡使用三动作组件</td><td>FE</td><td><span class="badge badge--warn">P1</span></td><td>0.5d</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="M3 · W2：数据源接入 + KBC 3.0" data-summary="11 项任务，后端跑通真实数据，覆盖 KBC 3.0、1 号报告、亏损减亏、websearch、苍穹审批">
  <h2 id="section-m3-w2数据源接入kbc-30">M3 · W2：数据源接入 + KBC 3.0</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>优先级</th><th>估工</th></tr></thead>
      <tbody>
        <tr><td>3.1</td><td>KBC 3.0 名单导入(管理员后台)</td><td>BE+FE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>3.2</td><td>KBC 3.0 名单 API 对接</td><td>BE</td><td><span class="badge badge--warn">P1</span></td><td>2d</td></tr>
        <tr><td>3.3</td><td>关键客户区接入 KBC 3.0 数据</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>3.4</td><td>客户异动判定规则（6 类）</td><td>AI+BE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>3.5</td><td>1 号报告 API 对接 + 缓存 + 降级</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>3.6</td><td>亏损项目减亏数据源</td><td>BE+DA</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>3.7</td><td>亏损减亏卡 UI</td><td>FE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>3.8</td><td>websearch 客户档案爬取服务</td><td>BE+AI</td><td><span class="badge badge--err">P0</span></td><td>3d</td></tr>
        <tr><td>3.9</td><td>websearch 数据源白名单 + 法规审</td><td>PD+Legal</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>3.10</td><td>客户档案字段表 schema + 写回</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>3.11</td><td>审批模块对接苍穹审批中台</td><td>BE+FE</td><td><span class="badge badge--warn">P1</span></td><td>2d</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="M4 · W2：消息智能体 + 调整关注 + 埋点" data-summary="10 项任务，完成云之间 IM 闭环、全局 follow、14 个埋点">
  <h2 id="section-m4-w2消息智能体调整关注埋点">M4 · W2：消息智能体 + 调整关注 + 埋点</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>优先级</th><th>估工</th></tr></thead>
      <tbody>
        <tr><td>4.1</td><td>消息智能体加入 myaiData + 详情页</td><td>FE+AI</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>4.2</td><td>云之间 IM OAuth 鉴权</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>4.3</td><td>云之间 IM 拉消息 + 摘要生成</td><td>AI+BE</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>4.4</td><td>云之间 IM 一键回复（3 候选）</td><td>AI+FE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>4.5</td><td>云之间 IM 重要消息预警 → 决策卡</td><td>AI+BE</td><td><span class="badge badge--warn">P1</span></td><td>1d</td></tr>
        <tr><td>4.6</td><td>转发选人面板对接 IM 联系人</td><td>BE+FE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>4.7</td><td>右上角「调整关注」按钮 + 全局面板</td><td>FE+DS</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>4.8</td><td>全局 follow 规则后端模型</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>1.5d</td></tr>
        <tr><td>4.9</td><td>数据埋点 14 个事件实现</td><td>FE+DA</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>4.10</td><td>埋点字段补齐</td><td>FE+DA</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="M5 · W2 收尾：内部灰度 + Demo" data-summary="6 项任务，灰度上线、E2E、压测、Demo 演练与验收">
  <h2 id="section-m5-w2收尾内部灰度demo">M5 · W2 收尾：内部灰度 + Demo</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>任务</th><th>Owner</th><th>优先级</th><th>估工</th></tr></thead>
      <tbody>
        <tr><td>5.1</td><td>灰度名单 + feature flag</td><td>BE</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
        <tr><td>5.2</td><td>CEO 反馈通道</td><td>PD</td><td><span class="badge badge--err">P0</span></td><td>0.5d</td></tr>
        <tr><td>5.3</td><td>关键路径 E2E 用例 30 条</td><td>QA</td><td><span class="badge badge--err">P0</span></td><td>2d</td></tr>
        <tr><td>5.4</td><td>性能压测</td><td>QA+FE</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>5.5</td><td>5/10 Demo 演练 + 评审</td><td>PD+全员</td><td><span class="badge badge--err">P0</span></td><td>1d</td></tr>
        <tr><td>5.6</td><td>灰度启动 + bug 修复 + 验收报告</td><td>全员</td><td><span class="badge badge--err">P0</span></td><td>持续</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="Demo 验收闸" data-summary="13 项演示级验收，每项对应可演示证据">
  <h2 id="section-demo-验收闸">Demo 验收闸</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>验收项</th><th>证据</th><th>检查人</th></tr></thead>
      <tbody>
        <tr><td>V1</td><td>简报正文精简 + 关键加粗</td><td>4 段字数压减 ≥50%</td><td>PD</td></tr>
        <tr><td>V2</td><td>视觉焦点单点</td><td>≥10 屏截图，每屏主焦色 1 处</td><td>DS+QA</td></tr>
        <tr><td>V3</td><td>外部洞察 4 类 chip</td><td>顺序与 SPEC 一致，console 无报错</td><td>QA</td></tr>
        <tr><td>V4</td><td>日程四分类</td><td>100 条抽样错分率 ≤5%</td><td>AI+QA</td></tr>
        <tr><td>V5</td><td>KBC 3.0 客户区</td><td>名单 ≥50 家可见，异动卡片置顶</td><td>QA</td></tr>
        <tr><td>V6</td><td>KPI 三动作齐全</td><td>≥10 张 KPI 卡 + 决策卡均有三按钮</td><td>QA</td></tr>
        <tr><td>V7</td><td>经营分析新卡</td><td>1 号报告 + 亏损减亏卡可见，数据非 mock</td><td>PD+QA</td></tr>
        <tr><td>V8</td><td>消息智能体闭环</td><td>列表第 5 角色 + IM OAuth 通 + 摘要生成</td><td>QA</td></tr>
        <tr><td>V9</td><td>调整关注全局入口</td><td>右上角按钮可见，4 操作演示完整</td><td>PD+QA</td></tr>
        <tr><td>V10</td><td>置信度圆点全覆盖</td><td>简报 / 决策 / KPI / KBC 客户卡均有圆点</td><td>QA</td></tr>
        <tr><td>V11</td><td>信息澄清面板可触发</td><td>Low 卡自动展开，修正后字段升 High</td><td>QA</td></tr>
        <tr><td>V12</td><td>14 个埋点齐全</td><td>Charles 抓包 14 事件 + 字段完整性 100%</td><td>DA+QA</td></tr>
        <tr><td>V13</td><td>websearch 异步可触发</td><td>≥3 家测试客户 5 类字段写库</td><td>QA</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="重点风险与依赖" data-summary="8 项风险，含 API 未就绪、IM 权限、法规版权、时间紧等">
  <h2 id="section-重点风险与依赖">重点风险与依赖</h2>
  <div class="callout callout--warning">
    <div class="callout-icon">⚠</div>
    <div class="callout-body">
      <strong>关键路径风险：</strong>KBC 3.0 名单 API 未就绪（M3 阻塞）、云之间 IM Open API 文档与权限（M4 阻塞）、时间紧（5/10 deadline）。应对措施包括 Excel 导入兜底、W1 提前对接、M1+M2 / M3+M4 并行推进。
    </div>
  </div>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>#</th><th>风险/依赖</th><th>影响</th><th>应对</th></tr></thead>
      <tbody>
        <tr><td>R1</td><td>KBC 3.0 名单 API 未就绪</td><td>M3 阻塞</td><td>Excel 导入兜底（3.1）</td></tr>
        <tr><td>R2</td><td>云之间 IM Open API 文档与权限</td><td>M4 阻塞</td><td>W1 内提前对接</td></tr>
        <tr><td>R3</td><td>1 号报告系统稳定性</td><td>经营分析空白</td><td>失败降级 + 缓存</td></tr>
        <tr><td>R4</td><td>websearch 法规版权</td><td>法务驳回</td><td>白名单 + 来源留痕</td></tr>
        <tr><td>R5</td><td>视觉焦点改造范围大</td><td>M1 风险延期</td><td>拆为两步走</td></tr>
        <tr><td>R6</td><td>置信度模型冷启动数据少</td><td>Mid/Low 误判</td><td>200 条回归 baseline</td></tr>
        <tr><td>R7</td><td>五一连续加班疲劳</td><td>W2 状态下滑</td><td>5/5 缓冲休整</td></tr>
        <tr><td>R8</td><td>时间紧（5/10 deadline）</td><td>全线压缩</td><td>QA 进 W2 即介入</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section data-section="工时与人力概览" data-summary="~85 人天，7 人核心 + 2 人临时支援">
  <h2 id="section-工时与人力概览">工时与人力概览</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>角色</th><th>W1（M1+M2）</th><th>W2（M3+M4+M5）</th><th>总计</th><th>主要任务</th></tr></thead>
      <tbody>
        <tr><td>FE × 2</td><td>~14 人天</td><td>~14 人天</td><td>~28 人天</td><td>简报、KPI 卡、调整关注、IM、置信度 UI</td></tr>
        <tr><td>BE</td><td>~5 人天</td><td>~16 人天</td><td>~21 人天</td><td>1 号报告、KBC、IM、审批、埋点服务端</td></tr>
        <tr><td>AI</td><td>~6 人天</td><td>~6 人天</td><td>~12 人天</td><td>置信度模型、客户异动、IM 摘要/回复、日程分类</td></tr>
        <tr><td>DA</td><td>~1 人天</td><td>~4 人天</td><td>~5 人天</td><td>埋点 schema、亏损数据</td></tr>
        <tr><td>DS</td><td>~3 人天</td><td>~2 人天</td><td>~5 人天</td><td>视觉焦点、KPI 卡、调整关注面板</td></tr>
        <tr><td>PD</td><td>~2 人天</td><td>~3 人天</td><td>~5 人天</td><td>规则评审、灰度、纪要-任务对照</td></tr>
        <tr><td>QA</td><td>~1 人天</td><td>~7 人天</td><td>~8 人天</td><td>E2E、性能、灰度</td></tr>
        <tr><td>Legal</td><td>~0 人天</td><td>~1 人天</td><td>~1 人天</td><td>websearch 合规审</td></tr>
      </tbody>
    </table>
  </div>
  <p>总计 <strong>~85 人天</strong>，建议 7 人核心 + 2 人临时支援，必要时全员 5/9–5/10 加班。</p>
</section>

<section data-section="评审决议 → 任务对应表" data-summary="22 条评审决议映射到具体任务编号">
  <h2 id="section-评审决议-任务对应表">评审决议 → 任务对应表</h2>
  <div class="table-wrapper">
    <table class="report-table">
      <thead><tr><th>评审决议</th><th>对应任务</th></tr></thead>
      <tbody>
        <tr><td>简报正文精简（≤30 字 / 段）</td><td>1.3 / 1.6</td></tr>
        <tr><td>视觉焦点单点</td><td>1.4 / 1.5</td></tr>
        <tr><td>日程模块（含四分类）</td><td>1.7 / 1.8 / 1.9</td></tr>
        <tr><td>日程子分类：去拜访 / 来拜访 / 内部会议 / ISS</td><td>1.7（visit_out / visit_in / internal / iss）</td></tr>
        <tr><td>websearch 爬取客户档案信息 / 客户背景</td><td>3.8 / 3.9 / 3.10</td></tr>
        <tr><td>每个分类做一条规则</td><td>3.4（客户异动）+ 1.8（日程）</td></tr>
        <tr><td>置信度评分</td><td>2.1 / 2.2</td></tr>
        <tr><td>信息澄清</td><td>2.3 / 2.4</td></tr>
        <tr><td>KPI 组件通用化</td><td>2.5</td></tr>
        <tr><td>转发 + 追问</td><td>2.6 / 2.7</td></tr>
        <tr><td>进一步分析路由专家</td><td>2.8</td></tr>
        <tr><td>数据埋点 14 个事件</td><td>4.9 / 4.10</td></tr>
        <tr><td>模块保留：日程、审批</td><td>1.7 + 3.11</td></tr>
        <tr><td>关键客户：KBC 3.0 客户</td><td>3.1 / 3.2 / 3.3 / 3.4</td></tr>
        <tr><td>消息智能体（云之间 IM）</td><td>4.1 / 4.2 / 4.3 / 4.4 / 4.5</td></tr>
        <tr><td>外部洞察专家</td><td>1.1 / 1.2</td></tr>
        <tr><td>经营分析：1 号报告</td><td>3.5</td></tr>
        <tr><td>亏损项目减亏进展</td><td>3.6 / 3.7</td></tr>
        <tr><td>外部洞察不含舆情 / 投融资动态</td><td>1.1（4 类 chip 顺序）</td></tr>
        <tr><td>右上角「调整关注」入口</td><td>4.7 / 4.8</td></tr>
      </tbody>
    </table>
  </div>
</section>
'''

html = f'''<!DOCTYPE html>
<!-- kai-report-creator v{VERSION} -->
<html lang="zh" data-template="kai-report-creator" data-version="{VERSION}" data-theme="{THEME}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="kai-report-creator {THEME} v{VERSION}">
<meta name="ir-hash" content="sha256:{ir_hash}">
<title>{title}</title>
<style>
/* Theme: corporate-blue */
:root {{
  --primary: #1F6F50; --primary-light: #E7EFE9; --accent: #C79A2B;
  --bg: #F8F5EF; --surface: #FFFDF9; --text: #2B2623; --text-muted: #766B63;
  --border: #E7DDD2; --success: #2F6B50; --warning: #A8741A; --danger: #A34A3F;
  --font-sans: 'Inter', 'PingFang SC', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace; --radius: 8px;
  --report-bg: #F8F5EF; --report-surface: #FFFDF9; --report-text: #2B2623;
  --report-text-muted: #766B63; --report-border: #E7DDD2; --report-structure: #1F6F50;
  --report-chip-bg: #F4EAD5; --report-chip-text: #7A6858; --report-chip-border: #E0D4C6;
  --report-delta-up-bg: #E7F1EA; --report-delta-up-text: #2F6B50;
  --report-delta-down-bg: #F6E8E6; --report-delta-down-text: #A34A3F;
  --report-delta-flat-bg: #EEE7DE; --report-delta-flat-text: #766B63;
}}
body {{ font-family: var(--font-sans); color: var(--text); background: var(--bg); margin: 0; line-height: 1.58; }}
h1 {{ font-size: 2.25rem; font-weight: 700; color: var(--text); border-bottom: 2px solid var(--report-structure); padding-bottom: .5rem; margin-bottom: 1.5rem; }}
h2 {{ font-size: 1.5rem; font-weight: 600; color: var(--text); border-left: 3px solid var(--report-structure); padding-left: .75rem; margin-top: 1.75rem; }}
h3 {{ font-size: 1.15rem; font-weight: 600; color: var(--text); margin-top: 1.1rem; }}
p {{ margin: .5rem 0; }} a {{ color: var(--report-structure); }}
strong {{ font-weight: 700; }} blockquote {{ border-left: 3px solid var(--border); margin: .75rem 0; padding: .5rem 1rem; color: var(--text-muted); }}

*, *::before, *::after {{ box-sizing: border-box; }}
.report-wrapper {{ max-width: 920px; margin: 0 auto; padding: 2rem 1.5rem; }}
@media (min-width: 1100px) {{ .report-wrapper {{ padding: 2.5rem 3rem; }} }}
.report-meta {{ color: var(--text-muted); font-size: .9rem; margin-top: -.5rem; margin-bottom: 1.5rem; text-align: right; }}
.report-footer {{ margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--report-border, var(--border)); text-align: center; color: var(--text-muted); font-size: .7rem; opacity: .5; letter-spacing: .03em; }}
@media print {{ .report-footer {{ display: none; }} }}

.kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .75rem; margin: 1.1rem 0; }}
.kpi-card {{ background: var(--report-surface, var(--surface)); border: 1px solid var(--report-border, var(--border)); border-radius: var(--radius); padding: .9rem; text-align: center; border-top: 2px solid var(--report-structure, var(--primary)); display: flex; flex-direction: column; align-items: center; }}
.kpi-label {{ font-size: .78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: .4rem; }}
.kpi-value {{ font-size: 2rem; font-weight: 800; color: var(--report-text, var(--text)); line-height: 1.2; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-variant-numeric: lining-nums tabular-nums; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; word-break: break-word; overflow-wrap: break-word; }}
.kpi-value .kpi-suffix {{ font-size: .75em; font-weight: 600; line-height: 1.3; }}
.kpi-trend {{ font-size: .85rem; margin-top: .3rem; }}
.kpi-trend--up {{ color: var(--success); }} .kpi-trend--down {{ color: var(--danger); }} .kpi-trend--neutral {{ color: var(--text-muted); }}
.kpi-card[data-accent] {{ border-top-color: var(--report-structure, var(--primary)); }}
.kpi-card[data-accent] .kpi-value {{ color: var(--report-text, var(--text)); }}
.kpi-delta {{ display: inline-block; padding: .15rem .48rem; border-radius: 999px; font-size: .74rem; font-weight: 700; margin-top: .28rem; }}
.kpi-delta--up   {{ background: var(--report-delta-up-bg, #E7F1EA); color: var(--report-delta-up-text, var(--success)); }}
.kpi-delta--down {{ background: var(--report-delta-down-bg, #F6E8E6); color: var(--report-delta-down-text, var(--danger)); }}
.kpi-delta--info {{ background: var(--report-delta-flat-bg, #EEE7DE); color: var(--report-delta-flat-text, var(--text-muted)); }}
.badge {{ display: inline-flex; align-items: center; padding: .18rem .55rem; border-radius: 999px; font-size: .75rem; font-weight: 600; letter-spacing: .01em; white-space: nowrap; border: 1px solid var(--report-chip-border, var(--report-border, var(--border))); }}
.badge--warn   {{ background: var(--report-delta-up-bg, #E7F1EA); color: var(--report-delta-up-text, var(--success)); border-color: transparent; }}
.badge--err    {{ background: var(--report-delta-down-bg, #F6E8E6); color: var(--report-delta-down-text, var(--danger)); border-color: transparent; }}

.table-wrapper {{ overflow-x: auto; margin: 1.1rem 0; }}
.report-table {{ width: 100%; border-collapse: collapse; font-size: .9rem; }}
.report-table th {{ background: var(--report-surface, var(--surface)); border-bottom: 2px solid var(--report-structure, var(--primary)); padding: .7rem 1rem; text-align: left; font-weight: 600; }}
.report-table td {{ padding: .6rem 1rem; border-bottom: 1px solid var(--border); }}
.report-table tr:hover td {{ background: var(--report-surface, var(--surface)); }}

.callout {{ display: flex; gap: .75rem; padding: .9rem 1.1rem; border-radius: var(--radius); margin: .75rem 0; border-left: 4px solid; align-items: flex-start; }}
.callout--warning {{ background: #FFFBEB; border-color: #F59E0B; }}
.callout-icon {{ font-size: 1.1rem; flex-shrink: 0; margin-top: .05rem; }}
.callout-body {{ flex: 1; min-width: 0; line-height: 1.6; font-size: .93rem; color: #1F2937; }}
.callout--warning .callout-icon {{ color: #F59E0B; }}

/* TOC */
.toc-sidebar {{ position: fixed; top: 0; left: 0; width: 240px; height: 100vh; overflow-y: auto; padding: 3rem 1rem 1.5rem; background: var(--surface); border-right: 1px solid var(--border); font-size: .83rem; z-index: 100; transform: translateX(-100%); transition: transform .28s ease; }}
.toc-sidebar.open {{ transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,.18); }}
.toc-sidebar h4 {{ font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin: 0 0 .75rem; font-weight: 600; }}
.toc-sidebar a {{ display: block; color: var(--text-muted); text-decoration: none; padding: .28rem .5rem; border-radius: 4px; margin-bottom: 1px; transition: all .18s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
.toc-sidebar a:hover, .toc-sidebar a.active {{ color: var(--primary); background: var(--primary-light); }}
.toc-sidebar a.toc-h3 {{ padding-left: 1.1rem; font-size: .78rem; opacity: .85; }}
.main-with-toc {{ margin-left: 0; }}
.toc-toggle {{ position: fixed; top: .75rem; left: .75rem; z-index: 200; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: .45rem .7rem; cursor: pointer; font-size: 1rem; line-height: 1; box-shadow: 0 2px 8px rgba(0,0,0,.2); }}
.toc-toggle.locked {{ box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.2); }}

/* Export */
.export-btn {{ position: fixed; bottom: 16px; right: 16px; z-index: 10001; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: .45rem .9rem; font-size: .82rem; cursor: pointer; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.2); }}
.export-menu {{ position: fixed; bottom: 52px; right: 16px; z-index: 10001; background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 6px; overflow: hidden; display: none; box-shadow: 0 4px 16px rgba(0,0,0,.15); min-width: 148px; }}
.export-menu.open {{ display: block; }}
.export-item {{ display: block; width: 100%; padding: .55rem 1rem; font-size: .84rem; background: none; border: none; cursor: pointer; text-align: left; color: var(--text, #111); white-space: nowrap; border-bottom: 1px solid var(--border, #e5e7eb); }}
.export-item:last-child {{ border-bottom: none; }}
.export-item:hover {{ background: var(--primary-light, #e3edff); }}

/* Edit */
.edit-hotzone {{ position: fixed; bottom: 0; left: 0; width: 80px; height: 80px; z-index: 10000; cursor: pointer; }}
.edit-toggle {{ position: fixed; bottom: 16px; left: 16px; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: .45rem .9rem; font-size: .82rem; cursor: pointer; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .25s ease, background .2s ease; z-index: 10001; box-shadow: 0 2px 8px rgba(0,0,0,.25); }}
.edit-toggle.show {{ opacity: 1; pointer-events: auto; }}
.edit-toggle.active {{ opacity: 1; pointer-events: auto; background: var(--success); }}
body.edit-mode [contenteditable] {{ outline: 1px dashed var(--border); border-radius: 2px; cursor: text; }}
body.edit-mode [contenteditable]:hover {{ outline-color: var(--primary); }}
body.edit-mode [contenteditable]:focus {{ outline: 2px solid var(--primary); }}

/* Summary card button */
.title-row {{ display: flex; align-items: flex-end; gap: 1rem; }}
.title-row h1 {{ flex: 1; }}
.card-mode-btn {{ flex-shrink: 0; margin-bottom: .6rem; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: .28rem .65rem; font-size: .76rem; font-weight: 600; color: var(--text-muted); cursor: pointer; transition: all .15s; white-space: nowrap; }}
.card-mode-btn:hover {{ background: var(--primary-light); color: var(--primary); border-color: var(--primary); }}
.sc-overlay {{ display: none; position: fixed; inset: 0; z-index: 500; background: rgba(0,0,0,.52); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 2rem; }}
body.card-mode .sc-overlay {{ display: flex; }}
body.card-mode {{ overflow: hidden; height: 100vh; }}
html:has(body.card-mode) {{ overflow: hidden; height: 100vh; }}
body.card-mode .main-with-toc,
body.card-mode .toc-toggle,
body.card-mode .toc-sidebar {{ visibility: hidden; }}
body.card-mode .sc-overlay {{ visibility: visible; }}
.sc-card {{ position: relative; display: flex; width: min(900px, 92vw); background: #fff; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; overflow: hidden; box-shadow: 0 24px 72px rgba(0,0,0,.3); }}
.sc-left {{ flex: 0 0 46%; display: flex; flex-direction: column; padding: 1.8rem 2rem 1.6rem; background: var(--primary); color: #fff; }}
.sc-label {{ font-size: .55rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; opacity: .5; margin-bottom: .55rem; display: flex; align-items: center; gap: .45rem; }}
.sc-label::before {{ content: ''; display: inline-block; width: 20px; height: 1px; background: currentColor; }}
.sc-title-main {{ font-size: clamp(3.45rem, 6.9vw, 5.25rem); font-weight: 900; line-height: .92; letter-spacing: -.05em; margin-bottom: .35rem; word-break: break-word; }}
.sc-title-sub {{ font-size: 1.08rem; line-height: 1.5; color: rgba(255,255,255,.88); margin-bottom: .9rem; max-width: 82%; }}
.sc-note {{ margin-top: auto; padding-top: 1.4rem; width: 72%; font-size: .84rem; line-height: 1.68; opacity: .9; }}
.sc-right {{ flex: 1; display: flex; flex-direction: column; padding: 1.8rem 1.8rem 1.8rem; border-left: 1px solid var(--border); }}
.sc-kpi-rows {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0 .6rem; margin-bottom: .5rem; }}
.sc-kpi-row {{ padding: .32rem 0; border-bottom: 1px solid var(--border); }}
.sc-kpi-row-l {{ font-size: .56rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }}
.sc-kpi-row-v {{ font-size: 1.15rem; font-weight: 800; color: var(--primary); line-height: 1.15; }}
.sc-kpi-row-t {{ font-size: .6rem; color: var(--success, #057A55); font-weight: 600; }}
.sc-summaries {{ flex: 1; display: flex; flex-direction: column; }}
.sc-sum-item {{ padding: .35rem 0; border-bottom: 1px solid var(--border); }}
.sc-sum-item:last-child {{ border-bottom: none; }}
.sc-sum-name {{ font-size: .56rem; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: .08em; }}
.sc-sum-text {{ font-size: .74rem; color: var(--text); line-height: 1.45; margin-top: .06rem; opacity: .72; }}
.sc-close {{ position: absolute; top: .8rem; right: .8rem; z-index: 1; background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.25); border-radius: 3px; width: 24px; height: 24px; cursor: pointer; color: #fff; display: flex; align-items: center; justify-content: center; font-size: .75rem; transition: background .15s; }}
.sc-close:hover {{ background: rgba(255,255,255,.28); }}
@media (max-width: 900px) {{ .sc-card {{ flex-direction: column; width: min(92vw, 640px); }} .sc-right {{ border-left: none; border-top: 1px solid var(--border); }} }}
@media print {{ .sc-overlay, .card-mode-btn {{ display: none !important; }} }}

@media print {{
  * {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}
  html, body {{ background: var(--bg) !important; color: var(--text) !important; }}
  .toc-toggle, .toc-sidebar, .edit-hotzone, .edit-toggle, .export-btn, .export-menu {{ display: none !important; }}
  h2 {{ break-after: avoid; }}
  .kpi-grid, .kpi-card, .callout, .table-wrapper {{ break-inside: avoid; }}
}}
@media (max-width: 768px) {{ .report-wrapper {{ padding: 1.5rem 1rem; }} }}
body.no-toc .toc-sidebar, body.no-toc .toc-toggle {{ display: none; }}
body.no-toc .main-with-toc {{ margin-left: 0; }}
</style>
</head>
<body>

<!-- Edit mode -->
<div class="edit-hotzone" id="edit-hotzone"></div>
<button class="edit-toggle" id="edit-toggle" title="Edit mode (E)">✏ Edit</button>

<!-- Export -->
<div class="export-menu" id="export-menu">
  <button class="export-item" id="export-print">🖨 打印 / PDF</button>
  <button class="export-item" id="export-png-desktop">🖥 保存图片（桌面）</button>
  <button class="export-item" id="export-png-mobile">📱 保存图片（手机）</button>
  <button class="export-item" id="export-im-share">💬 IM 长图</button>
</div>
<button class="export-btn" id="export-btn" title="导出">↓ 导出</button>

<!-- TOC -->
<button class="toc-toggle" id="toc-toggle-btn" aria-label="目录" aria-expanded="false">☰</button>
<nav class="toc-sidebar" id="toc-sidebar" aria-label="报告目录">
  <h4>目录</h4>
  {toc_links}
</nav>

<script type="application/json" id="report-summary">
{{
  "title": "{title}",
  "author": "",
  "date": "{date_str}",
  "abstract": "{abstract}",
  "poster_title": "",
  "poster_subtitle": "",
  "poster_note": "",
  "sections": {sections},
  "kpis": {kpis}
}}
</script>

<div class="main-with-toc">
  <div class="report-wrapper">

    <div class="title-row">
      <h1>{title}</h1>
      <button class="card-mode-btn" id="card-mode-btn" title="摘要卡片">⊞ 摘要卡</button>
    </div>
    <p class="report-subtitle">{abstract}</p>
    <p class="report-meta">{date_str}</p>

    <div class="sc-overlay" id="sc-overlay">
      <div class="sc-card" id="sc-card">
        <button class="sc-close" id="sc-close" aria-label="Close">✕</button>
      </div>
    </div>

    <div class="kpi-grid">
      {kpi_cards}
    </div>

    {content}

    <div class="report-footer">kai-report-creator v{VERSION} {THEME}</div>
    <div style="display:none;visibility:hidden;opacity:0;font-size:0;line-height:0;height:0;overflow:hidden;" aria-hidden="true" data-watermark="kai-report-creator v{VERSION} {THEME}">kai-report-creator v{VERSION} {THEME}</div>

  </div>
</div>

<script>
// TOC
const tocBtn = document.getElementById('toc-toggle-btn');
const tocSidebar = document.getElementById('toc-sidebar');
if (tocBtn && tocSidebar) {{
  let locked = false, closeTimer;
  function openToc() {{ clearTimeout(closeTimer); tocSidebar.classList.add('open'); tocBtn.setAttribute('aria-expanded', 'true'); }}
  function scheduleClose() {{ closeTimer = setTimeout(() => {{ if (!locked) {{ tocSidebar.classList.remove('open'); tocBtn.setAttribute('aria-expanded', 'false'); tocBtn.classList.remove('locked'); }} }}, 280); }}
  tocBtn.addEventListener('click', () => {{ locked = !locked; if (locked) {{ openToc(); tocBtn.classList.add('locked'); }} else {{ tocSidebar.classList.remove('open'); tocBtn.classList.remove('locked'); tocBtn.setAttribute('aria-expanded', 'false'); }} }});
  tocBtn.addEventListener('mouseenter', () => {{ if (!locked) openToc(); }});
  tocSidebar.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  tocSidebar.addEventListener('mouseleave', () => {{ if (!locked) scheduleClose(); }});
  document.addEventListener('click', e => {{ if (locked && !tocSidebar.contains(e.target) && !tocBtn.contains(e.target)) {{ locked = false; tocSidebar.classList.remove('open'); tocBtn.classList.remove('locked'); tocBtn.setAttribute('aria-expanded', 'false'); }} }});
}}

// Edit mode
const editHotzone = document.getElementById('edit-hotzone');
const editToggle = document.getElementById('edit-toggle');
if (editHotzone && editToggle) {{
  editHotzone.addEventListener('mouseenter', () => editToggle.classList.add('show'));
  editHotzone.addEventListener('mouseleave', () => editToggle.classList.remove('show'));
  editToggle.addEventListener('click', () => {{ document.body.classList.toggle('edit-mode'); editToggle.classList.toggle('active'); editToggle.textContent = document.body.classList.contains('edit-mode') ? '✏ Done' : '✏ Edit'; }});
}}

// Export
const exportBtn = document.getElementById('export-btn');
const exportMenu = document.getElementById('export-menu');
if (exportBtn && exportMenu) {{
  exportBtn.addEventListener('click', e => {{ e.stopPropagation(); exportMenu.classList.toggle('open'); }});
  document.addEventListener('click', e => {{ if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) exportMenu.classList.remove('open'); }});
  const printBtn = document.getElementById('export-print');
  printBtn && printBtn.addEventListener('click', () => {{ exportMenu.classList.remove('open'); window.print(); }});
}}

// Summary card
(function() {{
  const btn = document.getElementById('card-mode-btn');
  const overlay = document.getElementById('sc-overlay');
  const closeBtn = document.getElementById('sc-close');
  if (!btn || !overlay) return;
  function buildCard() {{
    try {{
      const d = JSON.parse(document.getElementById('report-summary').textContent);
      const card = document.getElementById('sc-card');
      const left = document.createElement('div'); left.className = 'sc-left';
      const right = document.createElement('div'); right.className = 'sc-right';
      const label = document.createElement('div'); label.className = 'sc-label'; label.textContent = '报告摘要';
      const titleMain = document.createElement('div'); titleMain.className = 'sc-title-main'; titleMain.textContent = d.title;
      const note = document.createElement('div'); note.className = 'sc-note'; note.textContent = d.abstract;
      left.appendChild(label); left.appendChild(titleMain); left.appendChild(note);
      const kpiRows = document.createElement('div'); kpiRows.className = 'sc-kpi-rows';
      (d.kpis || []).forEach(k => {{
        const row = document.createElement('div'); row.className = 'sc-kpi-row';
        const lbl = document.createElement('div'); lbl.className = 'sc-kpi-row-l'; lbl.textContent = k.label;
        const val = document.createElement('div'); val.className = 'sc-kpi-row-v'; val.textContent = k.value;
        row.appendChild(lbl); row.appendChild(val); kpiRows.appendChild(row);
      }});
      right.appendChild(kpiRows);
      const sums = document.createElement('div'); sums.className = 'sc-summaries';
      document.querySelectorAll('section[data-summary]').forEach(sec => {{
        const name = sec.getAttribute('data-section') || '';
        const text = sec.getAttribute('data-summary') || '';
        if (!name || !text) return;
        const item = document.createElement('div'); item.className = 'sc-sum-item';
        const n = document.createElement('div'); n.className = 'sc-sum-name'; n.textContent = name;
        const t = document.createElement('div'); t.className = 'sc-sum-text'; t.textContent = text;
        item.appendChild(n); item.appendChild(t); sums.appendChild(item);
      }});
      right.appendChild(sums);
      card.insertBefore(left, closeBtn);
      card.insertBefore(right, closeBtn);
    }} catch(e) {{}}
  }}
  btn.addEventListener('click', () => {{ if (!document.getElementById('sc-card').querySelector('.sc-left')) buildCard(); document.body.classList.add('card-mode'); }});
  closeBtn && closeBtn.addEventListener('click', () => document.body.classList.remove('card-mode'));
  overlay.addEventListener('click', e => {{ if (e.target === overlay) document.body.classList.remove('card-mode'); }});
}})();
</script>
</body>
</html>
'''

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Report written to {OUTPUT_PATH}")
