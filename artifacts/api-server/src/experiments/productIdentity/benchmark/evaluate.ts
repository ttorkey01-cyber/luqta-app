import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessSameProductCheaper } from "../cheaper";
import { classifyPair } from "../engine";
import { groupCandidates } from "../grouping";
import { normalizeIdentifier } from "../identifiers";
import type { IdentityRecord, PairClassification } from "../types";

const EXPECTED_PAIRS_SHA256 =
  "41f8584c9a517f1a765127546353353fe6ff97ff31925f2d8c22287a63f475af";
const ROOT = new URL("./", import.meta.url);

type CorpusPair = {
  id: string;
  sourceClass: "REAL_OBSERVED" | "CONTROLLED" | "UNVERIFIABLE";
  category: string;
  left: IdentityRecord;
  right: IdentityRecord;
  query?: string | Record<string, unknown>;
};

type BlindPair = {
  id: string;
  left: IdentityRecord;
  right: IdentityRecord;
  query?: string | Record<string, unknown>;
};

type BlindLabel = {
  id: string;
  classification: PairClassification;
  adequatelyAdjudicated: boolean;
  rationale: string;
  positiveEvidence: string[];
  conflictingEvidence: string[];
  unknownEvidence: string[];
};

export type BenchmarkInput = {
  pairs: CorpusPair[];
  blindPairs: BlindPair[];
  labels: BlindLabel[];
  mapping: Array<{ blindId: string; originalId: string }>;
};

type Metric = {
  numerator: number;
  denominator: number;
  value: number | "NOT_SCOREABLE";
  reason?: string;
};

type ScoredCase = {
  blindId: string;
  originalId: string;
  sourceClass: CorpusPair["sourceClass"];
  category: string;
  label: BlindLabel["classification"];
  adequatelyAdjudicated: boolean;
  prediction: PairClassification;
  confidence: number;
  exactPrediction: boolean;
  unsafeExactOnUnadjudicated: boolean;
  mismatch: boolean | null;
  mismatchReasons: string[];
  evidenceReasons: string[];
  labelRationale: string;
  labelPositiveEvidence: string[];
  conflictingEvidencePredicted: string[];
  labelConflictingEvidence: string[];
  labelUnknownEvidence: string[];
  productGroupCount: number;
  variantGroupCount: number;
  offerGroupCount: number | null;
  cheaperClaim: boolean;
  cheaperClassification: string;
  cheaperEvidence: string[];
};

const metric = (numerator: number, denominator: number, reason: string): Metric =>
  denominator
    ? { numerator, denominator, value: numerator / denominator }
    : { numerator, denominator, value: "NOT_SCOREABLE", reason };

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ")
    : "";
}

function hasEvidence(decision: ReturnType<typeof classifyPair>, code: string): boolean {
  return [...decision.positiveEvidence, ...decision.conflictingEvidence]
    .some((item) => item.code === code);
}

function hasGtin(record: IdentityRecord): boolean {
  return (record.identifiers ?? []).some((identifier) => /^GTIN(?:8|12|13|14)?$/i.test(identifier.kind));
}

