import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Only http(s)/mailto links render as clickable — `javascript:`/`data:`
 * hrefs (or anything unparsable) are dropped. `react-markdown` never
 * renders raw HTML from the source by default (no `rehype-raw`), so this
 * is defense in depth for untrusted bodies (e.g. an imported skill), not a
 * gap in the markdown parser itself.
 */
function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    const protocol = new URL(href, "http://x").protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a
              href={safeHref(href)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent-text)", textDecoration: "underline" }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
