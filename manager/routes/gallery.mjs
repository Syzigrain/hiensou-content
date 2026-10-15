import { Router } from "express";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const GALLERY_DIR = join(ROOT, "gallery");

const ALBUM_FIELDS = ["name", "description", "date", "location", "tags", "cover", "password", "passwordHint"];

function readAlbum(albumId) {
  const mdPath = join(GALLERY_DIR, albumId, "album.md");
  if (!existsSync(mdPath)) return null;
  const raw = readFileSync(mdPath, "utf-8");
  const { data, content } = matter(raw);
  const photos = listPhotos(albumId);
  return { id: albumId, frontmatter: data, body: content.trim(), photoCount: photos.length, photos };
}

function writeAlbum(albumId, frontmatter, body) {
  const dir = join(GALLERY_DIR, albumId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fm = {};
  for (const k of ALBUM_FIELDS) {
    if (frontmatter[k] !== undefined && frontmatter[k] !== "" && frontmatter[k] !== null) {
      fm[k] = frontmatter[k];
    }
    if (Array.isArray(fm[k]) && fm[k].length === 0) delete fm[k];
  }
  writeFileSync(join(dir, "album.md"), matter.stringify(body || "", fm), "utf-8");
}

function listPhotos(albumId) {
  const dir = join(GALLERY_DIR, albumId);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
      .sort();
  } catch { return []; }
}

function listAlbums() {
  if (!existsSync(GALLERY_DIR)) return [];
  return readdirSync(GALLERY_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith("."))
    .map(e => {
      const mdPath = join(GALLERY_DIR, e.name, "album.md");
      if (!existsSync(mdPath)) return null;
      try {
        const raw = readFileSync(mdPath, "utf-8");
        const { data } = matter(raw);
        return {
          id: e.name,
          name: data.name || e.name,
          description: data.description || "",
          date: data.date || "",
          location: data.location || "",
          tags: data.tags || [],
          photoCount: listPhotos(e.name).length,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

// GET /api/gallery — list albums
router.get("/", (_req, res) => {
  try { res.json(listAlbums()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/gallery/:id
router.get("/:id", (req, res) => {
  const album = readAlbum(req.params.id);
  if (!album) return res.status(404).json({ error: "相册不存在" });
  res.json(album);
});

// POST /api/gallery
router.post("/", (req, res) => {
  const { id, frontmatter, body } = req.body;
  if (!id) return res.status(400).json({ error: "缺少相册 id" });
  if (!frontmatter?.name) return res.status(400).json({ error: "缺少相册名称" });
  const cleanId = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!cleanId) return res.status(400).json({ error: "id 格式无效" });
  const dir = join(GALLERY_DIR, cleanId);
  if (existsSync(dir)) return res.status(409).json({ error: "相册已存在" });
  try {
    writeAlbum(cleanId, frontmatter, body || "");
    res.status(201).json({ id: cleanId });
  } catch (e) {
    res.status(500).json({ error: "保存失败" });
  }
});

// PUT /api/gallery/:id
router.put("/:id", (req, res) => {
  const { frontmatter, body, id: newId } = req.body;
  if (!frontmatter?.name) return res.status(400).json({ error: "缺少相册名称" });
  const targetId = (newId || req.params.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!targetId) return res.status(400).json({ error: "id 格式无效" });
  try {
    if (targetId !== req.params.id) {
      const newDir = join(GALLERY_DIR, targetId);
      if (existsSync(newDir)) return res.status(409).json({ error: "目标路径已存在" });
      writeAlbum(targetId, frontmatter, body || "");
      const oldDir = join(GALLERY_DIR, req.params.id);
      if (existsSync(oldDir)) {
        // Move photos to new dir
        const photos = listPhotos(req.params.id);
        for (const p of photos) {
          try { renameSync(join(oldDir, p), join(newDir, p)); } catch {}
        }
        rmSync(oldDir, { recursive: true, force: true });
        writeAlbum(targetId, frontmatter, body || "");
      }
    } else {
      if (!existsSync(join(GALLERY_DIR, req.params.id))) return res.status(404).json({ error: "相册不存在" });
      writeAlbum(req.params.id, frontmatter, body || "");
    }
    res.json({ id: targetId });
  } catch (e) {
    res.status(500).json({ error: "保存失败" });
  }
});

// DELETE /api/gallery/:id
router.delete("/:id", (req, res) => {
  const dir = join(GALLERY_DIR, req.params.id);
  if (!existsSync(dir)) return res.status(404).json({ error: "相册不存在" });
  try {
    rmSync(dir, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: "删除失败" });
  }
});

export default router;
