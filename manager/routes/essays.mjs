import { Router } from "express";
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const TYPE = "essays";

function readEssay(slug) {
  const filePath = join(ROOT, TYPE, `${slug}.md`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  if (data.published instanceof Date) data.published = data.published.toISOString();
  if (data.updated instanceof Date) data.updated = data.updated.toISOString();
  return { slug, frontmatter: data, body: content.trim() };
}

function writeEssay(slug, frontmatter, body) {
  const filePath = join(ROOT, TYPE, `${slug}.md`);
  const fm = { ...frontmatter };
  Object.keys(fm).forEach(k => {
    if (fm[k] === "" || fm[k] === null || fm[k] === undefined) delete fm[k];
    if (Array.isArray(fm[k]) && fm[k].length === 0) delete fm[k];
  });
  const output = matter.stringify(body, fm);
  writeFileSync(filePath, output, "utf-8");
}

function listEssays() {
  const dir = join(ROOT, TYPE);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md") && !f.startsWith("."))
    .map(f => {
      const slug = f.replace(/\.md$/, "");
      try {
        const raw = readFileSync(join(dir, f), "utf-8");
        const { data } = matter(raw);
        return {
          slug,
          title: data.title || "",
          description: data.description || "",
          draft: data.draft || false,
          published: data.published
            ? (data.published instanceof Date ? data.published.toISOString() : String(data.published))
            : "",
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}

function validateSlug(s) {
  // Allow only lowercase alphanumeric + hyphens, non-empty, no consecutive hyphens
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

// GET /api/essays — list all essays
router.get("/", (_req, res) => {
  try {
    res.json(listEssays());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/essays/:slug — read a single essay
router.get("/:slug", (req, res) => {
  const e = readEssay(req.params.slug);
  if (!e) return res.status(404).json({ error: "随笔不存在" });
  res.json(e);
});

// POST /api/essays — create a new essay
router.post("/", (req, res) => {
  const { frontmatter, body } = req.body;
  if (!frontmatter?.title) return res.status(400).json({ error: "缺少必填字段: 标题" });
  let slug = req.body.slug
    || frontmatter.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) slug = `essay-${Date.now()}`;
  if (!validateSlug(slug)) return res.status(400).json({ error: "slug 格式无效，仅允许小写字母、数字和连字符" });
  const filePath = join(ROOT, TYPE, `${slug}.md`);
  if (existsSync(filePath)) return res.status(409).json({ error: "随笔路径已存在" });
  try {
    writeEssay(slug, frontmatter, body || "");
    res.status(201).json({ slug });
  } catch (e) {
    res.status(500).json({ error: "保存失败，请重试" });
  }
});

// PUT /api/essays/:slug — update (and optionally rename) an essay
router.put("/:slug", (req, res) => {
  const { frontmatter, body, slug: newSlug } = req.body;
  if (!frontmatter?.title) return res.status(400).json({ error: "缺少必填字段: 标题" });
  const targetSlug = newSlug || req.params.slug;
  if (!validateSlug(targetSlug)) return res.status(400).json({ error: "slug 格式无效，仅允许小写字母、数字和连字符" });
  try {
    if (targetSlug !== req.params.slug) {
      const newPath = join(ROOT, TYPE, `${targetSlug}.md`);
      const oldPath = join(ROOT, TYPE, `${req.params.slug}.md`);
      if (existsSync(newPath)) return res.status(409).json({ error: "目标路径已存在" });
      // WRITE first, then DELETE old — matches posts.mjs safe ordering
      writeEssay(targetSlug, frontmatter, body || "");
      rmSync(oldPath, { force: true });
    } else {
      writeEssay(targetSlug, frontmatter, body || "");
    }
    res.json({ slug: targetSlug });
  } catch (e) {
    res.status(500).json({ error: "保存失败，请重试" });
  }
});

// DELETE /api/essays/:slug
router.delete("/:slug", (req, res) => {
  const filePath = join(ROOT, TYPE, `${req.params.slug}.md`);
  if (!existsSync(filePath)) return res.status(404).json({ error: "随笔不存在" });
  try {
    rmSync(filePath, { force: true });
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: "删除失败，请重试" });
  }
});

// PATCH /api/essays/:slug/draft — toggle draft status
router.patch("/:slug/draft", (req, res) => {
  const essay = readEssay(req.params.slug);
  if (!essay) return res.status(404).json({ error: "随笔不存在" });
  try {
    essay.frontmatter.draft = req.body.draft;
    writeEssay(req.params.slug, essay.frontmatter, essay.body);
    res.json({ draft: req.body.draft });
  } catch (e) {
    res.status(500).json({ error: "更新失败，请重试" });
  }
});

export default router;
