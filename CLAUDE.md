# BrowseAI - Stock Scraper

Automated stock earnings scraper. Scrapes tickers from Zacks and Yahoo Finance, stores data in Google Sheets, and uses Claude for AI ratings.

## Project Structure

```
weekly/         # Saturday prep scripts (run locally before Sunday GH Actions)
daily/          # Daily stock scraper (runs via GitHub Actions Mon-Fri)
.github/workflows/
  weekly_scrape.yml     # Runs every Sunday 6 AM PST
  daily_scrape.yml      # Triggered by cron-job.org at 6:45 AM & 10:00 AM PST Mon-Fri
  52w_low_scrape.yml    # Triggered by cron-job.org at 6:00 AM PST Mon-Fri
  zacks_buylist.yml     # Triggered by cron-job.org at 6:00 AM PST Mon-Fri
```

## Running Scripts

Always run from the project root:

```bash
# Saturday: prep next week's earnings data, commit & push to GitHub
python weekly/saturday.py

# Daily scraper (normally runs via GitHub Actions)
node daily/daily.js --losers
```

## Weekly Flow (saturday.py)

1. Scrapes Zacks earnings calendar for next week → `StockCode - Zacks_AMC_BMO.csv`
2. Scrapes Yahoo Finance earnings (5 days) → `Yahoo_Ticker`
3. Commits and pushes both files to GitHub
4. GitHub Actions picks up on Sunday 6 AM PST and runs the rest:
   - `reset.py` — clears Google Sheets
   - `merge_tickers.py` — merges CSVs, generates upload data
   - `run_robots.py` — triggers Browse AI robots via API

## Daily Flows (daily.js)

All modes triggered via `workflow_dispatch` by cron-job.org. Each scrapes Zacks + Finviz per ticker using Puppeteer, filters, and uploads to Google Sheets (Spreadsheet ID: `1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ`).

Filters applied before uploading (all modes):
- **Recom < 1.5** (analyst recommendation, index 27)
- **RSI < 70** (relative strength index, index 24)

Zacks scrape retries once (5s delay) before falling back to null values.

After upload, sheet is sorted by Recom ascending. Claude ratings (column AE) are currently disabled.

### `--losers` → `Price Down` sheet
Scrapes Yahoo Finance top daily losers. Caps at 25 uploaded rows. Runs at 6:45 AM and 10:00 AM PST — the 10 AM run clears and refreshes the morning data.

### `--52w-losers` → `52W Low` sheet
Scrapes Yahoo Finance 52-week losers. Runs at 6:00 AM PST.

### `--zacks-buylist` → `Zacks #1` sheet
Logs into Zacks Premium and scrapes tickers added to the #1 Buy List today. No upload cap. Exits cleanly (code 0) if no tickers were added today. Requires `ZACKS_EMAIL` and `ZACKS_PASSWORD` secrets. Runs at 6:00 AM PST.

## Environment Variables

- `CLAUDE_API_KEY` — Anthropic API key
- `GOOGLE_CREDENTIALS_PATH` — path to Google service account credentials JSON
- `BROWSE_AI_API_KEY` — Browse AI API key (weekly workflow only)
- `SLACK_WEBHOOK_URL` — Slack notification webhook (GitHub Actions only)
- `ZACKS_EMAIL` — Zacks Premium login email (zacks-buylist workflow only)
- `ZACKS_PASSWORD` — Zacks Premium login password (zacks-buylist workflow only)
