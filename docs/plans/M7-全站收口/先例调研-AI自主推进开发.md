# 先例调研笔记 · AI 自主推进开发（"让 AI 独自把活干完"的方法也要有源头）

> 缘起：产品负责人 2026-10-16 指出——"AI 自行推进并完成开发"**本身就是一条工作流**，按铁律也该先查先例再定；
> 我们此前直接写了《独自推进队列》，缺了这一步，本笔记补课并对齐。

## 一、三处源头

### 1. Ralph 技术（Geoffrey Huntley · ghuntley.com/ralph/）
- **一句话内核**：让 agent 在**不设工具调用上限的循环**里反复跑——每次迭代=一个目标+**确定性反馈**（测试）自我纠错；作者原话："the technique is **deterministically bad in an undeterministic world**"（用确定的循环与反馈，兜住不确定的模型）。
- 关键实践（原文）：
  - 主上下文当**调度器**，重活交子代理（防上下文爆炸）；**验证（build/test）只许一个执行者**（防回压）；
  - **"don't assume it's not implemented"**——动手前先搜代码，别假设；
  - **下一轮循环看不到上一轮的推理**（上下文会滚出去）——所以**状态必须落盘成文件**（如 fix_plan.md），靠文件接力；
  - 应对"autoregressive failure"（连败模式）：失败可识别、可修复，修完继续，不放弃也不硬撑。

### 2. Anthropic《Building Effective Agents》（2024-12 · 官方工程博客）
- 三条核心原则：**保持简单 / 过程透明（显式展示规划步骤） / 精心打磨"agent-计算机接口"（工具要有文档、要测试）**；
- agents = "LLM 在循环里依据**环境反馈**使用工具"；**每一步都要拿到 ground truth**（工具调用结果/代码执行结果）来评估进展；
- **人类检查点**：遇到阻塞或高风险动作暂停等人类；**停止条件**：如"最大迭代数"，保持控制；
- 成本与延迟是**显式权衡项**（能不 agent 就不 agent）。

### 3. Claude Code 官方最佳实践（Anthropic）
- headless 自动化（`claude -p` 进 CI/脚本，可自动 commit）；
- **给可验证目标**（测试/截图/命令），**尽早纠偏**（course-correct early）；
- Git 当**检查点**（提交=回滚点）；用 CLAUDE.md 写约定（对应我们的 AGENTS.md / CLAUDE.md，已是事实标准）。

## 二、对照《独自推进队列》——我们已有 vs 补课

| 业界要点 | 我们已有（对齐 ✓ / 缺 ✗） | 升级动作（已并入队列 v1.1） |
|---|---|---|
| 确定性反馈兜住不确定（Ralph） | ✓ 门禁全绿（含全站审计+双门）= ground truth | 队列里把"**门禁 = ground truth**"写显式 |
| 状态落盘、靠文件接力（Ralph） | ✓ 台账 + README | 明确：**每轮开头先读台账/队列，结尾写一行结果**并提交 |
| 停止条件（Anthropic） | ✓ 停手条件（登录/拍板/修不好即停） | **补"单轮预算"**：单轮时间盒约 1 小时，超预算即停、登记、下轮续 |
| 人类检查点（Anthropic） | ✓ "待用户清单" | 保持 |
| 简单优先 / 一轮一事（Anthropic） | ✓ 最小完整工作单元 | 保持 |
| 先搜再动、不假设（Ralph） | ✗ | 队列加："动手前先 rg/读现状，不假设实现" |
| 验证串行、防回压（Ralph） | ✓ 天然串行（单实例 + bridge 队列） | 队列写明："同一时间只跑一个门禁/打包，不并行" |
| Git 检查点（CC） | ✓ 每单元提交 | 保持（提交信息带"双门+门禁+装机"结论） |
| 尽早纠偏（CC） | ✓ 门禁即时反馈 | 保持 |

## 三、结论

**我们的队列与业界共识同构**（循环 + ground truth + 人类检查点 + 停止条件 + 状态落盘），v1.1 吸收三处源头补强**先搜再动、单轮预算、开头读结尾写、验证串行**四条，自本笔记进《体系溯源总表》。

## 四、出处

| 内容 | 出处 |
|---|---|
| Ralph 技术 | ghuntley.com/ralph/（Geoffrey Huntley） |
| Building Effective Agents | anthropic.com/engineering/building-effective-agents（2024-12） |
| Claude Code 最佳实践 | anthropic.com/engineering/claude-code-best-practices |
