// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
import { walk } from "../../fs/walk.ts";
import { withoutAll } from "../../collections/without_all.ts";

// deno-lint-ignore no-explicit-any
type Object = Record<string, any>;

const encoder = new TextEncoder();

const NODE_API_BASE_URL = "https://api.github.com/repos/nodejs/node";
const NODE_BASE_URL = "https://github.com/nodejs/node";
const NODE_IGNORED_TESTS = [
  /^addons\//,
  /^async-hooks\/(?!test-async-local-storage)/,
  /^cctest\//,
  /^doctool\//,
  /^embedding\//,
  /^fixtures\//,
  /^fuzzers\//,
  /^js-native-api\//,
  /^node-api\//,
  /^overlapped-checker\//,
  /^report\//,
  /^testpy\//,
  /^tick-processor\//,
  /^tools\//,
  /^v8-updates\//,
  /^wasi\//,
  /^wpt\//,
];

async function getNodeTestDirSHA(): Promise<string> {
  const response = await fetch(NODE_API_BASE_URL + "/contents");
  const body = await response.json();
  return body
    .find(({ name }: Object) => name === "test")
    .sha;
}

async function getNodeTests(sha: string): Promise<string[]> {
  const url = NODE_API_BASE_URL + "/git/trees/" + sha + "?recursive=1";
  const response = await fetch(url);
  const body = await response.json();

  return body.tree
    .filter(({ path }: Object) =>
      path.includes("/test-") && path.endsWith(".js") &&
      !NODE_IGNORED_TESTS.some((regex) => regex.test(path))
    )
    .map(({ path }: Object) => path);
}

async function getDenoTests(): Promise<string[]> {
  const files: string[] = [];
  const denoTestDir = new URL("./test", import.meta.url);

  for await (const { path } of walk(denoTestDir, { exts: [".js"] })) {
    files.push(path.replace(denoTestDir.pathname + "/", ""));
  }

  return files;
}

async function getMissingTests(): Promise<string[]> {
  const nodeTestDirSHA = await getNodeTestDirSHA();
  const nodeTests = await getNodeTests(nodeTestDirSHA);

  const denoTests = await getDenoTests();

  return withoutAll(nodeTests, denoTests);
}

async function main() {
  const file = await Deno.open(new URL("./TODO.md", import.meta.url), {
    write: true,
  });

  await file.write(encoder.encode("# Remaining Node Tests\n\n"));

  const missingTests = await getMissingTests();
  for (let i = 0; i < missingTests.length; i++) {
    const test = missingTests[i];
    await file.write(
      encoder.encode(
        `${i + 1}. [${test}](${NODE_BASE_URL + "/tree/main/test/" + test})\n`,
      ),
    );
  }

  file.close();
}

if (import.meta.main) {
  await main();
}
