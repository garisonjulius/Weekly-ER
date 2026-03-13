const fs = require("fs");
const path = require("path");

// Atomic write helper: write to temp file and rename to ensure full replacement
function atomicWriteFile(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, data, "utf8");
  // On most systems rename is atomic
  fs.renameSync(tmpPath, filePath);
}

/**
 * Convert tickers into Zacks URL format and write CSV.
 * zacks.csv format example:
 * "Origin URL"
 * "https://www.zacks.com/stock/quote/AAPL/detailed-earning-estimates?..."
 */
function writeTickersToCsv(tickers, outPath) {
  const header = '"Origin URL"\n';
  const lines = tickers.map((t) => {
    const upper = t.toUpperCase();
    const url = `https://www.zacks.com/stock/quote/${upper}/detailed-earning-estimates?icid=quote-stock_overview-quote_nav_tracking-zcom-left_subnav_quote_navbar-detailed_earning_estimates`;
    return `"${url}"`;
  });
  const csv = header + lines.join("\n") + "\n";
  atomicWriteFile(outPath, csv);
}

// Write tickers to the three CSVs in the workspace preserving each file's format
function writeAllFormats(tickers) {
  // zacks.csv: Zacks detailed earnings URL
  const zacksPath = path.resolve(process.cwd(), "zacks.csv");
  writeTickersToCsv(tickers, zacksPath);

  // finviz.csv: format https://finviz.com/quote.ashx?t=SYMBOL&p=d
  const finvizHeader = '"Origin URL"\n';
  const finvizLines = tickers.map(
    (t) => `"https://finviz.com/quote.ashx?t=${t.toUpperCase()}&p=d"`
  );
  atomicWriteFile(
    path.resolve(process.cwd(), "finviz.csv"),
    finvizHeader + finvizLines.join("\n") + "\n"
  );

  // stock_analysis.csv: format https://stockanalysis.com/stocks/symbol/forecast/
  const saHeader = '"Origin URL"\n';
  const saLines = tickers.map(
    (t) => `"https://stockanalysis.com/stocks/${t.toLowerCase()}/forecast/"`
  );
  atomicWriteFile(
    path.resolve(process.cwd(), "stock_analysis.csv"),
    saHeader + saLines.join("\n") + "\n"
  );
}

/**
 * Extract ticker symbols from the StockCode CSV file.
 * Ignores header rows and empty/invalid entries.
 */
function extractTickersFromStockCodeFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const tickers = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // Skip empty lines

    // Split by comma to get the ticker symbol (first column)
    const parts = trimmed.split(",");
    if (parts.length === 0) continue;

    const ticker = parts[0].trim();

    // Skip header rows (contain "Ticker Symbol" or similar)
    if (
      ticker.toLowerCase().includes("ticker") ||
      ticker.toLowerCase().includes("symbol")
    ) {
      continue;
    }

    // Skip if ticker is empty
    if (!ticker) continue;

    // Add valid ticker
    tickers.push(ticker.toUpperCase());
  }

  return tickers;
}

async function main() {
  console.log("📊 Stock Ticker CSV Generator from StockCode File");
  console.log("=".repeat(50));

  const stockCodePath = path.resolve(
    process.cwd(),
    "StockCode - Zacks_AMC_BMO.csv"
  );

  // Check if file exists
  if (!fs.existsSync(stockCodePath)) {
    console.error(`❌ Error: File not found: ${stockCodePath}`);
    console.error(
      'Please ensure "StockCode - Zacks_AMC_BMO.csv" exists in the current directory.'
    );
    process.exit(1);
  }

  console.log(`📂 Reading tickers from: ${stockCodePath}`);

  // Extract tickers from the StockCode file
  let tickers = extractTickersFromStockCodeFile(stockCodePath);

  console.log(`\n📋 Found ${tickers.length} ticker entries`);

  // Dedupe & normalize
  tickers = Array.from(new Set(tickers.map((s) => s.toUpperCase())));

  console.log(`📋 After deduplication: ${tickers.length} unique tickers`);
  console.log(
    `📋 Sample tickers: ${tickers.slice(0, 10).join(", ")}${tickers.length > 10 ? "..." : ""}`
  );

  if (tickers.length === 0) {
    console.error("❌ No valid tickers found in the file.");
    process.exit(1);
  }

  console.log(
    `\n📂 Writing ${tickers.length} tickers to zacks.csv, finviz.csv, and stock_analysis.csv...`
  );

  try {
    writeAllFormats(tickers);
    console.log("✅ All CSVs written successfully.");
    console.log("\nGenerated files:");
    console.log("  - zacks.csv");
    console.log("  - finviz.csv");
    console.log("  - stock_analysis.csv");
  } catch (err) {
    console.error("❌ Error writing CSVs:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
