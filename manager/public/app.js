// === State ===
let currentTab = "posts";
let allPosts = [];
let allEssays = [];
let allSpecs = [];
let allAlbums = [];
let allSeries = [];
let allTags = [];
let allCategories = [];

// === API helpers ===
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadList(type) {
  const data = await api(`/api/${type}`);
  if (type === "posts") allPosts = data;
  if (type === "essays") allEssays = data;
  if (type === "spec") allSpecs = data;
  if (type === "gallery") allAlbums = data;
  if (type === "series") allSeries = data;
}

async function loadTags() {
  allTags = await api("/api/tags");
}

async function loadCategories() {
  allCategories = await api("/api/categories");
}

// === Toast ===
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// === Confirm Dialog ===
function showConfirm(message, title = "确认操作", confirmText = "确定删除") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <h3>${title}</h3>
        <p style="white-space:pre-line;text-align:left">${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" data-action="cancel">取消</button>
          <button class="btn btn-danger" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target.dataset.action === "cancel") { overlay.remove(); resolve(false); }
      if (e.target.dataset.action === "confirm") { overlay.remove(); resolve(true); }
    });
    document.body.appendChild(overlay);
  });
}

// === Escaping ===
function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// === Render article list ===
function renderList() {
  const container = document.getElementById("article-list");
  let items;
  if (currentTab === "posts") items = allPosts;
  else if (currentTab === "essays") items = allEssays;
  else if (currentTab === "gallery") items = allAlbums;
  else if (currentTab === "series") items = allSeries;
  else items = allSpecs.map(s => ({ slug: s, title: s }));

  // Filter
  const searchTerm = document.getElementById("search-input").value.toLowerCase();
  const draftOnly = document.getElementById("filter-draft").checked;
  if (searchTerm) items = items.filter(i => i.title.toLowerCase().includes(searchTerm));
  if (draftOnly && currentTab !== "spec") items = items.filter(i => i.draft);

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">还没有${currentTab === "spec" ? "页面" : currentTab === "gallery" ? "相册" : currentTab === "series" ? "系列" : "内容"}，点击"+ 新建"开始</div></div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const isSpec = currentTab === "spec";
    const isGallery = currentTab === "gallery";
    const slug = isGallery ? item.id : item.slug;

    if (isGallery) {
      const tagsHtml = item.tags?.length
        ? item.tags.map(t => `<span class="badge badge-tag">${esc(t)}</span>`).join(" ")
        : "";
      return `
        <div class="card" data-slug="${esc(slug)}">
          <div class="card-header">
            <span class="card-title">🖼 ${esc(item.name)}</span>
            <div class="card-actions">
              <button class="btn-card-edit" data-slug="${esc(slug)}">✏ 编辑</button>
              <button class="btn-card-delete" data-slug="${esc(slug)}">🗑</button>
            </div>
          </div>
          <div class="card-meta">
            ${item.description ? `<span>${esc(item.description)}</span>` : ""}
            ${tagsHtml}
            ${item.date ? `📅 ${item.date}` : ""}
            ${item.location ? `📍 ${esc(item.location)}` : ""}
            📷 ${item.photoCount || 0} 张照片
          </div>
        </div>
      `;
    }

    if (currentTab === "series") {
      return `
        <div class="card" data-slug="${esc(item.id)}">
          <div class="card-header">
            <span class="card-title">📖 ${esc(item.name)}</span>
            <div class="card-actions">
              <button class="btn-card-edit" data-slug="${esc(item.id)}">✏ 编辑</button>
              <button class="btn-card-delete" data-slug="${esc(item.id)}">🗑</button>
            </div>
          </div>
          <div class="card-meta">${item.description ? esc(item.description) : ""}</div>
        </div>
      `;
    }

    const badges = [];
    if (!isSpec && item.pinned) badges.push('<span class="badge badge-pinned">置顶</span>');
    if (!isSpec && item.draft) badges.push('<span class="badge badge-draft">草稿</span>');
    const tagsHtml = !isSpec && item.tags?.length
      ? `<span class="card-meta"><span>🏷 ${item.tags.map(t => `<span class="badge badge-tag">${esc(t)}</span>`).join(" ")}</span></span>`
      : "";
    const categoryHtml = !isSpec && item.category ? `📂 ${esc(item.category)}` : "";
    const dateHtml = !isSpec && item.published ? `📅 ${item.published.slice(0, 10)}` : "";

    return `
      <div class="card" data-slug="${slug}">
        <div class="card-header">
          <span class="card-title">${esc(item.title)}</span>
          ${badges.join("")}
          <div class="card-actions">
            <button class="btn-card-edit" data-slug="${slug}">✏ 编辑</button>
            ${!isSpec ? `<button class="btn-card-delete" data-slug="${slug}">🗑</button>` : ""}
          </div>
        </div>
        <div class="card-meta">${tagsHtml} ${categoryHtml} ${dateHtml}</div>
      </div>
    `;
  }).join("");

  // Bind events
  container.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Don't trigger if clicking a button
      if (e.target.closest("button")) return;
      const slug = card.dataset.slug;
      openEditor(slug);
    });
  });
  container.querySelectorAll(".btn-card-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(btn.dataset.slug);
    });
  });
  container.querySelectorAll(".btn-card-delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteArticle(btn.dataset.slug);
    });
  });
}

