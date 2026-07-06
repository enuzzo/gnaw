import { lstat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export async function writeRenderedSnapshot({
  haulPath,
  renderedPath,
  html
}: {
  haulPath: string;
  renderedPath: string;
  html: string;
}): Promise<void> {
  const safeRelativePath = validateRenderedPath(renderedPath);
  const outputRoot = resolve(haulPath);
  const renderedRoot = resolve(outputRoot, "study", "rendered");
  const pathParts = safeRelativePath.split("/");
  const outputPath = resolve(renderedRoot, ...pathParts);

  if (!isInside(renderedRoot, outputPath)) {
    throw new Error(`Refusing rendered snapshot outside haul: ${renderedPath}`);
  }

  await ensureSafeDirectory(outputRoot, ["study", "rendered", ...pathParts.slice(0, -1)]);
  await assertNotSymlink(outputPath);
  await writeFile(outputPath, html, "utf8");
}

function validateRenderedPath(renderedPath: string): string {
  if (isAbsolute(renderedPath)) {
    throw new Error(`Refusing rendered snapshot outside haul: ${renderedPath}`);
  }

  const parts = renderedPath.split(/[\\/]+/);
  if (parts[0] !== "study" || parts[1] !== "rendered") {
    throw new Error(`Rendered snapshot must be inside study/rendered: ${renderedPath}`);
  }

  const relativeParts = parts.slice(2);
  if (relativeParts.length < 1 || relativeParts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Refusing rendered snapshot outside rendered root: ${renderedPath}`);
  }

  return relativeParts.join("/");
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
