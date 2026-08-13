/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract,
   plus the Smart Diff (grouped-by-role) sibling viewer. */
export { DiffViewer } from "./DiffViewer";
export { SmartDiffViewer } from "./SmartDiffViewer";
export type { DiffCommentApi } from "./comments";