async function deleteArticle(slug) {
  let title = slug;
  if (currentTab === "posts") title = allPosts.find(p => p.slug === slug)?.title || slug;
  else if (currentTab === "essays") title = allEssays.find(e => e.slug === slug)?.title || slug;
  else if (currentTab === "gallery") title = allAlbums.find(a => a.id === slug)?.name || slug;
  else if (currentTab === "series") title = allSeries.find(s => s.id === slug)?.name || slug;
  const confirmed = await showConfirm(`确定删除「${esc(title)}」？此操作不可撤销。`);
  if (!confirmed) return;
  try {
    await api(`/api/${currentTab}/${slug}`, { method: "DELETE" });
    showToast("删除成功");
    await refresh();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// === Modal ===
function openModal(title, isNew = false) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-overlay").style.display = "flex";
  document.getElementById("btn-delete-modal").style.display = (isNew || currentTab === "spec") ? "none" : "";
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
}

// === Form builder ===
function buildForm(frontmatter = {}, body = "", photos = []) {
  const fm = frontmatter;
  const slug = fm.slug || "";
  const isSpec = currentTab === "spec";
  const isEssay = currentTab === "essays";
  const isGallery = currentTab === "gallery";

  if (currentTab === "series") {
    return `
    <div class="form-group">
      <label class="form-label">id <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="id" value="${esc(slug)}" placeholder="my-series">
    </div>
    <div class="form-group">
      <label class="form-label">名称 <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="name" value="${esc(fm.name || "")}" required>
    </div>
    <div class="form-group">
      <label class="form-label">描述</label>
      <input class="form-input" name="description" value="${esc(fm.description || "")}">
    </div>
    <div class="form-group">
      <label class="form-label">封面图</label>
      <input class="form-input" name="cover" value="${esc(fm.cover || "")}" placeholder="./cover.avif">
    </div>
    <div class="form-group">
      <label class="form-label">
        <input type="checkbox" name="draft" ${fm.draft ? "checked" : ""}> 草稿
      </label>
    </div>
    `;
  }

  if (isGallery) {
    return `
    <div class="form-group">
      <label class="form-label">id <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="id" value="${esc(slug)}" placeholder="my-album">
    </div>
    <div class="form-group">
      <label class="form-label">名称 <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="name" value="${esc(fm.name || "")}" required>
    </div>
    <div class="form-group">
      <label class="form-label">描述</label>
      <input class="form-input" name="description" value="${esc(fm.description || "")}">
    </div>
    <div class="form-group">
      <label class="form-label">日期</label>
      <input class="form-input" name="date" type="date" value="${fm.date ? fm.date.slice(0, 10) : ""}">
    </div>
    <div class="form-group">
      <label class="form-label">地点</label>
      <input class="form-input" name="location" value="${esc(fm.location || "")}">
    </div>
    <div class="form-group">
      <label class="form-label">标签</label>
      <div class="tag-input-wrap" id="tag-input-wrap">
        ${(fm.tags || []).map(t => `<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<span class="tag-remove">×</span></span>`).join("")}
        <input class="tag-input-inner" id="tag-input" placeholder="输入标签后按 Enter">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">封面图</label>
      <input class="form-input" name="cover" value="${esc(fm.cover || "")}" placeholder="留空则自动取 cover.* 或第一张">
    </div>
    <button type="button" class="collapse-toggle" id="collapse-toggle">加密设置 & 照片管理</button>
    <div class="collapse-content" id="collapse-content">
      <div class="form-group">
        <label class="form-label">访问密码</label>
        <input class="form-input" name="password" value="${esc(fm.password || "")}" placeholder="留空则不加密">
      </div>
      <div class="form-group">
        <label class="form-label">密码提示</label>
        <input class="form-input" name="passwordHint" value="${esc(fm.passwordHint || "")}" placeholder="密码错误时显示的提示">
      </div>
      <div class="form-group">
        <label class="form-label">照片列表 (${photos.length} 张)</label>
        <div style="max-height:200px;overflow-y:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;">
          ${photos.length === 0
            ? '<span style="color:#94a3b8">将图片放入 gallery/${esc(slug || "相册id")}/ 目录即可</span>'
            : photos.map(p => `<div style="padding:2px 0">🖼 ${esc(p)}</div>`).join("")}
        </div>
      </div>
    </div>
    `;
  }

  if (isEssay) {
    return `
    <div class="form-group">
      <label class="form-label">标题 <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="title" value="${esc(fm.title || "")}" required>
    </div>
    <div class="form-group">
      <label class="form-label">日期</label>
      <input class="form-input" name="published" type="date" value="${fm.published ? fm.published.slice(0, 10) : new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-group" style="display:none">
      <input class="form-input" name="description" value="">
    </div>
    <div class="form-group">
      <label class="form-label">正文 (Markdown)</label>
      <textarea class="form-textarea" name="body">${esc(body)}</textarea>
    </div>
    `;
  }

  return `
    <div class="form-group">
      <label class="form-label">标题 <span style="color:#ef4444">*</span></label>
      <input class="form-input" name="title" value="${esc(fm.title || "")}" required>
    </div>
    ${!isSpec ? `
    <div class="form-group">
      <label class="form-label">slug (留空自动生成)</label>
      <input class="form-input" name="slug" value="${esc(slug)}" placeholder="my-post">
    </div>
    <div class="form-group">
      <label class="form-label">简介</label>
      <input class="form-input" name="description" value="${esc(fm.description || "")}">
    </div>
    <div class="form-group">
      <label class="form-label">发布日期</label>
      <input class="form-input" name="published" type="date" value="${fm.published ? fm.published.slice(0, 10) : new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-group">
      <label class="form-label">标签</label>
      <div class="tag-input-wrap" id="tag-input-wrap">
        ${(fm.tags || []).map(t => `<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<span class="tag-remove">×</span></span>`).join("")}
        <input class="tag-input-inner" id="tag-input" placeholder="输入标签后按 Enter">
      </div>
      <div class="tag-suggestions" id="tag-suggestions">
        ${allTags.map(t => `<span data-tag="${esc(t.tag)}">${esc(t.tag)} (${t.count})</span>`).join("")}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">分类</label>
      <input class="form-input" name="category" list="category-list" value="${esc(fm.category || "")}" placeholder="输入或选择分类">
      <datalist id="category-list">${allCategories.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    </div>
    <div class="form-group">
      <label class="form-label">封面图</label>
      <input class="form-input" name="image" value="${esc(fm.image || "")}" placeholder="./cover.avif">
    </div>
    <button type="button" class="collapse-toggle" id="collapse-toggle">更多字段</button>
    <div class="collapse-content" id="collapse-content">
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" name="draft" ${fm.draft ? "checked" : ""}> 草稿
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" name="pinned" ${fm.pinned ? "checked" : ""}> 置顶
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" name="comment" ${fm.comment !== false ? "checked" : ""}> 开启评论
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">密码</label>
        <input class="form-input" name="password" value="${esc(fm.password || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">密码提示</label>
        <input class="form-input" name="passwordHint" value="${esc(fm.passwordHint || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">作者</label>
        <input class="form-input" name="author" value="${esc(fm.author || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">许可协议</label>
        <input class="form-input" name="licenseName" value="${esc(fm.licenseName || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">许可链接</label>
        <input class="form-input" name="licenseUrl" value="${esc(fm.licenseUrl || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">原文链接</label>
        <input class="form-input" name="sourceLink" value="${esc(fm.sourceLink || "")}">
      </div>
      <div class="form-group">
        <label class="form-label">更新日期</label>
        <input class="form-input" name="updated" type="date" value="${fm.updated ? fm.updated.slice(0, 10) : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}">
      </div>
      <div class="form-group">
        <label class="form-label">语言</label>
        <input class="form-input" name="lang" value="${esc(fm.lang || "")}" placeholder="zh-CN">
      </div>
      <div class="form-group">
        <label class="form-label">系列</label>
        <input class="form-input" name="series" list="series-list" value="${esc(fm.series || "")}" placeholder="选择或输入系列 id">
        <datalist id="series-list">${allSeries.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label">系列排序</label>
        <input class="form-input" name="seriesOrder" type="number" value="${fm.seriesOrder || ""}" placeholder="1">
      </div>
    </div>
    ` : ""}
    <div class="form-group">
      <label class="form-label">正文 (Markdown)
        <button type="button" class="btn btn-sm btn-secondary" id="btn-import-file" style="margin-left:8px">导入文件</button>
        <input type="file" id="file-import-input" accept=".md,.mdx,.txt,.markdown" style="display:none">
      </label>
      <textarea class="form-textarea ${isSpec ? '' : 'small'}" name="body" id="body-textarea">${esc(body)}</textarea>
    </div>
  `;
}

// === Tag input setup ===
function setupTagInput() {
  const wrap = document.getElementById("tag-input-wrap");
  const input = document.getElementById("tag-input");
  const suggestions = document.getElementById("tag-suggestions");
  if (!input) return;

  function getTags() {
    return [...wrap.querySelectorAll(".tag-chip")].map(c => c.dataset.tag);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !getTags().includes(val)) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.dataset.tag = val;
        chip.innerHTML = `${esc(val)}<span class="tag-remove">×</span>`;
        chip.querySelector(".tag-remove").addEventListener("click", () => chip.remove());
        input.before(chip);
      }
      input.value = "";
    }
  });

  // Existing chips remove
  wrap.querySelectorAll(".tag-remove").forEach(btn => {
    btn.addEventListener("click", () => btn.parentElement.remove());
  });

  // Suggest tags
  if (suggestions) {
    suggestions.querySelectorAll("span").forEach(s => {
      s.addEventListener("click", () => {
        const tag = s.dataset.tag;
        if (tag && !getTags().includes(tag)) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.dataset.tag = tag;
          chip.innerHTML = `${esc(tag)}<span class="tag-remove">×</span>`;
          chip.querySelector(".tag-remove").addEventListener("click", () => chip.remove());
          input.before(chip);
        }
      });
    });
  }
}

