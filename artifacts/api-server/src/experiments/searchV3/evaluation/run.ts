import { evaluateSearchV3, renderEvaluationMarkdown } from "./harness";

const report = await evaluateSearchV3();
if (process.argv.includes("--markdown")) {
  process.stdout.write(renderEvaluationMarkdown(report));
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}