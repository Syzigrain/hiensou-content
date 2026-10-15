import { Router } from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const TYPE = "spec";

const SPEC_FILES = ["about", "friends", "guestbook"];

function readSpec(slug) {
  const mdPath = join(ROOT, TYPE, `${slug}.md`);
  const mdxPath = join(ROOT, TYPE, `${slug}.mdx`);
  const filePath = existsSync(mdxPath) ? mdxPath : existsSync(mdPath) ? mdPath : null;
  if (!filePath) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  if (data.published instanceof Date) data.published = data.published.toISOString();
  if (data.updated instanceof Date) data.updated = data.updated.toISOString();
  return { slug, frontmatter: data, body: content.trim() };
}

// GET /api/spec — list available spec pages
router.get("/", (_req, res) => {
  const list = SPEC_FILES.filter(slug => {
    return existsSync(join(ROOT, TYPE, `${slug}.md`)) || existsSync(join(ROOT, TYPE, `${slug}.mdx`));
  });
  res.json(list);
});

// GET /api/spec/:slug — read a single spec page
router.get("/:slug", (req, res) => {
  const spec = readSpec(req.params.slug);
  if (!spec) return res.status(404).json({ error: "页面不存在" });
  res.json(spec);
});

// PUT /api/spec/:slug — update a spec page
router.put("/:slug", (req, res) => {
  const { frontmatter, body } = req.body;
  const slug = req.params.slug;
  if (!SPEC_FILES.includes(slug)) return res.status(400).json({ error: "不可修改的页面" });
  const mdxPath = join(ROOT, TYPE, `${slug}.mdx`);
  const mdPath = join(ROOT, TYPE, `${slug}.md`);
  const filePath = existsSync(mdxPath) ? mdxPath : mdPath;
  try {
    const fm = { ...frontmatter };
    Object.keys(fm).forEach(k => {
      if (fm[k] === "" || fm[k] === null || fm[k] === undefined) delete fm[k];
      if (Array.isArray(fm[k]) && fm[k].length === 0) delete fm[k];
    });
    const output = matter.stringify(body || "", fm);
    writeFileSync(filePath, output, "utf-8");
    res.json({ slug });
  } catch (e) {
    res.status(500).json({ error: "保存失败，请重试" });
  }
});

export default router;
