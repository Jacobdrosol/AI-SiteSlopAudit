export interface ComputedTextNode {
  tag: string;
  text: string;
  fontSize: number;
  lineHeight: number | null;
  fontFamily: string;
  fontWeight: string;
  color: string;
  letterSpacing: string;
  width: number;
  siblingIndex: number;
  bgColor: string | null;
  bgComplex: boolean;
  selector: string;
  parentSelector: string | null;
  /** Clipped/screen-reader-only text: real DOM text, but not painted. Contrast
   *  checks must skip it, or every sr-only label looks like invisible text. */
  visuallyHidden?: boolean;
}

export interface ColorSample {
  selector: string;
  property: string;
  value: string;
}

export interface GradientSample {
  selector: string;
  backgroundImage: string;
  textClip: string | null;
}

export interface IconSample {
  selector: string;
  source: string;
  classes: string;
  size: number | null;
  strokeWidth: string | null;
}

export interface ImageSample {
  src: string;
  alt: string | null;
  width: number;
  height: number;
  role: string | null;
  naturalWidth: number;
  naturalHeight: number;
  isDataUri: boolean;
  isSvgPlaceholder: boolean;
  loading: string | null;
  /** CSS object-fit. "cover"/"contain" crop or letterbox on purpose, so a
   *  display aspect that differs from the natural one is not distortion. */
  objectFit?: string;
}

export interface ScriptSample {
  src: string;
  integrity: string | null;
  origin: string | null;
  crossOrigin: boolean;
}

export interface LinkSample {
  href: string;
  rel: string;
  integrity: string | null;
}

export interface FormSample {
  action: string;
  method: string;
  secure: boolean;
  hasPassword: boolean;
  passwordOverHttp: boolean;
}

export interface InteractiveSample {
  selector: string;
  tag: string;
  text: string;
  width: number;
  height: number;
  ariaLabel: string | null;
  hasVisibleFocusHint: boolean;
  /** Inside <header>|<nav>|<footer>: site chrome, not page content. */
  inChrome?: boolean;
  /** Distance from the top of the document, after scrolling to the top. */
  top?: number;
  /** A link inside flowing text (a paragraph, list item, caption). WCAG 2.5.5
   *  exempts these from the 44px target minimum. */
  inText?: boolean;
}

export interface HeadingSample {
  level: number;
  text: string;
  selector: string;
}

export interface LayoutSection {
  selector: string;
  tag: string;
  childCount: number;
  cardLikeChildren: number;
  columns: number;
  isGrid: boolean;
  textDensity: number;
  boundingBox: { width: number; height: number; top?: number } | null;
}

export interface ViewportCapture {
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
  horizontalOverflow: boolean;
  overflowAmount: number;
  /** True when horizontal overflow exists but is hidden, clipping content. */
  clipped?: boolean;
  screenshot?: string;
  bodyFontSize: number;
  /** Interactives visible at THIS viewport width. Touch-target checks must use
   *  the mobile capture, not the desktop one, or desktop nav links are judged
   *  by a phone threshold they never face. */
  interactives?: InteractiveSample[];
}

export interface MotifScan {
  eyebrowBadges: number;
  iconTiles: number;
  stepLabels: number;
  chipRows: number;
  chipCount: number;
  headingIcons: number;
  bicolorHeadings: number;
  kindCount: number;
  total: number;
  samples: string[];
}

export interface WebSnapshot {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  responseHeaders: Record<string, string>;
  title: string;
  metaDescription: string | null;
  viewportMeta: string | null;
  lang: string | null;
  textNodes: ComputedTextNode[];
  colors: ColorSample[];
  gradients: GradientSample[];
  icons: IconSample[];
  images: ImageSample[];
  interactives: InteractiveSample[];
  headings: HeadingSample[];
  sections: LayoutSection[];
  animations: Array<{ selector: string; animationName: string; duration: string }>;
  glassmorphism: ColorSample[];
  cssVariables: Record<string, string>;
  /** True when any stylesheet defines a visible :focus / :focus-visible style. */
  hasFocusStyles?: boolean;
  motifs: MotifScan;
  stylesheets: string[];
  scriptSources: string[];
  scriptTags: ScriptSample[];
  linkedResources: LinkSample[];
  forms: FormSample[];
  inlineScriptBytes: number;
  captures: ViewportCapture[];
  generatedAt: string;
}
