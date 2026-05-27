import { useEffect, useState } from 'react';
import type { SlideTheme } from '@/data/themes';
import { getImage, imageDataUri } from '@/services/images';

interface SlideRendererProps {
  content: string;
  format: 'markdown' | 'html';
  theme?: SlideTheme;
}

const IMAGE_REF_PATTERN = /\{\{image:([a-f0-9-]+)\}\}/g;

/**
 * Renders a slide. For markdown, we do a simple transform of common markdown
 * syntax to HTML. For html format, content is rendered directly.
 * Resolves {{image:ID}} references to inline data URIs.
 */
export function SlideRenderer({ content, format, theme }: SlideRendererProps) {
  const [resolvedContent, setResolvedContent] = useState(content);

  // Resolve image references
  useEffect(() => {
    let cancelled = false;
    const imageIds = [...content.matchAll(IMAGE_REF_PATTERN)].map((m) => m[1]);
    const uniqueIds = [...new Set(imageIds)];

    if (uniqueIds.length === 0) {
      setResolvedContent(content);
      return;
    }

    (async () => {
      const cache: Record<string, string> = {};
      await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const img = await getImage(id);
            if (img) cache[id] = imageDataUri(img.mimeType, img.data);
          } catch { /* skip broken refs */ }
        }),
      );
      if (cancelled) return;
      const resolved = content.replace(IMAGE_REF_PATTERN, (_, id) =>
        cache[id] ?? `{{image:${id}}}`,
      );
      setResolvedContent(resolved);
    })();

    return () => { cancelled = true; };
  }, [content]);

  const style: React.CSSProperties = theme
    ? {
        backgroundColor: theme.backgroundColor,
        color: theme.textColor,
        fontFamily: theme.fontFamily,
        '--heading-color': theme.headingColor,
        '--accent-color': theme.accentColor,
        '--code-bg': theme.codeBackground,
        '--code-color': theme.codeColor,
      } as React.CSSProperties
    : {};

  const themeClass = theme ? 'themed-slide' : '';

  if (format === 'html') {
    return (
      <div
        className={`prose prose-lg max-w-none h-full flex flex-col justify-center p-12 ${themeClass}`}
        style={style}
        dangerouslySetInnerHTML={{ __html: resolvedContent }}
      />
    );
  }

  const html = markdownToHtml(resolvedContent, theme);
  return (
    <div
      className={`prose prose-lg max-w-none h-full flex flex-col justify-center p-12 ${themeClass}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function markdownToHtml(md: string, theme?: SlideTheme): string {
  let html = md;
  const headingColor = theme?.headingColor ?? 'inherit';
  const accentColor = theme?.accentColor ?? '#2563eb';
  const codeBg = theme?.codeBackground ?? '#1f2937';
  const codeColor = theme?.codeColor ?? '#86efac';
  const inlineCodeBg = theme ? `${theme.headingColor}15` : '#f3f4f6';
  // Headers
  html = html.replace(/^### (.+)$/gm, `<h3 style="color: ${headingColor}">$1</h3>`);
  html = html.replace(/^## (.+)$/gm, `<h2 style="color: ${headingColor}">$1</h2>`);
  html = html.replace(/^# (.+)$/gm, `<h1 style="color: ${headingColor}">$1</h1>`);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, `<pre style="background: ${codeBg}; color: ${codeColor};" class="rounded-lg p-4 overflow-x-auto"><code>$2</code></pre>`);
  // Inline code
  html = html.replace(/`(.+?)`/g, `<code style="background: ${inlineCodeBg};" class="px-1.5 py-0.5 rounded text-sm">$1</code>`);
  // Images with optional size hint: ![alt|size](src)
  html = html.replace(/!\[([^\]|]+?)(?:\|(\w+))?\]\((.+?)\)/g, (_match, alt, size, src) => {
    const sizeMap: Record<string, string> = { small: '25%', medium: '50%', large: '75%', full: '100%' };
    const maxW = sizeMap[size] ?? '80%';
    return `<img src="${src}" alt="${alt}" style="max-width: ${maxW}; max-height: 60vh; width: auto; height: auto; object-fit: contain; border-radius: 0.5rem; margin: 0 auto; display: block;" />`;
  });
  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" style="color: ${accentColor};" class="underline">$1</a>`);
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-6 space-y-2">$&</ul>');
  // Paragraphs (lines that aren't already wrapped)
  html = html.replace(/^(?!<[hulo]|<li|<pre|<img)(.+)$/gm, '<p>$1</p>');
  // Clean up extra newlines
  html = html.replace(/\n{2,}/g, '\n');
  return html;
}
