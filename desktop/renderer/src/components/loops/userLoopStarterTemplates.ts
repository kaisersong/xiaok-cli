/**
 * 用户循环模板库
 *
 * 这些模板用于循环页面的空状态引导和"+ 新建循环"快速选择。
 * 模板不是预先创建的循环——只有用户主动点击"使用此模板"时才会
 * 通过 createUserLoopTemplate 复制成一份用户循环。
 */

export interface UserLoopStarterTemplate {
  templateId: string;
  title: string;
  category: 'business' | 'code';
  description: string;
  kind: 'task_completion' | 'markdown_file';
  prompt: string;
  /** markdown_file 类型用 — 默认输出目录建议（用户可改） */
  outputDirectory?: string;
  /** markdown_file 类型用 — 默认输出文件名（用户可改） */
  outputFileName?: string;
  /** 推荐的调度频率提示，仅展示用 */
  scheduleHint?: string;
}

export const USER_LOOP_STARTER_TEMPLATES: UserLoopStarterTemplate[] = [
  {
    templateId: 'daily-work-summary',
    title: '每日工作日报',
    category: 'business',
    description: '每天傍晚自动汇总你今天在 xiaok 里完成的对话、项目进展和产出，整理成日报。',
    kind: 'task_completion',
    prompt:
      '请汇总今天我在 xiaok 里完成的工作并整理成一份简洁的日报。\n\n' +
      '内容包括：\n' +
      '- 今天处理的主要任务和对话主题\n' +
      '- 完成的产出物（项目交付、报告、评审等）\n' +
      '- 遇到的卡点或待跟进事项\n' +
      '- 明天的优先事项建议\n\n' +
      '风格要简洁、结构清晰，控制在 200-400 字。',
    scheduleHint: '建议每天 18:00 触发',
  },
  {
    templateId: 'weekly-project-review',
    title: '每周项目复盘',
    category: 'business',
    description: '盘点本周 KSwarm 项目和重点任务的进展、卡点、下周计划，生成 Markdown 复盘报告。',
    kind: 'markdown_file',
    prompt:
      '请生成一份本周项目复盘报告，写入 output_path 对应的 Markdown 文件。\n\n' +
      '步骤：\n' +
      '1. 通过 inspect_project 查看活跃 KSwarm 项目状态。\n' +
      '2. 汇总每个项目本周的进展、阻塞、PO 决策、产出物。\n' +
      '3. 列出本周关键交付物及链接（artifacts/路径）。\n' +
      '4. 标记下周需要推进的事项和需要做出的决策。\n\n' +
      '报告结构：\n' +
      '# 本周项目复盘 [日期范围]\n\n' +
      '## 概览\n## 各项目进展\n## 关键产出\n## 卡点与决策\n## 下周重点\n',
    outputDirectory: '~/xiaok-loops/weekly-review',
    outputFileName: 'weekly-review.md',
    scheduleHint: '建议每周五 17:00 触发',
  },
  {
    templateId: 'industry-news-daily',
    title: '行业资讯日报',
    category: 'business',
    description: '使用 web_search 抓取当日 AI / 行业最新动态，按主题归类，生成 Markdown 简报。',
    kind: 'markdown_file',
    prompt:
      '请生成一份当日行业资讯简报，写入 output_path 对应的 Markdown 文件。\n\n' +
      '关注主题（可按需调整）：\n' +
      '- AI 大模型发布、能力进展\n' +
      '- 主流 AI 产品更新（OpenAI、Anthropic、Google、字节、阿里、腾讯等）\n' +
      '- AI Agent / 编程辅助工具动态\n' +
      '- 监管、行业标准变化\n\n' +
      '步骤：\n' +
      '1. 用 web_search 检索最近 24 小时的关键资讯（每个主题 2-3 条）。\n' +
      '2. 每条资讯用 1-2 句话总结要点 + 注明来源链接。\n' +
      '3. 末尾给出 3 条"值得关注的趋势"判断。\n',
    outputDirectory: '~/xiaok-loops/industry-news',
    outputFileName: 'industry-news.md',
    scheduleHint: '建议每天 09:00 触发',
  },
  {
    templateId: 'competitor-tracking',
    title: '竞品动态周报',
    category: 'business',
    description: '持续跟踪你关心的几个竞品的官网、博客、发布更新，生成周度对比报告。',
    kind: 'markdown_file',
    prompt:
      '请生成本周竞品动态报告，写入 output_path 对应的 Markdown 文件。\n\n' +
      '请把下面这一行的列表替换成你要跟踪的竞品名（用逗号分隔）：\n' +
      '跟踪的竞品：[在这里填，例如：Cursor, Windsurf, Continue]\n\n' +
      '步骤：\n' +
      '1. 用 web_search 查询每个竞品最近 7 天的产品更新、发布、博客文章。\n' +
      '2. 整理成统一结构：竞品名 / 关键变化 / 影响判断 / 来源链接。\n' +
      '3. 末尾写一段"对我们的启示"——值得借鉴或需要警惕的点。\n',
    outputDirectory: '~/xiaok-loops/competitor',
    outputFileName: 'competitor-weekly.md',
    scheduleHint: '建议每周一 09:00 触发',
  },
  {
    templateId: 'knowledge-base-review',
    title: '知识库每周回顾',
    category: 'business',
    description: '回顾本周加入知识库的内容，提取关键 takeaways，避免知识沉睡。',
    kind: 'markdown_file',
    prompt:
      '请回顾本周加入知识库的内容并写一份摘要，写入 output_path。\n\n' +
      '步骤：\n' +
      '1. 用 kb_list_collections 查看所有集合。\n' +
      '2. 对每个集合用 kb_search 检索 "本周" 相关的近期 source（或拉取 source 列表中最新的几个）。\n' +
      '3. 对每个新 source 用 kb_get_source 取出关键段落，提炼 2-3 个核心 takeaways。\n' +
      '4. 整理成结构化摘要，每条标注来源 source 标题。\n\n' +
      '报告结构：\n' +
      '# 知识库本周回顾 [日期]\n\n' +
      '## 新增内容概览\n## 关键 Takeaways（按主题）\n## 待深挖的方向\n',
    outputDirectory: '~/xiaok-loops/kb-review',
    outputFileName: 'kb-weekly-review.md',
    scheduleHint: '建议每周日 20:00 触发',
  },
  {
    templateId: 'repo-changes-watch',
    title: '本地仓库变动巡检',
    category: 'code',
    description: '跟踪指定本地 git 仓库的最新提交、分支变化，生成简明变动报告。',
    kind: 'markdown_file',
    prompt:
      '请生成本地仓库变动报告，写入 output_path 对应的 Markdown 文件。\n\n' +
      '请把下面这一行替换成你要监控的本地仓库路径（绝对路径，逗号分隔）：\n' +
      '监控的仓库：[在这里填，例如：/Users/you/projects/foo, /Users/you/projects/bar]\n\n' +
      '步骤：\n' +
      '1. 对每个仓库用 bash 跑 `git -C <repo> log --since="24 hours ago" --oneline --no-merges`。\n' +
      '2. 跑 `git -C <repo> status --short` 检查未提交变动。\n' +
      '3. 整理成每个仓库一段：分支 / 新提交数 / 关键提交摘要 / 未提交文件数。\n' +
      '4. 末尾给出"需要关注的异常"——例如长时间未提交、分支偏离主干等。\n',
    outputDirectory: '~/xiaok-loops/repo-watch',
    outputFileName: 'repo-changes.md',
    scheduleHint: '建议每天 19:00 触发',
  },
];
