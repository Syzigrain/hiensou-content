# Hiensou 博客文章仓库

> 本仓库仅存放博客文章内容，不含任何代码。博客代码位于 [Hiensou](REPO_URL) 仓库。

## 目录结构

```
├── posts/          # 博客文章 (markdown + 图片等资源)
│   └── <post-slug>/
│       ├── index.md
│       └── cover.*
├── essays/         # 随笔 (日记模式)
│   └── *.md
└── spec/           # 独立页面
    ├── about.md    # 关于页
    ├── friends.mdx # 友链页
    └── guestbook.md # 留言板
```

## 添加文章

### 博客文章 (posts)

在 `posts/` 下创建子目录，包含 `index.md` 和封面图:

```markdown
---
title: 文章标题
published: 2026-07-07
description: "文章简介"
image: "./cover.avif"
tags: ["标签1", "标签2"]
category: 分类
draft: false
---

正文内容...
```

### 随笔 (essays)

在 `essays/` 下创建 `.md` 文件:

```markdown
---
title: 随笔标题
published: 2026-07-07
description: 简介
---
```

## 自动部署

推送本仓库到 `main` 分支 → 通过 Vercel Deploy Hook 自动触发博客重建部署，无需手动操作。

### 部署架构

```
推送文章仓库 (本仓库)
    │
    ▼
GitHub Action → POST Vercel Deploy Hook
    │
    ▼
Vercel 重新构建代码仓库
    │ (构建时 clone 本仓库到 src/content/)
    ▼
博客更新上线
```

### Vercel 配置 (一次性)

代码仓库需要在 Vercel 中配置以下内容:

1. **Build Command**: `npx tsx scripts/sync-content.ts && node scripts/generate-icons.js && npx tsx scripts/generate-lqips.ts && astro build && pagefind --site dist`
2. **Environment Variable**: `CONTENT_REPO_URL` = 本仓库的 git clone URL
3. **Deploy Hook**: 在 Vercel 项目 Settings → Git → Deploy Hooks 创建，将 URL 设为本仓库的 `VERCEL_DEPLOY_HOOK_URL` secret

## 文章管理器

本仓库自带一个 Web 管理界面，方便创建和编辑文章。

### 启动

运行`start-manager.bat`

### 功能

- **文章管理**: 新建 / 编辑 / 删除 blog posts
- **随笔管理**: 新建 / 编辑 / 删除 essays
- **页面编辑**: 编辑 about / friends / guestbook
- **标签系统**: 标签 chips 输入 + 已有标签建议
- **草稿模式**: 一键切换文章的 draft 状态

### 注意事项

- 管理器直接操作本地文件，修改后即时生效
- slug 从 title 自动生成，也可以手动指定
- 图片需要手动放入文章目录，在编辑器中填写相对路径
# hiensou-content
