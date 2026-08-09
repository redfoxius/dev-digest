import { ConventionCategory } from '@devdigest/shared';

/**
 * Language-agnostic constants for the conventions module. See
 * docs/conventions-extractor-plan.md. Per-language constants (config
 * filenames, lint-rule category maps, ...) live in each pack under `./langs/`
 * (Phase 7.1 of docs/go-language-support-plan.md) — this file is only for
 * values that apply across every language pack.
 */

/** The fixed category vocabulary (mirrors the shared `ConventionCategory` enum). */
export const CONVENTION_CATEGORIES = ConventionCategory.options;

/** Top-N ranked files sampled per extraction, via `repoIntel.getConventionSamples`. */
export const SAMPLE_FILE_COUNT = 12;

/** Fuzzy line-window match threshold (token-overlap ratio) for evidence verification. */
export const EVIDENCE_FUZZY_THRESHOLD = 0.9;
