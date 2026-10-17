# 先例调研笔记 · AI 驱动的软件开发工作流

> 文档角色：**调研资料，不是执行标准**。开发流程以《J.Co 软件开发工作流标准》v1.6 为准；本文保留用于来源追踪。

> 按《J.Co 软件开发工作流标准》v1.1 §2.2 第 0 步执行（"开发前先找前辈"）｜日期：2026-10-16
>
> **调研问题**：我们自建的开发工作流（立项 → 调研 → 设计 → 施工 → 验收 → 交付，加上 AI 员工方法论与安全体系），业界有哪些成熟体系可以对照、吸收？

---

## 一、找到的成熟体系（都是"官方级"）

### 1. GitHub Spec Kit —— 规范驱动开发（SDD）官方工具包 ⭐ 14.1 万

> 出处：github.com/github/spec-kit

- **项目宪法（Constitution）**：每个项目先立"代码质量 / 测试 / 可维护性"原则（一次制定）——对应我们的 **AGENTS.md + 工作流标准**；
- **每个功能的流程**：`specify（规范）→ plan（计划）→ tasks（任务）→ implement（实施）→ converge（收敛）`；
  **implement → converge 循环，直到报告 "Converged"（收敛）**；
- **Bug 修复流程**：`assess（评估）→ fix（修复）→ test（验证）` 三者分离；
  官方原则：**"没有验证不算修好"（Missing verification is not a successful fix）**；
- **想法评估流程**：`intake → research → define → shape → decide` → 产出 go / needs-clarification / kill 决策；
  **注意：research（调研）排在 define（定义）之前**——与我们刚立的"先例调研"完全同构。

### 2. Claude Code 官方最佳实践（Anthropic）

> 出处：anthropic.com/engineering/claude-code-best-practices

- 第一条：**"给 AI 一个验证自己工作的方式"**——与我们"门禁全绿 / 先红后绿"同构；
- 核心口诀：**"先探索、再计划、再编码"（Explore first, then plan, then code）**——与我们的"调研 → 设计 → 施工"完全一致；
- 工程设施：CLAUDE.md 立规矩、权限配置、hooks、技能（Skills）、子代理——我们已用同款（AGENTS.md/CLAUDE.md、.githooks、技能库）；
- 会话管理：**"尽早频繁纠偏"**、**对抗性审查（adversarial review）**——对抗审查我们还没有，值得吸收。

### 3. 12-Factor Agents —— 生产级 AI 软件原则 ⭐ 2.7 万

> 出处：github.com/humanlayer/12-factor-agents

- 核心洞见（反直觉、且重要）：**好的 Agent"大部分就是软件"**——确定性代码 + 在关键点上嵌入 LLM 步骤；
  而不是"给个提示词、一袋工具、无限循环到成功"；
- 与我们直接相关的条款：**自己掌控提示词与上下文**（系统提示词规范）、**工具 = 结构化输出**（白名单工具集）、
  **让人类进回路**（人机检查点）、**小而专注的 Agent**（员工分工）；
- **对 J.Co 架构的确认**：发布引擎（软件骨架 + AI 在需要判断处介入）正是这个形态——方向正确。

### 4.（回顾）已吸收的前辈

Karpathy 编码四原则、Anthropic Agents / Agent Skills、OWASP LLM/Skills Top 10、browser-use——
见各自专项文档与 ADR。

---

## 二、对照结论

我们的体系与业界"官方级"体系**高度同构**——宪法级原则、调研先行、规范驱动、验证优先、人类检查点，
五项全部命中，说明方向没有跑偏；另有三项机制值得吸收补全（见下）。

---

## 三、吸收清单（已落进工作流标准 v1.2）

| # | 吸收什么 | 来自 | 落点 |
|---|---|---|---|
| 1 | **收敛检查**：验收时对照规范**逐条核对验证证据**——没有验证证据的条目 = 未收敛，不得交付 | Spec Kit（converge） | §2.4 验收 |
| 2 | **缺陷三分离**：评估（定位根因+写出复现）→ 修复 → 验证（**回到原始症状**确认）——"没有验证不算修好" | Spec Kit（bug fixing） | §2.6 运维 |
| 3 | **对抗审查**：封版前，用独立视角（另一 AI 会话/专门角色）对着规范专门"挑刺" | Claude Code 实践 | §2.5 交付 |
| 4 | 架构原则确认：**"软件为主 + AI 点睛"**（不把确定性工作盲目塞给 AI，也不让 AI 做无谓的循环） | 12-Factor Agents | 架构决策依据（本篇存档） |

---

## 四、出处清单

| 体系 | 出处 |
|---|---|
| GitHub Spec Kit（SDD） | github.com/github/spec-kit |
| Claude Code 最佳实践 | anthropic.com/engineering/claude-code-best-practices |
| 12-Factor Agents | github.com/humanlayer/12-factor-agents |
| Anthropic Building Effective Agents | anthropic.com/engineering/building-effective-agents |
| OWASP GenAI LLM Top 10 (2026) | genai.owasp.org |
| OWASP Agentic Skills Top 10 | github.com/OWASP/www-project-agentic-skills-top-10 |
