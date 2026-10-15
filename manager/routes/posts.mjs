import { Router } from "express";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively walk posts/ directory.
 * Returns { dirPath, leafName } — leafName is the immediate parent directory name.
 */
function walkPosts(type) {
  const base = join(ROOT, type);
  if (!existsSync(base)) return [];
  const results = [];
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    let hasIndex = false;
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if ((e.name === "index.md" || e.name === "index.mdx") && !hasIndex) {
        hasIndex = true;
        results.push({ dirPath: dir, leafName: relative(base, dir).split(/[\\/]/).pop() });
      }
    }
  }
  return results;
}

/**
 * Find a post directory by slug.
 * First tries flat structure, then searches recursively matching leafName or frontmatter slug.
 */
function findPostDir(type, slug) {
  const cand = join(ROOT, type, slug);
  if (existsSync(join(cand, "index.md")) || existsSync(join(cand, "index.mdx"))) {
    return cand;
  }
  const all = walkPosts(type);
  for (const { dirPath, leafName } of all) {
    if (leafName === slug) return dirPath;
    // Check frontmatter slug
    try {
      const raw = readFileSync(join(dirPath, existsSync(join(dirPath, "index.mdx")) ? "index.mdx" : "index.md"), "utf-8");
      const { data } = matter(raw);
      if (data.slug === slug) return dirPath;
    } catch { /* skip */ }
  }
  return null;
}

function readPost(type, slug) {
  const dir = findPostDir(type, slug);
  if (!dir) return null;
  const mdPath = join(dir, "index.md");
  const mdxPath = join(dir, "index.mdx");
  const filePath = existsSync(mdxPath) ? mdxPath : existsSync(mdPath) ? mdPath : null;
  if (!filePath) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  if (data.published instanceof Date) data.published = data.published.toISOString();
  if (data.updated instanceof Date) data.updated = data.updated.toISOString();
  return { slug, frontmatter: data, body: content.trim() };
}

function writePost(type, slug, frontmatter, body) {
  // Write to flat structure: posts/<slug>/index.md
  const dir = join(ROOT, type, slug);
  const filePath = join(dir, "index.md");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fm = { ...frontmatter };
  for (const k of Object.keys(fm)) {
    if (fm[k] === "" || fm[k] === null || fm[k] === undefined) delete fm[k];
    if (Array.isArray(fm[k]) && fm[k].length === 0) delete fm[k];
  }
  const output = matter.stringify(body, fm);
  writeFileSync(filePath, output, "utf-8");
}

function deletePost(type, slug) {
  const dir = findPostDir(type, slug);
  if (dir) rmSync(dir, { recursive: true, force: true });
}

function listPosts(type) {
  const all = walkPosts(type);
  const items = [];
  for (const { dirPath, leafName } of all) {
    const mdPath = join(dirPath, "index.md");
    const mdxPath = join(dirPath, "index.mdx");
    const filePath = existsSync(mdxPath) ? mdxPath : mdPath;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { data } = matter(raw);
      items.push({
        slug: data.slug || leafName,  // prefer explicit frontmatter slug
        title: data.title || "",
        tags: data.tags || [],
        category: data.category || "",
        draft: data.draft || false,
        pinned: data.pinned || false,
        published: data.published
          ? (data.published instanceof Date ? data.published.toISOString() : String(data.published))
          : "",
        updated: data.updated
          ? (data.updated instanceof Date ? data.updated.toISOString() : String(data.updated))
          : undefined,
        description: data.description || "",
      });
    } catch { /* skip */ }
  }
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.published || 0) - new Date(a.published || 0);
  });
  return items;
}

function validateSlug(s) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/", (_req, res) => {
  try { res.json(listPosts("posts")); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/:slug", (req, res) => {
  const post = readPost("posts", req.params.slug);
  if (!post) return res.status(404).json({ error: "文章不存在" });
  res.json(post);
});

router.post("/", (req, res) => {
  const { frontmatter, body } = req.body;
  if (!frontmatter?.title) return res.status(400).json({ error: "缺少必填字段: 标题" });
  let slug = req.body.slug
    || frontmatter.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) slug = `post-${Date.now()}`;
  if (!validateSlug(slug)) return res.status(400).json({ error: "slug 格式无效，仅允许小写字母、数字和连字符" });
  if (findPostDir("posts", slug)) return res.status(409).json({ error: "文章路径已存在" });
  try {
    writePost("posts", slug, frontmatter, body || "");
    res.status(201).json({ slug });
  } catch (e) {
    res.status(500).json({ error: "保存失败，请重试" });
  }
});

router.put("/:slug", (req, res) => {
  const { frontmatter, body, slug: newSlug } = req.body;
  if (!frontmatter?.title) return res.status(400).json({ error: "缺少必填字段: 标题" });
  const oldSlug = req.params.slug;
  const targetSlug = newSlug || oldSlug;
  if (!validateSlug(targetSlug)) return res.status(400).json({ error: "slug 格式无效，仅允许小写字母、数字和连字符" });
  try {
    if (targetSlug !== oldSlug) {
      if (findPostDir("posts", targetSlug)) {
        return res.status(409).json({ error: "目标路径已存在" });
      }
      writePost("posts", targetSlug, frontmatter, body || "");
      deletePost("posts", oldSlug);
    } else {
      // Update in-place — find existing dir and write there
      const existingDir = findPostDir("posts", oldSlug);
      if (!existingDir) return res.status(404).json({ error: "文章不存在" });
      const filePath = join(existingDir, existsSync(join(existingDir, "index.mdx")) ? "index.mdx" : "index.md");
      const fm = { ...frontmatter };
      for (const k of Object.keys(fm)) {
        if (fm[k] === "" || fm[k] === null || fm[k] === undefined) delete fm[k];
        if (Array.isArray(fm[k]) && fm[k].length === 0) delete fm[k];
      }
      writeFileSync(filePath, matter.stringify(body || "", fm), "utf-8");
    }
    res.json({ slug: targetSlug });
  } catch (e) {
    res.status(500).json({ error: "保存失败，请重试" });
  }
});

router.delete("/:slug", (req, res) => {
  const dir = findPostDir("posts", req.params.slug);
  if (!dir) return res.status(404).json({ error: "文章不存在" });
  try {
    deletePost("posts", req.params.slug);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: "删除失败，请重试" });
  }
});

router.patch("/:slug/draft", (req, res) => {
  const post = readPost("posts", req.params.slug);
  if (!post) return res.status(404).json({ error: "文章不存在" });
  try {
    post.frontmatter.draft = req.body.draft;
    writePost("posts", req.params.slug, post.frontmatter, post.body);
    res.json({ draft: req.body.draft });
  } catch (e) {
    res.status(500).json({ error: "更新失败，请重试" });
  }
});

export default router;
export { listPosts, findPostDir };
