export interface DesktopFile {
  path: string;
  rel: string;
  ext: string;
  content: string;
  lines: string[];
}

export interface DesktopSnapshot {
  root: string;
  files: DesktopFile[];
  xamlFiles: DesktopFile[];
  csFiles: DesktopFile[];
  projectFiles: DesktopFile[];
  frameworks: string[];
  totalFiles: number;
  totalLines: number;
}

export const XAML_EXTS = new Set([".axaml", ".xaml"]);
