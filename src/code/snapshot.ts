export interface CodeFile {
  path: string;
  relPath: string;
  ext: string;
  language: string;
  bytes: number;
  lines: number;
  content: string;
  isTest: boolean;
  isGenerated: boolean;
}

export interface DependencyInfo {
  manager: "npm" | "pip" | "cargo" | "go" | "gem" | "composer" | "nuget" | "gradle" | "maven" | "other";
  manifestPath: string;
  lockfilePresent: boolean;
  dependencies: Array<{ name: string; version: string; pinned: boolean; scope: string }>;
  devDependencies: number;
}

export interface CodeSnapshot {
  root: string;
  files: CodeFile[];
  totalFiles: number;
  totalLines: number;
  scannedFiles: number;
  skippedFiles: number;
  languages: Record<string, { files: number; lines: number }>;
  dependencies: DependencyInfo[];
  git: {
    isRepo: boolean;
    commitCount: number | null;
    hasGitignore: boolean;
    trackedSecretCandidates: string[];
  };
  hasReadme: boolean;
  hasLicense: boolean;
  hasTests: boolean;
  generatedAt: string;
}

export const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".rb": "Ruby",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".cs": "C#",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".php": "PHP",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".sql": "SQL",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".fs": "F#",
  ".vb": "VB",
};
