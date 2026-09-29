import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SEARCH_V3_BENCHMARK_30 } from "./groundTruth";
import type { Benchmark30Report, Benchmark30ProductMetadata } from "./liveRunner";
import { QUERY_IMAGE_REVIEWS } from "./imageReview";

type Candidate = Pick<
  Benchmark30ProductMetadata,
  "title" | "description" | "providerId" | "brand" | "productType" |
  "category" | "subcategory" | "color" | "price" | "currency" |
  "condition" | "location" | "availability"
> & { candidateId: string };

export type BlindPoolCase = {
  caseId: string;
  group: string;
  query: string;
  intendedProduct: string;
  hardConstraints: readonly string[];
  exactCriteria: readonly string[];
  closeCriteria: readonly string[];
  unacceptableCriteria: readonly string[];
  expectedNoMatchBehavior: string;
  visibleImageAttributes: readonly string[];
  candidates: Candidate[];
};

/** Results and rankings deliberately stay in a separate mapping file. */
export function makeBlindPool(report: Benchmark30Report): {
  pools: BlindPoolCase[];
  mapping: Record<string, Record<"v2" | "v3Local" | "v3Gemini", string[]>>;
} {
  const definitions = new Map(SEARCH_V3_BENCHMARK_30.map((item) => [item.id, item]));
  const reviews = new Map(QUERY_IMAGE_REVIEWS.map((review) => [review.caseId, review]));
  const mapping: Record<string, Record<"v2" | "v3Local" | "v3Gemini", string[]>> = {};
  const pools: BlindPoolCase[] = [];
  for (const record of report.cases) {
    if (!record.scorable) continue;
    const definition = definitions.get(record.caseId);
    if (!definition) throw new Error(`Unrecognized case: ${record.caseId}`);
    const candidates = new Map<string, Candidate>();
    const idByKey = new Map<string, string>();
    const ranks = { v2: [] as string[], v3Local: [] as string[], v3Gemini: [] as string[] };
    for (const arm of ["v2", "v3Local", "v3Gemini"] as const) {
      if (record[arm].status !== "success") continue;
      for (const product of record[arm].products?.slice(0, 5) ?? []) {
        const key = `${product.id}|${product.title.toLowerCase()}|${product.price ?? "unknown"}`;
        let candidateId = idByKey.get(key);
        if (!candidateId) {
          candidateId = createHash("sha256").update(key).digest("hex").slice(0, 12);
          idByKey.set(key, candidateId);
          candidates.set(candidateId, {
            candidateId,
            title: product.title,
            description: product.description?.slice(0, 1000) ?? null,
            providerId: product.providerId,
            brand: product.brand,
            productType: product.productType,
            category: product.category,
            subcategory: product.subcategory,
            color: product.color,
            price: product.price,
            currency: product.currency,
            condition: product.condition,
            location: product.location,
            availability: product.availability,
          });
        }
        ranks[arm].push(candidateId);
      }
    }
    mapping[record.caseId] = ranks;
    pools.push({
      caseId: record.caseId,
      group: record.group,
      query: record.query,
      intendedProduct: definition.intendedProduct,
      hardConstraints: definition.hardConstraints,
      exactCriteria: definition.exactCriteria,
      closeCriteria: definition.closeCriteria,
      unacceptableCriteria: definition.unacceptableCriteria,
      expectedNoMatchBehavior: definition.expectedNoMatchBehavior,
      visibleImageAttributes: reviews.get(record.caseId)?.visibleAttributes ?? [],
      candidates: [...candidates.values()].sort((a, b) => a.title.localeCompare(b.title)),
    });
  }
  return { pools, mapping };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, outputPrefix] = process.argv.slice(2);
  if (!input || !outputPrefix || !outputPrefix.startsWith("/tmp/")) {
    throw new Error("Usage: blindPool.ts <live-report.json> </tmp/output-prefix>");
  }
  const report = JSON.parse(readFileSync(input, "utf8")) as Benchmark30Report;
  const { pools, mapping } = makeBlindPool(report);
  const midpoint = Math.ceil(pools.length / 2);
  writeFileSync(`${outputPrefix}-a.json`, JSON.stringify(pools.slice(0, midpoint), null, 2));
  writeFileSync(`${outputPrefix}-b.json`, JSON.stringify(pools.slice(midpoint), null, 2));
  writeFileSync(`${outputPrefix}-mapping.json`, JSON.stringify(mapping, null, 2));
}