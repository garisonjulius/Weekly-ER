const puppeteer = require("puppeteer");
const prompt = require("prompt-sync")();
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { google } = require("googleapis");

// Wait helper
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Global array to store all extracted tickers
let extractedTickers = [];

// Helper function to create browser with stable configuration
async function createBrowser() {
  return await puppeteer.launch({
    headless: true, // Changed back to true for headless mode
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
    ],
  });
}

// Helper function to setup page with common settings
async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 720 });

  // Disable navigation events that might cause issues
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

// Enhanced page setup specifically for Finviz
async function setupFinvizPage(browser) {
  const page = await browser.newPage();

  // Use a more realistic user agent
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });

  // Set additional headers to appear more like a real browser
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

  // Disable images and other resources to speed up loading
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

// Extract StockAnalysis forecast data
async function scrapeStockAnalysisForecast(ticker, browser) {
  console.log(`🔍 Scraping StockAnalysis forecast for ${ticker}...`);
  const url = `https://stockanalysis.com/stocks/${ticker.toLowerCase()}/forecast/`;

  try {
    const page = await setupPage(browser);

    let pageLoaded = false;
    try {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
      pageLoaded = true;
    } catch (error) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        pageLoaded = true;
      } catch (error2) {
        console.warn(
          `⚠️ Could not load StockAnalysis forecast page for ${ticker}`
        );
        await page.close();
        return {
          revenueGrowth: null,
          epsGrowth: null,
          strongBuy: null,
          buy: null,
          total: null,
          companyName: null,
          currentPrice: null,
        };
      }
    }

    if (!pageLoaded) {
      await page.close();
      return {
        revenueGrowth: null,
        epsGrowth: null,
        strongBuy: null,
        buy: null,
        total: null,
        companyName: null,
        currentPrice: null,
      };
    }

    // Wait for the summary cards to be present
    let summaryCardsFound = false;
    try {
      await page.waitForSelector(
        "div.inline-flex.items-baseline.rounded-full",
        { timeout: 30000 }
      );
      summaryCardsFound = true;
    } catch (error) {
      try {
        await page.waitForSelector('div[class*="inline-flex"]', {
          timeout: 15000,
        });
        summaryCardsFound = true;
      } catch (error2) {
        console.warn(
          `⚠️ Could not find summary cards for ${ticker} on StockAnalysis page`
        );
        await page.close();
        return {
          revenueGrowth: null,
          epsGrowth: null,
          strongBuy: null,
          buy: null,
          total: null,
          companyName: null,
          currentPrice: null,
        };
      }
    }

    if (!summaryCardsFound) {
      await page.close();
      return {
        revenueGrowth: null,
        epsGrowth: null,
        strongBuy: null,
        buy: null,
        total: null,
        companyName: null,
        currentPrice: null,
      };
    }

    // Click the Quarterly button before scraping data
    const quarterlyClickResult = await page.evaluate(() => {
      const quarterlyButton = document.querySelector(
        "button.controls-btn.-ml-px.rounded-none.rounded-r-md.px-2.py-1\\.5.bp\\:px-3.sm\\:px-4.sm\\:py-2.bg-gray-100.dark\\:bg-dark-500"
      );

      if (!quarterlyButton) {
        const buttons = Array.from(
          document.querySelectorAll("button.controls-btn")
        );
        const quarterlyBtn = buttons.find(
          (btn) => btn.textContent.trim() === "Quarterly"
        );
        if (quarterlyBtn) {
          quarterlyBtn.click();
          return { clicked: true, method: "text-content" };
        }
        return { clicked: false, error: "Quarterly button not found" };
      }

      const isActive =
        quarterlyButton.classList.contains("bg-gray-100") &&
        quarterlyButton.classList.contains("dark:bg-dark-500");

      if (!isActive) {
        quarterlyButton.click();
        return { clicked: true, method: "exact-selector", wasActive: false };
      } else {
        return { clicked: true, method: "exact-selector", wasActive: true };
      }
    });

    if (quarterlyClickResult.clicked) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Extract values based on card order
    const summaryData = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll("div.inline-flex.items-baseline.rounded-full")
      );
      const revenueMatch = cards[0]
        ? cards[0].textContent.match(/-?\d+\.\d+%/)
        : null;
      const epsMatch = cards[2]
        ? cards[2].textContent.match(/-?\d+\.\d+%/)
        : null;
      return {
        revenueGrowth: revenueMatch ? revenueMatch[0] : null,
        epsGrowth: epsMatch ? epsMatch[0] : null,
      };
    });

    // Scrape Recommendation Trends
    const recTrends = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      let recTable = null;
      for (const tbl of tables) {
        if (
          tbl.innerText.includes("Strong Buy") &&
          tbl.innerText.includes("Total")
        ) {
          recTable = tbl;
          break;
        }
      }
      if (!recTable) return { strongBuy: null, buy: null, total: null };
      let strongBuy = null,
        buy = null,
        total = null;
      const rows = Array.from(recTable.querySelectorAll("tbody tr"));
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 2) return;
        const label = cells[0].textContent.trim();
        const lastCell = cells[cells.length - 1].textContent.trim();
        if (label === "Strong Buy") strongBuy = parseInt(lastCell, 10);
        if (label === "Buy") buy = parseInt(lastCell, 10);
        if (label === "Total") total = parseInt(lastCell, 10);
      });
      return { strongBuy, buy, total };
    });

    // Extract company name and price
    const { companyName, currentPrice } = await page.evaluate(() => {
      let companyName = null;
      const nameDiv = document.querySelector(
        "div.mb-0.text-2xl.font-bold.text-default.sm\\:text-\\[26px\\]"
      );
      if (nameDiv) companyName = nameDiv.textContent.trim();

      let currentPrice = null;
      const priceDiv = document.querySelector(
        "div.text-4xl.font-bold.transition-colors.duration-300"
      );
      if (priceDiv) currentPrice = priceDiv.textContent.trim();

      return { companyName, currentPrice };
    });

    await page.close();

    console.log(`✅ Successfully scraped StockAnalysis forecast for ${ticker}`);
    return {
      revenueGrowth: summaryData.revenueGrowth,
      epsGrowth: summaryData.epsGrowth,
      strongBuy: recTrends.strongBuy,
      buy: recTrends.buy,
      total: recTrends.total,
      companyName: companyName,
      currentPrice: currentPrice,
    };
  } catch (error) {
    console.error(
      `❌ Error scraping StockAnalysis forecast for ${ticker}:`,
      error.message
    );
    return {
      revenueGrowth: null,
      epsGrowth: null,
      strongBuy: null,
      buy: null,
      total: null,
      companyName: null,
      currentPrice: null,
    };
  }
}

