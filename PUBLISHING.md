# 发布 runbook — dsh-token-pulse-view

工件已备好（`dist/`）：

| 文件 | 用途 |
|---|---|
| `dsh-token-pulse-view-1.0.0.tgz` | npm 通道包体 / GitHub Release 附件 |
| `RELEASE_NOTES.md` | Release / 商店详情文案 |
| `token-pulse.dpmidx` | Plugin Hub「自建目录」索引（把 `OWNER` 换成你的 GitHub 账号后重新生成，见下） |
| `market-entry.json` | dpmidx 的源 JSON |

## 通道 A：GitHub 仓库（Plugin Hub topic 扫描自动收录）

Hub 的发现页按 `topic:dsh-plugin` 搜索仓库。建仓时带上该 topic 即被收录。

```bash
# 1) 建仓库（网页或 API 均可），建议 public，owner=<你的GitHub账号>
git init -b main   # 本目录已 init，跳过
git remote add origin https://github.com/<OWNER>/dsh-token-pulse-view.git
git push -u origin main --tags
# 2) topics（网页 Settings → Topics，或 API 设 ["dsh-plugin","deepseek-harness"]）
# 3) Release：v1.0.0，正文粘 dist/RELEASE_NOTES.md，可附上 .tgz
```

网页建仓时把 Topics 填 `dsh-plugin` 一步到位，之后 Hub 扫描自动上架。

## 通道 B：npm 注册表

```bash
npm login
npm publish            # 公共名未占用；占用则改 dsh-token-pulse-view-<suffix> 后重发
```

发布前自检已过：`npm pack --dry-run` 12 文件 23.5kB；Hub security-scan `clean`；
keywords 首项 `dsh-plugin`（Hub 的 dsh 插件判据接受 keywords+main）。

## 通道 C：Plugin Hub 自建目录索引（完全离线）

1. 把 `market-entry.json` 的 `url` 改成真实仓库地址（或 tgz 的 https 直链，
   `.tgz` 结尾会自动标为成品包），重新生成：
   ```bash
   node ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hub/scripts/build-market-index.mjs \
     dist/market-entry.json dist/token-pulse.dpmidx
   ```
2. 把 `.dpmidx` 任意静态托管（GitHub raw 链接即可），在 Harness 的
   Plugin Hub → 设置里添加该索引 URL（关闭官方源开关可选）。

## 通道 D：Hub 应用内「发布」页（GUI）

插件页 → 发布：粘贴 GitHub token（repo scope）与/或 npm token，选本目录，
双通道一键推送；发布前自动过安全扫描与质量门禁（本包已预检通过）。
