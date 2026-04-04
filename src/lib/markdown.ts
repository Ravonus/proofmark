/** Simple markdown to HTML converter — no external deps */
export function markdownToHtml(md: string): string {
  let html = md;

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 id="$slug">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 id="$slug">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 id="$slug">$1</h2>');

  // Fix slugs
  html = html.replace(/id="\$slug">(.+?)<\/h[234]>/g, (match, text) => {
    const slug = text
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const tag = match.includes("</h2>") ? "h2" : match.includes("</h3>") ? "h3" : "h4";
    return `id="${slug}">${text}</${tag}>`;
  });

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquotes
  html = html.replace(/^>\s*(.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Unordered lists
  html = html.replace(/(^- .+\n?)+/gm, (block) => {
    const items = block
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => `<li>${l.slice(2)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });

  // Paragraphs — wrap standalone lines
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<") || trimmed.startsWith("#")) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}
