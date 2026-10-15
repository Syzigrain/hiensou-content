import express from "express";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import matter from "gray-matter";
import postsRouter, { findPostDir, listPosts } from "./routes/posts.mjs";
import essaysRouter from "./routes/essays.mjs";
import specRouter from "./routes/spec.mjs";
import galleryRouter from "./routes/gallery.mjs";
import seriesRouter from "./routes/series.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = process.env.PORT || 3456;

const app = express();
app.use(express.json());

// Static files for the manager UI
app.use(express.static(join(__dirname, "public")));

// API routes
app.use("/api/posts", postsRouter);
app.use("/api/essays", essaysRouter);
app.use("/api/spec", specRouter);
app.use("/api/gallery", galleryRouter);
app.use("/api/series", seriesRouter);

// Tags and categories (aggregated from posts)
app.get("/api/tags", (req, res) => {
  const posts = listPosts("posts");
  const tagMap = {};
  for (const p of posts) {
    for (const t of p.tags || []) {
      tagMap[t] = (tagMap[t] || 0) + 1;
    }
  }
  res.json(Object.entries(tagMap).map(([tag, count]) => ({ tag, count })));
});

app.get("/api/categories", (req, res) => {
  const posts = listPosts("posts");
  const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  cats.sort();
  res.json(cats);
});

// Organize posts by category — preview or execute
app.get("/api/organize", (req, res) => {
  const posts = listPosts("posts");
  const plan = [];
  for (const p of posts) {
    const cat = p.category || "未分类";
    const actualDir = findPostDir("posts", p.slug);
    if (!actualDir) continue;
    // Only move if not already in the right category folder
    const parentDir = join(ROOT, "posts", cat);
    if (actualDir.startsWith(parentDir + (process.platform === "win32" ? "\\" : "/"))) continue;
    const targetDir = join(ROOT, "posts", cat, p.slug);
    plan.push({
      slug: p.slug,
      title: p.title,
      category: cat,
      from: actualDir,
      to: targetDir,
      willMove: true,
    });
  }
  res.json({ plan, totalMoves: plan.length });
});

app.post("/api/organize", (req, res) => {
  if (!req.body.execute) {
    return res.status(400).json({ error: "设置 execute: true 以确认执行" });
  }
  const posts = listPosts("posts");
  const results = [];
  for (const p of posts) {
    const cat = p.category || "未分类";
    const actualDir = findPostDir("posts", p.slug);
    if (!actualDir) continue;
    const parentDir = join(ROOT, "posts", cat);
    // Skip if already in the correct category folder
    if (actualDir.startsWith(parentDir + (process.platform === "win32" ? "\\" : "/"))) {
      continue;
    }
    const targetDir = join(ROOT, "posts", cat, p.slug);
    if (actualDir === targetDir) continue;
    try {
      // Write slug into frontmatter so Astro keeps the original URL
      const indexPath = join(actualDir, "index.md");
      if (existsSync(indexPath)) {
        const raw = readFileSync(indexPath, "utf-8");
        const { data, content } = matter(raw);
        if (!data.slug) {
          data.slug = p.slug;
          const output = matter.stringify(content, data);
          writeFileSync(indexPath, output, "utf-8");
        }
      }
      // Move directory into category folder
      const targetParent = join(ROOT, "posts", cat);
      if (!existsSync(targetParent)) {
        mkdirSync(targetParent, { recursive: true });
      }
      renameSync(actualDir, targetDir);
      results.push({ slug: p.slug, status: "moved", to: `posts/${cat}/${p.slug}` });
    } catch (e) {
      results.push({ slug: p.slug, status: "failed", error: e.message });
    }
  }
  res.json({ results });
});

// Git push — commit and push all changes
app.post("/api/push", (req, res) => {
  const message = (req.body.message || "update content").trim();
  try {
    // Check if there are changes
    const status = execSync("git status --porcelain", { cwd: ROOT, stdio: "pipe" }).toString().trim();
    if (!status) return res.json({ ok: true, output: "No changes to push" });

    console.log(`[push] Committing: ${message}`);
    execSync("git add -A", { cwd: ROOT, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: ROOT, stdio: "pipe" });
    console.log("[push] Pushing...");
    const out = execSync("git push", { cwd: ROOT, stdio: "pipe", timeout: 30000 }).toString();
    console.log("[push] Done");
    res.json({ ok: true, output: out.trim() || "Pushed successfully" });
  } catch (e) {
    const stderr = (e.stderr?.toString() || "") + (e.stdout?.toString() || "") || e.message;
    console.error("[push] Failed:", stderr);
    res.status(500).json({ error: stderr.slice(-500) });
  }
});

// Global error handler — always return JSON
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`Article manager running at http://localhost:${PORT}`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process and try again.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
