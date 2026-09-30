import { open, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildBlindPacket,
  loadFrozenCases,
  preflightSourceIndexes,
  runReplay,
} from "./harness";

async function writeNewFile(path: string, content: string): Promise<void> {
  const file = await open(path, "wx");
  try {
    await file.writeFile(content, "utf8");
  } finally {
    await file.close();
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  // This validates the immutable bytes before runReplay can dynamically import
  // connectors/index and initialize any live providers.
  const cases = await loadFrozenCases();
  let hasLiveFlag = false;
  let benchmarkJudged = false;
  let outValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--live" && !hasLiveFlag) hasLiveFlag = true;
    else if (args[index] === "--independent-benchmark-judged" && !benchmarkJudged) benchmarkJudged = true;
    else if (args[index] === "--out" && !outValue && args[index + 1]) {
      outValue = args[index + 1];
      index += 1;
    } else {
      throw new Error("Unknown or duplicate CLI arguments.");
    }
  }
  if (!hasLiveFlag || !benchmarkJudged || !outValue) {
    throw new Error(
      "Usage: tsx cli.ts --live --independent-benchmark-judged --out <new-output-directory>. " +
      "The independent benchmark must be judged before live replay.",
    );
  }
  const outputDirectory = resolve(outValue);
  // Reserve the destination before any provider import or request. A repeated
  // invocation cannot accidentally trigger another same-run replay.
  await mkdir(outputDirectory);
  const connectors = await import("../../../connectors");
  const readinessPreflight = await preflightSourceIndexes(connectors.providerRegistry);
  const observations = await runReplay(cases, {
    allowLive: true,
    independentBenchmarkJudged: true,
    readinessPreflight,
  });
  const packet = buildBlindPacket(observations);
  await writeNewFile(
    resolve(outputDirectory, "observations.json"),
    `${JSON.stringify(observations, null, 2)}\n`,
  );
  await writeNewFile(
    resolve(outputDirectory, "blind-packet.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  console.log(`Replay observations and blind packet written once to ${outputDirectory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Replay CLI failed.");
    process.exitCode = 1;
  });
}