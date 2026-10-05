/**
 * In-page content capture for the blocks discovery found. Passed to page.evaluate, so it must stay
 * self-contained: no imports and nothing from module scope.
 *
 * Every block is read as an ordered list of items (headings, text, lists, media, links, buttons,
 * forms, tables, icons), plus every link it holds and a sanitised HTML snapshot. Text is read the
 * way a reader sees it once every animation has run, so content waiting for a scroll still counts.
 */
export function scanContent({ targets, maxHtmlChars }) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
  const TEXT_BLOCKS = new Set(['P', 'BLOCKQUOTE', 'FIGCAPTION', 'PRE', 'ADDRESS', 'DT', 'DD']);
  // Rich text keeps inline meaning and links; every other tag is unwrapped to its text.
  const INLINE = {
    A: ['href', 'target', 'rel', 'title'], STRONG: [], B: [], EM: [], I: [], U: [], S: [], SUP: [], SUB: [], SMALL: [], CODE: [], MARK: [],
  };

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttribute = (text) => escapeText(text).replace(/"/g, '&quot;');
  const absolute = (value) => {
    if (!value) return null;
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  };
  const hrefOf = (anchor) => {
    try {
      return typeof anchor.href === 'string' ? anchor.href : absolute(anchor.href.baseVal);
    } catch {
      return null;
    }
  };
  // display:none removes a box; visibility:hidden and opacity:0, used by entrance animations, do not.
  const boxed = (element) => element.getClientRects().length > 0 || getComputedStyle(element).display === 'contents';
  const textOf = (element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
    return clean(copy.textContent);
  };
  const ownText = (element) => clean(Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(' '));
  const buttonLike = (element) => element.getAttribute('role') === 'button'
    || /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i.test(element.getAttribute('class') || '');

  function richText(element) {
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          parts.push(escapeText(child.textContent));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE || SKIP.has(child.tagName)) continue;
        if (child.tagName === 'BR') {
          parts.push('<br>');
          continue;
        }
        const keep = INLINE[child.tagName];
        if (!keep) {
          walk(child);
          continue;
        }
        const name = child.tagName.toLowerCase();
        const attributes = keep.map((attribute) => {
          const value = attribute === 'href' ? hrefOf(child) : child.getAttribute(attribute);
          return value ? ` ${attribute}="${escapeAttribute(value)}"` : '';
        }).join('');
        parts.push(`<${name}${attributes}>`);
        walk(child);
        parts.push(`</${name}>`);
      }
    };
    walk(element);
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

  const image = (img) => ({
    type: 'image',
    src: absolute(img.currentSrc || img.getAttribute('src')),
    srcset: img.getAttribute('srcset') || null,
    // Lazy-loading plugins park the real address here until the image scrolls into view.
    lazy_src: absolute(img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')),
    alt: img.getAttribute('alt'),
    width: img.naturalWidth || null,
    height: img.naturalHeight || null,
  });
  const video = (node) => ({
    type: 'video',
    src: absolute(node.currentSrc || node.getAttribute('src') || node.querySelector('source')?.getAttribute('src')),
    poster: absolute(node.getAttribute('poster')),
    autoplay: node.autoplay,
    loop: node.loop,
    muted: node.muted,
    controls: node.controls,
    playsinline: node.hasAttribute('playsinline'),
  });
  const embed = (node) => ({
    type: 'embed', tag: node.tagName.toLowerCase(), src: absolute(node.getAttribute('src') || node.getAttribute('data')), title: node.getAttribute('title'),
  });
  const labelFor = (field) => clean((field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)?.textContent)
    || field.closest('label')?.textContent
    || field.getAttribute('aria-label')
    || '') || null;
  const form = (node) => ({
    type: 'form',
    action: absolute(node.getAttribute('action')),
    method: (node.getAttribute('method') || 'get').toLowerCase(),
    fields: Array.from(node.querySelectorAll('input, select, textarea, button'))
      .filter((field) => field.getAttribute('type') !== 'hidden')
      .map((field) => ({
        tag: field.tagName.toLowerCase(),
        type: field.getAttribute('type') || null,
        name: field.getAttribute('name') || null,
        label: field.tagName === 'BUTTON' ? textOf(field) || null : labelFor(field),
        placeholder: field.getAttribute('placeholder') || null,
        required: Boolean(field.required),
        ...(field.tagName === 'SELECT' ? { options: Array.from(field.options, (option) => clean(option.textContent)) } : {}),
      })),
  });

  function collect(root) {
    const items = [];
    const nestedMedia = (element) => {
      for (const node of element.querySelectorAll('img, video, iframe')) {
        if (!boxed(node)) continue;
        if (node.tagName === 'IMG') items.push(image(node));
        else if (node.tagName === 'VIDEO') items.push(video(node));
        else items.push(embed(node));
      }
    };
    const visit = (element) => {
      if (SKIP.has(element.tagName) || !boxed(element)) return;
      const tag = element.tagName;
      if (element instanceof SVGElement) {
        items.push({
          type: 'icon',
          label: element.getAttribute('aria-label') || clean(element.querySelector('title')?.textContent) || null,
          view_box: element.getAttribute('viewBox'),
        });
        return;
      }
      if (/^H[1-6]$/.test(tag)) {
        const text = textOf(element);
        if (text) items.push({ type: 'heading', level: Number(tag[1]), text, html: richText(element) });
        return;
      }
      if (TEXT_BLOCKS.has(tag)) {
        const text = textOf(element);
        if (text) items.push({ type: 'text', tag: tag.toLowerCase(), text, html: richText(element) });
        nestedMedia(element);
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const entries = Array.from(element.children)
          .filter((child) => child.tagName === 'LI' && boxed(child))
          .map((child) => ({ text: textOf(child), html: richText(child) }))
          .filter((entry) => entry.text);
        if (entries.length) items.push({ type: 'list', ordered: tag === 'OL', items: entries });
        nestedMedia(element);
        return;
      }
      if (tag === 'IMG') {
        items.push(image(element));
        return;
      }
      if (tag === 'VIDEO') {
        items.push(video(element));
        return;
      }
      if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
        items.push(embed(element));
        return;
      }
      if (tag === 'FORM') {
        items.push(form(element));
        return;
      }
      if (tag === 'TABLE') {
        items.push({ type: 'table', rows: Array.from(element.rows, (row) => Array.from(row.cells, (cell) => textOf(cell))) });
        return;
      }
      if (tag === 'A' && element.hasAttribute('href')) {
        const picture = element.querySelector('img');
        items.push({
          type: 'link',
          text: textOf(element) || element.getAttribute('aria-label') || null,
          href: hrefOf(element),
          target: element.getAttribute('target'),
          button: buttonLike(element),
          ...(picture && boxed(picture) ? { image: image(picture) } : {}),
        });
        return;
      }
      if (tag === 'BUTTON' || element.getAttribute('role') === 'button') {
        items.push({ type: 'button', text: textOf(element) || null, label: element.getAttribute('aria-label') });
        return;
      }
      const background = getComputedStyle(element).backgroundImage;
      if (background && background !== 'none') {
        // Computed values quote every URL, and a data: URL may itself hold quotes and brackets.
        for (const match of background.matchAll(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/g)) {
          const value = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1');
          if (value) items.push({ type: 'background', src: absolute(value) });
        }
      }
      // Text written straight into a layout box, as page builders often do, is a paragraph too.
      if (ownText(element)) {
        items.push({ type: 'text', tag: tag.toLowerCase(), text: textOf(element), html: richText(element) });
        nestedMedia(element);
        return;
      }
      for (const child of element.children) visit(child);
    };
    visit(root);
    return items;
  }

  function snapshot(element) {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const attribute of Array.from(node.attributes)) {
        if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') node.removeAttribute(attribute.name);
      }
    }
    const html = copy.outerHTML.replace(/\s+/g, ' ');
    return html.length > maxHtmlChars ? { html: html.slice(0, maxHtmlChars), truncated: true } : { html, truncated: false };
  }

  return targets.map((target) => {
    let element = null;
    try {
      element = document.querySelectorAll(target.css)[target.match_index || 0] || null;
    } catch {
      element = null;
    }
    if (!element) return { id: target.id, found: false };
    const anchors = element.matches('a[href]')
      ? [element, ...element.querySelectorAll('a[href]')]
      : Array.from(element.querySelectorAll('a[href]'));
    const html = snapshot(element);
    return {
      id: target.id,
      found: true,
      tag: element.tagName.toLowerCase(),
      text: textOf(element),
      items: collect(element),
      // Menus hide their dropdowns until hovered; their links are content all the same.
      links: anchors.map((anchor) => ({
        text: textOf(anchor) || anchor.getAttribute('aria-label') || null,
        href: hrefOf(anchor),
        target: anchor.getAttribute('target'),
        hidden: !boxed(anchor),
      })),
      html: html.html,
      html_truncated: html.truncated,
    };
  });
}
