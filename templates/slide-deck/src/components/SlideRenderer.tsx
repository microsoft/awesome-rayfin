interface SlideRendererProps {
  content: string;
  format: 'markdown' | 'html';
}

/**
 * Renders a slide. For markdown, we do a simple transform of common markdown
 * syntax to HTML. For html format, content is rendered directly.
 */
export function SlideRenderer({ content, format }: SlideRendererProps) {
  if (format === 'html') {
    return (
      <div
        className="prose prose-lg max-w-none h-full flex flex-col justify-center p-12"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  // Simple markdown-to-HTML transform for common patterns
  const html = markdownToHtml(content);
  return (
    <div
      className="prose prose-lg max-w-none h-full flex flex-col justify-center p-12"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function markdownToHtml(md: string): string {
  let html = md;
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-900 text-green-300 rounded-lg p-4 overflow-x-auto"><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">$1</code>');
  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">$1</a>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-6 space-y-2">$&</ul>');
  // Paragraphs (lines that aren't already wrapped)
  html = html.replace(/^(?!<[hulo]|<li)(.+)$/gm, '<p>$1</p>');
  // Clean up extra newlines
  html = html.replace(/\n{2,}/g, '\n');
  return html;
}
