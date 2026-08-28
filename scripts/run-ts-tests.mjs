#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export class TypeScriptTestDiscoveryError extends Error {
  constructor(root) {
    super(`No TypeScript tests discovered under ${join(root, "src")}`);
    this.name = "TypeScriptTestDiscoveryError";
    this.root = root;
  }
}

export class TypeScriptTestProcessError extends Error {
  constructor(signal) {
    super(`TypeScript test process terminated by ${signal}`);
    this.name = "TypeScriptTestProcessError";
    this.signal = signal;
  }
}

async function collectTests(directory, root, collected) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTests(path, root, collected);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      collected.push(relative(root, path).split(sep).join("/"));
    }
  }
}

export async function discoverTypeScriptTests(root = process.cwd()) {
  const collected = [];
  await collectTests(join(root, "src"), root, collected);
  return collected.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export async function runTypeScriptTests(root = process.cwd()) {
  const tests = await discoverTypeScriptTests(root);
  if (tests.length === 0) throw new TypeScriptTestDiscoveryError(root);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--test", ...tests],
      { cwd: root, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new TypeScriptTestProcessError(signal));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  try {
    process.exitCode = await runTypeScriptTests();
  } catch (error) {
    if (error instanceof Error) console.error(error.message);
    else console.error("TypeScript test runner failed with a non-Error value");
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  await main();
}
