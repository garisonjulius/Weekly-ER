require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const puppeteer = require("puppeteer");
const prompt = require("prompt-sync")();
const { google } = require("googleapis");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CREDENTIALS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ||
  "/Users/garisonjulius/Downloads/revised_stock/credentials.json";

// ============================================================
// ANTHROPIC CONFIG
// ============================================================
const ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌ CLAUDE_API_KEY environment variable is not set");
  process.exit(1);
}
const SPREADSHEET_ID = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ";
let SHEET_NAME = "Individual";

// Claude writes rating to column AE
const RATING_COL = "AE";

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

      let price = null;
      const priceEl =
        document.querySelector("#get_last_price") ||
        document.querySelector(".last_price");
      if (priceEl) {
        const match = priceEl.textContent.match(/[\d.]+/);
        if (match) price = match[0];
      }

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
        const rankChip = document.querySelector('[class*="rankrect_"]');
        if (rankChip) {
          const classMatch = rankChip.className.match(/rankrect_(\d)/);
          if (classMatch) zacksRank = classMatch[1];
        }
      }

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

      let industryRank = null;
      const indStatusEl = document.querySelector(".industry_rank a.status");
      if (indStatusEl) {
        const text = indStatusEl.textContent.trim();
        const pctMatch = text.match(/((?:Top|Bottom)\s+\d+%)/i);
        if (pctMatch) {
          industryRank = pctMatch[1];
        } else {
          industryRank = text;
        }
      }

      let industry = null;
      const sectorEl = document.querySelector(".industry_rank a.sector");
      if (sectorEl) {
        industry = sectorEl.textContent.trim();
        industry = industry.replace(/^Industry:\s*/i, "");
      }

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

      let epsCurrentQuarter = getTableCellByLabel(
        "#detail_estimate",
        "Current Quarter",
      );
      let lastEpsSurprise = getTableCellByLabel(
        "#detail_estimate",
        "Last EPS Surprise",
      );

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

      let epsGrowthCurrentQuarter = getTableCellByLabel(
        "#detailed_earnings_estimates",
        "Year over Year Growth",
      );

      let magnitude90Days = getTableCellByLabel(
        "#magnitude_estimate",
        "90 Days Ago",
      );

      let yearOverYearGrowth = null;
      const yoyRows = document.querySelectorAll("tr");
      let yoyCount = 0;
      for (const row of yoyRows) {
        const cells = row.querySelectorAll("td, th");
        if (
          cells.length > 1 &&
          cells[0]?.textContent?.includes("Year over Year Growth")
        ) {
          yoyCount++;
          if (yoyCount === 2) {
            yearOverYearGrowth = cells[1]?.textContent?.trim() || null;
            break;
          }
        }
      }
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
      let name = null;
      const title = document.title || "";
      const titleMatch = title.match(/^[A-Z]{1,5}\s+(.+?)\s+Stock\s+Quote/);
      if (titleMatch) {
        name = titleMatch[1].trim();
      }
      if (!name) {
        const rows = document.querySelectorAll(".fullview-title tr");
        if (rows.length > 1) name = rows[1]?.textContent?.trim() || null;
      }
      if (!name) {
        const broadMatch = title.match(/^\S+\s+(.+?)\s+Stock/);
        if (broadMatch) name = broadMatch[1].trim();
      }
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

