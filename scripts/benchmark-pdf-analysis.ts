import { performance } from "node:perf_hooks";
import { createFakePdf } from "~/server/__tests__/helpers/fake-pdf";
import { analyzePdf as analyzePdfTs } from "~/server/pdf-analyze";
import { analyzePdf as analyzePdfRust, getEngineStatus } from "~/server/rust-engine";

type BenchmarkCase = {
  name: string;
  text: string;
  iterations: number;
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

async function measure(label: string, iterations: number, fn: () => Promise<unknown>) {
  const timings: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await fn();
    timings.push(performance.now() - startedAt);
  }
  console.warn(
    `${label.padEnd(28)} avg=${average(timings).toFixed(1)}ms median=${median(timings).toFixed(1)}ms runs=${iterations}`,
  );
}

function buildLargeContract(lineCount: number) {
  const lines = [
    "MASTER SERVICES AGREEMENT",
    "",
    "Company Name: ________",
    "Vendor Name: ________",
    "Effective Date: ________",
    "",
  ];
  for (let index = 0; index < lineCount; index += 1) {
    lines.push(
      `Section ${index + 1}. The parties agree that line item ${index + 1} remains confidential and binding until terminated in writing.`,
    );
  }
  lines.push("", "IN WITNESS WHEREOF", "Company Signature: ________", "Vendor Signature: ________");
  return lines.join("\n");
}

async function main() {
  const status = await getEngineStatus();
  if (!status.available) {
    throw new Error("Rust engine not running on localhost:9090. Start it with: cd rust-service && cargo run --release");
  }

  const cases: BenchmarkCase[] = [
    {
      name: "simple-nda",
      iterations: 5,
      text: [
        "NON-DISCLOSURE AGREEMENT",
        "",
        "Disclosing Party Name: ________",
        "Receiving Party Name: ________",
        "Date: ________",
        "",
        "Signature: ________",
      ].join("\n"),
    },
    {
      name: "large-contract",
      iterations: 3,
      text: buildLargeContract(900),
    },
  ];

  for (const benchmarkCase of cases) {
    const pdf = await createFakePdf(benchmarkCase.text);
    console.warn(`\n[${benchmarkCase.name}] bytes=${pdf.length}`);
    await measure("TypeScript analyzer", benchmarkCase.iterations, async () => analyzePdfTs(pdf));
    await measure("Rust analyzer", benchmarkCase.iterations, async () => analyzePdfRust(pdf));
  }
}

void main();
