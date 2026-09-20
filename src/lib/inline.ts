/**
 * The little bit of formatting the editors in /admin are allowed inside a line
 * of copy. Everything is escaped first, so a stray `<` in the text stays a `<`
 * and nothing anyone types in the CMS can inject markup.
 *
 * Supported: [label](href), **bold**, _italic_.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Only links we're willing to render: the site itself, an anchor, http(s), mail. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#)/i;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

export function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
      // `href` has been through escapeHtml, so `&` is already `&amp;` — which is
      // what an attribute wants. Un-escape only to test the scheme.
      const target = href.replace(/&amp;/g, '&');
      if (!SAFE_HREF.test(target)) return whole;
      const external = /^https?:\/\//i.test(target);
      return `<a href="${href}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
}