// === File import ===
function setupFileImport() {
  const btn = document.getElementById("btn-import-file");
  const input = document.getElementById("file-import-input");
  if (!btn || !input) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    input.click();
  });

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const parsed = parseMarkdownFile(text);
      // Fill form fields
      const fm = parsed.frontmatter;
      const titleFromFile = file.name.replace(/\.[^.]+$/, "");
      const elTitle = document.querySelector('[name="title"]');
      if (elTitle) elTitle.value = fm.title || titleFromFile;
      if (fm.description) { const el = document.querySelector('[name="description"]'); if (el) el.value = fm.description; }
      if (fm.tags && Array.isArray(fm.tags)) {
        // Clear existing chips and add new ones
        const wrap = document.getElementById("tag-input-wrap");
        const existingChips = wrap.querySelectorAll(".tag-chip");
        existingChips.forEach(c => c.remove());
        const tagInput = document.getElementById("tag-input");
        fm.tags.forEach(tag => {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.dataset.tag = tag;
          chip.innerHTML = `${esc(tag)}<span class="tag-remove">×</span>`;
          chip.querySelector(".tag-remove").addEventListener("click", () => chip.remove());
          tagInput.before(chip);
        });
      }
      if (fm.category) { const el = document.querySelector('[name="category"]'); if (el) el.value = fm.category; }
      if (fm.image) { const el = document.querySelector('[name="image"]'); if (el) el.value = fm.image; }
      if (fm.published) { const el = document.querySelector('[name="published"]'); if (el) el.value = fm.published; }
      if (fm.draft !== undefined) { const el = document.querySelector('[name="draft"]'); if (el) el.checked = fm.draft; }
      if (fm.pinned !== undefined) { const el = document.querySelector('[name="pinned"]'); if (el) el.checked = fm.pinned; }
      if (fm.author) { const el = document.querySelector('[name="author"]'); if (el) el.value = fm.author; }
      if (fm.password) { const el = document.querySelector('[name="password"]'); if (el) el.value = fm.password; }
      if (fm.passwordHint) { const el = document.querySelector('[name="passwordHint"]'); if (el) el.value = fm.passwordHint; }
      // Set body
      const bodyEl = document.getElementById("body-textarea");
      if (bodyEl) bodyEl.value = parsed.body;
      showToast(`已导入: ${file.name}`);
    };
    reader.readAsText(file);
    input.value = ""; // allow re-importing same file
  });
}

