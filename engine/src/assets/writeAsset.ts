import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type NormalizeAssetPath = (url: string, contentType?: string | null) => string;

export interface WriteAssetOptions {
  outputRoot: string;
  url: string;
  contentType?: string | null;
  body: Buffer | Uint8Array;
  rootPrefix?: string;
  normalizedPath?: string;
  normalizePath?: NormalizeAssetPath;
}

export interface WriteAssetResult {
  bytes: number;
  sha256: string;
  rawPath: string;
}

export async function writeAsset(options: WriteAssetOptions): Promise<WriteAssetResult> {
  const body = Buffer.from(options.body);
  const normalizedPath = options.normalizedPath ?? options.normalizePath?.(options.url, options.contentType);

  if (!normalizedPath) {
    throw new Error("writeAsset requires normalizedPath or normalizePath");
  }

  const safeRelativePath = validateRelativeRawPath(normalizedPath);
  const outputRoot = resolve(options.outputRoot);
  const rootPrefix = options.rootPrefix ?? "study/raw";
  const rootParts = validateRootPrefix(rootPrefix).split("/");
  const rawRoot = resolve(outputRoot, ...rootParts);
  const pathParts = safeRelativePath.split("/");
  const absolutePath = resolve(rawRoot, ...pathParts);

  if (!isInside(rawRoot, absolutePath)) {
    throw new Error(`Refusing path traversal outside haul: ${normalizedPath}`);
  }

  await ensureSafeDirectory(outputRoot, [...rootParts, ...pathParts.slice(0, -1)]);
  await assertNotSymlink(absolutePath);
  await writeFile(absolutePath, body);

  return {
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
    rawPath: `${rootParts.join("/")}/${safeRelativePath}`
  };
}

function validateRootPrefix(path: string): string {
  if (isAbsolute(path)) {
    throw new Error(`Refusing path traversal outside haul: ${path}`);
  }
  const parts = path.split(/[\\/]+/);
  if (parts.length < 1 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Refusing path traversal outside haul: ${path}`);
  }
  return parts.join("/");
}

function validateRelativeRawPath(path: string): string {
  if (isAbsolute(path)) {
    throw new Error(`Refusing path traversal outside haul: ${path}`);
  }

  const parts = path.split(/[\\/]+/);
  if (parts.length < 2 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Refusing path traversal outside haul: ${path}`);
  }

  return parts.join("/");
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath !== "" && !relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath);
}

async function ensureSafeDirectory(root: string, parts: string[]): Promise<void> {
  let current = root;
  await mkdir(current, { recursive: true });
  await assertDirectoryNotSymlink(current);

  for (const part of parts) {
    current = resolve(current, part);
    await mkdir(current, { recursive: false }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
    });
    await assertDirectoryNotSymlink(current);
  }
}

async function assertDirectoryNotSymlink(filePath: string): Promise<void> {
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink inside haul: ${filePath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to write through non-directory inside haul: ${filePath}`);
  }
}

async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink inside haul: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