// Scrape rows from the current Yahoo Finance losers table
async function scrapeYahooTableRows(page) {
  return await page.evaluate(() => {
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

      let changePct = null;
      const pctStreamer = row.querySelector(
        'fin-streamer[data-field="regularMarketChangePercent"]',
      );
      if (pctStreamer) {
        changePct = pctStreamer.textContent.trim().replace(/[()]/g, "");
      } else {
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
    return items;
  });
}

// Scrape Yahoo Finance losers
async function scrapeYahooLosers(browser, retries = 2) {
  console.log("🔍 Scraping Yahoo Finance losers...");
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

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page
        .waitForSelector("table tbody tr", { timeout: 30000 })
        .catch(() => null);
      await wait(5000);

      try {
        const dropdownBtn = await page.$(
          ".select-dropdown.yf-jdck1h button.menuBtn",
        );
        if (dropdownBtn) {
          console.log("📋 Expanding rows per page to 100...");
          await dropdownBtn.click();
          await wait(1000);
          const clicked100 = await page.evaluate(() => {
            const options = document.querySelectorAll(
              '[role="option"], [role="listbox"] button, .menuContainer li, .menuContainer button, .dialog-container button, .dialog-container [role="option"]',
            );
            for (const opt of options) {
              if (opt.textContent.trim() === "100") {
                opt.click();
                return true;
              }
            }
            const allEls = document.querySelectorAll(
              'button, li, div[role="option"], span[role="option"]',
            );
            for (const el of allEls) {
              if (el.textContent.trim() === "100" && el.offsetParent !== null) {
                el.click();
                return true;
              }
            }
            return false;
          });
          if (clicked100) {
            await page
              .waitForSelector("table tbody tr", { timeout: 30000 })
              .catch(() => null);
            await wait(5000);
          }
        }
      } catch (dropdownErr) {
        console.log("⚠️ Could not change rows per page:", dropdownErr.message);
      }

      const allResults = [];
      const seenSymbols = new Set();
      const firstPageResults = await scrapeYahooTableRows(page);
      for (const item of firstPageResults) {
        if (!seenSymbols.has(item.symbol)) {
          seenSymbols.add(item.symbol);
          allResults.push(item);
        }
      }
      console.log(`📊 Page 1: found ${firstPageResults.length} losers`);

      const MAX_CANDIDATES = 200;
      let pageNum = 1;
      while (allResults.length < MAX_CANDIDATES) {
        const nextBtn = await page.$(
          '[data-testid="next-page-button"]:not([disabled])',
        );
        if (!nextBtn) break;
        pageNum++;
        await nextBtn.click();
        await wait(5000);
        const pageResults = await scrapeYahooTableRows(page);
        if (pageResults.length === 0) break;
        for (const item of pageResults) {
          if (!seenSymbols.has(item.symbol)) {
            seenSymbols.add(item.symbol);
            allResults.push(item);
          }
        }
        console.log(
          `📊 Page ${pageNum}: found ${pageResults.length} losers (total: ${allResults.length})`,
        );
      }

      await page.close();
      console.log(`✅ Found ${allResults.length} total losers`);
      if (allResults.length > 0) return allResults;
    } catch (error) {
      console.error(
        `❌ Error scraping Yahoo losers (attempt ${attempt}/${retries}):`,
        error.message,
      );
    }
  }
  return [];
}

function buildTickerDataRow(ticker, zacks, finviz, changePct = null) {
  const amcBmo = zacks.amcBmo || null;
  const earningsDate = zacks.earningsDate || null;
  const today = new Date();
  const todaysDate = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;

  return [
    todaysDate, // 0:  Today's Date
    earningsDate, // 1:  Earnings Date
    amcBmo, // 2:  AMC/BMO
    ticker.toUpperCase(), // 3:  Ticker
    finviz.companyName, // 4:  Name
    zacks.price, // 5:  Price
    zacks.epsCurrentQuarter, // 6:  EPS Curr Qtr
    zacks.earningsEsp, // 7:  Earnings ESP
    zacks.yearOverYearGrowth, // 8:  EPS Growth % Curr Qtr
    zacks.lastEpsSurprise, // 9:  Last EPS Surprise
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
    console.log(`📊 ${ticker} done.`);
    return row;
  } catch (error) {
    console.error(`❌ Error scraping ${ticker}:`, error.message);
    return buildTickerDataRow(ticker, zacksNull, finvizNull, changePct);
  }
}

// --- Google Sheets helpers ---
let _sheetsClient = null;
async function getAuthenticatedSheets() {
  if (_sheetsClient) return _sheetsClient;
  const creds = require(CREDENTIALS_PATH);
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

let _sheetId = null;
async function getSheetId(sheets, spreadsheetId, sheetName) {
  if (_sheetId !== null) return _sheetId;
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = response.data.sheets.find(
    (s) => s.properties.title === sheetName,
  );
  if (!sheet) throw new Error(`Sheet with name ${sheetName} not found`);
  _sheetId = sheet.properties.sheetId;
  return _sheetId;
}

async function clearIndividualSheet() {
  try {
    const sheets = await getAuthenticatedSheets();
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2:ZZ`,
    });
    console.log("🧹 Cleared Individual sheet from row 2 onwards");
  } catch (error) {
    console.error("❌ Error clearing sheet:", error.message);
  }
}

async function uploadRowToGoogleSheet(dataArray) {
  try {
    const sheets = await getAuthenticatedSheets();
    const sheetId = await getSheetId(sheets, SPREADSHEET_ID, SHEET_NAME);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2`,
      valueInputOption: "RAW",
      requestBody: { values: [dataArray] },
    });

    console.log(`✅ Uploaded row to Google Sheets`);
    return true;
  } catch (error) {
    console.error("❌ Error uploading to Google Sheets:", error.message);
    return false;
  }
}