/** Parse a markdown file with optional YAML frontmatter */
function parseMarkdownFile(text) {
  const fm = {};
  let body = text;
  // Check for frontmatter delimited by ---
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (match) {
    const yamlBlock = match[1];
    body = text.slice(match[0].length);
    // Parse simple YAML key: value pairs
    let currentKey = null;
    yamlBlock.split("\n").forEach(line => {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2].trim();
        if (val === "true") fm[currentKey] = true;
        else if (val === "false") fm[currentKey] = false;
        else if (val === "" || val === "null") fm[currentKey] = null;
        else if (val.startsWith("[") && val.endsWith("]")) {
          fm[currentKey] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
        } else {
          fm[currentKey] = val.replace(/^["']|["']$/g, "");
        }
      }
    });
  }
  return { frontmatter: fm, body: body.trimStart() };
}

// === Open editor ===
async function openEditor(slug) {
  let frontmatter = {}, body = "", existingSlug = "", galleryPhotos = [];
  if (slug) {
    try {
      const data = await api(`/api/${currentTab}/${slug}`);
      frontmatter = data.frontmatter;
      body = data.body;
      existingSlug = (currentTab === "gallery" || currentTab === "series") ? data.id : data.slug;
      if (currentTab === "gallery") {
        frontmatter.id = existingSlug;
        galleryPhotos = data.photos || [];
      } else if (currentTab === "series") {
        frontmatter.id = existingSlug;
      } else {
        frontmatter.slug = existingSlug;
      }
    } catch (e) {
      showToast(e.message, "error");
      return;
    }
  }

  const isNew = !slug;
  openModal(isNew ? "新建" : "编辑", isNew);
  const modalBody = document.getElementById("modal-body");
  modalBody.innerHTML = buildForm(frontmatter, body, galleryPhotos);
  document.getElementById("modal").dataset.slug = existingSlug;
  document.getElementById("modal").dataset.isNew = isNew;

  // Tag input logic
  setupTagInput();

  // File import
  setupFileImport();

  // Collapse toggle
  const collapseToggle = document.getElementById("collapse-toggle");
  const collapseContent = document.getElementById("collapse-content");
  if (collapseToggle) {
    collapseToggle.addEventListener("click", () => {
      collapseToggle.classList.toggle("open");
      collapseContent.classList.toggle("open");
    });
  }
}

