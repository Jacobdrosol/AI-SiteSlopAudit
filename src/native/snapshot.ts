export type NativeFileKind =
  | "source"
  | "header"
  | "cmake"
  | "project"
  | "shader"
  | "ui"
  | "test"
  | "other";

export interface NativeFile {
  path: string;
  rel: string;
  ext: string;
  content: string;
  lines: string[];
  kind: NativeFileKind;
}

export interface NativeSnapshot {
  root: string;
  files: NativeFile[];
  sourceFiles: NativeFile[];
  headerFiles: NativeFile[];
  cmakeFiles: NativeFile[];
  projectFiles: NativeFile[];
  shaderFiles: NativeFile[];
  uiFiles: NativeFile[];
  testFiles: NativeFile[];
  frameworks: string[];
  testFrameworks: string[];
  totalFiles: number;
  totalLines: number;
}

export const CPP_SOURCE_EXTS = new Set([".c", ".cc", ".cpp", ".cxx", ".m", ".mm"]);
export const CPP_HEADER_EXTS = new Set([".h", ".hh", ".hpp", ".hxx", ".inl", ".ipp"]);
export const SHADER_EXTS = new Set([
  ".hlsl", ".hlsli", ".glsl", ".vert", ".frag", ".geom", ".comp", ".tesc", ".tese", ".wgsl", ".metal",
]);
export const UI_EXTS = new Set([".ui", ".qml", ".qrc", ".qss"]);
export const NATIVE_PROJECT_FILES = new Set([
  "cmakelists.txt", "makefile", "meson.build", "xmake.lua", "premake5.lua",
  "project.godot",
]);
export const NATIVE_PROJECT_EXT = new Set([".vcxproj", ".sln", ".pro", ".pri", ".uproject", ".uplugin"]);
