const puppeteer = require("puppeteer");
const prompt = require("prompt-sync")();
const { google } = require("googleapis");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CREDENTIALS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ||
  "/Users/garisonjulius/Downloads/revised_stock/credentials.json";

// Usage: node daily.js --losers
// Usage: node "daily.js" (then input tickers manually)
async function createBrowser() {
  return await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );
  await page.setViewport({ width: 1280, height: 720 });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.resourceType() === "image") {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

async function setupFinvizPage(browser) {
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );
  await page.setViewport({ width: 1920, height: 1080 });

  await page.setExtraHTTPHeaders({
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Ch-Ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const resourceType = req.resourceType();
    if (
      resourceType === "image" ||
      resourceType === "stylesheet" ||
      resourceType === "font"
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

// Scrape Zacks stock quote page for a single ticker
async function scrapeZacksData(ticker, browser) {
  console.log(`🔍 Scraping Zacks data for ${ticker}...`);
  const url = `https://www.zacks.com/stock/quote/${ticker.toUpperCase()}/detailed-earning-estimates`;

  const nullResult = {
    price: null,
    zacksRank: null,
    vgm: null,
    industryRank: null,
    industry: null,
    amcBmo: null,
    earningsDate: null,
    epsCurrentQuarter: null,
    lastEpsSurprise: null,
    earningsEsp: null,
    epsGrowthCurrentQuarter: null,
    magnitude90Days: null,
    yearOverYearGrowth: null,
  };

  try {
    const page = await setupPage(browser);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await wait(5000);

    const data = await page.evaluate(() => {
      // Helper: find a row in a table by label text, return the specified column cell
      function getTableCellByLabel(tableSelector, labelText, colIndex = 1) {
        const table = document.querySelector(tableSelector);
        if (!table) return null;
        const rows = table.querySelectorAll("tr");
        for (const row of rows) {
          const cells = row.querySelectorAll("td, th");
          if (cells.length > colIndex) {
            const label = cells[0]?.textContent?.trim();
            if (label && label.includes(labelText)) {
              return cells[colIndex]?.textContent?.trim() || null;
            }
          }
        }
        return null;
      }

      // Price: #get_last_price or .last_price
      let price = null;
      const priceEl =
        document.querySelector("#get_last_price") ||
        document.querySelector(".last_price");
      if (priceEl) {
        const match = priceEl.textContent.match(/[\d.]+/);
        if (match) price = match[0];
      }

      // Zacks Rank: .rank_view text like "3-Hold" or rankrect class
      let zacksRank = null;
      const rankView = document.querySelector(".rank_view");
      if (rankView) {
        const match = rankView.textContent.match(
          /(\d)\s*-\s*(?:Strong Buy|Buy|Hold|Sell|Strong Sell)/i,
        );
        if (match) zacksRank = match[1];
        if (!zacksRank) {
          const simpleMatch = rankView.textContent.match(/(\d)/);
          if (simpleMatch) zacksRank = simpleMatch[1];
        }
      }
      if (!zacksRank) {
        // Fallback: extract rank number from rankrect class (e.g. "rankrect_3")
        const rankChip = document.querySelector('[class*="rankrect_"]');
        if (rankChip) {
          const classMatch = rankChip.className.match(/rankrect_(\d)/);
          if (classMatch) zacksRank = classMatch[1];
        }
      }

      // VGM Score: .composite_val_vgm
      let vgm = null;
      const vgmEl = document.querySelector(".composite_val.composite_val_vgm");
      if (vgmEl) {
        vgm = vgmEl.textContent.trim();
      }
      if (!vgm) {
        const bodyText = document.body.textContent || "";
        const vgmMatch = bodyText.match(/VGM\s*(?:Score)?\s*[:\s]*([A-F])/i);
        if (vgmMatch) vgm = vgmMatch[1];
      }

      // Industry Rank: .industry_rank a.status — extract percentage like "Bottom 11%"
      let industryRank = null;
      const indStatusEl = document.querySelector(".industry_rank a.status");
      if (indStatusEl) {
        const text = indStatusEl.textContent.trim();
        // e.g. "Bottom 8% (223 out of 243)" → "Bottom 8%"
        const pctMatch = text.match(/((?:Top|Bottom)\s+\d+%)/i);
        if (pctMatch) {
          industryRank = pctMatch[1];
        } else {
          industryRank = text;
        }
      }

      // Industry name: .industry_rank a.sector
      let industry = null;
      const sectorEl = document.querySelector(".industry_rank a.sector");
      if (sectorEl) {
        industry = sectorEl.textContent.trim();
        // Remove "Industry: " prefix if present
        industry = industry.replace(/^Industry:\s*/i, "");
      }

      // AMC/BMO and Earnings Date: from Zacks "Exp Earnings Date" section
      // Format examples: "*BMO5/8/26", "5/7/26", "*AMC1/29/27"
      let amcBmo = null;
      let earningsDate = null;
      const bodyText2 = document.body.textContent || "";
      const expEarningsMatch = bodyText2.match(
        /Exp\s*Earnings\s*Date[\s\S]*?(?:More\s*Info\s*)?(\*?(AMC|BMO))?([\d]{1,2}\/[\d]{1,2}\/[\d]{2,4})/i,
      );
      if (expEarningsMatch) {
        if (expEarningsMatch[2]) amcBmo = expEarningsMatch[2].toUpperCase();
        earningsDate = expEarningsMatch[3];
      }

      // EPS Current Quarter: #detail_estimate table, "Current Quarter" row
      let epsCurrentQuarter = getTableCellByLabel(
        "#detail_estimate",
        "Current Quarter",
      );

      // Last EPS Surprise: #detail_estimate table, "Last EPS Surprise" row
      let lastEpsSurprise = getTableCellByLabel(
        "#detail_estimate",
        "Last EPS Surprise",
      );

      // Earnings ESP: look in tables for "Earnings ESP" row
      let earningsEsp = null;
      const allTables = document.querySelectorAll("table");
      for (const table of allTables) {
        const rows = table.querySelectorAll("tr");
        for (const row of rows) {
          const cells = row.querySelectorAll("td, th");
          if (
            cells.length > 1 &&
            cells[0]?.textContent?.trim().includes("Earnings ESP")
          ) {
            earningsEsp = cells[1]?.textContent?.trim() || null;
            break;
          }
        }
        if (earningsEsp) break;
      }

      // EPS Growth Current Quarter: #detailed_earnings_estimates, "Year over Year Growth Est." row, col 1
      let epsGrowthCurrentQuarter = getTableCellByLabel(
        "#detailed_earnings_estimates",
        "Year over Year Growth",
      );

      // Magnitude 90 Days: #magnitude_estimate table, "90 Days Ago" row
      let magnitude90Days = getTableCellByLabel(
        "#magnitude_estimate",
        "90 Days Ago",
      );

      // Year Over Year Growth (Sales): search sales estimates table for "Year over Year Growth Est."
      let yearOverYearGrowth = null;
      // Try the sales estimates section - typically the second table with this label
      const yoyRows = document.querySelectorAll("tr");
      let yoyCount = 0;
      for (const row of yoyRows) {
        const cells = row.querySelectorAll("td, th");
        if (
          cells.length > 1 &&
          cells[0]?.textContent?.includes("Year over Year Growth")
        ) {
          yoyCount++;
          // Second occurrence is typically sales growth
          if (yoyCount === 2) {
            yearOverYearGrowth = cells[1]?.textContent?.trim() || null;
            break;
          }
        }
      }
      // If only one found, use it (EPS growth)
      if (!yearOverYearGrowth && yoyCount === 1) {
        yearOverYearGrowth = epsGrowthCurrentQuarter;
      }

      return {
        price,
        zacksRank,
        vgm,
        industryRank,
        industry,
        amcBmo,
        earningsDate,
        epsCurrentQuarter,
        lastEpsSurprise,
        earningsEsp,
        epsGrowthCurrentQuarter,
        magnitude90Days,
        yearOverYearGrowth,
      };
    });

    await page.close();

    console.log(`✅ Successfully scraped Zacks data for ${ticker}`);
    console.log(`  Price: ${data.price}`);
    console.log(`  Zacks Rank: ${data.zacksRank}`);
    console.log(`  VGM: ${data.vgm}`);
    console.log(`  Industry Rank: ${data.industryRank}`);
    console.log(`  Industry: ${data.industry}`);
    console.log(`  AMC/BMO: ${data.amcBmo}`);
    console.log(`  Earnings Date: ${data.earningsDate}`);
    console.log(`  EPS Current Qtr: ${data.epsCurrentQuarter}`);
    console.log(`  Last EPS Surprise: ${data.lastEpsSurprise}`);
    console.log(`  Earnings ESP: ${data.earningsEsp}`);
    console.log(`  EPS Growth Current Qtr: ${data.epsGrowthCurrentQuarter}`);
    console.log(`  Magnitude 90 Days: ${data.magnitude90Days}`);
    console.log(`  Y/Y Growth: ${data.yearOverYearGrowth}`);

    return data;
  } catch (error) {
    console.error(`❌ Error scraping Zacks data for ${ticker}:`, error.message);
    return nullResult;
  }
}

// Scrape Finviz data for a single ticker
async function scrapeFinvizData(ticker, browser) {
  console.log(`🔍 Scraping Finviz data for ${ticker}...`);

  try {
    const finvizUrl = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&p=d`;
    const finvizPage = await setupFinvizPage(browser);

    await finvizPage.goto(finvizUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await wait(5000);

    const { pageText, companyName } = await finvizPage.evaluate(() => {
      const text = document.body.textContent || document.body.innerText;
      // Company name from page title: "AAPL Apple Inc. Stock Quote" → "Apple Inc."
      let name = null;
      const title = document.title || "";
      const titleMatch = title.match(/^[A-Z]{1,5}\s+(.+?)\s+Stock\s+Quote/);
      if (titleMatch) {
        name = titleMatch[1].trim();
      }
      if (!name) {
        // Fallback: fullview-title second row
        const rows = document.querySelectorAll(".fullview-title tr");
        if (rows.length > 1) name = rows[1]?.textContent?.trim() || null;
      }
      if (!name) {
        // Fallback: try broader title match (handles tickers of any length)
        const broadMatch = title.match(/^\S+\s+(.+?)\s+Stock/);
        if (broadMatch) name = broadMatch[1].trim();
      }
      // Clean up leading/trailing dashes and whitespace
      if (name) name = name.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
      return { pageText: text, companyName: name };
    });

    await finvizPage.close();

    const finvizData = {
      companyName,
      pe: pageText.match(/P\/E([\d.]+)/i)?.[1] || null,
      forwardPE: pageText.match(/Forward P\/E([\d.]+)/i)?.[1] || null,
      peg: pageText.match(/PEG([\d.]+)/i)?.[1] || null,
      roe: pageText.match(/ROE([+-]?[\d.]+%)/i)?.[1] || null,
      roic: pageText.match(/ROIC([+-]?[\d.]+%)/i)?.[1] || null,
      profitMargin: pageText.match(/Profit Margin([+-]?[\d.]+%)/i)?.[1] || null,
      debtEq: pageText.match(/Debt\/Eq([\d.]+)/i)?.[1] || null,
      epsYOY: pageText.match(/EPS Y\/Y TTM([+-]?[\d.]+%)/i)?.[1] || null,
      salesYOY: pageText.match(/Sales Y\/Y TTM([+-]?[\d.]+%)/i)?.[1] || null,
      perfQuarter: pageText.match(/Perf Quarter([+-]?[\d.]+%)/i)?.[1] || null,
      perfYear: pageText.match(/Perf Year([+-]?[\d.]+%)/i)?.[1] || null,
      rsi: pageText.match(/RSI \(14\)([\d.]+)/i)?.[1] || null,
      earnings:
        pageText.match(/Earnings([A-Za-z]{3} [\d]{1,2} [AP]MC)/i)?.[1] || null,
      recom: pageText.match(/Recom([\d.]+)/i)?.[1] || null,
    };

    console.log(`✅ Finviz data for ${ticker}: ${JSON.stringify(finvizData)}`);
    return finvizData;
  } catch (error) {
    console.error(
      `❌ Error scraping Finviz data for ${ticker}:`,
      error.message,
    );
    return {
      companyName: null,
      pe: null,
      forwardPE: null,
      peg: null,
      roe: null,
      roic: null,
      profitMargin: null,
      debtEq: null,
      epsYOY: null,
      salesYOY: null,
      perfQuarter: null,
      perfYear: null,
      rsi: null,
      earnings: null,
      recom: null,
    };
  }
}

// Scrape Yahoo Finance top 25 losers (with retry)
async function scrapeYahooLosers(browser, retries = 2) {
  console.log("🔍 Scraping Yahoo Finance top 25 losers...");
  const url = "https://finance.yahoo.com/markets/stocks/losers/";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`🔄 Retry attempt ${attempt}/${retries}...`);
        await wait(5000);
      }
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        if (type === "image" || type === "stylesheet" || type === "font") {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Use domcontentloaded instead of networkidle2 — Yahoo loads data dynamically
      // and networkidle2 can time out on CI runners
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      // Wait for the table to appear
      await page
        .waitForSelector("table tbody tr", { timeout: 30000 })
        .catch(() => null);
      await wait(5000);

      const results = await page.evaluate(() => {
        const items = [];
        const rows = document.querySelectorAll("table tbody tr");
        for (const row of rows) {
          const symbolEl =
            row.querySelector("td:first-child a fin-streamer[data-symbol]") ||
            row.querySelector(
              'td:first-child a[data-testid="table-cell-ticker"]',
            ) ||
            row.querySelector("td:first-child a");
          if (!symbolEl) continue;
          const symbol =
            symbolEl.getAttribute("data-symbol") || symbolEl.textContent.trim();
          if (!symbol || !/^[A-Z]{1,5}$/.test(symbol)) continue;

          // Change % is typically in the 5th column (index 4) or a fin-streamer with data-field="regularMarketChangePercent"
          let changePct = null;
          const pctStreamer = row.querySelector(
            'fin-streamer[data-field="regularMarketChangePercent"]',
          );
          if (pctStreamer) {
            changePct = pctStreamer.textContent.trim().replace(/[()]/g, "");
          } else {
            // Fallback: look through cells for a percentage value
            const cells = row.querySelectorAll("td");
            for (const cell of cells) {
              const text = cell.textContent.trim();
              if (/^[+-]?[\d.]+%$/.test(text)) {
                changePct = text;
                break;
              }
            }
          }

          items.push({ symbol, changePct });
        }
        return items.slice(0, 25);
      });

      await page.close();

      console.log(
        `✅ Found ${results.length} losers: ${results.map((r) => `${r.symbol} (${r.changePct})`).join(", ")}`,
      );
      if (results.length > 0) return results;
      console.log("⚠️ No results found, will retry...");
      await page.close();
    } catch (error) {
      console.error(
        `❌ Error scraping Yahoo losers (attempt ${attempt}/${retries}):`,
        error.message,
      );
    }
  } // end retry loop
  return [];
}

// Build data row for a single ticker (returns array, does not upload)
function buildTickerDataRow(ticker, zacks, finviz, changePct = null) {
  // AMC/BMO and Earnings Date come from Zacks scrape
  const amcBmo = zacks.amcBmo || null;
  const earningsDate = zacks.earningsDate || null;

  const today = new Date();
  const todaysDate = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;

  return [
    todaysDate, // 0: Today's Date
    earningsDate, // 1: Earnings Date
    amcBmo, // 2: AMC/BMO
    ticker.toUpperCase(), // 3: Ticker
    finviz.companyName, // 4: Name
    zacks.price, // 5: Price
    zacks.epsCurrentQuarter, // 6: EPS Curr Qtr
    zacks.earningsEsp, // 7: Earnings ESP
    zacks.yearOverYearGrowth, // 8: EPS Growth % Curr Qtr
    zacks.lastEpsSurprise, // 9: Last EPS Surprise
    zacks.zacksRank, // 10: Zacks Rank
    zacks.vgm, // 11: VGM
    zacks.industryRank, // 12: Industry Rank
    zacks.industry, // 13: Industry
    zacks.magnitude90Days, // 14: Magnitude 90 Days
    zacks.epsGrowthCurrentQuarter, // 15: Year Over Year Growth
    finviz.pe, // 16: P/E
    finviz.forwardPE, // 17: Forward P/E
    finviz.peg, // 18: PEG
    finviz.roe, // 19: ROE
    finviz.roic, // 20: ROIC
    finviz.profitMargin, // 21: Profit Margin
    finviz.epsYOY, // 22: EPS Y/Y TTM
    finviz.salesYOY, // 23: Sales Y/Y TTM
    finviz.rsi, // 24: RSI
    finviz.perfQuarter, // 25: Perf Qtr
    finviz.perfYear, // 26: Perf Year
    finviz.recom, // 27: Recom
    finviz.debtEq, // 28: Debt/Eq
    changePct, // 29: %change
  ];
}

// Scrape a single ticker and return data row
async function scrapeTickerData(ticker, browser, changePct = null) {
  console.log(`🚀 Scraping ${ticker}...`);

  const zacksNull = {
    price: null,
    zacksRank: null,
    vgm: null,
    industryRank: null,
    industry: null,
    amcBmo: null,
    earningsDate: null,
    epsCurrentQuarter: null,
    lastEpsSurprise: null,
    earningsEsp: null,
    epsGrowthCurrentQuarter: null,
    magnitude90Days: null,
    yearOverYearGrowth: null,
  };
  const finvizNull = {
    companyName: null,
    pe: null,
    forwardPE: null,
    peg: null,
    roe: null,
    roic: null,
    profitMargin: null,
    debtEq: null,
    epsYOY: null,
    salesYOY: null,
    perfQuarter: null,
    perfYear: null,
    rsi: null,
    earnings: null,
    recom: null,
  };

  try {
    const [zacksResult, finvizResult] = await Promise.allSettled([
      scrapeZacksData(ticker, browser),
      scrapeFinvizData(ticker, browser),
    ]);

    const zacks =
      zacksResult.status === "fulfilled" ? zacksResult.value : zacksNull;
    const finviz =
      finvizResult.status === "fulfilled" ? finvizResult.value : finvizNull;

    const row = buildTickerDataRow(ticker, zacks, finviz, changePct);
    console.log(`📊 ${ticker} done. Data: ${JSON.stringify(row)}`);
    return row;
  } catch (error) {
    console.error(`❌ Error scraping ${ticker}:`, error.message);
    return buildTickerDataRow(ticker, zacksNull, finvizNull, changePct);
  }
}

// --- Google Sheets upload ---
async function getSheetId(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = response.data.sheets.find(
    (s) => s.properties.title === sheetName,
  );
  if (!sheet) throw new Error(`Sheet with name ${sheetName} not found`);
  return sheet.properties.sheetId;
}

// Clear all data from row 2 onwards in the Individual sheet
async function clearIndividualSheet() {
  try {
    const creds = require(CREDENTIALS_PATH);
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ";
    const sheetName = "Individual";

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sheetName}'!A2:ZZ`,
    });

    console.log("🧹 Cleared Individual sheet from row 2 onwards");
  } catch (error) {
    console.error("❌ Error clearing sheet:", error.message);
  }
}

// Upload a single row to Google Sheets at row 2 (inserts and shifts existing data down)
async function uploadRowToGoogleSheet(dataArray) {
  try {
    const creds = require(CREDENTIALS_PATH);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ";
    const sheetName = "Individual";
    const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);

    // Insert a new row at position 2 (0-indexed: startIndex 1)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 1,
                endIndex: 2,
              },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });

    // Write the data into row 2
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: [dataArray],
      },
    });

    console.log(`✅ Uploaded row to Google Sheets`);
    return true;
  } catch (error) {
    console.error("❌ Error uploading to Google Sheets:", error.message);
    return false;
  }
}

