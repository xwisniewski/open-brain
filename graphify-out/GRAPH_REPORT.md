# Graph Report - .  (2026-06-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 132 nodes · 147 edges · 13 communities (11 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c1eeed93`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)
1. `compileWiki()` - 9 edges
2. `compilerOptions` - 8 edges
3. `compilerOptions` - 7 edges
4. `scripts` - 6 edges
5. `lintWiki()` - 6 edges
6. `scripts` - 5 edges
7. `exportThoughts()` - 4 edges
8. `ingestUrl()` - 4 edges
9. `runDigest()` - 4 edges
10. `readRawFiles()` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (13 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (19): dependencies, @anthropic-ai/sdk, @modelcontextprotocol/sdk, openai, @supabase/supabase-js, devDependencies, ts-node, @types/node (+11 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (19): anthropic, compileArticle(), CompileState, compileWiki(), groupByTopics(), loadState(), main(), parseFrontmatter() (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (16): dependencies, @anthropic-ai/sdk, dotenv, @supabase/supabase-js, devDependencies, ts-node, @types/node, typescript (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (11): Decision, exportProjects(), exportThoughts(), main(), Project, RAW_PROJECTS, RAW_THOUGHTS, slug() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.20
Nodes (6): __dirname, execFileAsync, openai, server, supabase, transport

### Community 5 - "Community 5"
Cohesion: 0.20
Nodes (9): compilerOptions, esModuleInterop, module, moduleResolution, outDir, skipLibCheck, strict, target (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (8): compilerOptions, esModuleInterop, module, moduleResolution, outDir, strict, target, include

### Community 7 - "Community 7"
Cohesion: 0.36
Nodes (8): extractWikilinks(), getAllMdFiles(), LintReport, lintWiki(), main(), pageKey(), resolveLink(), WIKI_DIR

### Community 8 - "Community 8"
Cohesion: 0.36
Nodes (7): anthropic, fetchPageText(), IngestResult, ingestUrl(), main(), slugify(), SOURCES_DIR

### Community 9 - "Community 9"
Cohesion: 0.53
Nodes (4): getCalendarEvents(), getGmailMessages(), getGoogleAccessToken(), runDigest()

### Community 10 - "Community 10"
Cohesion: 0.40
Nodes (3): mockInsert, mockRpc, mockSelect

## Knowledge Gaps
- **73 isolated node(s):** `mockRpc`, `mockSelect`, `mockInsert`, `execFileAsync`, `__dirname` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `mockRpc`, `mockSelect`, `mockInsert` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._