// Scrape Zacks Buy List for tickers added today
async function scrapeZacksBuylist(browser) {
  console.log("🔍 Scraping Zacks Buy List...");

  const ZACKS_EMAIL = process.env.ZACKS_EMAIL;
  const ZACKS_PASSWORD = process.env.ZACKS_PASSWORD;

  if (!ZACKS_EMAIL || !ZACKS_PASSWORD) {
    console.error("❌ ZACKS_EMAIL and ZACKS_PASSWORD environment variables are required");
    return [];
  }

  const BUYLIST_URL = "https://www.zacks.com/stocks/buy-list/?adid=zp_topnav_1list&icid=zacks.com-zacks.com-nav_tracking-zacks_premium-main_menu_wrapper-zacks_1_rank";

  const page = await setupPage(browser);

  try {
    // Navigate directly to the buy list — it will redirect to the premium login page
    console.log("🔐 Navigating to buy list (will redirect to premium login)...");
    await page.goto(BUYLIST_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await wait(2000);

    // Dismiss cookie banner if present
    const cookieBtn = await page.$("#accept_cookie");
    if (cookieBtn) {
      await cookieBtn.click();
      await wait(500);
      console.log("🍪 Dismissed cookie banner");
    }

    const currentUrl = page.url();
    console.log(`📍 Landed on: ${currentUrl}`);

    // If redirected to a login page, fill in credentials
    if (currentUrl.includes("login") || currentUrl.includes("registration")) {
      console.log("🔑 Premium login required — filling form...");

      console.log("🔑 Filling credentials...");

      // Set values in a way that works for both regular and React-controlled inputs
      await page.evaluate((email, password) => {
        function setNativeValue(el, value) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          nativeInputValueSetter.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const emailEl = document.querySelector("#username");
        const passwordEl = document.querySelector("#password");
        if (emailEl) setNativeValue(emailEl, email);
        if (passwordEl) setNativeValue(passwordEl, password);
      }, ZACKS_EMAIL, ZACKS_PASSWORD);
      await wait(500);

      // Click the submit input via JS (bypasses Puppeteer visibility check)
      await page.evaluate(() => {
        const submitEl = document.querySelector('input[name="submit"]') || document.querySelector('input[type="submit"]');
        if (submitEl) submitEl.click();
      });
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });

      await wait(2000);
      const postLoginUrl = page.url();
      console.log(`✅ Login submitted. Now at: ${postLoginUrl}`);

      if (postLoginUrl.includes("login") || postLoginUrl.includes("registration")) {
        console.error("❌ Login failed — still on login page after submit");
        await page.screenshot({ path: "/tmp/zacks_login_fail.png" });
        await page.close();
        return [];
      }
    } else {
      console.log("✅ Already logged in — on buy list directly");
    }

    // Navigate to the buy list page
    await page.goto(BUYLIST_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await wait(3000);

    // Build today's date in US Eastern time (Zacks uses ET; GitHub Actions runs in UTC)
    const etParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const m = etParts.month;                          // no leading zero month: "4"
    const mm = m.padStart(2, "0");                   // leading zero month:    "04"
    const d = etParts.day;                            // no leading zero day:   "1"
    const dd = d.padStart(2, "0");                   // leading zero day:      "01"
    const yyyy = etParts.year;
    const yy = yyyy.slice(-2);
    const todaySlash = `${mm}/${dd}/${yyyy}`;         // "04/01/2026"
    const todaySlashShort = `${mm}/${dd}/${yy}`;      // "04/01/26"
    const todayNoLeadingZero = `${m}/${d}/${yy}`;     // "4/1/26" ← Zacks format

    console.log(`📅 Looking for Date Added = ${todayNoLeadingZero}`);

    const tickers = await page.evaluate((todaySlash, todaySlashShort, todayNoLeadingZero) => {
      const results = [];

      // Find the table that has both "Symbol" and "Date Added" headers
      const tables = document.querySelectorAll("table");
      let targetTable = null;

      for (const table of tables) {
        let headerCells = table.querySelectorAll("thead th, thead td");
        if (headerCells.length === 0) headerCells = table.querySelectorAll("tr:first-child th");
        const texts = Array.from(headerCells).map((h) => h.textContent.trim().toLowerCase());
        if (texts.some((t) => t.includes("symbol")) && texts.some((t) => t.includes("date added"))) {
          targetTable = table;
          break;
        }
      }

      if (!targetTable) return { tickers: [], error: "Table not found" };

      const rows = targetTable.querySelectorAll("tbody tr");
      for (const row of rows) {
        // Symbol is in a <th> element; ticker is in the link's rel attribute or hoverquote-symbol span
        const thCell = row.querySelector("th");
        const symbolText = (
          thCell?.querySelector("a[rel]")?.getAttribute("rel")?.trim()?.toUpperCase() ||
          thCell?.querySelector("span.hoverquote-symbol")?.textContent?.trim()?.replace(/\s/g, "").toUpperCase()
        );
        if (!symbolText || !/^[A-Z0-9.]{1,6}$/.test(symbolText)) continue;

        // Date is in <td> cells
        const tdCells = Array.from(row.querySelectorAll("td"));
        const hasToday = tdCells.some((td) => {
          const t = td.textContent.trim();
          return t === todaySlash || t === todaySlashShort || t === todayNoLeadingZero;
        });
        if (!hasToday) continue;

        results.push(symbolText);
      }

      if (!targetTable) return { tickers: [], error: "Table not found" };
      return { tickers: results, error: null };
    }, todaySlash, todaySlashShort, todayNoLeadingZero);

    await page.close();

    if (tickers.error) {
      console.error(`❌ Scraping error: ${tickers.error}`);
      return [];
    }

    console.log(`✅ Found ${tickers.tickers.length} tickers added today: ${tickers.tickers.join(", ") || "none"}`);
    return tickers.tickers.map((symbol) => ({ symbol, changePct: null }));
  } catch (error) {
    console.error("❌ Error scraping Zacks buy list:", error.message);
    try { await page.close(); } catch (_) {}
    return [];
  }
}

