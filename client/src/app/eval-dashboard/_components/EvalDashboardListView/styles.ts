import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 960,
  } as CSSProperties,
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } as CSSProperties,
  h1: {
    fontSize: 18,
    fontWeight: 700,
  } as CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } as CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as CSSProperties,
};
