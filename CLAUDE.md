# BrowseAI - Stock Scraper

Automated stock earnings scraper. Scrapes tickers from Zacks and Yahoo Finance, stores data in Google Sheets, and uses Claude for AI ratings.

## Project Structure

```
weekly/         # Saturday prep scripts (fully automated via GitHub Actions)
daily/          # Daily stock scraper (runs via GitHub Actions Mon-Fri)
.github/workflows/
  saturday_prep.yml     # Triggered by cron-job.org at 8:00 AM PDT Saturday (15:00 UTC)
  weekly_scrape.yml     # Triggered by cron-job.org at 9:00 AM PDT Saturday (16:00 UTC)
  daily_scrape.yml      # Triggered by cron-job.org at 6:45 AM, 9:30 AM, and 12:00 PM PST Mon-Fri
  52w_low_scrape.yml    # Triggered by cron-job.org at 9:00 AM PST Mon-Fri
  zacks_buylist.yml     # Triggered by cron-job.org at 6:00 AM PST Mon-Sat
```

## Daylight Saving Time

cron-job.org schedules are in UTC. When the US clocks change, update the cron-job.org triggers to keep the same local time:
- **Spring forward (March):** subtract 1 hour from UTC times (PST → PDT, UTC-8 → UTC-7)
- **Fall back (November):** add 1 hour to UTC times (PDT → PST, UTC-7 → UTC-8)


## Running Scripts

Always run from the project root:

```bash
# Daily scraper (normally runs via GitHub Actions)
node daily/daily.js --losers

# Manually trigger saturday prep if needed (normally automated)
python weekly/saturday.py
```

## Weekly Flow (fully automated on Saturday)

All steps run automatically via cron-job.org → GitHub Actions. No manual steps required.

### Saturday 8:00 AM PDT — `saturday_prep.yml` → `saturday.py`
1. Scrapes Zacks earnings calendar for next week → `StockCode - Zacks_AMC_BMO.csv`
2. Scrapes Yahoo Finance earnings (5 days) → `Yahoo_Ticker`
3. Commits and pushes both files to GitHub

### Saturday 9:00 AM PDT — `weekly_scrape.yml`
4. `reset.py` — clears Google Sheets (Mon–Fri, Master_Tickers, robot tabs)
5. `merge_tickers.py` — merges CSVs, generates URL lists, uploads to Master_Tickers sheet
6. `run_robots.py` — fires Browse AI bulk scrape jobs (Zacks, Finviz, Stock Analysis) asynchronously

## Daily Flows (daily.js)

All modes triggered via `workflow_dispatch` by cron-job.org. Each scrapes Zacks + Finviz per ticker using Puppeteer, filters, and uploads to Google Sheets (ID via `SPREADSHEET_ID` env var).

Filters applied before uploading (all modes):
- **Recom < 1.5** (analyst recommendation, index 27)
- **RSI < 70** (relative strength index, index 24)

Zacks scrape retries once (5s delay) before falling back to null values.

After upload, sheet is sorted by Recom ascending. Claude ratings (column AE) are intentionally disabled — `runClaudeRatings(uploadedCount)` is commented out in `daily.js` and should stay that way until re-enabled deliberately.

### `--losers` → `Price Down` sheet
Scrapes Yahoo Finance top daily losers. Caps at 25 uploaded rows. Runs at 6:45 AM, 9:30 AM, and 12:00 PM PST — later runs clear and refresh earlier data.

### `--52w-losers` → `52W Low` sheet
Scrapes Yahoo Finance 52-week losers. Runs at 9:00 AM PST.

### `--zacks-buylist` → `Zacks #1` sheet
Logs into Zacks Premium and scrapes tickers added to the #1 Buy List today. No upload cap. Does not clear the sheet — new rows are inserted at row 2 (top of data) so the newest additions always appear first. Exits cleanly (code 0) if no tickers were added today. Requires `ZACKS_EMAIL` and `ZACKS_PASSWORD` secrets. Runs at 6:00 AM PST Mon-Sat.

## Environment Variables

- `CLAUDE_API_KEY` — Anthropic API key
- `GOOGLE_CREDENTIALS_PATH` — path to Google service account credentials JSON
- `BROWSE_AI_API_KEY` — Browse AI API key (weekly workflow only)
- `SLACK_WEBHOOK_URL` — Slack notification webhook (GitHub Actions only)
- `ZACKS_EMAIL` — Zacks Premium login email (zacks-buylist workflow only)
- `ZACKS_PASSWORD` — Zacks Premium login password (zacks-buylist workflow only)
