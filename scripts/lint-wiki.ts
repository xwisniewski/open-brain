/**
 * lint-wiki.ts
 *
 * Audits the wiki/ directory for:
 *   - Broken wikilinks (references to pages that don't exist)
 *   - Orphaned pages (exist but aren't linked from anywhere)
 *
 * Run: npm run lint
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../.env.local") });

const VAULT = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.env.HOME!, "Desktop/Second Brain Vault");
const WIKI_DIR = path.join(VAULT, "wiki");

export interface LintReport {
  totalPages: number;
  totalLinks: number;
  brokenLinks: Array<{ page: string; link: string }>;
  orphanedPages: string[];
}

function getAllMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getAllMdFiles(full));
    else if (entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

function pageKey(filePath: string): string {
  return path.relative(WIKI_DIR, filePath).replace(/\.md$/, "");
}

function extractWikilinks(content: string): string[] {
  // Matches [[Target]] and [[Target|Display Text]]
  const matches = [...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g)];
  return matches.map((m) => m[1].trim());
}

// Resolve a wikilink target against the known page key set.
// Obsidian resolves unqualified names by searching all subdirectories.
function resolveLink(link: string, pageKeys: Set<string>): string | null {
  if (pageKeys.has(link)) return link;
  // Try subdirectory-qualified match
  for (const key of pageKeys) {
    if (key === link || key.endsWith(`/${link}`)) return key;
  }
  return null;
}

export function lintWiki(): LintReport {
  const allFiles = getAllMdFiles(WIKI_DIR);
  // Exclude the index and any dot-files
  const contentFiles = allFiles.filter(
    (f) => !path.basename(f).startsWith("_") && !path.basename(f).startsWith("."),
  );

  const pageKeys = new Set(contentFiles.map(pageKey));
  const linkedPages = new Set<string>();
  const brokenLinks: Array<{ page: string; link: string }> = [];
  let totalLinks = 0;

  for (const file of contentFiles) {
    const content = fs.readFileSync(file, "utf8");
    const links = extractWikilinks(content);
    totalLinks += links.length;

    for (const link of links) {
      const resolved = resolveLink(link, pageKeys);
      if (resolved) {
        linkedPages.add(resolved);
      } else {
        brokenLinks.push({ page: pageKey(file), link });
      }
    }
  }

  // Orphaned: exists in wiki, has no inbound links, and isn't the index
  const orphanedPages = [...pageKeys].filter((k) => !linkedPages.has(k));

  return {
    totalPages: contentFiles.length,
    totalLinks,
    brokenLinks,
    orphanedPages,
  };
}

async function main(): Promise<void> {
  if (!fs.existsSync(WIKI_DIR)) {
    console.log(`[lint-wiki] wiki/ directory not found at ${WIKI_DIR} — run compile first`);
    process.exit(0);
  }

  console.log(`[lint-wiki] scanning ${WIKI_DIR}`);
  const { totalPages, totalLinks, brokenLinks, orphanedPages } = lintWiki();

  console.log(`\nPages: ${totalPages}  Links: ${totalLinks}`);

  if (brokenLinks.length === 0) {
    console.log("Broken links: none ✓");
  } else {
    console.log(`\nBroken links (${brokenLinks.length}):`);
    for (const { page, link } of brokenLinks) {
      console.log(`  ${page}  →  [[${link}]]`);
    }
  }

  if (orphanedPages.length === 0) {
    console.log("Orphaned pages: none ✓");
  } else {
    console.log(`\nOrphaned pages (${orphanedPages.length}):`);
    for (const p of orphanedPages) {
      console.log(`  ${p}`);
    }
  }

  const exitCode = brokenLinks.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[lint-wiki] fatal:", err);
  process.exit(1);
});
