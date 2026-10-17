# ADR-0006：本地存储先 JSON，后 SQLite

- 日期：2026-10-17
- 状态：已采纳（M11 Phase 0）
- 关联：`docs/plans/M11-任务会话重构/技术方案.md`

## 背景

当前数据分散在：

- Renderer `localStorage`：`jco-chats-v1`、草稿、素材、发布记录、日志；
- `kernel/auto-tasks.json`、`auto-runs.json`；
- `kernel/task-sessions/*.json`；
- `%APPDATA%/J.Co/publish`。

问题：

- 没有统一事务边界；
- 同一业务状态多处读取；
- 迁移和回滚困难；
- 消息截断、任务台账分叉都与数据分散有关。

## 决策

1. 先引入 **Repository 接口**，Domain/Application 不直接读写存储。
2. Phase 1 使用主进程**单一 JSON 存储**：

```text
%APPDATA%/J.Co/data/store.json
%APPDATA%/J.Co/data/store.backup.json
%APPDATA%/J.Co/data/migrations.log
```

3. 要求：
   - `schemaVersion`；
   - 单写者（主进程）；
   - 临时文件 + rename 原子写入；
   - 写前备份；
   - 启动校验，损坏时从 backup 恢复；
   - 迁移幂等；
   - store 不进安装包。
4. 后续需要更强查询/分页/并发时，在同一 Repository 接口下替换为 SQLite，不改 Domain/Application。

## 选择 JSON 的理由

- 当前数据量小；
- 不引入原生依赖，避免 Electron 打包缺包；
- 迁移和人工排查简单；
- 单写者 + 原子写足以覆盖 v1 的并发模型。

## 不采用的方案

- 继续用 localStorage 作为主数据源：Renderer 可清缓存、跨页一致性差、无事务。
- 继续把任务写多个 JSON：台账分叉无法根治。
- Phase 1 直接上 SQLite：原生模块打包和跨平台风险会干扰核心链路验证。

## 后果

正面：

- 一个事实源；
- 可备份、可迁移、可回滚；
- Repository 接口为 SQLite 留好路径。

代价：

- 需要自己实现原子写、锁和迁移；
- 大数据量时性能有限；
- 需要严格单写者纪律。

## 验收

- store 写入/读取/备份/恢复单元测试；
- 迁移幂等测试；
- 并发写不损坏；
- 消息完整回读；
- 安装版可读写用户数据目录。