// Extract StockAnalysis statistics data
async function scrapeStockAnalysisStats(ticker, browser) {
  console.log(`🔍 Scraping StockAnalysis statistics for ${ticker}...`);

  try {
    const statsUrl = `https://stockanalysis.com/stocks/${ticker.toLowerCase()}/statistics/`;
    const statsPage = await setupPage(browser);

    // Clear cache to prevent data persistence
    await statsPage.evaluateOnNewDocument(() => {
      if (window.localStorage) window.localStorage.clear();
      if (window.sessionStorage) window.sessionStorage.clear();
    });

    await statsPage.goto(statsUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
      cache: false,
    });
    console.log(`✅ Successfully loaded stats page for ${ticker}`);

    // Wait for dynamic content to load
    await wait(3000);

    await statsPage.waitForSelector("table", { timeout: 15000 });
    console.log(`✅ Found table on stats page for ${ticker}`);

    // Helper to get value by label from the live page
    const stats = await statsPage.evaluate(() => {
      function getStat(label) {
        const tds = Array.from(document.querySelectorAll("td"));
        for (let i = 0; i < tds.length; i++) {
          const cellText = tds[i].textContent.trim();
          if (cellText === label && tds[i + 1]) {
            return tds[i + 1].textContent.trim();
          }
        }
        return null;
      }
      return {
        peRatio: getStat("PE Ratio"),
        forwardPE: getStat("Forward PE"),
        pegRatio: getStat("PEG Ratio") || getStat("PEG"),
        roe: getStat("Return on Equity (ROE)"),
        roic: getStat("Return on Invested Capital (ROIC)"),
        profitMargin: getStat("Profit Margin"),
      };
    });

    await statsPage.close();

    console.log(
      `✅ Successfully scraped StockAnalysis statistics for ${ticker}`
    );
    return {
      peRatio: stats.peRatio,
      forwardPE: stats.forwardPE,
      pegRatio: stats.pegRatio,
      roe: stats.roe,
      roic: stats.roic,
      profitMargin: stats.profitMargin,
    };
  } catch (error) {
    console.error(
      `❌ Error scraping StockAnalysis statistics for ${ticker}:`,
      error.message
    );
    return {
      peRatio: null,
      forwardPE: null,
      pegRatio: null,
      roe: null,
      roic: null,
      profitMargin: null,
    };
  }
}