// Main function - supports --losers mode and manual ticker input
async function main() {
  const args = process.argv.slice(2);
  const isLosersMode = args.includes("--losers");

  console.log("🎯 Daily Stock Scraper (Zacks + Finviz)");
  console.log("=".repeat(50));

  await clearIndividualSheet();

  const browser = await createBrowser();
  // entries: array of { symbol, changePct }
  let entries = [];

  try {
    if (isLosersMode) {
      console.log("📉 Mode: Yahoo Finance Top 25 Losers");
      entries = await scrapeYahooLosers(browser);
      if (entries.length === 0) {
        console.error("❌ No losers found. Exiting.");
        await browser.close();
        process.exit(1);
      }
    } else {
      console.log("✏️  Mode: Manual ticker input");
      console.log(
        "Enter stock tickers (one per line, press Enter twice when done):",
      );
      while (true) {
        const ticker = prompt("Ticker (or press Enter to finish): ")
          .trim()
          .toUpperCase();
        if (!ticker) break;
        entries.push({ symbol: ticker, changePct: null });
      }
      if (entries.length === 0) {
        console.error("No tickers entered. Exiting.");
        await browser.close();
        process.exit(1);
      }
    }

    console.log(
      `\n📊 Tickers to scrape (${entries.length}): ${entries.map((e) => e.symbol).join(", ")}`,
    );
    console.log("=".repeat(50));

    for (let i = 0; i < entries.length; i++) {
      const { symbol, changePct } = entries[i];
      console.log(`\n📊 Processing ${i + 1}/${entries.length}: ${symbol}`);
      console.log("-".repeat(30));

      const row = await scrapeTickerData(symbol, browser, changePct);

      // Skip stocks with RSI >= 70 or Recom >= 1.5
      const rsiVal = parseFloat(row[24]);
      const recomVal = parseFloat(row[27]);
      if (rsiVal >= 70) {
        console.log(`⏭️ Skipping ${symbol}: RSI ${rsiVal} >= 70`);
        continue;
      }
      if (recomVal >= 1.5) {
        console.log(`⏭️ Skipping ${symbol}: Recom ${recomVal} >= 1.5`);
        continue;
      }

      await uploadRowToGoogleSheet(row);

      if (i < entries.length - 1) {
        console.log("⏳ Waiting 2 seconds before next ticker...");
        await wait(2000);
      }
    }

    console.log("\n🎉 All tickers processed!");
    console.log(`📊 Total processed: ${entries.length}`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  });
}
