import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { test } from "node:test";
import {
  PixelVisualSimilarityAdapter,
  VisualSimilarityError,
} from "./index";

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

/** Build a real RGB PNG fixture locally, without third-party image packages. */
function makePng(pixel: (x: number, y: number) => [number, number, number]) {
  const width = 32;
  const height = 32;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // truecolor RGB
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0; // PNG filter: None
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = row + 1 + x * 3;
      scanlines[offset] = red;
      scanlines[offset + 1] = green;
      scanlines[offset + 2] = blue;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const redPng = makePng(() => [240, 24, 16]);
const bluePng = makePng(() => [16, 32, 240]);

test("pixel-derived visual similarity distinguishes different image pixels", async () => {
  const adapter = new PixelVisualSimilarityAdapter();
  const identical = await adapter.compareImages({ bytes: redPng }, { bytes: redPng });
  const different = await adapter.compareImages({ bytes: redPng }, { bytes: bluePng });

  assert.equal(identical.pixelScore, 1);
  assert.equal(identical.visualScore, 1);
  assert.ok(different.visualScore >= 0 && different.visualScore < identical.visualScore - 0.2);
});

test("URL is only a cache identity; image bytes are required and decoded locally", async () => {
  const adapter = new PixelVisualSimilarityAdapter();
  const result = await adapter.compareImages(
    { bytes: redPng, url: "file:///etc/passwd" },
    { bytes: redPng, url: "https://example.invalid/not-fetched.png" },
  );
  assert.equal(result.visualScore, 1);
});

test("rejects oversized and unsupported image inputs before decoding", async () => {
  const adapter = new PixelVisualSimilarityAdapter({ maxImageBytes: redPng.length });
  await assert.rejects(
    adapter.compareImages({ bytes: Buffer.concat([redPng, Buffer.from([0])]) }, { bytes: redPng }),
    (error: unknown) => error instanceof VisualSimilarityError && error.code === "IMAGE_TOO_LARGE",
  );
  await assert.rejects(
    adapter.compareImages({ bytes: Buffer.from("not an image") }, { bytes: redPng }),
    (error: unknown) => error instanceof VisualSimilarityError && error.code === "UNSUPPORTED_IMAGE",
  );
});

test("reports an unavailable local decoder explicitly", async () => {
  const adapter = new PixelVisualSimilarityAdapter({ executable: "/no/such/image-decoder" });
  await assert.rejects(
    adapter.compareImages({ bytes: redPng }, { bytes: redPng }),
    (error: unknown) =>
      error instanceof VisualSimilarityError && error.code === "IMAGE_DECODE_UNAVAILABLE",
  );
});

test("enforces the image decoder subprocess deadline", async () => {
  const adapter = new PixelVisualSimilarityAdapter({ decodeTimeoutMs: 1 });
  await assert.rejects(
    adapter.compareImages({ bytes: redPng }, { bytes: redPng }),
    (error: unknown) =>
      error instanceof VisualSimilarityError && error.code === "IMAGE_DECODE_TIMEOUT",
  );
});

test("decoder subprocess concurrency is module-wide with a bounded queue wait", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visual-decode-limit-"));
  const executable = join(directory, "fake-magick");
  const activeFile = join(directory, "active");
  const peakFile = join(directory, "peak");
  const lockFile = join(directory, "lock");
  const quote = (value: string) => `'${value.replace(/'/gu, "'\\''")}'`;
  const script = [
    "#!/bin/sh",
    `exec 9>${quote(lockFile)}`,
    "flock -x 9",
    `active=$(cat ${quote(activeFile)} 2>/dev/null || echo 0)`,
    "active=$((active + 1))",
    `printf '%s' \"$active\" > ${quote(activeFile)}`,
    `peak=$(cat ${quote(peakFile)} 2>/dev/null || echo 0)`,
    `if [ \"$active\" -gt \"$peak\" ]; then printf '%s' \"$active\" > ${quote(peakFile)}; fi`,
    "flock -u 9",
    "sleep 0.15",
    "flock -x 9",
    `active=$(cat ${quote(activeFile)})`,
    "active=$((active - 1))",
    `printf '%s' \"$active\" > ${quote(activeFile)}`,
    "flock -u 9",
    "head -c 3072 /dev/zero",
  ].join("\n");
  try {
    await writeFile(executable, script);
    await chmod(executable, 0o755);
    const firstAdapter = new PixelVisualSimilarityAdapter({
      executable,
      decodeTimeoutMs: 2_000,
      decodeQueueTimeoutMs: 2_000,
    });
    const secondAdapter = new PixelVisualSimilarityAdapter({
      executable,
      decodeTimeoutMs: 2_000,
      decodeQueueTimeoutMs: 20,
    });
    const firstCall = firstAdapter.compareImages({ bytes: redPng }, { bytes: redPng });
    const queuedCall = secondAdapter.compareImages({ bytes: bluePng }, { bytes: bluePng });
    await assert.rejects(
      queuedCall,
      (error: unknown) =>
        error instanceof VisualSimilarityError && error.code === "IMAGE_DECODE_QUEUE_TIMEOUT",
    );
    const result = await firstCall;
    assert.equal(result.visualScore, 1);
    assert.equal(Number(await readFile(peakFile, "utf8")), 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("optional embedding provider adds image and text comparison without replacing pixel scoring", async () => {
  const adapter = new PixelVisualSimilarityAdapter({
    embeddingProvider: {
      async embedImage(image) {
        return image.bytes === redPng ? [1, 0] : [0, 1];
      },
      async embedText(text) {
        return text === "red" ? [1, 0] : [0, 1];
      },
      compare(left, right) {
        return JSON.stringify(left) === JSON.stringify(right) ? 1 : 0;
      },
    },
  });
  const imageResult = await adapter.compareImages({ bytes: redPng }, { bytes: bluePng });
  assert.ok(imageResult.pixelScore < 1);
  assert.equal(imageResult.embeddingScore, 0);
  assert.ok(imageResult.visualScore < 1);
  const textResult = await adapter.compareImageToText({ bytes: redPng }, "red");
  assert.equal(textResult.embeddingScore, 1);
});