// Extract Finviz data - Simple and direct approach that works
async function scrapeFinvizData(ticker, browser) {
  console.log(`🔍 Scraping Finviz data for ${ticker}...`);

  try {
    const finvizUrl = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&p=d`;
    const finvizPage = await setupFinvizPage(browser);

    await finvizPage.goto(finvizUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    console.log("✅ Page loaded successfully");

    // Wait for content to load
    await wait(5000);

    // Get the page text directly
    const pageText = await finvizPage.evaluate(() => {
      return document.body.textContent || document.body.innerText;
    });

    await finvizPage.close();

    console.log(`📊 Text length: ${pageText.length} characters`);

    // Simple regex extraction for the specific metrics you need
    const finvizData = {
      marketCap: pageText.match(/Market Cap([\d.]+[BMK])/i)?.[1] || null,
      epsYOY: pageText.match(/EPS Y\/Y TTM([+-]?[\d.]+%)/i)?.[1] || null,
      salesYOY: pageText.match(/Sales Y\/Y TTM([+-]?[\d.]+%)/i)?.[1] || null,
      perfQuarter: pageText.match(/Perf Quarter([+-]?[\d.]+%)/i)?.[1] || null,
      perfYear: pageText.match(/Perf Year([+-]?[\d.]+%)/i)?.[1] || null,
      rsi: pageText.match(/RSI \(14\)([\d.]+)/i)?.[1] || null,
      earnings:
        pageText.match(/Earnings([A-Za-z]{3} [\d]{1,2} [AP]MC)/i)?.[1] || null,
      recom: pageText.match(/Recom([\d.]+)/i)?.[1] || null,
    };

    // Log the extracted values for verification
    console.log(`📊 Extracted Finviz data for ${ticker}:`);
    console.log(`  Market Cap: ${finvizData.marketCap}`);
    console.log(`  EPS Y/Y TTM: ${finvizData.epsYOY}`);
    console.log(`  Sales Y/Y TTM: ${finvizData.salesYOY}`);
    console.log(`  Perf Quarter: ${finvizData.perfQuarter}`);
    console.log(`  Perf Year: ${finvizData.perfYear}`);
    console.log(`  RSI (14): ${finvizData.rsi}`);
    console.log(`  Earnings: ${finvizData.earnings}`);
    console.log(`  Recom: ${finvizData.recom}`);

    // Check if we got any data
    const hasData = Object.values(finvizData).some(
      (value) => value && value.trim() !== ""
    );

    if (hasData) {
      console.log(`✅ Successfully scraped Finviz data for ${ticker}`);
    } else {
      console.warn(`⚠️ No data extracted from Finviz for ${ticker}`);
    }

    return finvizData;
  } catch (error) {
    console.error(
      `❌ Error scraping Finviz data for ${ticker}:`,
      error.message
    );
    return {
      marketCap: null,
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

// Main scraping function - now resilient to individual source failures
async function scrapeForecastGrowth(ticker, date = null, zacksData = null) {
  console.log(`🚀 Starting resilient scraping for ${ticker}...`);

  const browser = await createBrowser();

  try {
    // Scrape each data source independently
    const [forecastData, statsData, finvizData] = await Promise.allSettled([
      scrapeStockAnalysisForecast(ticker, browser),
      scrapeStockAnalysisStats(ticker, browser),
      scrapeFinvizData(ticker, browser),
    ]);

    // Extract results or set defaults
    const forecast =
      forecastData.status === "fulfilled"
        ? forecastData.value
        : {
            revenueGrowth: null,
            epsGrowth: null,
            strongBuy: null,
            buy: null,
            total: null,
            companyName: null,
            currentPrice: null,
          };

    const stats =
      statsData.status === "fulfilled"
        ? statsData.value
        : {
            peRatio: null,
            forwardPE: null,
            pegRatio: null,
            roe: null,
            roic: null,
            profitMargin: null,
          };

    const finviz =
      finvizData.status === "fulfilled"
        ? finvizData.value
        : {
            marketCap: null,
            epsYOY: null,
            salesYOY: null,
            perfQuarter: null,
            perfYear: null,
            rsi: null,
            earnings: null,
            recom: null,
          };

    // Create comprehensive array with consistent structure
    const scrapedData = [
      ticker.toUpperCase(), // 0: Ticker
      forecast.companyName, // 1: Company Name
      forecast.currentPrice, // 2: Current Price
      forecast.revenueGrowth, // 3: Revenue Growth
      forecast.epsGrowth, // 4: EPS Growth
      forecast.strongBuy, // 5: Strong Buy
      forecast.buy, // 6: Buy
      forecast.total, // 7: Total
      stats.peRatio, // 8: PE Ratio
      stats.forwardPE, // 9: Forward PE
      stats.pegRatio, // 10: PEG Ratio
      stats.roe, // 11: ROE
      stats.roic, // 12: ROIC
      stats.profitMargin, // 13: Profit Margin
      finviz.marketCap, // 14: Market Cap
      finviz.epsYOY, // 15: EPS Y/Y TTM
      finviz.salesYOY, // 16: Sales Y/Y TTM
      finviz.perfQuarter, // 17: Perf Quarter
      finviz.perfYear, // 18: Perf Year
      finviz.rsi, // 19: RSI (14)
      finviz.earnings, // 20: Earnings
      finviz.recom, // 21: Recom
      zacksData ? zacksData.estimate : null, // 22: Zacks Estimate
      zacksData ? zacksData.esp : null, // 23: Zacks ESP
      zacksData ? zacksData.time : null, // 24: Zacks Time
      date || "-", // 25: Date
    ];

    console.log(
      `📊 Completed resilient scraping for ${ticker}. Data array length: ${scrapedData.length}`
    );
    console.log("Scraped Data Array:", scrapedData);

    // --- GOOGLE SHEETS UPLOAD ---
    async function getSheetId(sheets, spreadsheetId, sheetName) {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId,
      });
      const sheet = response.data.sheets.find(
        (s) => s.properties.title === sheetName
      );
      return sheet.properties.sheetId;
    }

    async function appendToGoogleSheet(dataArray) {
      try {
        const creds = require("/Users/garisonjulius/Downloads/revised_stock/credentials.json");

        // Fix: Use googleapis with correct authentication
        const auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key.replace(/\\n/g, "\n"),
          },
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        const sheets = google.sheets({ version: "v4", auth });
        const spreadsheetId = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ";
        const range = "'Cursor_Raw'!A3"; // Let Sheets expand columns as needed

        // First, insert a new row at position 3 to shift existing data down
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId: await getSheetId(
                      sheets,
                      spreadsheetId,
                      "Cursor_Raw"
                    ),
                    dimension: "ROWS",
                    startIndex: 2, // 0-based index, so 2 = row 3
                    endIndex: 3,
                  },
                  inheritFromBefore: false,
                },
              },
            ],
          },
        });

        // Then insert the data into the new row 3
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          range: range,
          valueInputOption: "RAW",
          requestBody: {
            values: [dataArray],
          },
        });

        console.log("Successfully uploaded data to Google Sheets");
        return true;
      } catch (error) {
        console.error("Error uploading to Google Sheets:", error.message);
        return false;
      }
    }

    const uploadSuccess = await appendToGoogleSheet(scrapedData);
    if (!uploadSuccess) {
      console.warn(
        "Failed to upload to Google Sheets, but scraping completed successfully"
      );
    }
    // --- END GOOGLE SHEETS UPLOAD ---
  } catch (error) {
    console.error(
      `❌ Fatal error during scraping for ${ticker}:`,
      error.message
    );
    throw error;
  } finally {
    await browser.close();
  }
}

// Function to scrape calendar and get tickers
async function scrapeCalendar(day) {
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      console.log(
        `🚀 Launching browser for calendar scraping... (Attempt ${
          attempt + 1
        }/${MAX_RETRIES})`
      );
      const browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      console.log("📄 Navigating to Zacks earnings calendar...");
      await page.goto("https://www.zacks.com/earnings/earnings-calendar", {
        waitUntil: "networkidle2",
        timeout: 90000,
      }); // Increased timeout

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

      // Find and click the specific day
      console.log(`🎯 Looking for day ${day}...`);
      const daySelector = `#dt_${day}`;
      let found = false;
      try {
        await page.waitForSelector(daySelector, { timeout: 10000 });
        console.log(`✅ Found day ${day}, clicking...`);
        await page.click(daySelector);
        await wait(3000); // Wait 3 seconds after clicking the day
        found = true;
      } catch (error) {
        console.log(
          `❌ Day selector ${daySelector} not found, trying fallback...`
        );
        const dayElements = await page.$$(".caltddt, .caltddtyellow");
        for (const element of dayElements) {
          const text = await (
            await element.getProperty("textContent")
          ).jsonValue();
          if (parseInt(text, 10) === day) {
            console.log(`✅ Found day ${day} by text, clicking...`);
            await element.click();
            await wait(3000); // Wait 3 seconds after clicking the day (fallback)
            found = true;
            break;
          }
        }
      }
      if (!found) {
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
        await page.waitForSelector(
          "#earnings_rel_data_all_table_length select",
          { timeout: 10000 }
        );
        await page.select("#earnings_rel_data_all_table_length select", "-1");
        await wait(3000); // Wait 3 seconds after selecting ALL entries
        console.log("✅ Successfully set dropdown to ALL");
        await wait(5000);
      } catch (error) {
        console.log(
          "❌ Could not set dropdown to ALL, continuing with current view..."
        );
      }

      // Extract all stock data (symbol, estimate, ESP)
      console.log("\n🎯 Extracting stock data...");
      const stockData = await page.$$eval(
        "#earnings_rel_data_all_table tbody tr",
        (rows) => {
          return rows
            .map((row) => {
              const cells = row.querySelectorAll("td, th");
              if (cells.length === 0) return null;

              // Find symbol (first column with a link)
              let symbol = null;
              const link = row.querySelector("th a, td:first-child a");
              if (link) {
                symbol = link.textContent.trim();
              }

              // Find Estimate, ESP, and Time columns by looking for text content
              let estimate = null;
              let esp = null;
              let time = null;

              // Try to find columns by header text or position
              const headerRow = document.querySelector(
                "#earnings_rel_data_all_table thead tr, #earnings_rel_data_all_table .table-header"
              );
              if (headerRow) {
                const headers = Array.from(
                  headerRow.querySelectorAll("th, td")
                );
                const headerTexts = headers.map((h) =>
                  h.textContent.trim().toLowerCase()
                );

                // Find Estimate column index
                const estimateIndex = headerTexts.findIndex((text) =>
                  text.includes("estimate")
                );
                if (estimateIndex !== -1 && estimateIndex < cells.length) {
                  const estimateCell = cells[estimateIndex];
                  if (estimateCell) {
                    estimate = estimateCell.textContent.trim() || null;
                  }
                }

                // Find ESP column index
                const espIndex = headerTexts.findIndex((text) =>
                  text.includes("esp")
                );
                if (espIndex !== -1 && espIndex < cells.length) {
                  const espCell = cells[espIndex];
                  if (espCell) {
                    esp = espCell.textContent.trim() || null;
                  }
                }

                // Find Time column index
                const timeIndex = headerTexts.findIndex((text) =>
                  text.includes("time")
                );
                if (timeIndex !== -1 && timeIndex < cells.length) {
                  const timeCell = cells[timeIndex];
                  if (timeCell) {
                    time = timeCell.textContent.trim() || null;
                  }
                }
              }

              // If no headers found, try to extract by position (fallback)
              if (!estimate && !esp && !time && cells.length >= 4) {
                // Common positions: Symbol, Estimate, ESP, Time (but this is less reliable)
                if (cells[1] && cells[1].textContent.trim()) {
                  estimate = cells[1].textContent.trim();
                }
                if (cells[2] && cells[2].textContent.trim()) {
                  esp = cells[2].textContent.trim();
                }
                if (cells[3] && cells[3].textContent.trim()) {
                  time = cells[3].textContent.trim();
                }
              }

              return symbol ? { symbol, estimate, esp, time } : null;
            })
            .filter((stock) => stock);
        }
      );

      console.log(`📊 Total stocks extracted: ${stockData.length}`);
      console.log("📋 Sample data:", stockData.slice(0, 3)); // Log first 3 entries for verification
      await browser.close();
      return stockData;
    } catch (error) {
      attempt++;
      console.error(
        `❌ An error occurred during calendar scraping (Attempt ${attempt}):`,
        error.message
      );
      if (attempt >= MAX_RETRIES) {
        return [];
      } else {
        console.log("🔁 Retrying...");
        await wait(3000);
      }
    }
  }
}

