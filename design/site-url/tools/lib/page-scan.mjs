/**
 * Evaluated inside the page. Must stay self-contained: no imports, no closures.
 * Implements the union of discovery signals 1-8 and 11 from 01-source-discovery.md.
 * Signals 9 (scroll-triggered) and 10 (dynamic injection) are satisfied by the
 * readiness phase that scrolls the page and settles before this scan runs.
 */
export function scanPage(options) {
  const CLASS_FAMILY = new RegExp(options.classFamilySource, 'i');
  const MISSABLE = new RegExp(options.missableSource, 'i');
  const EMBED_HOSTS = options.embedHosts;
  const STYLE_PROPERTIES = options.styleProperties;
  const MIN_WIDTH = options.minWidth;
  const MIN_HEIGHT = options.minHeight;
  const BAND_STEP = options.bandStep;

  const pageWidth = document.documentElement.clientWidth;
  const pageHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
  );

  const signals = new Map();
  const meta = new Map();

  function addSignal(element, signal, detail) {
    if (!element || element === document.body || element === document.documentElement) return;
    if (!signals.has(element)) signals.set(element, new Set());
    signals.get(element).add(signal);
    if (detail) meta.set(element, { ...(meta.get(element) || {}), ...detail });
  }

  function absRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      w: rect.width,
      h: rect.height,
      top: rect.y + window.scrollY,
      bottom: rect.y + window.scrollY + rect.height,
      left: rect.x + window.scrollX,
      right: rect.x + window.scrollX + rect.width,
    };
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number.parseFloat(style.opacity || '1') < 0.02) return false;
    return true;
  }

  // Tag boundaries read as word breaks, as in parity.mjs: markup whitespace is not text.
  function boundaryText(root) {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('script,style,noscript')) continue;
      const value = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (value) parts.push(value);
    }
    return parts.join(' ');
  }

  // Uncapped: coverage repair only sees scanned elements, so a cap turns the page's tail into whitespace.
  const allElements = Array.from(document.querySelectorAll('body *'));
  const visibleElements = allElements.filter(isVisible);

  // Signal 1 - semantic landmarks and ARIA.
  const landmarkSelector = 'header,footer,main,nav,aside,article,section,form,figure,dialog,details,'
    + '[role=region],[role=list],[role=status],[role=dialog],[role=banner],[role=contentinfo],'
    + '[role=navigation],[role=main],[role=complementary],[role=search],[aria-label],[aria-labelledby]';
  for (const element of Array.from(document.querySelectorAll(landmarkSelector))) {
    if (isVisible(element)) addSignal(element, 1);
  }

  // Signal 2 - heading anchors mapped to their nearest visual owner.
  for (const heading of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    if (!isVisible(heading)) continue;
    let owner = heading.parentElement;
    let outermost = null;
    while (owner && owner !== document.body) {
      const rect = owner.getBoundingClientRect();
      if (rect.width >= pageWidth * 0.6) break;
      outermost = owner;
      owner = owner.parentElement;
    }
    // Narrow headings still belong to their band, never to the heading element alone.
    addSignal(owner && owner !== document.body ? owner : (outermost || heading), 2);
  }

  // Signal 3 - class-family names on substantial boxes.
  for (const element of visibleElements) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 200 || rect.height <= 8) continue;
    const tokens = `${element.className || ''} ${element.id || ''}`;
    if (typeof tokens === 'string' && CLASS_FAMILY.test(tokens)) addSignal(element, 3);
  }

  // Signal 4 - vertical band scan for headless/decorative regions.
  const bandCandidates = visibleElements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= pageWidth * 0.6 && rect.height >= 8;
    })
    .map((element) => ({ element, rect: absRect(element) }))
    .sort((a, b) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h));

  const bandOwners = [];
  for (let y = 0; y < pageHeight; y += BAND_STEP) {
    const owner = bandCandidates.find((entry) => entry.rect.top <= y && entry.rect.bottom > y);
    bandOwners.push({ y, element: owner ? owner.element : null });
    if (owner) addSignal(owner.element, 4);
  }

  // Signal 5 - media, embeds, and animation.
  const mediaSelector = 'video,audio,canvas,iframe,embed,object,[data-component],[data-cmp-is],[data-widget]';
  for (const element of Array.from(document.querySelectorAll(mediaSelector))) {
    if (isVisible(element)) addSignal(element, 5);
  }
  for (const element of visibleElements) {
    const style = getComputedStyle(element);
    if (style.animationName && style.animationName !== 'none') addSignal(element, 5, { animated: true });
  }

  // Signal 6 - floating, sticky, and overlay chrome.
  for (const element of visibleElements) {
    const style = getComputedStyle(element);
    const zIndex = Number.parseInt(style.zIndex, 10);
    if (style.position === 'fixed' || style.position === 'sticky') {
      addSignal(element, 6, { positioning: style.position });
    } else if (Number.isInteger(zIndex) && zIndex > 0) {
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) addSignal(element, 6, { positioning: `z-${zIndex}` });
    }
  }

  // Signal 7 - repetition.
  for (const element of visibleElements) {
    const children = Array.from(element.children).filter(isVisible);
    if (children.length < 2) continue;
    const first = children[0].getBoundingClientRect();
    const equivalent = children.filter((child) => {
      const rect = child.getBoundingClientRect();
      return child.tagName === children[0].tagName
        && Math.abs(rect.width - first.width) <= 2
        && Math.abs(rect.height - first.height) <= 4;
    });
    if (equivalent.length >= 2) addSignal(element, 7, { repeated_children: equivalent.length });
  }

  // Signal 8 - missable pattern catalog.
  for (const element of visibleElements) {
    const attributes = Array.from(element.attributes || [])
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .join(' ');
    if (MISSABLE.test(attributes)) addSignal(element, 8);
  }

  // Signal 11 - third-party embeds.
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (!isVisible(frame)) continue;
    const source = frame.src || '';
    if (EMBED_HOSTS.some((host) => source.includes(host))) addSignal(frame, 11, { embed_src: source });
  }

  // Reduce candidates to outermost visible blocks.
  function isWrapper(rect) {
    return rect.h >= pageHeight * 0.8 && rect.w >= pageWidth * 0.95;
  }

  let candidates = Array.from(signals.keys()).filter((element) => {
    if (!isVisible(element)) return false;
    const rect = absRect(element);
    if (isWrapper(rect)) return false;
    const signalSet = signals.get(element);
    const floatingOrMedia = signalSet.has(5) || signalSet.has(6);
    if (!floatingOrMedia && rect.w < MIN_WIDTH && rect.h < MIN_HEIGHT) return false;
    return true;
  });

  function reduceToOutermost(elements) {
    // Containment, not area: a clipped track or carousel row can be far larger than the section holding it.
    const pool = new Set(elements);
    const kept = Array.from(pool).filter((element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (pool.has(node)) return false;
      }
      return true;
    });
    return kept.sort((a, b) => {
      const rectA = absRect(a);
      const rectB = absRect(b);
      return rectA.top - rectB.top || rectA.left - rectB.left;
    });
  }

  let blocks = reduceToOutermost(candidates);

  // `isWrapper` only discards elements above 80% of the page, so a container sitting just under it
  // is kept and `reduceToOutermost` then deletes every real section inside it. Size cannot tell a
  // container from a section; how its children fill it can. Descend when the inner sections stack as
  // bands accounting for most of the block's height: each spans the host, or shares its row with nothing.
  const CONTAINER_MIN_SHARE = 0.5;
  const PART_MIN_WIDTH_SHARE = 0.9;
  const PART_MIN_COVERAGE = 0.7;

  function innerSections(block) {
    const inside = candidates.filter((element) => element !== block && block.contains(element));
    const pool = new Set(inside);
    return inside
      .filter((element) => {
        for (let node = element.parentElement; node && node !== block; node = node.parentElement) {
          if (pool.has(node)) return false;
        }
        return true;
      })
      .sort((a, b) => absRect(a).top - absRect(b).top);
  }

  // Grids nest several same-size wrappers before the sections start, and each one looks like a
  // single child rather than a partition. Walk past them to the element that actually holds them.
  function contentHost(block) {
    const rect = absRect(block);
    let current = block;
    for (let depth = 0; depth < 8; depth += 1) {
      const children = Array.from(current.children).filter(isVisible);
      if (children.length !== 1) break;
      const childRect = absRect(children[0]);
      if (childRect.h < rect.h * 0.95 || childRect.w < rect.w * 0.95) break;
      current = children[0];
    }
    return current;
  }

  /** The host's direct child holding `element`: the box a section is laid out in. */
  function slotOf(element, host) {
    let node = element;
    while (node.parentElement && node.parentElement !== host) node = node.parentElement;
    return node;
  }

  /** `other` shares `rect`'s row: level with it vertically while clear of it horizontally. */
  function beside(rect, other) {
    const vertical = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
    const horizontal = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
    return vertical > 1 && horizontal <= 1;
  }

  /** Overlays and decorations positioned out of flow never form a column of their own. */
  function outOfFlow(element, within) {
    for (let node = element; node && node !== within; node = node.parentElement) {
      if (['absolute', 'fixed'].includes(getComputedStyle(node).position)) return true;
    }
    return false;
  }

  /**
   * A section narrower than its host still stacks as a band when no sibling of its slot shares its
   * row. Side-by-side siblings mean the host is laid out in columns, which stay one block.
   */
  function ownsRow(part, host) {
    const slot = slotOf(part, host);
    const rect = absRect(slot);
    return !Array.from(host.children).some((sibling) => sibling !== slot && isVisible(sibling)
      && !outOfFlow(sibling, host) && beside(rect, absRect(sibling)));
  }

  /**
   * Painted content beside a narrow part inside its slot that no part claims would fall outside every
   * block. As coverage repair does for vertical gaps, each such region becomes a block of its own.
   */
  function unclaimedBeside(part, host, parts) {
    const slot = slotOf(part, host);
    if (slot === part || absRect(part).w >= absRect(host).w * PART_MIN_WIDTH_SHARE) return [];
    const rect = absRect(part);
    const owners = [];
    for (const element of Array.from(slot.querySelectorAll('*'))) {
      if (parts.some((other) => other.contains(element) || element.contains(other))) continue;
      if (!isVisible(element) || !isPainted(element) || outOfFlow(element, slot)) continue;
      if (!beside(rect, absRect(element))) continue;
      let owner = element;
      while (owner.parentElement !== slot && !parts.some((other) => owner.parentElement.contains(other))) {
        owner = owner.parentElement;
      }
      if (!owners.includes(owner)) owners.push(owner);
    }
    return owners;
  }

  function partitionsBlock(block, parts) {
    if (parts.length < 2) return false;
    const rect = absRect(block);
    if (rect.h <= 0) return false;
    let covered = 0;
    let cursor = rect.top;
    for (const part of parts) {
      const partRect = absRect(part);
      if (partRect.w < rect.w * PART_MIN_WIDTH_SHARE && !ownsRow(part, block)) return false;
      covered += Math.max(0, partRect.bottom - Math.max(partRect.top, cursor));
      cursor = Math.max(cursor, partRect.bottom);
    }
    return covered >= rect.h * PART_MIN_COVERAGE;
  }

  // Which descendant carries a section's signal can change with the viewport; a slot holding only
  // that section cannot, so discovery uses it to reunite the section across breakpoints.
  const soleSlots = new Map();

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const next = [];
    for (const block of blocks) {
      if (absRect(block).h < pageHeight * CONTAINER_MIN_SHARE) {
        next.push(block);
        continue;
      }
      const host = contentHost(block);
      const parts = innerSections(host);
      if (partitionsBlock(host, parts)) {
        const claimed = [...new Set(parts.flatMap((part) => unclaimedBeside(part, host, parts)))];
        for (const region of claimed) {
          if (!signals.has(region)) signals.set(region, new Set());
          signals.get(region).add(4);
        }
        const sections = [...parts, ...claimed];
        const slots = sections.map((section) => slotOf(section, host));
        sections.forEach((section, index) => {
          if (slots.indexOf(slots[index]) === slots.lastIndexOf(slots[index])) soleSlots.set(section, slots[index]);
        });
        next.push(...sections);
        changed = true;
      } else {
        next.push(block);
      }
    }
    if (!changed) break;
    blocks = reduceToOutermost(next);
  }

  function classTokens(element) {
    const raw = typeof element.className === 'string' ? element.className : '';
    return raw.trim().split(/\s+/).filter(Boolean);
  }

  function isPainted(element) {
    if (element.matches('img,video,canvas,svg,iframe,object,embed,hr,input,button,select,textarea')) return true;
    const style = getComputedStyle(element);
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    const background = style.backgroundColor || '';
    if (background && background !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background)) return true;
    const borderWidths = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
    if (borderWidths.some((property) => Number.parseFloat(style[property]) > 0)) return true;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return true;
    }
    return false;
  }

  function gapIntruders(from, to, blockList) {
    const found = [];
    for (const element of visibleElements) {
      const rect = absRect(element);
      const overlap = Math.min(rect.bottom, to) - Math.max(rect.top, from);
      if (overlap <= 2 || overlap < rect.h * 0.5) continue;
      if (isWrapper(rect)) continue;
      if (blockList.some((block) => block === element || block.contains(element))) continue;
      if (!isPainted(element)) continue;
      found.push(element);
      if (found.length >= 8) break;
    }
    return found;
  }

  function findGaps(blockList) {
    const sorted = blockList.map(absRect).sort((a, b) => a.top - b.top);
    const gaps = [];
    let position = 0;
    for (const rect of sorted) {
      if (rect.top > position + 0.5) gaps.push({ from: position, to: rect.top });
      position = Math.max(position, rect.bottom);
    }
    if (position < pageHeight - 0.5) gaps.push({ from: position, to: pageHeight });
    return gaps;
  }

  /** Highest ancestor that neither swallows an existing block nor wraps the page. */
  function promoteOwner(element, blockList) {
    let best = element;
    let node = element.parentElement;
    while (node && node !== document.body) {
      if (isWrapper(absRect(node))) break;
      if (blockList.some((block) => node.contains(block))) break;
      best = node;
      node = node.parentElement;
    }
    return best;
  }

  // Coverage repair: every painted region outside a block becomes its own block.
  for (let pass = 0; pass < 3; pass += 1) {
    const promotions = [];
    for (const gap of findGaps(blocks)) {
      for (const intruder of gapIntruders(gap.from, gap.to, blocks)) {
        const owner = promoteOwner(intruder, blocks);
        if (blocks.includes(owner) || promotions.includes(owner)) continue;
        if (blocks.some((block) => block.contains(owner))) continue;
        promotions.push(owner);
      }
    }
    if (!promotions.length) break;
    for (const promoted of promotions) {
      if (!signals.has(promoted)) signals.set(promoted, new Set());
      signals.get(promoted).add(4);
    }
    blocks = reduceToOutermost(blocks.concat(promotions));
  }

  function looksHashed(token) {
    return /\d/.test(token) && /^[A-Za-z0-9_-]{6,}$/.test(token) && !/^[a-z]+-\d{1,2}$/i.test(token);
  }

  function pathSelector(element) {
    const parts = [];
    let node = element;
    while (node && node !== document.body && parts.length < 6) {
      const parent = node.parentElement;
      if (!parent) break;
      const index = Array.from(parent.children).indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return `body ${parts.join(' > ')}`.trim();
  }

  function stableSelector(element) {
    const tag = element.tagName.toLowerCase();
    const attempts = [];
    if (element.id && !looksHashed(element.id)) attempts.push(`#${CSS.escape(element.id)}`);
    for (const name of ['data-testid', 'data-test', 'data-qa', 'data-component', 'data-cmp-is', 'data-block', 'data-section']) {
      const value = element.getAttribute(name);
      if (value) attempts.push(`${tag}[${name}="${CSS.escape(value)}"]`);
    }
    const stableClasses = classTokens(element).filter((token) => !looksHashed(token)).slice(0, 3);
    if (stableClasses.length) {
      attempts.push(`${tag}.${stableClasses.map((token) => CSS.escape(token)).join('.')}`);
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) attempts.push(`${tag}[aria-label="${CSS.escape(ariaLabel)}"]`);
    if (['header', 'footer', 'main', 'nav'].includes(tag)) attempts.push(tag);
    attempts.push(pathSelector(element));

    for (const css of attempts) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(css));
      } catch {
        continue;
      }
      const index = matches.indexOf(element);
      if (index >= 0) return { css, match_index: index, expected_matches: matches.length };
    }
    return { css: pathSelector(element), match_index: 0, expected_matches: 1 };
  }

  function styleSnapshot(element) {
    if (!element) return null;
    const style = getComputedStyle(element);
    const snapshot = {};
    for (const property of STYLE_PROPERTIES) snapshot[property] = style[property];
    return snapshot;
  }

  function roleSnapshots(element) {
    const roles = {};
    const pick = (selector) => element.querySelector(selector);
    const mapping = {
      heading: 'h1,h2,h3,h4,h5,h6',
      body: 'p',
      link: 'a[href]',
      button: 'button,[role=button],a[class*=btn],a[class*=button]',
      image: 'img',
      video: 'video',
      icon: 'svg',
    };
    for (const [role, selector] of Object.entries(mapping)) {
      const node = pick(selector);
      if (node && isVisible(node)) {
        roles[role] = {
          tag: node.tagName.toLowerCase(),
          text: (node.textContent || '').trim().slice(0, 60),
          styles: styleSnapshot(node),
        };
      }
    }
    return roles;
  }

  function mediaSnapshot(element) {
    const items = [];
    // Uncapped: asset acquisition reads this list, so a dropped node is a dropped asset.
    const nodes = Array.from(element.querySelectorAll('img,video,source,iframe,svg'));
    for (const node of nodes) {
      const tag = node.tagName.toLowerCase();
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const item = {
        tag,
        visible: rect.width > 0 && rect.height > 0,
        rect: { w: rect.width, h: rect.height },
        object_fit: style.objectFit,
        object_position: style.objectPosition,
      };
      if (tag === 'img') {
        item.src = node.currentSrc || node.src || null;
        item.srcset = node.getAttribute('srcset');
        item.alt = node.getAttribute('alt');
        item.intrinsic = { width: node.naturalWidth, height: node.naturalHeight };
        item.loading = node.getAttribute('loading');
      } else if (tag === 'video') {
        item.src = node.currentSrc || node.src || null;
        item.poster = node.poster || null;
        item.autoplay = node.autoplay;
        item.loop = node.loop;
        item.muted = node.muted;
        item.controls = node.controls;
        item.playsinline = node.hasAttribute('playsinline');
        item.preload = node.preload;
        item.ready_state = node.readyState;
        item.intrinsic = { width: node.videoWidth, height: node.videoHeight };
      } else if (tag === 'source') {
        item.src = node.getAttribute('src');
        item.type = node.getAttribute('type');
        item.media = node.getAttribute('media');
      } else if (tag === 'iframe') {
        item.src = node.getAttribute('src');
        item.title = node.getAttribute('title');
      } else if (tag === 'svg') {
        item.view_box = node.getAttribute('viewBox');
        item.aria_label = node.getAttribute('aria-label');
      }
      items.push(item);
    }
    const style = getComputedStyle(element);
    if (style.backgroundImage && style.backgroundImage !== 'none') {
      items.push({ tag: 'css-background', src: style.backgroundImage, visible: true });
    }
    return items;
  }

  // Bounds keep one pathological block from bloating the artifact; ordinary sections sit far below them.
  const MAX_TEXT_ENTRIES = 400;
  const MAX_TEXT_CHARS = 20000;
  const MAX_LINKS = 200;
  const MAX_SVGS = 40;
  const MAX_SVG_CHARS = 250000;
  const MAX_BACKGROUND_NODES = 1500;
  const MAX_BACKGROUNDS = 40;
  const SHAPES = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use']);
  // Presentation attributes with their SVG initial values; only a differing computed value is written.
  const PAINT_DEFAULTS = {
    'fill-opacity': '1',
    'fill-rule': 'nonzero',
    stroke: 'none',
    'stroke-width': '1px',
    'stroke-opacity': '1',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    opacity: '1',
    'stop-color': 'rgb(0, 0, 0)',
    'stop-opacity': '1',
  };

  function ownText(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // Elements whose whole text is one authored value, inline links and emphasis included.
  const TEXT_CONTAINERS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'figcaption', 'dt', 'dd', 'td', 'th',
    'label', 'button', 'a', 'caption', 'summary', 'address', 'cite', 'q',
  ]);
  const INLINE_KEPT = new Set(['a', 'strong', 'b', 'em', 'i', 'u', 'br', 'sup', 'sub', 'span', 'mark', 'small']);

  /** Rich text as an author would type it: inline markup and link targets only, no classes or styles. */
  function richText(node) {
    const clone = node.cloneNode(true);
    for (const child of Array.from(clone.querySelectorAll('*')).reverse()) {
      const tag = child.tagName.toLowerCase();
      if (!INLINE_KEPT.has(tag)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      if (tag === 'a' && child.getAttribute('href')) child.setAttribute('href', child.href);
      for (const attribute of Array.from(child.attributes)) {
        if (!(tag === 'a' && ['href', 'target', 'rel'].includes(attribute.name))) child.removeAttribute(attribute.name);
      }
      if (tag === 'span') child.replaceWith(...child.childNodes);
    }
    return clone.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 5000);
  }

  /**
   * The SVG as it renders, not as it was written: classes and currentColor resolve through CSS
   * that will not exist in AEM, so every computed paint is written onto the element itself.
   */
  function exportSvg(svg) {
    const clone = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((original, index) => {
      const copy = copies[index];
      if (!copy) return;
      const computed = getComputedStyle(original);
      if (SHAPES.has(original.tagName.toLowerCase()) || original === svg) {
        copy.setAttribute('fill', computed.getPropertyValue('fill'));
      }
      for (const [property, initial] of Object.entries(PAINT_DEFAULTS)) {
        const value = computed.getPropertyValue(property);
        if (value && value !== initial) copy.setAttribute(property, value);
      }
      if (computed.display === 'none') copy.setAttribute('display', 'none');
    });
    const rect = svg.getBoundingClientRect();
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(rect.width)));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(rect.height)));
    // A sprite reference points outside this element, so the symbol travels with it.
    const borrowed = [];
    for (const use of clone.querySelectorAll('use')) {
      const reference = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (!reference || !reference.startsWith('#')) continue;
      const id = reference.slice(1);
      if (clone.querySelector(`[id="${CSS.escape(id)}"]`) || borrowed.some((node) => node.id === id)) continue;
      const target = document.getElementById(id);
      if (target) borrowed.push(target.cloneNode(true));
    }
    if (borrowed.length) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      for (const node of borrowed) defs.appendChild(node);
      clone.insertBefore(defs, clone.firstChild);
    }
    return new XMLSerializer().serializeToString(clone);
  }

  /** What an author needs to recreate the block: its copy, its links, its icons and its background art. */
  function contentSnapshot(element) {
    const text = [];
    let characters = 0;
    const captured = new WeakSet();
    const insideCaptured = (node) => {
      for (let parent = node.parentElement; parent && parent !== element.parentElement; parent = parent.parentElement) {
        if (captured.has(parent)) return true;
      }
      return false;
    };
    for (const node of [element, ...element.querySelectorAll('*')]) {
      if (text.length >= MAX_TEXT_ENTRIES || characters >= MAX_TEXT_CHARS) break;
      if (node.closest('script,style,noscript,svg,template') || insideCaptured(node)) continue;
      const tag = node.tagName.toLowerCase();
      const container = TEXT_CONTAINERS.has(tag);
      const value = container ? boundaryText(node) : ownText(node);
      if (!value || !isVisible(node)) continue;
      const entry = { tag, text: value.slice(0, MAX_TEXT_CHARS - characters) };
      if (/^h[1-6]$/.test(tag)) entry.level = Number(tag[1]);
      const link = node.closest('a[href]');
      if (link && element.contains(link)) entry.href = link.href;
      if (container) {
        captured.add(node);
        const html = richText(node);
        if (html && html !== entry.text) entry.html = html;
      }
      text.push(entry);
      characters += entry.text.length;
    }

    const links = Array.from(element.querySelectorAll('a[href]'))
      .filter((link) => isVisible(link))
      .slice(0, MAX_LINKS)
      .map((link) => ({
        text: boundaryText(link).slice(0, 200),
        href: link.href,
        target: link.getAttribute('target'),
        rel: link.getAttribute('rel'),
        aria_label: link.getAttribute('aria-label'),
      }));

    const svgs = [];
    for (const svg of Array.from(element.querySelectorAll('svg'))) {
      if (svgs.length >= MAX_SVGS) break;
      if (svg.parentElement?.closest('svg') || !isVisible(svg)) continue;
      const rect = svg.getBoundingClientRect();
      const markup = exportSvg(svg);
      svgs.push({
        markup: markup.length <= MAX_SVG_CHARS ? markup : null,
        truncated: markup.length > MAX_SVG_CHARS,
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        view_box: svg.getAttribute('viewBox'),
        aria_label: svg.getAttribute('aria-label'),
        title: svg.querySelector('title')?.textContent?.trim() || null,
        in_link: svg.closest('a[href]')?.href || null,
      });
    }

    const backgrounds = [];
    const seen = new Set();
    for (const node of [element, ...element.querySelectorAll('*')].slice(0, MAX_BACKGROUND_NODES)) {
      if (backgrounds.length >= MAX_BACKGROUNDS) break;
      const image = getComputedStyle(node).backgroundImage;
      if (!image || image === 'none' || !image.includes('url(') || !isVisible(node)) continue;
      for (const match of image.matchAll(/url\(\s*"?([^")]+)"?\s*\)/g)) {
        if (seen.has(match[1])) continue;
        seen.add(match[1]);
        const rect = node.getBoundingClientRect();
        backgrounds.push({
          url: match[1],
          tag: node.tagName.toLowerCase(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }
    return { text, links, svgs, backgrounds };
  }

  const records = blocks.map((element) => {
    const rect = absRect(element);
    const info = meta.get(element) || {};
    const text = boundaryText(element);
    const firstMedia = element.querySelector('img,video,iframe,svg');
    const classChain = [];
    let node = element;
    while (node && node !== document.body && classChain.length < 4) {
      classChain.push(`${node.tagName.toLowerCase()}${classTokens(node).length ? `.${classTokens(node)[0]}` : ''}`);
      node = node.parentElement;
    }
    return {
      selector: stableSelector(element),
      tag: element.tagName.toLowerCase(),
      class_chain: classChain,
      rect,
      signals: Array.from(signals.get(element)).sort((a, b) => a - b),
      detail: info,
      signature: {
        tag: element.tagName.toLowerCase(),
        text: text.slice(0, 60),
        text_length: text.length,
        child_count: element.children.length,
        media: firstMedia
          ? (firstMedia.currentSrc || firstMedia.getAttribute('src') || firstMedia.tagName.toLowerCase())
          : null,
        aria_label: element.getAttribute('aria-label'),
      },
      repeated_children: info.repeated_children || 0,
      section_slot: soleSlots.has(element) ? stableSelector(soleSlots.get(element)) : null,
      styles: { root: styleSnapshot(element), roles: roleSnapshots(element) },
      media: mediaSnapshot(element),
      content: contentSnapshot(element),
    };
  });

  // Bands from the retained block set. After coverage repair a gap can only be intentional
  // whitespace, which is attributed to its neighbour; anything still painted stays UNCLAIMED.
  const intervals = records
    .map((record) => ({ top: record.rect.top, bottom: record.rect.bottom, selector: record.selector.css, signals: record.signals }))
    .sort((a, b) => a.top - b.top);
  const bands = [];
  let cursor = 0;

  function pushGap(from, to, neighbour) {
    if (to - from < 1) return;
    const intruders = gapIntruders(from, to, blocks).map((element) => {
      const rect = absRect(element);
      return {
        tag: element.tagName.toLowerCase(),
        classes: classTokens(element).slice(0, 3),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
      };
    });
    bands.push({
      from: Math.round(from),
      to: Math.round(to),
      owner: intruders.length ? 'UNCLAIMED' : `WHITESPACE:${neighbour || 'document'}`,
      signals: [],
      intruders,
    });
  }

  for (const interval of intervals) {
    if (interval.top > cursor + 0.5) {
      pushGap(cursor, interval.top, bands.length ? bands[bands.length - 1].owner : interval.selector);
    }
    bands.push({
      from: Math.round(Math.max(cursor, interval.top)),
      to: Math.round(Math.max(cursor, interval.bottom)),
      owner: interval.selector,
      signals: interval.signals,
      intruders: [],
    });
    cursor = Math.max(cursor, interval.bottom);
  }
  if (cursor < pageHeight - 0.5) {
    pushGap(cursor, pageHeight, bands.length ? bands[bands.length - 1].owner : null);
  }
  const maxUnclaimedGap = bands
    .filter((band) => band.owner === 'UNCLAIMED')
    .reduce((max, band) => Math.max(max, band.to - band.from), 0);

  return {
    page: {
      width: pageWidth,
      height: pageHeight,
      title: document.title,
      band_step: BAND_STEP,
      bands_scanned: bandOwners.length,
    },
    metadata: {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || null,
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      og: Array.from(document.querySelectorAll('meta[property^="og:"]')).reduce((accumulator, node) => {
        accumulator[node.getAttribute('property')] = node.getAttribute('content');
        return accumulator;
      }, {}),
    },
    blocks: records,
    coverage: { bands, max_unclaimed_gap: Math.round(maxUnclaimedGap) },
  };
}
