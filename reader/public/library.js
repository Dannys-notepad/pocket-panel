const grid = document.getElementById("grid");

async function load() {
  const res = await fetch("/api/manifest.json");
  const data = await res.json();

  if (!data.length) {
    grid.innerHTML = `<p class="empty">No series found. Run the scraper first.</p>`;
    return;
  }

  grid.innerHTML = data.map(s => `
    <a class="card" href="/series.html?s=${encodeURIComponent(s.slug)}">
      <div class="thumb">
        ${s.cover ? `<img src="${s.cover}" loading="lazy" alt="${s.name}">` : `<div class="no-cover">No cover</div>`}
      </div>
      <div class="card-body">
        <h3>${s.name}</h3>
        <p>${s.chapters.length} chapter${s.chapters.length === 1 ? "" : "s"}</p>
      </div>
    </a>
  `).join("");
}

document.getElementById("refresh").addEventListener("click", async () => {
  await fetch("/api/refresh");
  load();
});

load();