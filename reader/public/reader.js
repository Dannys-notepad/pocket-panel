const params = new URLSearchParams(location.search);
const slug = params.get("s");
const chapterId = params.get("c");

const pagesEl = document.getElementById("pages");
const progressEl = document.getElementById("progress");
const back = document.getElementById("back");
const prevBtn = document.getElementById("prevCh");
const nextBtn = document.getElementById("nextCh");
const fitBtn = document.getElementById("toggleFit");

let series, chapters, currentIndex, pages = [], currentPage = 0;

async function load() {
  const res = await fetch("/api/manifest.json");
  const data = await res.json();
  series = data.find(s => s.slug === slug);
  if (!series) return;
  chapters = [...series.chapters].sort((a, b) => a.number - b.number);
  currentIndex = chapters.findIndex(c => c.id === chapterId);
  if (currentIndex < 0) currentIndex = 0;

  document.title = `${series.name} — ${chapters[currentIndex].name}`;
  back.href = `/series.html?s=${encodeURIComponent(slug)}`;

  // fit mode from localStorage
  const fit = localStorage.getItem("reader:fit") ?? "fit-width";
  pagesEl.className = `pages ${fit}`;
  fitBtn.textContent = fit === "fit-width" ? "📐 Fit width" : "📐 Original";

  renderChapter(currentIndex);
}

function renderChapter(idx) {
  const ch = chapters[idx];
  pages = ch.pages;
  currentPage = 0;
  pagesEl.innerHTML = pages.map((p, i) => `
    <img
      src="${p.url}"
      loading="${i < 3 ? "eager" : "lazy"}"
      decoding="async"
      data-index="${i}"
      alt="page ${i + 1}"
    />
  `).join("");

  progressEl.textContent = `1 / ${pages.length}`;

  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= chapters.length - 1;

  // mark read
  localStorage.setItem(`progress:${slug}:${ch.id}`, "read");

  // scroll top
  window.scrollTo(0, 0);

  // scroll observer
  const imgs = [...pagesEl.querySelectorAll("img")];
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        currentPage = Number(e.target.dataset.index) + 1;
        progressEl.textContent = `${currentPage} / ${pages.length}`;
      }
    }
  }, { rootMargin: "-40% 0px -40% 0px" });
  imgs.forEach(img => io.observe(img));
}

function goChapter(delta) {
  const next = currentIndex + delta;
  if (next < 0 || next >= chapters.length) return;
  const url = new URL(location.href);
  url.searchParams.set("c", chapters[next].id);
  location.href = url.toString();
}

prevBtn.addEventListener("click", () => goChapter(-1));
nextBtn.addEventListener("click", () => goChapter(1));

fitBtn.addEventListener("click", () => {
  const cur = pagesEl.classList.contains("fit-width") ? "original" : "fit-width";
  pagesEl.className = `pages ${cur}`;
  localStorage.setItem("reader:fit", cur);
  fitBtn.textContent = cur === "fit-width" ? "📐 Fit width" : "📐 Original";
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") goChapter(-1);
  if (e.key === "ArrowRight") goChapter(1);
  if (e.key === "f" || e.key === "F") fitBtn.click();
  if (e.key === " " || e.key === "PageDown") {
    e.preventDefault();
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
  }
  if (e.key === "PageUp") {
    e.preventDefault();
    window.scrollBy({ top: -window.innerHeight * 0.9, behavior: "smooth" });
  }
});

load();