const openLetterButton = document.querySelector("#openLetter");
const closeLetterButton = document.querySelector("#closeLetter");
const letterModal = document.querySelector("#letterModal");
const letterContent = document.querySelector("#letterContent");
const photoLightbox = document.querySelector("#photoLightbox");
const closePhotoButton = document.querySelector("#closePhoto");
const lightboxImage = document.querySelector("#lightboxImage");

const fallbackLetter = `有些话先放在这里，等你把真正想写的内容填进 loveletter.txt。

我想把一路上那些很小的瞬间都记下来：一起停下来的街口，照片里没有拍完整的天空，还有音乐响起时忽然安静下来的心情。

谢谢你出现在这些日子里。愿以后每一次普通的出发，都能因为彼此在身边，变成值得收藏的旅行。

一直想念你的人`;

let lastFocusedElement = null;

async function loadLetter() {
  try {
    const response = await fetch("loveletter.txt", { cache: "no-store" });
    if (!response.ok) throw new Error("Letter file is unavailable.");
    const text = (await response.text()).trim();
    letterContent.textContent = text || fallbackLetter;
  } catch (error) {
    letterContent.textContent = fallbackLetter;
  }
}

function openLetter() {
  lastFocusedElement = document.activeElement;
  letterModal.classList.add("is-open");
  letterModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  loadLetter();
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

document.querySelectorAll(".photo-strip img").forEach((image) => {
  image.tabIndex = 0;
  image.addEventListener("click", () => openPhoto(image));
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPhoto(image);
    }
  });
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