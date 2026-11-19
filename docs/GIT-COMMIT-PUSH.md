# 提交与推送约定

用户明确说「提交并推送 / commit & push」等时，Agent **自动按本文执行**，不必再问是否推送。未明确要求时，**禁止**擅自 `git commit` / `git push`。

Agent 约束见 `.cursor/rules/git-commit-push.mdc`（与本文同步维护）。

## 何时执行

| 用户说法（示例） | 动作 |
| --- | --- |
| 提交并推送、commit 并 push、推送到远程 | `git add` → `commit` → `push`，并回复摘要 |
| 只提交 / 先 commit | 只 commit，不 push |
| 未提及提交 | 不 commit、不 push |

## 提交前检查（并行）

在 `dashbord` 仓库根目录：

1. `git status`
2. `git diff` / `git diff --cached`（看清本次真正改动）
3. `git log -8 --oneline`（对齐既有 commit 文风）
4. `git status -sb`（确认分支与 ahead/behind）

## 提交内容

1. **只纳入与本次需求相关的文件**；勿把无关脏文件、密钥（`.env`、`credentials*` 等）塞进提交。
2. `data/**` 若为有意回写的行情/份额/分时缓存，可随功能一并提交（本仓库策略允许积累）；无关或误生成的大文件先确认。
3. **Commit message**：1～2 句，写清 **为什么**（中文，与近期 `feat:` / `fix:` 风格一致），避免只罗列文件名。
4. **Windows PowerShell**：不要用 bash `$(cat <<'EOF')` heredoc；用 PowerShell here-string，例如：

```powershell
$msg = @"
feat: 一句话说明动机

补充一句范围或影响（可选）。
"@
git commit -m $msg
```

5. 遵守安全约定：不改 `git config`；不做 force push main/master；不 `--amend` 已推送提交；hooks 失败则修问题后 **新 commit**，不盲目 amend。

## 推送

1. `git push -u origin HEAD`（或当前跟踪分支的等价推送）。
2. 推送后用 `git status` 确认与 `origin` 同步。

## 回复必须带「变更摘要」（每次）

推送（或仅提交）完成后，在回复里用简短摘要说明 **本次提交的主要功能点**，不要只贴 commit hash。建议结构：

1. **Commit**：短 hash + 标题 + 远程分支
2. **主要功能点**：3～6 条 bullet，按用户可感知能力写（新图/修 bug/布局/代理/文档等）
3. **范围提示**（可选）：是否含 `data/**` 回写、是否需 `deploy:cf` 等

示例：

```text
已提交并推送：abc1234 → origin/master

主要功能点：
- 宽基篮子累计净流入，tooltip 按 9 指数分解
- 累计图叠加上证指数（复用两融 sseClose 缓存）
- PC 宽屏通栏 + ETF 双列；H5 单列保留
- 右下角回顶部；页头文案 PC 单行
```

## 与其它约束的关系

- 前端改动仍须遵守 `docs/H5-MOBILE.md` / `h5-mobile` 规则。
- 数据与双环境仍须遵守 `docs/DATA-CACHE-STRATEGY.md`。
- 本流程 **不替代** 用户规则里的 Git Safety Protocol；冲突时以更严的安全条款为准。
