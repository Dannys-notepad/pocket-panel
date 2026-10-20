import { Komikku } from "@weismanns/komikku";

const args = process.argv.slice(2);
const QUERY = args[0];

if (!QUERY || !QUERY.trim()) {
  console.error("Usage: npm run search -- \"<Search Term>\"");
  console.error("Example: npm run search -- \"Solo Leveling\"");
  process.exit(1);
}

async function main() {
  const komikku = new Komikku();
  
  console.log(`Searching for "${QUERY}" on DemonicScans...\n`);
  
  const results = await komikku.search(QUERY, {
    providers: ["Demonicscans"],
    limitManga: 10, // Show up to 10 results
  });

  if (!results.length) {
    console.log(`❌ No results found for "${QUERY}".`);
    console.log(`Tip: Try a shorter search term (e.g., "Solo" instead of "Solo Leveling").`);
    process.exit(0);
  }

  console.log(`✅ Found ${results.length} result(s):\n`);
  
  for (const manga of results) {
    console.log(`Title:  ${manga.title}`);
    console.log(`URL:    https://demonicscans.org${manga.url}`);
    console.log(`Status: ${manga.status || "Unknown"}`);
    console.log("-".repeat(40));
  }
}

main().catch(err => {
  console.error("Search failed:", err);
  process.exit(1);
});