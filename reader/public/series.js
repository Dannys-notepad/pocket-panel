const params = new URLSearchParams(location.search);
const slug = params.get("s");
const list = document.getElementById("chapters");
const titleEl = document.getElementById("title");

async function load() {
  const res = await fetch("/api/manifest.json");
  const data = await res.json();
  const series = data.find(s => s.slug === slug);
  if (!series) {
    list.innerHTML = `<p class="empty">Series not found.</p>`;
    return;
  }
  document.title = series.name;
  titleEl.textContent = series.name;

  // reverse order — newest first, like webtoon sites
  const chapters = [...series.chapters].sort((a, b) => b.number - a.number);

  list.innerHTML = chapters.map(c => {
    const progress = localStorage.getItem(`progress:${series.slug}:${c.id}`);
    const read = progress ? ` <span class="read">✓</span>` : "";
    return `
      <a class="chapter-item" href="/reader.html?s=${encodeURIComponent(series.slug)}&c=${encodeURIComponent(c.id)}">
        <span>${c.name}</span>
        <span class="pages">${c.pages.length} pages${read}</span>
      </a>
    `;
  }).join("");
}

load();