// ============================================================
// CLAUDE RATINGS — called once after all tickers are uploaded
// ============================================================

/**
 * Calls Claude API with web search for a single ticker.
 * Returns { rating } or N/A on failure.
 */
async function getClaudeRating(row) {
  const ticker = row[3] || "N/A";

  // Build context from the row data
  const data = {
    price: row[5],
    epsCurrentQtr: row[6],
    earningsEsp: row[7],
    epsGrowthPct: row[8],
    lastEpsSurprise: row[9],
    zacksRank: row[10],
    vgm: row[11],
    industryRank: row[12],
    industry: row[13],
    pe: row[16],
    forwardPE: row[17],
    peg: row[18],
    roe: row[19],
    roic: row[20],
    profitMargin: row[21],
    epsYOY: row[22],
    salesYOY: row[23],
    rsi: row[24],
    perfQuarter: row[25],
    perfYear: row[26],
    recom: row[27],
    debtEq: row[28],
    changePct: row[29],
  };

  const prompt = `You are a stock analyst. Evaluate ${ticker} using the financial data below AND search the web for recent news, catalysts, or risks.

FINANCIAL DATA:
- Price: ${data.price} | Change: ${data.changePct}
- Zacks Rank: ${data.zacksRank} | VGM: ${data.vgm} | Industry: ${data.industry} (${data.industryRank})
- EPS Current Qtr: ${data.epsCurrentQtr} | EPS Growth: ${data.epsGrowthPct} | Last EPS Surprise: ${data.lastEpsSurprise}
- Earnings ESP: ${data.earningsEsp}
- P/E: ${data.pe} | Forward P/E: ${data.forwardPE} | PEG: ${data.peg}
- ROE: ${data.roe} | ROIC: ${data.roic} | Profit Margin: ${data.profitMargin}
- EPS Y/Y: ${data.epsYOY} | Sales Y/Y: ${data.salesYOY}
- RSI: ${data.rsi} | Perf Quarter: ${data.perfQuarter} | Perf Year: ${data.perfYear}
- Analyst Recom: ${data.recom} | Debt/Eq: ${data.debtEq}

Rate as: Strong Buy, Buy, Moderate Buy, Watch, Hold, Sell, or Avoid.

Respond in exactly this format (two lines only, no other text):
RATING: <your rating>
EXPLANATION: <1-2 sentence justification referencing both the data and any recent news>`;

  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
  };

  try {
    console.log(`  📡 Sending API request for ${ticker}...`);
    const startTime = Date.now();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000), // 60s timeout
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  📥 Response received in ${elapsed}s (status: ${res.status})`);

    const json = await res.json();
    if (json.error) {
      console.error(`❌ Claude API error for ${ticker}:`, json.error.message);
      return { rating: "N/A" };
    }

    // Log content block types so we can see what Claude did
    const blockTypes = json.content.map((b) => b.type).join(", ");
    console.log(`  📦 Response blocks: [${blockTypes}]`);

    // Search ALL text blocks for the rating (not just the last one)
    const textBlocks = json.content.filter((b) => b.type === "text");
    console.log(`  📝 Text blocks (${textBlocks.length}):`);
    textBlocks.forEach((b, idx) => console.log(`     [${idx}] "${b.text.trim().substring(0, 100)}"`));

    // Combine all text blocks to search for rating and explanation
    const allText = textBlocks.map((b) => b.text).join("\n");

    let rating = "Hold";
    let explanation = "";
    const ratingMatch = allText.match(
      /RATING:\s*(Strong Buy|Buy|Moderate Buy|Watch|Hold|Sell|Avoid)/i,
    );
    if (ratingMatch) {
      rating = ratingMatch[1].trim();
    } else {
      console.log(`  ⚠️ No rating match found in any text block, defaulting to "Hold"`);
    }

    const explMatch = allText.match(/EXPLANATION:\s*(.+)/i);
    if (explMatch) {
      explanation = explMatch[1].trim();
    }

    return { rating, explanation };
  } catch (err) {
    console.error(
      `❌ Network error calling Claude for ${ticker}:`,
      err.message,
    );
    return { rating: "N/A" };
  }
}

/**
 * Reads all populated rows from the sheet, calls Claude for each,
 * then batch-writes Rating (AD) and Explanation (AE) back.
 */
async function runClaudeRatings(uploadedCount) {
  console.log("\n🤖 Running Claude ratings for all uploaded stocks...");
  console.log("=".repeat(50));

  try {
    const sheets = await getAuthenticatedSheets();

    // Read all data rows — if uploadedCount given, scope it; otherwise read all
    const readRange = uploadedCount
      ? `'${SHEET_NAME}'!A2:AC${1 + uploadedCount}`
      : `'${SHEET_NAME}'!A2:AC`;
    console.log(`📖 Reading sheet range: ${readRange}`);
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: readRange,
    });

    const rows = readRes.data.values || [];
    if (rows.length === 0) {
      console.log("⚠️  No data found in sheet — skipping Claude ratings.");
      return;
    }

    console.log(`📊 Found ${rows.length} rows to rate`);
    // Preview tickers found
    const tickers = rows.map((r) => r[3] || "???").join(", ");
    console.log(`📋 Tickers: ${tickers}`);

    // Call Claude in parallel batches of 3, write ratings immediately
    const BATCH_SIZE = 3;
    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
      console.log(`\n📦 Batch ${batchNum}/${totalBatches}`);

      const results = await Promise.allSettled(
        batch.map(async (row, j) => {
          const i = batchStart + j;
          const ticker = row[3] || `Row ${i + 2}`;
          const sheetRow = i + 2;
          console.log(`  🤖 [${i + 1}/${rows.length}] Getting Claude rating for ${ticker}...`);

          const { rating, explanation } = await getClaudeRating(row);

          const cellRange = `'${SHEET_NAME}'!${RATING_COL}${sheetRow}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: cellRange,
            valueInputOption: "RAW",
            requestBody: { values: [[rating, explanation]] },
          });
          console.log(`  ✅ ${ticker}: ${rating} → ${explanation}`);
          return { ticker, rating };
        })
      );

      // Log any failures
      results.forEach((r, j) => {
        if (r.status === "rejected") {
          const ticker = batch[j]?.[3] || "???";
          console.error(`  ❌ Failed to rate ${ticker}, skipping: ${r.reason?.message}`);
        }
      });

      if (batchStart + BATCH_SIZE < rows.length) {
        console.log(`  ⏳ Waiting 15s before next batch (rate limit)...`);
        await wait(15000);
      }
    }

    console.log(
      `\n✅ Claude ratings written to column AE for ${rows.length} stocks`,
    );
  } catch (error) {
    console.error("❌ Error running Claude ratings:", error.message);
  }
}

