# Token Pulse v1.0.0

首个版本：把 DSH 的 token 用量显示升级成一块会话仪表盘（Conversation View「Token 用量」页签）。

- 4 张 KPI 玻璃卡：总消耗 / 输出 / 缓存命中率 / 解码 TPS，逐轮 sparkline
- 逐轮 token 堆叠流动图（输入·缓存读·缓存写·输出），hover/方向键查每轮精确分桶、首 token、TPS、参与模型；近 20 / 近 50 / 全部窗口
- 上下文占用环形仪表 + 系统/工具/消息构成
- provider/model 计费归因排行
- 会话墙钟拆分：模型 / 工具 / 间隔
- 数据全部读宿主持久投影（tokenUsage / sessionStats / contextPressure / contextBreakdown + 本包 tokenPulse），与计费同源，翻页压缩不变
- 纯展示：不写会话、不发网络、不注入模型上下文；跟随浅深色主题

安装后在 插件 列表或 Plugin Hub 中启停。
