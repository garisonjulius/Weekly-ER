# BrowseAI - Stock Scraper

Automated stock earnings scraper. Scrapes tickers from Zacks and Yahoo Finance, stores data in Google Sheets, and uses Claude for AI ratings.

## Project Structure

```
weekly/         # Saturday prep scripts (fully automated via GitHub Actions)
mid-weekly/     # Thursday mid-week re-scrape (fully automated via GitHub Actions)
daily/          # Daily stock scraper (runs via GitHub Actions Mon-Fri)
.github/workflows/
  saturday_prep.yml     # Triggered by cron-job.org at 8:00 AM PDT Saturday (15:00 UTC)
  weekly_scrape.yml     # Triggered by cron-job.org at 9:00 AM PDT Saturday (16:00 UTC)
  mid_weekly_scrape.yml # Triggered by cron-job.org at 9:00 AM PST Thursday (17:00 UTC)
  daily_scrape.yml      # Triggered by cron-job.org at 6:45 AM, 9:30 AM, and 12:00 PM PST Mon-Fri
  52w_low_scrape.yml    # Triggered by cron-job.org at 9:00 AM PST Mon-Fri
  zacks_buylist.yml     # Triggered by cron-job.org at 6:00 AM PST Mon-Sat
```

## Daylight Saving Time

cron-job.org schedules and Claude Code Routines are in UTC. When the US clocks change, update both to keep the same local time:
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

## Mid-Weekly Flow (fully automated on Thursday)

Runs automatically via cron-job.org → GitHub Actions every Thursday at 9:00 AM PST. Purpose: catch tickers that had no confirmed AMC/BMO call time when Saturday ran and get them into Browse AI mid-week.

**Does NOT run `reset.py`** — existing ER data is preserved.

### Thursday 9:00 AM PST — `mid_weekly_scrape.yml` → `thursday.py`

1. `next_week_tickers.py` — re-scrapes Zacks earnings calendar (one week ahead) → `StockCode - Zacks_AMC_BMO.csv`
2. `yahoo.py` — re-scrapes Yahoo Finance (5 days from next Monday) → `Yahoo_Ticker`
3. `update_tickers.py` — merges fresh data, identifies newly confirmed tickers (had no valid AMC/BMO on Saturday), **appends** them to `Master_Tickers` sheet (no wipe), generates URL CSVs for newly confirmed tickers only
4. `run_robots.py` — fires Browse AI bulk scrape jobs (Zacks, Finviz, Stock Analysis) for newly confirmed tickers only

Slack notification sent on success or failure with count of newly confirmed tickers.

## Daily Flows (daily.js)

All modes triggered via `workflow_dispatch` by cron-job.org. Each scrapes Zacks + Finviz per ticker using Puppeteer, filters, and uploads to Google Sheets (ID via `SPREADSHEET_ID` env var).

Filters applied before uploading (all modes):
- **Recom < 2** (analyst recommendation, index 27)
- **RSI < 70** (relative strength index, index 24)

Zacks scrape retries once (5s delay) before falling back to null values.

After upload, sheet is sorted by Recom ascending. Claude ratings (column AE) are intentionally disabled — `runClaudeRatings(uploadedCount)` is commented out in `daily.js` and should stay that way until re-enabled deliberately.

### `--losers` → `Price Down` sheet
Scrapes Yahoo Finance top daily losers. Caps at 25 uploaded rows. Runs at 6:45 AM, 9:30 AM, and 12:00 PM PST — later runs clear and refresh earlier data.

### `--52w-losers` → `52W Low` sheet
Scrapes Yahoo Finance 52-week losers. Runs at 9:00 AM PST.

### `--zacks-buylist` → `Zacks #1` sheet
Logs into Zacks Premium and scrapes tickers added to the #1 Buy List today. No upload cap. Does not clear the sheet — new rows are inserted at row 2 (top of data) so the newest additions always appear first. Exits cleanly (code 0) if no tickers were added today. Requires `ZACKS_EMAIL` and `ZACKS_PASSWORD` secrets. Runs at 6:00 AM PST Mon-Sat.

## Claude Analysis Pipeline (automated, runs after daily.js)

A Claude routine that reads the `Price Down` sheet and produces structured stock analyses written to Notion. Runs automatically Mon–Fri at 10:30 AM PDT via Claude Code Routines (routine ID: `trig_018FDLayKqJ4dCWhMyGWXZNQ`, manage at https://claude.ai/code/routines).

The prompt lives in `daily/claude_analysis_prompt.md`. To run manually, paste its contents into a Claude Code session.

**DST note:** The routine cron is `30 17 * * 1-5` (17:30 UTC = 10:30 AM PDT). When clocks fall back in November (PDT → PST), update the routine to `30 18 * * 1-5` to keep 10:30 AM local time.

**Source:** Google Sheet `Price Down` tab (gid 595411953) — same sheet daily.js writes to.

**Notion database:** Daily Stock Analysis — `collection://5da60d42-25ee-4b8f-8720-ec5889f98578` inside `https://app.notion.com/p/389decce4ccc8171baa5e2626db007b9`

### Pipeline steps

1. **Hard filter** — exclude Zacks Rank 4 or 5
2. **Structured analysis** — six sections per stock (Earnings Surprise Outlook, Trend and Quality, Valuation, Technical Setup, Risk Flags, Bottom Line) using only spreadsheet metrics
3. **Web research** — only for stocks flagged `RESEARCH_CANDIDATE: YES`
4. **Write to Notion** — one page per surviving stock with all properties and full analysis body

### RESEARCH_CANDIDATE three-state classification

After the Bottom Line in Step 2, each stock is assigned one of:

- **YES** — case for mean reversion vs. genuine decline is ambiguous from metrics alone; web research needed. Strong fundamentals clashing with a large unexplained drop, missing key data, or an earnings report today.
- **NO_BULLISH** — metrics already paint a constructive picture (improving fundamentals, favorable rank, low valuation, RSI approaching oversold in an uptrend); decline looks like sector/sentiment noise. Surface as a potential candidate without researching.
- **NO_BEARISH** — metrics already paint a negative picture (deteriorating earnings, strong miss signals, extreme valuation vs. declining fundamentals, crypto proxy behavior); decline consistent with fundamental weakness. Skip.

### Notion schema (Daily Stock Analysis)

| Property | Type | Notes |
|---|---|---|
| Ticker | title | |
| Rating | select | STRONG BUY / BUY / HOLD / SELL / STRONG SELL |
| Date | date | ISO-8601 |
| Zacks Rank | number | |
| VGM | select | A / B / C / D / F |
| Price | number (dollar) | |
| % Change | number | strip the % sign |
| RSI | number | |
| Industry | text | |
| Bottom Line | text | one sentence synthesis |
| Research Candidate | select | YES / NO_BULLISH / NO_BEARISH |

## Environment Variables

- `CLAUDE_API_KEY` — Anthropic API key
- `GOOGLE_CREDENTIALS_PATH` — path to Google service account credentials JSON
- `BROWSE_AI_API_KEY` — Browse AI API key (weekly workflow only)
- `SLACK_WEBHOOK_URL` — Slack notification webhook (GitHub Actions only)
- `ZACKS_EMAIL` — Zacks Premium login email (zacks-buylist workflow only)
- `ZACKS_PASSWORD` — Zacks Premium login password (zacks-buylist workflow only)
