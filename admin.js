const state = { content: null, letterUnlocked: false };
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

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function deriveLetterKey(password, saltBytes, iterations = 180000, usage = ["encrypt", "decrypt"]) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function encryptLetterBody(body, password) {
  const iterations = 180000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveLetterKey(password, salt, iterations, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(body),
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptLetterBody(encryptedBody, password) {
  const key = await deriveLetterKey(
    password,
    base64ToBytes(encryptedBody.salt),
    encryptedBody.iterations,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encryptedBody.iv) },
    key,
    base64ToBytes(encryptedBody.ciphertext),
  );
  return new TextDecoder().decode(decrypted);
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
  state.letterUnlocked = !state.content.letter?.encryptedBody;
  renderForm();
  setStatus("已读取线上内容。修改后点击“保存并更新网站”。");
}

function renderForm() {
  $$('[data-path]').forEach((input) => {
    if (input.dataset.path === "letter.body") {
      const encryptedBody = state.content.letter?.encryptedBody;
      input.value = encryptedBody && !state.letterUnlocked ? "" : getByPath(state.content, "letter.body") || "";
      input.placeholder = encryptedBody && !state.letterUnlocked
        ? "信件已加密。输入密码并点击“解锁信件正文”后再编辑。"
        : "在这里写完整信件正文。保存时会用上方密码加密。";
      return;
    }
    input.value = getByPath(state.content, input.dataset.path) || "";
  });
  $("#repoInput").value = state.content.admin?.repository || "Carrol-Shield/film-journey-letter";
  $("#branchInput").value = state.content.admin?.branch || "main";
  renderTimelineEditor();
}

function readSimpleFields() {
  $$('[data-path]').forEach((input) => {
    if (input.dataset.path === "letter.body") return;
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
    renderPhotoEditor($(".photo-editor", node), item);
    container.append(node);
  });
}

function renderPhotoEditor(container, item) {
  const template = $("#photoTemplate");
  container.innerHTML = "";
  (item.photos || []).forEach((photo, photoIndex) => {
    const node = template.content.firstElementChild.cloneNode(true);
    $('[data-field="src"]', node).value = photo.src || "";
    $('[data-field="alt"]', node).value = photo.alt || "";
    $(".remove-photo", node).addEventListener("click", () => {
      item.photos.splice(photoIndex, 1);
      renderTimelineEditor();
    });
    container.append(node);
  });
}

function readTimelineEditor() {
  const cards = $$(".timeline-card");
  state.content.timeline = cards.map((card) => {
    const item = { photos: [] };
    $$(':scope > .grid [data-field], :scope > label [data-field]', card).forEach((input) => {
      const field = input.dataset.field;
      if (field === "reverse") item.reverse = input.checked;
      else item[field] = input.value;
    });
    $$(".photo-row", card).forEach((row) => {
      const photo = {
        src: $('[data-field="src"]', row).value,
        alt: $('[data-field="alt"]', row).value,
      };
      const file = $('[data-field="file"]', row).files[0];
      if (file) photo.file = file;
      item.photos.push(photo);
    });
    return item;
  });
}

async function unlockLetterBody() {
  const encryptedBody = state.content.letter?.encryptedBody;
  const textarea = $('[data-path="letter.body"]');
  if (!encryptedBody) {
    state.letterUnlocked = true;
    textarea.value = state.content.letter?.body || textarea.value || "";
    setStatus("当前信件尚未加密，可以直接编辑正文。保存时会用信件密码加密。");
    return;
  }

  const password = $("#letterPasswordInput").value;
  if (!password) throw new Error("请先输入信件密码。");

  try {
    const body = await decryptLetterBody(encryptedBody, password);
    state.content.letter.body = body;
    state.letterUnlocked = true;
    textarea.value = body;
    textarea.placeholder = "已解锁，可以编辑正文。保存时会重新加密。";
    setStatus("信件正文已解锁，可以编辑。保存时会重新加密。");
  } catch (error) {
    throw new Error("信件密码不正确，无法解锁正文。");
  }
}

async function prepareEncryptedLetter() {
  state.content.letter = state.content.letter || {};
  const textarea = $('[data-path="letter.body"]');
  const password = $("#letterPasswordInput").value;
  const existingEncryptedBody = state.content.letter.encryptedBody;

  if (!state.letterUnlocked && existingEncryptedBody) {
    delete state.content.letter.body;
    return;
  }

  const body = textarea.value;
  if (!password) throw new Error("保存信件正文前，请输入信件密码 260111。");
  state.content.letter.encryptedBody = await encryptLetterBody(body, password);
  delete state.content.letter.body;
}

async function saveContent() {
  try {
    readSimpleFields();
    readTimelineEditor();
    setStatus("正在加密信件正文...");
    await prepareEncryptedLetter();

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
$("#unlockLetterBody").addEventListener("click", () => unlockLetterBody().catch((error) => setStatus(error.message)));

loadContent().catch((error) => setStatus(error.message));