/**
 * Sorts the sheet by Recom column (AB, index 27) ascending.
 */
async function sortSheetByRecom() {
  console.log("\n📊 Sorting sheet by Recom (ascending)...");
  try {
    const sheets = await getAuthenticatedSheets();
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    const sheet = spreadsheet.data.sheets.find(
      (s) => s.properties.title === SHEET_NAME
    );
    const sheetId = sheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: {
                sheetId,
                startRowIndex: 1, // skip header
                startColumnIndex: 0,
              },
              sortSpecs: [
                {
                  dimensionIndex: 27, // Recom column (0-indexed)
                  sortOrder: "ASCENDING",
                },
              ],
            },
          },
        ],
      },
    });
    console.log("✅ Sheet sorted by Recom");
  } catch (err) {
    console.error("❌ Failed to sort sheet:", err.message);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const isLosersMode = args.includes("--losers");
  const isRatingsOnly = args.includes("--ratings");
  const isZacksBuylistMode = args.includes("--zacks-buylist");

  if (isZacksBuylistMode) {
    SHEET_NAME = "Zacks #1";
  }

  console.log("🎯 Daily Stock Scraper (Zacks + Finviz + Claude)");
  console.log("=".repeat(50));

  // if (isRatingsOnly) {
  //   console.log("🤖 Mode: Claude ratings only (using existing sheet data)");
  //   await sortSheetByRecom();
  //   await runClaudeRatings();
  //   console.log("\n🏁 Done! Ratings written to column AE.");
  //   return;
  // }

  await clearIndividualSheet();

  const browser = await createBrowser();
  let entries = [];

  try {
    if (isZacksBuylistMode) {
      console.log("📋 Mode: Zacks #1 Buy List (tickers added today)");
      entries = await scrapeZacksBuylist(browser);
      if (entries.length === 0) {
        console.error("❌ No Zacks buy list tickers found for today. Exiting.");
        await browser.close();
        process.exit(1);
      }
    } else if (isLosersMode) {
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

    console.log(`\n📋 Candidate list (${entries.length} tickers):`);
    entries.forEach((e, idx) => {
      console.log(`  ${idx + 1}. ${e.symbol} (${e.changePct || "N/A"})`);
    });
    console.log("=".repeat(50));

    const MAX_OUTPUT = isZacksBuylistMode ? Infinity : 25;
    let uploadedCount = 0;
    let totalScraped = 0;

    for (let i = 0; i < entries.length; i++) {
      if (uploadedCount >= MAX_OUTPUT) {
        console.log(`\n🎯 Reached ${MAX_OUTPUT} uploaded stocks, stopping.`);
        break;
      }

      const { symbol, changePct } = entries[i];
      console.log(`\n🔍 Scraping ${symbol} Now (${uploadedCount}/${MAX_OUTPUT} uploaded)`);

      const row = await scrapeTickerData(symbol, browser, changePct);
      totalScraped++;

      const rsiVal = parseFloat(row[24]);
      const recomVal = parseFloat(row[27]);
      if (isNaN(recomVal) || recomVal === null) {
        console.log(`⏭️ Skipping ${symbol}: Recom is null/missing`);
      } else if (rsiVal >= 70) {
        console.log(`⏭️ Skipping ${symbol}: RSI ${rsiVal} >= 70`);
      } else if (recomVal >= 1.5) {
        console.log(`⏭️ Skipping ${symbol}: Recom ${recomVal} >= 1.5`);
      } else {
        await uploadRowToGoogleSheet(row);
        uploadedCount++;
      }

      if (i < entries.length - 1 && uploadedCount < MAX_OUTPUT) {
        console.log("⏳ Waiting 2 seconds before next ticker...");
        await wait(2000);
      }
    }

    console.log("\n🎉 All tickers scraped!");
    console.log(
      `📊 Total scraped: ${totalScraped}, Uploaded: ${uploadedCount}`,
    );

    // Sort by Recom, then run Claude ratings
    await sortSheetByRecom();
    // await runClaudeRatings(uploadedCount);

    console.log("\n🏁 All done! Sheet is fully populated with ratings.");
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
