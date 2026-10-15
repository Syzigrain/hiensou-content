# Gallery

每个子目录代表一个相册，包含：

- `album.md` — 相册元信息（YAML frontmatter），字段见 firefly-2026 示例
- 图片文件 — 支持 jpg / png / webp / avif / gif
- `cover.*` — 封面图（可选，不设则用第一张）
- `urls.txt` — 远程图片 URL（可选，每行一个）

## album.md 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| name | 是 | 相册名称 |
| description | 否 | 相册描述 |
| date | 否 | 日期 YYYY-MM-DD |
| location | 否 | 拍摄地点 |
| tags | 否 | 标签数组 |
| cover | 否 | 手动指定封面路径 |
| password | 否 | 访问密码 |
| passwordHint | 否 | 密码提示 |