// === Save article ===
async function saveArticle() {
  const modal = document.getElementById("modal");
  const isNew = modal.dataset.isNew === "true";
  const oldSlug = modal.dataset.slug;

  // Gather form data
  const modalBody = document.getElementById("modal-body");

  // Build frontmatter from inputs
  const frontmatter = {};
  modalBody.querySelectorAll("input[name], textarea[name]").forEach(el => {
    if (el.type === "checkbox") {
      frontmatter[el.name] = el.checked;
    } else if (el.name === "body") {
      // handled separately
    } else if (el.name === "published") {
      if (el.value) frontmatter.published = el.value;
    } else if (el.value) {
      frontmatter[el.name] = el.value;
    }
  });

  // Get tags from chips
  const chips = modalBody.querySelectorAll(".tag-chip");
  if (chips.length > 0) {
    frontmatter.tags = [...chips].map(c => c.dataset.tag || c.textContent.replace("×", "").trim());
  }

  const body = modalBody.querySelector("textarea[name='body']")?.value || "";

  const isGallery = currentTab === "gallery";

  if (isGallery) {
    if (!frontmatter.name) { showToast("缺少必填字段: 名称", "error"); return; }
    const id = frontmatter.id || frontmatter.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    delete frontmatter.id; // id goes in URL, not frontmatter
    try {
      if (isNew) {
        await api(`/api/gallery`, { method: "POST", body: JSON.stringify({ id, frontmatter, body: "" }) });
        showToast("创建成功");
      } else {
        await api(`/api/gallery/${oldSlug}`, {
          method: "PUT", body: JSON.stringify({ id, frontmatter, body: "" }),
        });
        showToast("保存成功");
      }
      closeModal();
      await refresh();
    } catch (e) { showToast(e.message, "error"); }
    return;
  }

  if (currentTab === "series") {
    if (!frontmatter.name) { showToast("缺少必填字段: 名称", "error"); return; }
    const id = frontmatter.id || frontmatter.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    delete frontmatter.id; // id goes in URL, not frontmatter
    try {
      if (isNew) {
        await api(`/api/series`, { method: "POST", body: JSON.stringify({ id, frontmatter, body: "" }) });
        showToast("创建成功");
      } else {
        await api(`/api/series/${oldSlug}`, {
          method: "PUT", body: JSON.stringify({ id, frontmatter, body: "" }),
        });
        showToast("保存成功");
      }
      closeModal();
      await refresh();
    } catch (e) { showToast(e.message, "error"); }
    return;
  }

  if (!frontmatter.title) {
    showToast("缺少必填字段: 标题", "error");
    return;
  }

  // Auto-generate slug for new posts
  let newSlug = frontmatter.slug;
  if (!newSlug && currentTab !== "spec") {
    newSlug = frontmatter.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  try {
    if (isNew) {
      await api(`/api/${currentTab}`, {
        method: "POST",
        body: JSON.stringify({ frontmatter, body, slug: newSlug }),
      });
      showToast("创建成功");
    } else {
      await api(`/api/${currentTab}/${oldSlug}`, {
        method: "PUT",
        body: JSON.stringify({ frontmatter, body, slug: newSlug }),
      });
      showToast("保存成功");
    }
    closeModal();
    await refresh();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function refresh() {
  try {
    await loadList(currentTab);
    if (currentTab === "posts") {
      await loadTags();
      await loadCategories();
      allSeries = await api("/api/series"); // load series for post form datalist
    }
    if (currentTab === "series") {
      // Series doesn't need tags/categories
    }
    renderList();
  } catch (e) {
    showToast(`加载失败: ${e.message}`, "error");
  }
}

// === Delete from modal ===
async function deleteFromModal() {
  const modal = document.getElementById("modal");
  const slug = modal.dataset.slug;
  if (!slug) return;
  const confirmed = await showConfirm(`确定删除当前正在编辑的文章？此操作不可撤销。`);
  if (!confirmed) return;
  try {
    await api(`/api/${currentTab}/${slug}`, { method: "DELETE" });
    showToast("删除成功");
    closeModal();
    await refresh();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// === Tab switching ===
document.getElementById("tab-bar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  currentTab = tab.dataset.tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  // Update new button text
  const btnNew = document.getElementById("btn-new");
  const btnOrganize = document.getElementById("btn-organize");
  if (currentTab === "spec") {
    btnNew.style.display = "none";
    btnOrganize.style.display = "none";
  } else if (currentTab === "gallery") {
    btnNew.style.display = "";
    btnNew.textContent = "+ 新建相册";
    btnOrganize.style.display = "none";
  } else if (currentTab === "series") {
    btnNew.style.display = "";
    btnNew.textContent = "+ 新建系列";
    btnOrganize.style.display = "none";
  } else {
    btnNew.style.display = "";
    btnNew.textContent = `+ 新建${currentTab === "posts" ? "文章" : "随笔"}`;
    btnOrganize.style.display = currentTab === "posts" ? "" : "none";
  }
  refresh();
});

// === New article ===
document.getElementById("btn-new").addEventListener("click", () => openEditor(null));

// === Modal buttons ===
document.getElementById("btn-save").addEventListener("click", saveArticle);
document.getElementById("btn-cancel").addEventListener("click", closeModal);
document.getElementById("btn-close").addEventListener("click", closeModal);
document.getElementById("btn-delete-modal").addEventListener("click", deleteFromModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});

// === Filter ===
document.getElementById("filter-draft").addEventListener("change", renderList);
document.getElementById("search-input").addEventListener("input", renderList);

// === Organize by category ===
document.getElementById("btn-organize").addEventListener("click", async () => {
  try {
    const data = await api("/api/organize");
    if (data.totalMoves === 0) {
      showToast("所有文章已按分类整理好，无需移动");
      return;
    }
    const preview = data.plan.map(p =>
      `${p.title}  →  posts/${p.category}/${p.slug}`
    ).join("\n");
    const confirmed = await showConfirm(
      `将移动 ${data.totalMoves} 篇文章到对应分类文件夹：\n\n${preview}\n\n文章的 slug 已写入 frontmatter，URL 不会改变。`,
      "按分类整理",
      "确定整理"
    );
    if (!confirmed) return;
    const result = await api("/api/organize", {
      method: "POST",
      body: JSON.stringify({ execute: true }),
    });
    const moved = result.results.filter(r => r.status === "moved").length;
    const failed = result.results.filter(r => r.status === "failed").length;
    showToast(`整理完成：移动 ${moved} 篇${failed ? `，失败 ${failed} 篇` : ""}`);
    await refresh();
  } catch (e) {
    showToast(e.message, "error");
  }
});

// === Push ===
document.getElementById("btn-push").addEventListener("click", async () => {
  const message = prompt("Commit message:", "update content");
  if (message === null) return; // cancelled
  showToast("推送中...");
  try {
    const res = await api("/api/push", {
      method: "POST",
      body: JSON.stringify({ message: message || "update content" }),
    });
    showToast(res.output || "推送成功");
  } catch (e) {
    showToast(e.message, "error");
  }
});

// === Init ===
async function init() {
  document.getElementById("btn-organize").style.display = "";
  await refresh();
}

init();
