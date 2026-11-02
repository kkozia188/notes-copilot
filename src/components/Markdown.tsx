import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { normalizeMathBlocks } from "../lib/latex";

const RAW_BASE = "https://raw.githubusercontent.com/Michael-Jetson/Robotics_Tutorial/main/";

/** Resolve a link relative to the note it appears in. Returns a repo-relative path. */
export function resolveRelative(fromNote: string, href: string): string {
  const url = new URL(href, `https://x/${encodeURI(fromNote)}`);
  return decodeURIComponent(url.pathname.slice(1));
}

type Props = {
  markdown: string;
  /** Repo-relative path of the note, used to resolve relative links and images. */
  notePath?: string;
  onNavigate?: (path: string) => void;
};

function MarkdownImpl({ markdown, notePath, onNavigate }: Props) {
  const components: Components = {
    a({ href = "", children, node: _node, ...rest }) {
      if (/^[a-z]+:/i.test(href)) {
        return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>;
      }
      if (href.startsWith("#")) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const frag = decodeURIComponent(href.slice(1)).replace(/-/g, "");
              const root = (e.currentTarget as HTMLElement).closest(".markdown");
              const h = Array.from(root?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []).find((el) =>
                (el.textContent ?? "").replace(/\s|-/g, "").includes(frag),
              );
              h?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {children}
          </a>
        );
      }
      if (notePath && onNavigate) {
        const target = resolveRelative(notePath, href.split("#")[0]);
        const isDir = !/\.[a-z0-9]+$/i.test(target);
        if (target.endsWith(".md") || isDir) {
          const path = isDir ? `${target.replace(/\/$/, "")}/README.md` : target;
          return (
            <a href={`#/${path}`} onClick={(e) => { e.preventDefault(); onNavigate(path); }}>
              {children}
            </a>
          );
        }
      }
      return <a href={href} {...rest}>{children}</a>;
    },
    img({ src = "", alt, node: _node, ...rest }) {
      const s = typeof src === "string" ? src : "";
      const url = notePath && s && !/^[a-z]+:/i.test(s) ? RAW_BASE + encodeURI(resolveRelative(notePath, s)) : s;
      return <img src={url} alt={alt} loading="lazy" {...rest} />;
    },
  };

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {normalizeMathBlocks(markdown)}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
