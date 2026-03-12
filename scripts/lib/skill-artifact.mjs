import fs from "node:fs/promises";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "json",
  "json5",
  "yaml",
  "yml",
  "toml",
  "js",
  "cjs",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "rb",
  "go",
  "rs",
  "swift",
  "kt",
  "java",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "sql",
  "csv",
  "ini",
  "cfg",
  "env",
  "xml",
  "html",
  "css",
  "scss",
  "sass",
  "svg",
]);

const PACKAGE_DEPENDENCY_SECTIONS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

export async function listTextFiles(root) {
  const files = [];

  async function walk(folder) {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === ".clawhub" || entry.name === ".clawdhub") continue;

      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relPath = path.relative(root, fullPath).split(path.sep).join("/");
      const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      const bytes = await fs.readFile(fullPath);
      files.push({ relPath, bytes });
    }
  }

  await walk(root);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}

export async function collectReleaseFiles(root) {
  await validateSelfContainedRelease(root);
  return listTextFiles(root);
}

export async function materializeReleaseFiles(files, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  for (const file of files) {
    const outputPath = path.join(outDir, fromPosixRel(file.relPath));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, file.bytes);
  }
}

export async function validateSelfContainedRelease(root) {
  const files = await listTextFiles(root);
  for (const file of files.filter((entry) => path.posix.basename(entry.relPath) === "package.json")) {
    const packageDir = path.resolve(root, fromPosixRel(path.posix.dirname(file.relPath)));
    const packageJson = JSON.parse(file.bytes.toString("utf8"));
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      const dependencies = packageJson[section];
      if (!dependencies || typeof dependencies !== "object") continue;

      for (const [name, spec] of Object.entries(dependencies)) {
        if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
        const targetDir = path.resolve(packageDir, spec.slice(5));
        if (!isWithinRoot(root, targetDir)) {
          throw new Error(
            `Release artifact is not self-contained: ${file.relPath} depends on ${name} via ${spec}`,
          );
        }
        await fs.access(targetDir).catch(() => {
          throw new Error(`Missing local dependency for release: ${file.relPath} -> ${spec}`);
        });
      }
    }
  }
}

function fromPosixRel(relPath) {
  return relPath === "." ? "." : relPath.split("/").join(path.sep);
}

function isWithinRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
