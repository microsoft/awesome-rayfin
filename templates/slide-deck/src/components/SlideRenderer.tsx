import type { SlideTheme } from '@/data/themes';

interface SlideRendererProps {
  content: string;
  format: 'markdown' | 'html';
  theme?: SlideTheme;
}

/**
 * Renders a slide. For markdown, we do a simple transform of common markdown
 * syntax to HTML. For html format, content is rendered directly.
 */
export function SlideRenderer({ content, format, theme }: SlideRendererProps) {
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
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  const html = markdownToHtml(content, theme);
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
  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" style="color: ${accentColor};" class="underline">$1</a>`);
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-6 space-y-2">$&</ul>');
  // Paragraphs (lines that aren't already wrapped)
  html = html.replace(/^(?!<[hulo]|<li|<pre)(.+)$/gm, '<p>$1</p>');
  // Clean up extra newlines
  html = html.replace(/\n{2,}/g, '\n');
  return html;
}
