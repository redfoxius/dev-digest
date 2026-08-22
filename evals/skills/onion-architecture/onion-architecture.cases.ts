import type { SkillCase } from "../../src/index.js";

const DIFF = `diff --git a/server/src/modules/context-docs/service.ts b/server/src/modules/context-docs/service.ts
index 1111111..2222222 100644
--- a/server/src/modules/context-docs/service.ts
+++ b/server/src/modules/context-docs/service.ts
@@ -1,4 +1,5 @@
 import type { Container } from '../../platform/container.js';
+import { readFile } from 'node:fs/promises';
 import type {
   ContextDocRoot,
 } from '@devdigest/shared';
@@ -40,6 +41,13 @@ export class ContextDocsService {
     return chunkMarkdown(raw);
   }

+  /** Quick one-off preview for the admin debug panel — just grab the first 500 chars. */
+  async previewDoc(cloneRoot: string, relativePath: string): Promise<string> {
+    const raw = await readFile(\`\${cloneRoot}/\${relativePath}\`, 'utf8');
+    return raw.slice(0, 500);
+  }
+
   async listRoots(): Promise<ContextDocRoot[]> {`;

export const cases: SkillCase[] = [
  {
    name: "flags a module's service.ts reading the filesystem directly instead of via its designated reader",
    kind: "quality",
    prompt: `Review this diff for onion-architecture / layering violations. In server/src/modules/context-docs/, reader.ts (discoverContextDocs, using node:fs/promises) is the file responsible for all filesystem access to a cloned repo's working tree; service.ts orchestrates but doesn't touch the filesystem itself.\n\n${DIFF}`,
    practices: [
      "the review explicitly flags context-docs/service.ts's new previewDoc method importing and calling readFile from node:fs/promises directly as a layering violation, not just generic praise or silence",
      "the review names reader.ts (or 'the module's reader/FS-owning file') as where this filesystem read belongs instead of inline in service.ts",
      "the review does not excuse the violation just because the change is described as a 'quick one-off' or 'just for a debug panel'",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
];
