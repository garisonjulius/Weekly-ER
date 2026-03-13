const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

// Helper sleep
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function createBrowser() {
  return await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 800 });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (t === "image" || t === "stylesheet" || t === "font") req.abort();
    else req.continue();
  });

  return page;
}

/**
 * Scrape Zacks earnings calendar for a given day of the month (1-31).
 * Returns an array of objects: { ticker: <string>, time: <string|null> }.
 */
async function scrapeCalendarTickers(day) {
  if (!day || isNaN(day) || day < 1 || day > 31) {
    throw new Error("Invalid day. Must be 1-31");
  }

  const browser = await createBrowser();
  try {
    const page = await setupPage(browser);
    await page.goto("https://www.zacks.com/earnings/earnings-calendar", {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    // Wait for the page to fully load
    console.log("⏳ Waiting for page to load...");
    await wait(3000);

    // Click the calendar icon to open the date picker
    console.log("📅 Looking for date selector...");
    await page.waitForSelector("#date_select", { timeout: 20000 });
    console.log("✅ Found date selector, clicking...");
    await page.click("#date_select");
    await wait(3000); // Wait 3 seconds after clicking date selector

    // Wait for the calendar popup to appear
    console.log("📅 Waiting for calendar popup...");
    await page.waitForSelector("#minical_place_holder", { timeout: 20000 });
    await wait(1000);

    const daySelector = `#dt_${day}`;
    let clicked = false;
    try {
      await page.waitForSelector(daySelector, { timeout: 8000 });
      await page.click(daySelector);
      clicked = true;
    } catch (err) {
      // fallback: find by text
      const elems = await page.$$(".caltddt, .caltddtyellow");
      for (const el of elems) {
        const txt = (
          await (await el.getProperty("textContent")).jsonValue()
        ).trim();
        if (parseInt(txt, 10) === day) {
          await el.click();
          clicked = true;
          break;
        }
      }
    }

    if (!clicked) {
      console.error(`❌ Could not find day ${day} in the calendar`);
      await browser.close();
      return [];
    }

    // Wait for the earnings table to update
    console.log("📊 Waiting for earnings table...");
    await page.waitForSelector("#earnings_rel_data_all_table", {
      timeout: 20000,
    });
    console.log("✅ Earnings table found");

    // Set the table to show ALL entries
    console.log("📋 Setting table to show ALL entries...");
    await wait(2000);

    try {
      console.log("🔍 Setting dropdown to show ALL entries...");
      await page.waitForSelector("#earnings_rel_data_all_table_length select", {
        timeout: 10000,
      });
      await page.select("#earnings_rel_data_all_table_length select", "-1");
      await wait(3000); // Wait after selecting ALL
    } catch (err) {
      console.log(
        "❌ Could not set dropdown to ALL, continuing with current view..."
      );
    }

    // Extract tickers and time (amc / bmo / null)
    const rows = await page.$$eval(
      "#earnings_rel_data_all_table tbody tr",
      (trs) => {
        return trs
          .map((tr) => {
            const link = tr.querySelector("th a, td:first-child a");
            if (!link) return null;
            const ticker = (link.textContent || "").trim();

            // Try to find the time column. There isn't a guaranteed selector,
            // so scan the td cells for common values like 'amc' or 'bmo'.
            const tds = Array.from(tr.querySelectorAll("td"));
            let time = null;
            for (const td of tds) {
              const txt = (td.textContent || "").trim().toLowerCase();
              if (txt === "amc" || txt === "bmo") {
                time = txt;
                break;
              }
              // Some rows might have an explicitly empty cell or '-' for unknown
              if (txt === "-" || txt === "" || txt === "null") {
                // keep scanning, we'll default to null if nothing found
              }
            }

            return { ticker, time: time || null };
          })
          .filter(Boolean);
      }
    );

    // Normalize tickers and dedupe while preserving times for each ticker.
    // If same ticker appears multiple times with different times, later one wins.
    const map = new Map();
    for (const r of rows) {
      map.set((r.ticker || "").toUpperCase(), r.time);
    }
    const result = Array.from(map.entries()).map(([ticker, time]) => ({
      ticker,
      time,
    }));
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Convert tickers into template URL format and write CSV.
 * template.csv format example:
 * "Origin URL"
 * "https://www.zacks.com/stock/quote/AAPL?q=aapl"
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

// Atomic write helper: write to temp file and rename to ensure full replacement
function atomicWriteFile(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, data, "utf8");
  // On most systems rename is atomic
  fs.renameSync(tmpPath, filePath);
}

// Write tickers to the three CSVs in the workspace preserving each file's format
function writeAllFormats(tickers) {
  // zacks.csv: Zacks detailed earnings URL (already implemented)
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

const prompt = require("prompt-sync")();

async function main() {
  console.log("🎯 Stock Ticker Extractor");
  console.log("=".repeat(50));
  console.log("1. Manual - Enter specific stock tickers");
  console.log("2. Calendar - Scrape stocks from Zacks earnings calendar");
  console.log("=".repeat(50));

  const choice = prompt("Enter your choice (1 or 2): ");

  let tickers = [];
  // Always write to zacks.csv and overwrite if it exists
  let outFile = "zacks.csv";

  if (choice === "1") {
    console.log("\n📝 Manual Mode");
    console.log(
      "Enter stock tickers (one per line, press Enter twice when done):"
    );
    while (true) {
      const t = prompt("Ticker (or press Enter to finish): ").trim();
      if (!t) break;
      tickers.push(t.toUpperCase());
    }
    if (tickers.length === 0) {
      console.error("No tickers entered. Exiting.");
      process.exit(1);
    }
    console.log(`\n📊 Manual tickers: ${tickers.join(", ")}`);
  } else if (choice === "2") {
    console.log("\n📅 Calendar Mode");
    const dayStr = prompt("Enter a day of the month (1-31): ");
    const dayNum = parseInt(dayStr, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      console.error("Invalid day. Please enter a number between 1 and 31.");
      process.exit(1);
    }
    console.log(`\n📅 Scraping calendar for day ${dayNum}...`);
    const scraped = await scrapeCalendarTickers(dayNum);
    if (!scraped || scraped.length === 0) {
      console.error("❌ No tickers found for the specified date.");
      process.exit(1);
    }

    // scraped is an array of { ticker, time }
    console.log("\n📊 Calendar stocks (ticker - time):");
    for (const r of scraped) {
      console.log(
        `- ${r.ticker.toUpperCase()} - ${r.time === null ? "null" : r.time}`
      );
    }
    console.log(
      `\n📋 Sample stock tickers: ${scraped
        .slice(0, 10)
        .map((r) => r.ticker.toUpperCase())
        .join(", ")}`
    );

    // Upload ticker/time pairs to Google Sheets (sheet: Zacks_AMC_BMO)
    try {
      await uploadTickerTimePairsToSheet(scraped);
    } catch (err) {
      console.error(
        "❌ Failed to upload ticker/time pairs to Google Sheets:",
        err.message
      );
    }

    // Convert to simple ticker list for downstream CSV writing
    tickers = scraped.map((r) => r.ticker.toUpperCase());
  } else {
    console.error("❌ Invalid choice. Please enter 1 or 2.");
    process.exit(1);
  }

  // Automatically write to output.csv (overwrite if exists)
  console.log(
    `\n📂 Will write ${tickers.length} tickers to ${outFile} (will overwrite if it exists)`
  );

  // Dedupe & normalize one final time
  tickers = Array.from(new Set(tickers.map((s) => s.toUpperCase())));

  console.log(
    `\n📂 Writing ${tickers.length} tickers to zacks.csv, finviz.csv, and stock_analysis.csv...`
  );
  try {
    writeAllFormats(tickers);
    console.log("✅ All CSVs written successfully.");
  } catch (err) {
    console.error("❌ Error writing CSVs:", err.message);
    process.exit(1);
  }
}

// --- Google Sheets upload for ticker/time pairs (uses same auth logic as old.js) ---
async function getSheetId(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = response.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  if (!sheet) throw new Error(`Sheet with name ${sheetName} not found`);
  return sheet.properties.sheetId;
}

async function uploadTickerTimePairsToSheet(pairs) {
  if (!pairs || pairs.length === 0) return true;

  // Load credentials (same absolute path used in old.js)
  const creds = require("/Users/garisonjulius/Downloads/revised_stock/credentials.json");

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ";
  const sheetName = "Zacks_AMC_BMO";

  // Prepare values as array of arrays [[ticker, time], ...]
  const values = pairs.map((p) => [
    (p.ticker || "").toUpperCase(),
    p.time === null ? "null" : p.time,
  ]);

  try {
    // Insert N rows at row 3 (index 2) to make space for new data
    const rowCount = values.length;
    const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 2, // 0-based -> row 3
                endIndex: 2 + rowCount,
              },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });

    // Write values to A3:B{2+rowCount}
    const endRow = 2 + rowCount; // 0-based endIndex equals last row index +1; but A1 notation uses 1-based rows
    const range = `'${sheetName}'!A3:B${endRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: {
        values,
      },
    });

    console.log(
      `✅ Uploaded ${rowCount} ticker/time pairs to Google Sheet '${sheetName}'`
    );
    return true;
  } catch (error) {
    console.error(
      "Error uploading ticker/time pairs to Google Sheets:",
      error.message || error
    );
    return false;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}


// Run for the following dates: 27-28
// Currently running: 27