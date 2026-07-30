const fallbackContent = {
  meta: {
    title: "给你的胶片旅行",
    description: "一页关于音乐、照片、时间轴和一封信的温柔纪念网页。",
  },
  hero: {
    eyebrow: "Our Little Journey",
    title: "给你的胶片旅行",
    subtitle: "把音乐、城市、照片和想说的话收进同一页。",
    musicLabel: "灰色",
    musicSrc: "gray.mp3",
  },
  timeline: [],
  letter: {
    sectionEyebrow: "A Letter",
    sectionTitle: "还有一封想慢慢读给你的信",
    buttonText: "打开这封信",
    paperDate: "写给你",
    dialogTitle: "亲爱的你",
    body: "亲爱的你：\n\n这里先放一封示例信。",
  },
};

let pageContent = fallbackContent;
let lastFocusedElement = null;

const $ = (selector) => document.querySelector(selector);
const timelineEl = $("#timeline");
const openLetterButton = $("#openLetter");
const closeLetterButton = $("#closeLetter");
const letterModal = $("#letterModal");
const letterContent = $("#letterContent");
const photoLightbox = $("#photoLightbox");
const closePhotoButton = $("#closePhoto");
const lightboxImage = $("#lightboxImage");

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value || "";
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveLetterKey(password, saltBase64, iterations = 180000) {
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
      salt: base64ToBytes(saltBase64),
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function decryptLetter(encryptedBody, password) {
  const key = await deriveLetterKey(password, encryptedBody.salt, encryptedBody.iterations);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encryptedBody.iv) },
    key,
    base64ToBytes(encryptedBody.ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

function renderTimeline(items = []) {
  timelineEl.innerHTML = "";
  items.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "timeline-item";

    const marker = document.createElement("div");
    marker.className = "time-mark";
    const number = document.createElement("span");
    number.textContent = text(item.id, String(index + 1).padStart(2, "0"));
    marker.append(number);

    const story = document.createElement("div");
    story.className = "story";
    story.innerHTML = `
      <p class="date"></p>
      <h2></h2>
      <p class="story-copy"></p>
      <div class="photo-strip${item.reverse ? " photo-strip--reverse" : ""}"></div>
    `;
    story.querySelector(".date").textContent = item.date || "";
    story.querySelector("h2").textContent = item.place || "";
    story.querySelector(".story-copy").textContent = item.text || "";

    const strip = story.querySelector(".photo-strip");
    (item.photos || []).forEach((photo) => {
      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.src = photo.src || "";
      img.alt = photo.alt || item.place || "旅行照片";
      img.tabIndex = 0;
      img.addEventListener("click", () => openPhoto(img));
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPhoto(img);
        }
      });
      figure.append(img);
      strip.append(figure);
    });

    article.append(marker, story);
    timelineEl.append(article);
  });
}

function renderContent(content) {
  pageContent = content;
  document.title = text(content.meta?.title, fallbackContent.meta.title);
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = text(content.meta?.description, fallbackContent.meta.description);

  setText("#heroEyebrow", text(content.hero?.eyebrow, fallbackContent.hero.eyebrow));
  setText("#page-title", text(content.hero?.title, fallbackContent.hero.title));
  setText("#heroText", text(content.hero?.subtitle, fallbackContent.hero.subtitle));
  setText("#musicLabel", text(content.hero?.musicLabel, fallbackContent.hero.musicLabel));
  const source = $("#musicSource");
  const audio = $("#musicAudio");
  if (source && audio) {
    const nextSrc = text(content.hero?.musicSrc, fallbackContent.hero.musicSrc);
    if (source.getAttribute("src") !== nextSrc) {
      source.setAttribute("src", nextSrc);
      audio.load();
    }
  }

  renderTimeline(content.timeline || []);
  setText("#letterEyebrow", text(content.letter?.sectionEyebrow, fallbackContent.letter.sectionEyebrow));
  setText("#letter-title", text(content.letter?.sectionTitle, fallbackContent.letter.sectionTitle));
  setText("#openLetter", text(content.letter?.buttonText, fallbackContent.letter.buttonText));
  setText("#paperDate", text(content.letter?.paperDate, fallbackContent.letter.paperDate));
  setText("#letterDialogTitle", text(content.letter?.dialogTitle, fallbackContent.letter.dialogTitle));
}

async function loadContent() {
  try {
    const response = await fetch("content.json", { cache: "no-store" });
    if (!response.ok) throw new Error("content.json unavailable");
    renderContent(await response.json());
  } catch (error) {
    renderContent(fallbackContent);
  }
}

async function getLetterBody() {
  const encryptedBody = pageContent.letter?.encryptedBody;
  if (!encryptedBody) {
    return text(pageContent.letter?.body, fallbackContent.letter.body);
  }

  const password = window.prompt("请输入信件密码");
  if (password === null) return null;

  try {
    return await decryptLetter(encryptedBody, password);
  } catch (error) {
    window.alert("密码不正确，暂时不能打开这封信。");
    return null;
  }
}

async function openLetter() {
  const body = await getLetterBody();
  if (body === null) return;

  lastFocusedElement = document.activeElement;
  letterModal.classList.add("is-open");
  letterModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  letterContent.textContent = body;
  closeLetterButton.focus();
}

function closeLetter() {
  letterModal.classList.remove("is-open");
  letterModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (lastFocusedElement) lastFocusedElement.focus();
}

function openPhoto(image) {
  lightboxImage.src = image.currentSrc || image.src;
  lightboxImage.alt = image.alt;
  photoLightbox.classList.add("is-open");
  photoLightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  closePhotoButton.focus();
}

function closePhoto() {
  photoLightbox.classList.remove("is-open");
  photoLightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lightboxImage.removeAttribute("src");
}

openLetterButton.addEventListener("click", openLetter);
closeLetterButton.addEventListener("click", closeLetter);
letterModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-letter]")) closeLetter();
});
closePhotoButton.addEventListener("click", closePhoto);
photoLightbox.addEventListener("click", (event) => {
  if (event.target === photoLightbox) closePhoto();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (letterModal.classList.contains("is-open")) closeLetter();
  if (photoLightbox.classList.contains("is-open")) closePhoto();
});

loadContent();