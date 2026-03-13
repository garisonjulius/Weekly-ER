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

    // Format the date we want to scrape (current month only)
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // Convert to 1-12

    // Validate day is within valid range for current month
    const lastDayOfMonth = new Date(year, today.getMonth() + 1, 0).getDate();
    if (day > lastDayOfMonth) {
      throw new Error(
        `Invalid day ${day} for ${month}/${year}. Month only has ${lastDayOfMonth} days.`
      );
    }

    // Build date string directly to avoid timezone issues
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    console.log(`📅 Target date: ${dateStr} (day ${day})`);

    // Try clicking the calendar button first to properly initialize it
    console.log("📅 Opening calendar dialog...");
    let calendarButtonClicked = false;
    try {
      // Try various selectors for the calendar button
      const buttons = await page.$$(
        '#myDatepicker button, button[type="button"][aria-label*="calendar"], button[aria-label*="date"], button.calendar-button'
      );

      if (buttons.length > 0) {
        await buttons[0].click();
        calendarButtonClicked = true;
        await wait(1500);
      }
    } catch (e) {
      // Button click failed, will try forcing dialog visible instead
    }

    if (!calendarButtonClicked) {
      console.log("   Calendar button not found, forcing dialog visible...");
    }

    const dialogOpened = await page.evaluate(() => {
      const dialog = document.querySelector("#cb-dialog-1");
      if (dialog) {
        dialog.style.display = "block";
        // Also make sure it's not hidden by other styles
        dialog.style.visibility = "visible";
        dialog.style.zIndex = "10000";
        return true;
      }
      return false;
    });

    if (!dialogOpened) {
      console.log("⚠️ Could not open calendar dialog");
    }

    // Wait longer for calendar to fully render with proper styling
    await wait(2500);

    // Check initial calendar state
    const initialState = await page.evaluate(() => {
      const monthYearEl = document.querySelector(".month-year");
      return monthYearEl ? monthYearEl.textContent.trim() : "Not found";
    });
    console.log(`   Initial calendar: ${initialState}`);

    // Set the textbox directly first - this often triggers the calendar to update properly
    console.log(`📝 Pre-setting textbox to ${dateStr}...`);
    await page.evaluate((dateString) => {
      const textbox = document.querySelector("#cb-textbox-1");
      if (textbox) {
        textbox.value = dateString;
        textbox.dispatchEvent(new Event("input", { bubbles: true }));
        textbox.dispatchEvent(new Event("change", { bubbles: true }));
        textbox.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, dateStr);
    await wait(3000);

    // Check calendar state after setting textbox
    const updatedState = await page.evaluate(() => {
      const monthYearEl = document.querySelector(".month-year");
      return monthYearEl ? monthYearEl.textContent.trim() : "Not found";
    });
    console.log(`   Calendar after textbox set: ${updatedState}`);

    // If calendar is still showing old month (not 2025), wait for navigation
    // The navigation loop will handle it
    if (!updatedState.includes("2025") && updatedState !== "Not found") {
      console.log(`   Calendar not updated yet, navigation will handle it...`);
    }

    // Navigate to the correct year/month if still needed
    console.log(`📅 Navigating to ${month}/${year}...`);
    let navigationComplete = false;
    let navAttempts = 0;
    const maxAttempts = 100;

    while (navAttempts < maxAttempts && !navigationComplete) {
      // Check current calendar state only, don't click from evaluate
      const currentDate = await page.evaluate(
        (targetMonth, targetYear) => {
          const monthYearEl = document.querySelector(".month-year");
          if (!monthYearEl) return { error: "month-year element not found" };

          const text = monthYearEl.textContent.trim();
          const yearMatch = text.match(/\d{4}/);
          const currentYear = yearMatch ? parseInt(yearMatch[0]) : null;

          const monthNames = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
          const targetMonthName = monthNames[targetMonth - 1];

          // Check if we're at the target date
          if (text.includes(targetMonthName) && currentYear === targetYear) {
            return {
              currentYear,
              currentMonth: targetMonth,
              atTarget: true,
              text,
            };
          }

          // Determine what action needed (just return, don't click)
          if (currentYear !== targetYear) {
            return { needsYearNav: true, currentYear, text };
          }

          if (currentYear === targetYear) {
            const currentMonthIndex = monthNames.findIndex((m) =>
              text.includes(m)
            );
            if (currentMonthIndex === -1) {
              return { error: "Could not determine current month" };
            }

            if (currentMonthIndex === targetMonth - 1) {
              return { atTarget: true, text };
            }

            return {
              needsMonthNav: true,
              currentMonthIndex,
              text,
              isBeforeTarget: currentMonthIndex < targetMonth - 1,
            };
          }

          return { error: "Unexpected state" };
        },
        month,
        year
      );

      if (currentDate.error) {
        console.log("⚠️ Navigation error: " + currentDate.error);
        break;
      }

      if (currentDate.atTarget) {
        console.log(`✅ Reached ${month}/${year} (${currentDate.text})`);
        navigationComplete = true;
        break;
      }

      // Now do the actual clicking using pointer events instead of page.click()
      let clicked = false;

      if (currentDate.needsYearNav) {
        const buttonSelector =
          currentDate.currentYear < year
            ? "button.next-year"
            : "button.prev-year";
        try {
          await page.evaluate((selector) => {
            const btn = document.querySelector(selector);
            if (btn) {
              // Dispatch multiple event types to ensure compatibility
              btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
              btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
              btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
              btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
              btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
              btn.click(); // Native click as final attempt
            }
          }, buttonSelector);
          clicked = true;
          navAttempts++;
        } catch (e) {
          console.log(`   Error navigating year: ${e.message}`);
          break;
        }
      } else if (currentDate.needsMonthNav) {
        const buttonSelector = currentDate.isBeforeTarget
          ? "button.next-month"
          : "button.prev-month";
        try {
          await page.evaluate((selector) => {
            const btn = document.querySelector(selector);
            if (btn) {
              // Dispatch multiple event types to ensure compatibility
              btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
              btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
              btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
              btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
              btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
              btn.click(); // Native click as final attempt
            }
          }, buttonSelector);
          clicked = true;
          navAttempts++;
        } catch (e) {
          console.log(`   Error navigating month: ${e.message}`);
          break;
        }
      }

      if (clicked) {
        await wait(600);
      } else {
        console.log(`   No navigation needed`);
        break;
      }
    }

    // If navigation failed, it's OK - the textbox pre-setting may have already updated the calendar
    // Try to click the day anyway

    // Click the target day
    console.log(`📅 Clicking day ${day}...`);
    const dayClicked = await page.evaluate(
      (dayNum, monthNum, yearNum) => {
        // Try exact data-date match first
        const targetDate = `${yearNum}-${String(monthNum).padStart(
          2,
          "0"
        )}-${String(dayNum).padStart(2, "0")}`;
        let td = document.querySelector(`td[data-date="${targetDate}"]`);

        if (td && !td.hasAttribute("disabled")) {
          td.click();
          return { success: true, method: "data-date", date: targetDate };
        }

        // Fallback: find by visible text
        const allTds = Array.from(document.querySelectorAll("td"));
        td = allTds.find(
          (t) =>
            t.textContent.trim() === String(dayNum) &&
            !t.hasAttribute("disabled")
        );

        if (td) {
          td.click();
          return {
            success: true,
            method: "text",
            date: td.getAttribute("data-date"),
          };
        }

        return { success: false };
      },
      day,
      month,
      year
    );

    if (dayClicked.success) {
      console.log(
        `✅ Day ${day} clicked (${dayClicked.method}, actual date: ${dayClicked.date})`
      );

      // Wait for the click to process and table to start updating
      await wait(2000);

      // Set the textbox value to ensure the earnings filter updates
      console.log(`📝 Setting textbox to ${dateStr}...`);
      await page.evaluate((dateString) => {
        const textbox = document.querySelector("#cb-textbox-1");
        if (textbox) {
          textbox.value = dateString;
          // Trigger events to notify the component
          textbox.dispatchEvent(new Event("input", { bubbles: true }));
          textbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, dateStr);
      await wait(1000);

      // Close the calendar by clicking outside or pressing Escape
      console.log("⌨️ Closing calendar...");
      await page.keyboard.press("Escape");
      await wait(2500);
    } else {
      console.log(`⚠️ Could not click day ${day}`);
    }

    // Force trigger a search/filter by waiting for page to respond
    console.log("📊 Waiting for earnings table to update...");

    // Wait for the table selector to exist
    await page.waitForSelector("#earnings_rel_data_all_table", {
      timeout: 20000,
    });

    // Poll table row count to ensure it's loaded all data for the selected date
    let rowCountStable = false;
    let lastRowCount = 0;
    let stableChecks = 0;

    for (let i = 0; i < 20; i++) {
      const currentRowCount = await page
        .$$eval("#earnings_rel_data_all_table tbody tr", (trs) => trs.length)
        .catch(() => 0);

      if (i === 0) {
        console.log(`   Current rows: ${currentRowCount}`);
      }

      if (currentRowCount === lastRowCount) {
        stableChecks++;
        if (stableChecks >= 3) {
          rowCountStable = true;
          break;
        }
      } else {
        stableChecks = 0;
      }

      lastRowCount = currentRowCount;
      await wait(800);
    }

    console.log(`✅ Earnings table loaded (stable: ${rowCountStable})`);

    // Check what day's data is displayed
    const tableHeader = await page
      .$eval("#tableHeader", (el) => el.textContent || "")
      .catch(() => "Unknown");
    console.log(`📅 Table header: ${tableHeader}`);

    // Set the table to show ALL entries
    console.log("📋 Setting table to show ALL entries...");
    await wait(2000);

    try {
      console.log("🔍 Setting dropdown to show ALL entries (robust)...");

      // Try multiple possible selectors for the entries-per-page control.
      const dropdownSelectors = [
        "#earnings_rel_data_all_table_length select",
        'select[aria-controls="earnings_rel_data_all_table"]',
        "select#dt-length-0",
        'select.form-select[aria-controls="earnings_rel_data_all_table"]',
        "#earnings_rel_data_all_table_wrapper select",
      ];

      let setAll = false;
      for (const sel of dropdownSelectors) {
        try {
          const exists = await page.$(sel);
          if (!exists) continue;

          console.log(`   Trying dropdown selector: ${sel}`);

          // Check available options first
          const optionsInfo = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            return {
              options: Array.from(el.options).map((o) => ({
                value: o.value,
                text: o.textContent,
              })),
              currentValue: el.value,
            };
          }, sel);

          if (optionsInfo) {
            console.log(
              `   Available options:`,
              optionsInfo.options.slice(0, 5)
            );
          }

          // Try setting the highest value (usually -1 or largest number)
          const result = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { success: false, reason: "Element not found" };

            // Try value -1 first
            let opt = Array.from(el.options).find((o) => o.value === "-1");

            // Try "all" text
            if (!opt) {
              opt = Array.from(el.options).find((o) =>
                (o.textContent || "").toLowerCase().includes("all")
              );
            }

            // Fall back to last option (highest number)
            if (!opt) {
              opt = el.options[el.options.length - 1];
            }

            if (opt) {
              el.value = opt.value;
              // Dispatch multiple events to ensure change is registered
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return { success: true, selectedValue: opt.value };
            }
            return { success: false, reason: "No suitable option found" };
          }, sel);

          if (result.success) {
            setAll = true;
            console.log(`   ✅ Selected value: ${result.selectedValue}`);
            // Wait longer for table to update
            await wait(4000);
            break;
          }
        } catch (e) {
          console.log(`   ⚠️ Error with selector ${sel}:`, e.message);
        }
      }

      if (!setAll) {
        console.log(
          "❌ Could not set dropdown to ALL using known selectors, continuing with current view..."
        );
      } else {
        console.log("✅ Entries-per-page set to ALL (or attempted)");
      }
    } catch (err) {
      console.log(
        "❌ Could not set dropdown to ALL, continuing with current view...",
        err.message || err
      );
    }

    // Poll the table row count to ensure all rows are loaded (DataTables may still be rendering)
    console.log("⏳ Polling table row count to ensure all rows are loaded...");
    let prevRowCount = 0;
    let stableCount = 0;
    for (let i = 0; i < 15; i++) {
      const currentRowCount = await page.$$eval(
        "#earnings_rel_data_all_table tbody tr",
        (trs) => trs.length
      );
      console.log(`   Row count: ${currentRowCount}`);
      if (currentRowCount === prevRowCount) {
        stableCount++;
        if (stableCount >= 3) {
          console.log(`✅ Table stabilized at ${currentRowCount} rows`);
          break;
        }
      } else {
        stableCount = 0;
      }
      prevRowCount = currentRowCount;
      await wait(1500);
    }

    // Check if there's pagination info and try to load more if needed
    const totalRows = await page.evaluate(() => {
      const info =
        document.querySelector(".dataTables_info") ||
        document.querySelector("[role='status']");
      if (!info) return null;
      const text = (info.textContent || "").trim();
      const match = text.match(/(\d+)\s+entries/i) || text.match(/of\s+(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
      return null;
    });

    if (totalRows) {
      console.log(
        `📊 DataTables reports ${totalRows} total entries in filtered data`
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
  // Support CLI args for non-interactive runs:
  // node Scraper_V2.js calendar 27
  // node Scraper_V2.js manual (then interactive)
  const argv = process.argv.slice(2);
  let choiceArg = null;
  let dayArg = null;
  if (argv.length) {
    if (argv[0] === "calendar" || argv[0] === "--calendar") {
      choiceArg = "2";
      dayArg = argv[1];
    } else if (argv[0] === "manual" || argv[0] === "--manual") {
      choiceArg = "1";
    }
  }

  console.log("🎯 Stock Ticker Extractor");
  console.log("=".repeat(50));
  console.log("1. Manual - Enter specific stock tickers");
  console.log("2. Calendar - Scrape stocks from Zacks earnings calendar");
  console.log("=".repeat(50));

  const choice = choiceArg || prompt("Enter your choice (1 or 2): ");

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
    const dayStr = dayArg || prompt("Enter a day of the month (1-31): ");
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

// Run for the following dates: 15-19
// Currently running: 16
