export const TOOL_VERSION = '1.0.0';

export const DEFAULT_BREAKPOINTS = [375, 768, 1440];

export const DEFAULT_VISUAL_PASS_RATIO = 0.9;

export const BAND_STEP_PX = 20;

export const MAX_UNCLAIMED_GAP_PX = 20;

export const MIN_BLOCK_WIDTH_PX = 200;

export const MIN_BLOCK_HEIGHT_PX = 8;

export const CLASS_FAMILY_SOURCE = '(section|wrapper|container|block|panel|band|strip|bar|marquee|ticker|scroller|carousel|slider|announce|promo|cta|hero|footer|header|feature|nav|banner|consent|cookie|toast|snackbar|modal|drawer|sticky|float)';

export const MISSABLE_SOURCE = '(promo|marquee|ticker|announcement|cookie|consent|back-to-top|breadcrumb|logo-strip|stats|quote|divider|pinned|newsletter|region-selector|search-overlay|mega-menu|skip-link|preloader|progress|chat)';

export const EMBED_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'player.', 'embed.',
  'segment.com', 'amplitude.com', 'onetrust', 'cookiebot', 'usercentrics', 'didomi', 'trustarc', 'truste',
  'optimizely', 'vwo.com', 'abtasty', 'hubspot', 'marketo', 'salesforce', 'chilipiper',
];

/** Captured by discover.mjs and compared by parity.mjs. One list keeps both sides homologous. */
export const STYLE_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textTransform', 'textAlign', 'textDecorationLine', 'whiteSpace', 'fontFeatureSettings',
  'fontVariationSettings', 'webkitFontSmoothing',
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'opacity', 'boxShadow', 'textShadow', 'fill', 'stroke',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderTopStyle', 'borderRadius',
  'width', 'height', 'maxWidth', 'minHeight', 'boxSizing',
  'display', 'position', 'zIndex', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'alignContent', 'gap', 'rowGap', 'columnGap', 'gridTemplateColumns', 'gridTemplateRows', 'gridAutoFlow',
  'overflow', 'overflowX', 'overflowY', 'aspectRatio', 'objectFit', 'objectPosition', 'transform', 'visibility',
];

/** Frozen score denominators from 01-source-discovery.md. */
export const SCORE_DENOMINATORS = {
  content: 0.25,
  typography: 0.25,
  color: 0.2,
  layout: 0.15,
  section_order: 0.1,
  media_interaction: 0.05,
};

/** Geometry tolerances from 04-visual-parity.md. */
export const GEOMETRY_TOLERANCE = { x: 1, width: 1, height: 8 };

/** Ordered: the first matching rule wins when routing a failure to an owning layer. */
export const OWNING_LAYER_RULES = [
  { layer: 'plan-or-selector', when: 'target selector resolved zero or ambiguous matches' },
  { layer: 'geometry-container', when: 'rect width or height delta exceeds tolerance' },
  { layer: 'typography-tokens', when: 'font family, size, weight or line-height differ' },
  { layer: 'color-tokens', when: 'color, background or border colors differ' },
  { layer: 'spacing', when: 'padding, margin or gap differ' },
  { layer: 'media-assets', when: 'media source, intrinsic size or object-fit differ' },
  { layer: 'component-css', when: 'pixels differ with matching geometry and properties' },
];
