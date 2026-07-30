const state = { content: null, photoFiles: new Map() };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const statusEl = $("#status");

function setStatus(message) {
  statusEl.textContent = message;
}

function getByPath(object, path) {
  return path.split(".").reduce((target, key) => (target ? target[key] : undefined), object);
}

function setByPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key]) target[key] = {};
    target = target[key];
  });
  target[keys[keys.length - 1]] = value;
}

function slugFileName(name) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : "jpg";
  const base = parts.join(".") || "photo";
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
  return `${Date.now()}-${safe}.${ext}`;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function githubHeaders() {
  const token = $("#tokenInput").value.trim();
  if (!token) throw new Error("请先粘贴 GitHub token。需要 Contents: Read and write 权限。");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoInfo() {
  const repo = $("#repoInput").value.trim();
  const branch = $("#branchInput").value.trim() || "main";
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error("仓库格式应为 owner/name，例如 Carrol-Shield/film-journey-letter。");
  return { repo, branch };
}

async function githubRequest(path, options = {}) {
  const { repo } = repoInfo();
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...options,
    headers: { ...githubHeaders(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const error = await response.json();
      detail = error.message ? `：${error.message}` : "";
    } catch {}
    throw new Error(`GitHub 请求失败 ${response.status}${detail}`);
  }
  return response.json();
}

async function getContentSha(path) {
  const { branch } = repoInfo();
  try {
    const data = await githubRequest(`contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
    return data.sha;
  } catch (error) {
    if (String(error.message).includes("404")) return null;
    throw error;
  }
}

async function putFile(path, base64Content, message, sha = null) {
  const { branch } = repoInfo();
  const body = { message, content: base64Content, branch };
  if (sha) body.sha = sha;
  return githubRequest(`contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function uploadPhoto(file) {
  const filename = slugFileName(file.name);
  const path = `photos/${filename}`;
  const content = await fileToBase64(file);
  await putFile(path, content, `Upload ${filename}`);
  return path;
}

async function loadContent() {
  setStatus("正在读取 content.json...");
  const response = await fetch(`content.json?ts=${Date.now()}`);
  if (!response.ok) throw new Error("读取 content.json 失败。请确认网站已经发布。");
  state.content = await response.json();
  state.photoFiles.clear();
  renderForm();
  setStatus("已读取线上内容。修改后点击“保存并更新网站”。");
}

function renderForm() {
  $$('[data-path]').forEach((input) => {
    input.value = getByPath(state.content, input.dataset.path) || "";
  });
  $("#repoInput").value = state.content.admin?.repository || "Carrol-Shield/film-journey-letter";
  $("#branchInput").value = state.content.admin?.branch || "main";
  renderTimelineEditor();
}

function readSimpleFields() {
  $$('[data-path]').forEach((input) => {
    setByPath(state.content, input.dataset.path, input.value);
  });
  state.content.admin = {
    repository: $("#repoInput").value.trim(),
    branch: $("#branchInput").value.trim() || "main",
  };
}

function renderTimelineEditor() {
  const container = $("#timelineEditor");
  const template = $("#timelineTemplate");
  container.innerHTML = "";
  (state.content.timeline || []).forEach((item, itemIndex) => {
    const node = template.content.firstElementChild.cloneNode(true);
    $(".item-title", node).textContent = `${item.id || String(itemIndex + 1).padStart(2, "0")} · ${item.place || "未命名地点"}`;
    $$('[data-field]', node).forEach((input) => {
      const field = input.dataset.field;
      if (field === "reverse") input.checked = Boolean(item.reverse);
      else if (field !== "file") input.value = item[field] || "";
    });
    $(".remove-item", node).addEventListener("click", () => {
      state.content.timeline.splice(itemIndex, 1);
      renderTimelineEditor();
    });
    $(".add-photo", node).addEventListener("click", () => {
      item.photos = item.photos || [];
      item.photos.push({ src: "", alt: "" });
      renderTimelineEditor();
    });
    renderPhotoEditor($(".photo-editor", node), item, itemIndex);
    container.append(node);
  });
}

function renderPhotoEditor(container, item, itemIndex) {
  const template = $("#photoTemplate");
  container.innerHTML = "";
  (item.photos || []).forEach((photo, photoIndex) => {
    const node = template.content.firstElementChild.cloneNode(true);
    $('[data-field="src"]', node).value = photo.src || "";
    $('[data-field="alt"]', node).value = photo.alt || "";
    const fileInput = $('[data-field="file"]', node);
    const key = `${itemIndex}-${photoIndex}`;
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) state.photoFiles.set(key, fileInput.files[0]);
      else state.photoFiles.delete(key);
    });
    $(".remove-photo", node).addEventListener("click", () => {
      item.photos.splice(photoIndex, 1);
      renderTimelineEditor();
    });
    container.append(node);
  });
}

function readTimelineEditor() {
  const cards = $$(".timeline-card");
  state.content.timeline = cards.map((card, itemIndex) => {
    const item = { photos: [] };
    $$(':scope > .grid [data-field], :scope > label [data-field]', card).forEach((input) => {
      const field = input.dataset.field;
      if (field === "reverse") item.reverse = input.checked;
      else item[field] = input.value;
    });
    $$(".photo-row", card).forEach((row, photoIndex) => {
      const photo = {
        src: $('[data-field="src"]', row).value,
        alt: $('[data-field="alt"]', row).value,
      };
      const key = `${itemIndex}-${photoIndex}`;
      if (state.photoFiles.has(key)) photo.file = state.photoFiles.get(key);
      item.photos.push(photo);
    });
    return item;
  });
}

async function saveContent() {
  try {
    readSimpleFields();
    readTimelineEditor();
    setStatus("正在上传新照片...");
    let uploadCount = 0;
    for (const item of state.content.timeline) {
      for (const photo of item.photos || []) {
        if (photo.file) {
          photo.src = await uploadPhoto(photo.file);
          delete photo.file;
          uploadCount += 1;
          setStatus(`已上传 ${uploadCount} 张照片，继续保存内容...`);
        }
      }
    }

    setStatus("正在更新 content.json...");
    const contentSha = await getContentSha("content.json");
    const cleanContent = JSON.parse(JSON.stringify(state.content));
    const json = JSON.stringify(cleanContent, null, 2) + "\n";
    await putFile("content.json", utf8ToBase64(json), "Update site content", contentSha);
    setStatus("保存成功。GitHub Pages 正在自动更新，通常几十秒后刷新公开页面即可看到新内容。\n\n公开页面：https://carrol-shield.github.io/film-journey-letter/");
    state.photoFiles.clear();
  } catch (error) {
    setStatus(`保存失败：${error.message}`);
  }
}

$("#addTimeline").addEventListener("click", () => {
  state.content.timeline = state.content.timeline || [];
  state.content.timeline.push({
    id: String(state.content.timeline.length + 1).padStart(2, "0"),
    date: "",
    place: "新地点",
    text: "",
    reverse: false,
    photos: [],
  });
  renderTimelineEditor();
});
$("#reloadContent").addEventListener("click", () => loadContent().catch((error) => setStatus(error.message)));
$("#saveContent").addEventListener("click", saveContent);

loadContent().catch((error) => setStatus(error.message));