// Main function
async function main() {
  console.log("🎯 Stock Analysis Scraper");
  console.log("=".repeat(50));
  console.log("1. Manual - Enter specific stock tickers");
  console.log("2. Calendar - Scrape stocks from Zacks earnings calendar");
  console.log("=".repeat(50));

  const choice = prompt("Enter your choice (1 or 2): ");

  let tickers = [];
  let dayNum = null; // Declare dayNum at function scope
  let stockData = null; // Declare stockData at function scope

  if (choice === "1") {
    // Manual mode
    console.log("\n📝 Manual Mode");
    console.log(
      "Enter stock tickers (one per line, press Enter twice when done):"
    );

    while (true) {
      const ticker = prompt("Ticker (or press Enter to finish): ")
        .trim()
        .toUpperCase();
      if (!ticker) break;
      tickers.push(ticker);
    }

    console.log(`\n📊 Manual tickers: ${tickers.join(", ")}`);
  } else if (choice === "2") {
    // Calendar mode
    console.log("\n📅 Calendar Mode");
    const day = prompt("Enter a day of the month (1-31): ");
    dayNum = parseInt(day, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      console.error("Invalid day. Please enter a number between 1 and 31.");
      process.exit(1);
    }

    console.log(`\n📅 Scraping calendar for day ${dayNum}...`);
    stockData = await scrapeCalendar(dayNum);

    if (stockData.length === 0) {
      console.error("❌ No stocks found for the specified date.");
      process.exit(1);
    }

    // Extract tickers from stock data for processing
    tickers = stockData.map((stock) => stock.symbol);

    // --- START FROM SPECIFIC TICKER FUNCTIONALITY ---
    // Set your start ticker here. Leave as empty string to scrape all.
    const startFromTicker = ""; // e.g., "AAPL" or "TSLA". Leave as "" to scrape all.
    if (startFromTicker) {
      const startIdx = tickers.indexOf(startFromTicker);
      if (startIdx !== -1) {
        stockData.splice(0, startIdx); // Remove stocks before start ticker
        tickers = stockData.map((stock) => stock.symbol);
        console.log(
          `\n⏩ Will start scraping from ${startFromTicker} (index ${
            startIdx + 1
          } of ${stockData.length + startIdx})`
        );
      } else {
        console.warn(
          `⚠️ Ticker ${startFromTicker} not found in the list. Will scrape all tickers.`
        );
      }
    }
    // --- END START FROM SPECIFIC TICKER FUNCTIONALITY ---

    console.log(`\n📊 Calendar stocks: ${tickers.join(", ")}`);
    console.log(`📋 Sample stock data:`, stockData.slice(0, 3));
  } else {
    console.error("❌ Invalid choice. Please enter 1 or 2.");
    process.exit(1);
  }

  // Process each ticker
  console.log("\n🚀 Starting to scrape data for each ticker...");
  console.log("=".repeat(50));

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    console.log(`\n📊 Processing ${i + 1}/${tickers.length}: ${ticker}`);
    console.log("-".repeat(30));

    try {
      // Pass date for calendar mode, null for manual mode
      const dateToPass = choice === "2" ? dayNum.toString() : null;

      // Pass Zacks data for calendar mode
      let zacksDataToPass = null;
      if (choice === "2" && stockData) {
        const stockInfo = stockData.find((stock) => stock.symbol === ticker);
        zacksDataToPass = stockInfo || null;
      }

      await scrapeForecastGrowth(ticker, dateToPass, zacksDataToPass);
      console.log(`✅ Successfully processed ${ticker}`);
    } catch (error) {
      console.error(`❌ Error processing ${ticker}:`, error.message);
    }

    // Add delay between requests to be respectful
    if (i < tickers.length - 1) {
      console.log("⏳ Waiting 2 seconds before next ticker...");
      await wait(2000);
    }
  }

  console.log("\n🎉 All tickers processed!");
  console.log(`📊 Total processed: ${tickers.length}`);
}

// Run the main function
if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  });
}

// Running Dates: 3-4
// Running Right Now: 4
// Start From Ticker (Optional): ""