function independentlyValidGtin(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function countWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function confusion(predicted: boolean[], expected: boolean[]) {
  const tp = predicted.filter((value, index) => value && expected[index]).length;
  const fp = predicted.filter((value, index) => value && !expected[index]).length;
  const fn = predicted.filter((value, index) => !value && expected[index]).length;
  const tn = predicted.filter((value, index) => !value && !expected[index]).length;
  return {
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    accuracy: metric(tp + tn, predicted.length, "No adequately adjudicated evidence cases."),
    precision: metric(tp, tp + fp, "No positive predictions."),
    recall: metric(tp, tp + fn, "No independently labeled positive cases."),
  };
}

function joinInput(input: BenchmarkInput): Array<{
  blind: BlindPair;
  label: BlindLabel;
  original: CorpusPair;
}> {
  const originals = new Map(input.pairs.map((pair) => [pair.id, pair]));
  const blinds = new Map(input.blindPairs.map((pair) => [pair.id, pair]));
  const labels = new Map(input.labels.map((label) => [label.id, label]));
  const blindIds = new Set<string>();
  const originalIds = new Set<string>();
  const joined = input.mapping.map(({ blindId, originalId }) => {
    if (blindIds.has(blindId) || originalIds.has(originalId)) {
      throw new Error(`Duplicate blind/original mapping for ${blindId} -> ${originalId}`);
    }
    blindIds.add(blindId);
    originalIds.add(originalId);
    const blind = blinds.get(blindId);
    const label = labels.get(blindId);
    const original = originals.get(originalId);
    if (!blind || !label || !original) {
      throw new Error(`Incomplete blind-ID join for ${blindId} -> ${originalId}`);
    }
    return { blind, label, original };
  });
  if (joined.length !== input.pairs.length ||
      joined.length !== input.blindPairs.length ||
      joined.length !== input.labels.length) {
    throw new Error("Corpus, blind pair, label, and mapping counts must match exactly.");
  }
  return joined;
}

export function scoreBenchmark(input: BenchmarkInput) {
  const joined = joinInput(input);
  const cases: ScoredCase[] = joined.map(({ blind, label, original }) => {
    const decision = classifyPair(blind.left, blind.right, blind.query);
    const groups = groupCandidates([blind.left, blind.right]);
    const productGroupCount = groups.length;
    const variantGroupCount = groups.reduce((sum, group) => sum + group.variants.length, 0);
    const offerGroups = groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.offers));
    const hasOffers = !!(blind.left.offer || blind.right.offer);
    const cheaper = assessSameProductCheaper(blind.left, blind.right, {
      now: "2026-09-30T23:59:59.999Z",
    });
    const mismatch = label.adequatelyAdjudicated
      ? decision.classification !== label.classification
      : null;
    const mismatchReasons = mismatch
      ? [`Expected ${label.classification}; predicted ${decision.classification}.`, label.rationale]
      : [];
    if (!label.adequatelyAdjudicated && decision.classification !== "UNKNOWN") {
      mismatchReasons.push("Unadjudicated listing evidence produced a non-UNKNOWN classification.");
    }
    return {
      blindId: blind.id,
      originalId: original.id,
      sourceClass: original.sourceClass,
      category: original.category,
      label: label.classification,
      adequatelyAdjudicated: label.adequatelyAdjudicated,
      prediction: decision.classification,
      confidence: decision.confidence,
      exactPrediction: decision.classification === "SAME_PRODUCT_SAME_VARIANT",
      unsafeExactOnUnadjudicated:
        !label.adequatelyAdjudicated && decision.classification === "SAME_PRODUCT_SAME_VARIANT",
      mismatch,
      mismatchReasons,
      labelRationale: label.rationale,
      labelPositiveEvidence: label.positiveEvidence,
      evidenceReasons: [
        ...decision.positiveEvidence.map((item) => `+ ${item.code}: ${item.detail}`),
        ...decision.conflictingEvidence.map((item) => `! ${item.code}: ${item.detail}`),
        ...decision.unknownEvidence.map((item) => `? ${item.code}: ${item.detail}`),
      ],
      conflictingEvidencePredicted: decision.conflictingEvidence.map((item) => item.code),
      labelConflictingEvidence: label.conflictingEvidence,
      labelUnknownEvidence: label.unknownEvidence,
      productGroupCount,
      variantGroupCount,
      offerGroupCount: hasOffers ? offerGroups.length : null,
      cheaperClaim: cheaper.isCheaper,
      cheaperClassification: cheaper.classification,
      cheaperEvidence: cheaper.evidence.map((item) => `${item.code}: ${item.detail}`),
    };
  });

  const adjudicated = cases.filter((item) => item.adequatelyAdjudicated);
  const exactPositive = adjudicated.filter((item) =>
    item.label === "SAME_PRODUCT_SAME_VARIANT");
  const exactNegative = adjudicated.filter((item) =>
    item.label !== "SAME_PRODUCT_SAME_VARIANT");
  const exactOnAdjudicated = adjudicated.filter((item) => item.exactPrediction);
  const sameProductLabels: PairClassification[] = [
    "SAME_PRODUCT_SAME_VARIANT",
    "SAME_PRODUCT_DIFFERENT_VARIANT",
    "PROBABLE_SAME_PRODUCT",
  ];
  const predictedSameProduct = (item: ScoredCase) =>
    sameProductLabels.includes(item.prediction);
  const sameProductGroundTruth = (item: ScoredCase) =>
    sameProductLabels.includes(item.label);

  const conflictCases = adjudicated.map((item) => ({
    predicted: item.conflictingEvidencePredicted.length > 0,
    expected: item.labelConflictingEvidence.length > 0,
  }));
  const conflictEvidence = confusion(
    conflictCases.map((item) => item.predicted),
    conflictCases.map((item) => item.expected),
  );
  const conflictClass = confusion(
    adjudicated.map((item) => item.prediction === "DIFFERENT_PRODUCT"),
    adjudicated.map((item) => item.label === "DIFFERENT_PRODUCT"),
  );

  const gtinCases = joined.filter(({ blind, label }) =>
    label.adequatelyAdjudicated && hasGtin(blind.left) && hasGtin(blind.right));
  const gtinMatching = gtinCases.map(({ blind, label }) => {
    const left = (blind.left.identifiers ?? []).filter((item) => /^GTIN(?:8|12|13|14)?$/i.test(item.kind));
    const right = (blind.right.identifiers ?? []).filter((item) => /^GTIN(?:8|12|13|14)?$/i.test(item.kind));
    const expectedMatch = left.some((a) => right.some((b) =>
      independentlyValidGtin(a.value) && independentlyValidGtin(b.value) &&
      normalizeIdentifier(a).normalized === normalizeIdentifier(b).normalized));
    const expectedConflict = label.conflictingEvidence.some((item) => /gtin/i.test(item));
    const expected = expectedMatch ? true : expectedConflict ? false : null;
    return {
      expected,
      predicted: false,
      blindId: blind.id,
      left,
      right,
    };
  }).filter((item) => item.expected !== null);
  for (const item of gtinMatching) {
    const joinedCase = cases.find((candidate) => candidate.blindId === item.blindId)!;
    item.predicted = joinedCase.conflictingEvidencePredicted.includes("CONFLICTING_GTIN") === false &&
      joinedCase.evidenceReasons.some((reason) => reason.includes("MATCHED_GTIN"));
  }
  const gtinValues = joined.flatMap(({ blind }) =>
    [...(blind.left.identifiers ?? []), ...(blind.right.identifiers ?? [])]
      .filter((item) => /^GTIN(?:8|12|13|14)?$/i.test(item.kind)));
  const validationMatches = gtinValues.filter((identifier) =>
    (normalizeIdentifier(identifier).status === "VALID") === independentlyValidGtin(identifier.value)).length;

  const fieldCases = adjudicated.flatMap((item) => {
    const source = joined.find(({ blind }) => blind.id === item.blindId)!.blind;
    const brandAvailable = !!normalize(source.left.brand) && !!normalize(source.right.brand);
    const modelAvailable = !!normalize(source.left.model) && !!normalize(source.right.model);
    const sameBrand = brandAvailable && normalize(source.left.brand) === normalize(source.right.brand);
    const sameModel = modelAvailable && normalize(source.left.model) === normalize(source.right.model);
    return [
      ...(brandAvailable ? [{
        expected: sameBrand,
        predicted: item.evidenceReasons.some((reason) => reason.includes("MATCHED_BRAND_MODEL")) ||
          item.conflictingEvidencePredicted.includes("CONFLICTING_BRAND"),
      }] : []),
      ...(modelAvailable ? [{
        expected: sameBrand && sameModel,
        predicted: item.evidenceReasons.some((reason) => reason.includes("MATCHED_BRAND_MODEL")) ||
          item.conflictingEvidencePredicted.includes("CONFLICTING_MODEL"),
      }] : []),
    ];
  });
  const brandModel = confusion(
    fieldCases.map((item) => item.predicted),
    fieldCases.map((item) => item.expected),
  );

  function coverage(items: ScoredCase[]) {
    const classified = items.filter((item) => item.prediction !== "UNKNOWN").length;
    const abstained = items.length - classified;
    return {
      classified: metric(classified, items.length, "No pairs in this slice."),
      abstained: metric(abstained, items.length, "No pairs in this slice."),
      counts: { classified, abstained, total: items.length },
    };
  }

  function sliceMetrics(items: ScoredCase[]) {
    const eligible = items.filter((item) => item.adequatelyAdjudicated);
    return {
      pairs: items.length,
      adequatelyAdjudicated: eligible.length,
      variantClassificationAccuracy: metric(
        countWhere(eligible, (item) => item.prediction === item.label),
        eligible.length,
        "No adequately adjudicated pairs in this slice.",
      ),
      exactPrecision: metric(
        countWhere(eligible, (item) =>
          item.exactPrediction && item.label === "SAME_PRODUCT_SAME_VARIANT"),
        countWhere(eligible, (item) => item.exactPrediction),
        "No adequately adjudicated EXACT predictions.",
      ),
      exactRecall: metric(
        countWhere(eligible, (item) =>
          item.exactPrediction && item.label === "SAME_PRODUCT_SAME_VARIANT"),
        countWhere(eligible, (item) => item.label === "SAME_PRODUCT_SAME_VARIANT"),
        "No adequately adjudicated same-product/same-variant labels.",
      ),
      coverage: coverage(items),
    };
  }

  const categorySlice = (name: string, predicate: (item: ScoredCase) => boolean) => ({
    ...sliceMetrics(cases.filter(predicate)),
    name,
  });
  const categories = {
    Nike: categorySlice("Nike", (item) => /nike/.test(item.category.toLowerCase()) ||
      item.evidenceReasons.some((reason) => /nike/i.test(reason)) ||
      joined.some(({ blind }) => blind.id === item.blindId &&
        /nike/i.test(`${blind.left.brand} ${blind.right.brand} ${blind.left.title} ${blind.right.title}`))),
    electronics: categorySlice("electronics", (item) =>
      /electronics|storage|phone|laptop|tablet|earbuds|smart-watch/i.test(item.category)),
    beauty: categorySlice("beauty", (item) => /beauty|volume|pack/i.test(item.category)),
    automotive: categorySlice("automotive", (item) => /automotive|oem|fitment|car|vehicle/i.test(item.category)),
  };

  const sameVariantPair = adjudicated.filter((item) =>
    item.label === "SAME_PRODUCT_SAME_VARIANT");
  const distinctVariantPair = adjudicated.filter((item) =>
    item.label === "SAME_PRODUCT_DIFFERENT_VARIANT");
  const labeledSameProduct = adjudicated.filter(sameProductGroundTruth);
  const labeledDifferentProduct = adjudicated.filter((item) =>
    item.label === "DIFFERENT_PRODUCT");
  const offerCases = cases.filter((item) => item.offerGroupCount !== null);
  const offerExpectedSeparate = offerCases.filter((item) => {
    const { blind } = joined.find(({ blind }) => blind.id === item.blindId)!;
    const left = blind.left.offer;
    const right = blind.right.offer;
    return !!left && !!right && (
      (left.providerOfferId && right.providerOfferId &&
        (normalize(blind.left.providerId) !== normalize(blind.right.providerId) ||
          normalize(left.providerOfferId) !== normalize(right.providerOfferId))) ||
      (!left.providerOfferId || !right.providerOfferId)
    );
  });
  const offerSeparationCorrect = offerCases.filter((item) => {
    const { blind } = joined.find(({ blind }) => blind.id === item.blindId)!;
    const left = blind.left.offer;
    const right = blind.right.offer;
    if (!left || !right) return item.offerGroupCount === 1;
    const expectedSeparate = offerExpectedSeparate.includes(item);
    return expectedSeparate ? item.offerGroupCount === 2 : item.offerGroupCount === 1;
  }).length;
  const trueCheaperClaims = cases.filter((item) => item.cheaperClaim);
  const unsafeCheaperClaims = trueCheaperClaims.filter((item) =>
    !item.adequatelyAdjudicated || item.label !== "SAME_PRODUCT_SAME_VARIANT");
  const comparableOfferCases = cases.filter((item) =>
    item.cheaperEvidence.some((reason) => reason.startsWith("FRESH_IN_STOCK_SAME_CURRENCY:")));
  const comparableCheaperClaims = trueCheaperClaims.filter((item) =>
    item.cheaperEvidence.some((reason) =>
      reason.startsWith("FRESH_IN_STOCK_SAME_CURRENCY:")));
  const unsafeComparableClaims = comparableCheaperClaims.filter((item) =>
    !item.adequatelyAdjudicated || item.label !== "SAME_PRODUCT_SAME_VARIANT");
  const labeledSameVariantCases = adjudicated.filter((item) =>
    item.label === "SAME_PRODUCT_SAME_VARIANT");
  const exactFalseCount = countWhere(exactOnAdjudicated, (item) =>
    item.label !== "SAME_PRODUCT_SAME_VARIANT");
  const exactNonmatchFalsePositiveCount = countWhere(exactNegative, (item) =>
    item.exactPrediction);
  const falseMerges = countWhere(labeledDifferentProduct, (item) =>
    item.productGroupCount === 1);
  const falseSplits = countWhere(labeledSameProduct, (item) =>
    item.productGroupCount > 1);
  const probablePredictions = adjudicated.filter((item) =>
    item.prediction === "PROBABLE_SAME_PRODUCT");
  const probableLabels = adjudicated.filter((item) =>
    item.label === "PROBABLE_SAME_PRODUCT");

  return {
    schemaVersion: 1,
    benchmark: "independent-product-identity",
    corpusSha256: EXPECTED_PAIRS_SHA256,
    corpusPairs: cases.length,
    joinMethod: "blindId -> blind-map.originalId -> pairs.id; labels joined by blindId",
    metrics: {
      exactIdentity: {
        definition: "EXACT means SAME_PRODUCT_SAME_VARIANT. Precision/recall use adequately adjudicated cases only.",
        precision: metric(
          countWhere(exactOnAdjudicated, (item) => item.label === "SAME_PRODUCT_SAME_VARIANT"),
          exactOnAdjudicated.length,
          "No adequately adjudicated EXACT predictions.",
        ),
        recall: metric(
          countWhere(exactOnAdjudicated, (item) => item.label === "SAME_PRODUCT_SAME_VARIANT"),
          exactPositive.length,
          "No adequately adjudicated same-product/same-variant labels.",
        ),
        falseExactRate: metric(
          exactFalseCount,
          exactOnAdjudicated.length,
          "No adequately adjudicated EXACT predictions.",
        ),
        nonmatchFalsePositiveRate: metric(
          exactNonmatchFalsePositiveCount,
          exactNegative.length,
          "No adequately adjudicated non-EXACT labels.",
        ),
        unadjudicatedUnsafeExact: metric(
          countWhere(cases.filter((item) => !item.adequatelyAdjudicated),
            (item) => item.unsafeExactOnUnadjudicated),
          cases.filter((item) => !item.adequatelyAdjudicated).length,
          "No unadjudicated pairs.",
        ),
        unadjudicatedNonUnknown: metric(
          countWhere(cases.filter((item) => !item.adequatelyAdjudicated),
            (item) => item.prediction !== "UNKNOWN"),
          cases.filter((item) => !item.adequatelyAdjudicated).length,
          "No unadjudicated pairs.",
        ),
      },
      classification: {
        variantClassificationAccuracy: metric(
          countWhere(adjudicated, (item) => item.prediction === item.label),
          adjudicated.length,
          "No adequately adjudicated pairs.",
        ),
        falseMerge: metric(
          falseMerges,
          labeledDifferentProduct.length,
          "No adequately adjudicated DIFFERENT_PRODUCT cases.",
        ),
        falseSplit: metric(
          falseSplits,
          labeledSameProduct.length,
          "No adequately adjudicated same-product cases.",
        ),
        groupingFalseMergeCount: falseMerges,
        groupingFalseSplitCount: falseSplits,
        probableMisclassification: {
          falsePredictionRate: metric(
            countWhere(probablePredictions, (item) => item.label !== "PROBABLE_SAME_PRODUCT"),
            probablePredictions.length,
            "No adequately adjudicated PROBABLE_SAME_PRODUCT predictions.",
          ),
          classificationRecall: metric(
            countWhere(probableLabels, (item) => item.prediction === "PROBABLE_SAME_PRODUCT"),
            probableLabels.length,
            "No adequately adjudicated PROBABLE_SAME_PRODUCT labels.",
          ),
          predictedCount: probablePredictions.length,
          mislabeledPredictionCount: countWhere(probablePredictions, (item) =>
            item.label !== "PROBABLE_SAME_PRODUCT"),
        },
      },
      conflictDetection: {
        againstIndependentConflictingEvidence: conflictEvidence,
        againstDifferentProductClass: conflictClass,
      },
      gtin: {
        matchingAccuracy: metric(
          countWhere(gtinMatching, (item) => item.predicted === item.expected),
          gtinMatching.length,
          "No adequately adjudicated pairs with GTIN identifiers and independent GTIN conflict/match evidence.",
        ),
        matchingCases: gtinMatching.map((item) => ({
          blindId: item.blindId,
          expectedMatch: item.expected,
          predictedMatch: item.predicted,
        })),
        validationAccuracyAgainstIndependentCheckDigit: metric(
          validationMatches,
          gtinValues.length,
          "No GTIN identifiers in the corpus.",
        ),
        validationCounts: {
          identifiers: gtinValues.length,
          independentlyValid: countWhere(gtinValues, (item) => independentlyValidGtin(item.value)),
          engineValid: countWhere(gtinValues, (item) => normalizeIdentifier(item).status === "VALID"),
        },
      },
      brandModelEvidenceAccuracy: {
        accuracy: brandModel.accuracy,
        precision: brandModel.precision,
        recall: brandModel.recall,
        truePositive: brandModel.truePositive,
        falsePositive: brandModel.falsePositive,
        falseNegative: brandModel.falseNegative,
        trueNegative: brandModel.trueNegative,
        definition: "Detection of directly equal brand/model fields against their normalized field agreement; this is evidence-field accuracy, not whole-pair identity accuracy.",
      },
      grouping: {
        productGroupingAccuracy: metric(
          countWhere(adjudicated, (item) =>
            (item.productGroupCount === 1) === sameProductGroundTruth(item)),
          adjudicated.length,
          "No adequately adjudicated pairs.",
        ),
        variantSeparation: metric(
          countWhere(distinctVariantPair, (item) => item.variantGroupCount > 1),
          distinctVariantPair.length,
          "No adequately adjudicated different-variant pairs.",
        ),
        sameVariantConsolidation: metric(
          countWhere(sameVariantPair, (item) => item.variantGroupCount === 1),
          sameVariantPair.length,
          "No adequately adjudicated same-variant pairs.",
        ),
        offerSeparation: metric(
          offerSeparationCorrect,
          offerCases.length,
          "No pairs with offer information.",
        ),
        offerPairs: offerCases.length,
      },
      sameProductCheaper: {
        trueComparableOfferCoverage: metric(
          comparableOfferCases.length,
          labeledSameVariantCases.length,
          "No adequately adjudicated SAME_PRODUCT_SAME_VARIANT cases to assess for comparable offers.",
        ),
        comparableOfferCount: comparableOfferCases.length,
        comparableOfferDenominator: labeledSameVariantCases.length,
        unsafeClaimsPerComparableOffer: metric(
          unsafeComparableClaims.length,
          comparableOfferCases.length,
          "No fresh, in-stock, same-currency comparable offers.",
        ),
        trueComparableOfferDenominator: comparableOfferCases.length,
        unsafeComparableClaimCount: unsafeComparableClaims.length,
        notScoreableOfferCaseCount: cases.filter((item) =>
          item.cheaperClassification === "UNKNOWN").length,
        notScoreableOfferCases: cases.filter((item) =>
          item.cheaperClassification === "UNKNOWN").map((item) => ({
          blindId: item.blindId,
          evidence: item.cheaperEvidence,
        })),
        unsafeClaimRate: metric(
          unsafeCheaperClaims.length,
          trueCheaperClaims.length,
          "No SAME_PRODUCT_CHEAPER claims were produced.",
        ),
        unsafeClaimCount: unsafeCheaperClaims.length,
        trueClaimCount: trueCheaperClaims.length,
        allCheaperClaims: trueCheaperClaims.map((item) => ({
          blindId: item.blindId,
          label: item.label,
          adequatelyAdjudicated: item.adequatelyAdjudicated,
          evidence: item.cheaperEvidence,
        })),
      },
      coverage: {
        overall: coverage(cases),
        bySourceClass: Object.fromEntries(
          (["REAL_OBSERVED", "CONTROLLED", "UNVERIFIABLE"] as const).map((sourceClass) => [
            sourceClass,
            coverage(cases.filter((item) => item.sourceClass === sourceClass)),
          ]),
        ),
      },
      categorySlices: categories,
    },
    cases,
  };
}

export function verifyCorpusSha256(bytes: Buffer | string): string {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== EXPECTED_PAIRS_SHA256) {
    throw new Error(
      `Benchmark corpus SHA-256 mismatch: expected ${EXPECTED_PAIRS_SHA256}, received ${actual}. Refusing to score.`,
    );
  }
  return actual;
}

export function loadBenchmarkInput(): BenchmarkInput {
  const pairsBytes = readFileSync(new URL("pairs.json", ROOT));
  verifyCorpusSha256(pairsBytes);
  return {
    pairs: JSON.parse(pairsBytes.toString("utf8")).pairs,
    blindPairs: JSON.parse(readFileSync(new URL("blind-pairs.json", ROOT), "utf8")).pairs,
    labels: JSON.parse(readFileSync(new URL("blind-labels.json", ROOT), "utf8")).labels,
    mapping: JSON.parse(readFileSync(new URL("blind-map.json", ROOT), "utf8")).mapping,
  };
}

export function writeScorecard(outputPath = fileURLToPath(new URL("scorecard.json", ROOT))) {
  const scorecard = scoreBenchmark(loadBenchmarkInput());
  writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`);
  return scorecard;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeScorecard();
}