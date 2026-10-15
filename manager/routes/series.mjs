import { Router } from "express";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SERIES_DIR = join(ROOT, "series");

function readSeries(id) {
  const filePath = join(SERIES_DIR, `${id}.md`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return { id, frontmatter: data, body: content.trim() };
}

function writeSeries(id, frontmatter, body) {
  if (!existsSync(SERIES_DIR)) mkdirSync(SERIES_DIR, { recursive: true });
  const filePath = join(SERIES_DIR, `${id}.md`);
  const fm = { id, ...frontmatter };
  for (const k of Object.keys(fm)) {
    if (fm[k] === "" || fm[k] === null || fm[k] === undefined) delete fm[k];
  }
  writeFileSync(filePath, matter.stringify(body || "", fm), "utf-8");
}

function listSeries() {
  if (!existsSync(SERIES_DIR)) return [];
  return readdirSync(SERIES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const id = f.replace(/\.md$/, "");
      try {
        const raw = readFileSync(join(SERIES_DIR, f), "utf-8");
        const { data } = matter(raw);
        return { id, name: data.name || id, description: data.description || "", draft: data.draft || false };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET /api/series
router.get("/", (_req, res) => {
  try { res.json(listSeries()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/series/:id
router.get("/:id", (req, res) => {
  const s = readSeries(req.params.id);
  if (!s) return res.status(404).json({ error: "系列不存在" });
  res.json(s);
});

// POST /api/series
router.post("/", (req, res) => {
  const { id, frontmatter, body } = req.body;
  if (!id) return res.status(400).json({ error: "缺少 id" });
  if (!frontmatter?.name) return res.status(400).json({ error: "缺少名称" });
  const cleanId = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!cleanId) return res.status(400).json({ error: "id 格式无效" });
  if (existsSync(join(SERIES_DIR, `${cleanId}.md`))) return res.status(409).json({ error: "系列已存在" });
  try {
    writeSeries(cleanId, frontmatter, body || "");
    res.status(201).json({ id: cleanId });
  } catch (e) { res.status(500).json({ error: "保存失败" }); }
});

// PUT /api/series/:id
router.put("/:id", (req, res) => {
  const { frontmatter, body, id: newId } = req.body;
  if (!frontmatter?.name) return res.status(400).json({ error: "缺少名称" });
  const targetId = (newId || req.params.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!targetId) return res.status(400).json({ error: "id 格式无效" });
  try {
    writeSeries(targetId, frontmatter, body || "");
    if (targetId !== req.params.id) {
      const oldPath = join(SERIES_DIR, `${req.params.id}.md`);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }
    res.json({ id: targetId });
  } catch (e) { res.status(500).json({ error: "保存失败" }); }
});

// DELETE /api/series/:id
router.delete("/:id", (req, res) => {
  const filePath = join(SERIES_DIR, `${req.params.id}.md`);
  if (!existsSync(filePath)) return res.status(404).json({ error: "系列不存在" });
  try {
    unlinkSync(filePath);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: "删除失败" }); }
});

export default router;
