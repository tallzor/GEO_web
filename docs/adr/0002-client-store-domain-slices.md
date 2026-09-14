# 客户端 Store 按领域 slice 组合

客户端状态继续由一个 `useAppStore` 对外提供兼容入口，但其 implementation 按工作区生命周期、品牌、检测和优化/内容四个领域 slice 组织；远程请求通过可替换的客户端 port 注入，HTTP 只作为生产 adapter。这样既不要求页面一次性迁移到多个 Store，又把本地模拟、服务端投影合并和领域状态变换集中在各自的 module 中，避免主 Store 重新承担跨领域细节。
