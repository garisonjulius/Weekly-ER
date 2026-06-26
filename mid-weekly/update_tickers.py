import csv
import sys
from config import SPREADSHEET_ID
from sheets_auth import get_sheets_service


def is_valid(call_time):
    return call_time.upper() in ("AMC", "BMO")


def read_master_tickers_from_sheet():
    """Read existing tickers and call times from Master_Tickers Google Sheet."""
    service = get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range="'Master_Tickers'!A:B"
    ).execute()
    values = result.get("values", [])
    master = {}
    for row in values[1:]:  # skip header
        if len(row) >= 2:
            ticker = row[0].strip().upper()
            call_time = row[1].strip().upper()
            if ticker:
                master[ticker] = call_time
        elif len(row) == 1:
            ticker = row[0].strip().upper()
            if ticker:
                master[ticker] = ""
    return master


def merge_scraped_tickers():
    """Merge freshly scraped Yahoo and Zacks data. Returns only confirmed tickers."""
    merged = {}

    # Load Yahoo first
    try:
        with open("Yahoo_Ticker", "r") as f:
            reader = csv.reader(f)
            next(reader, None)  # skip header
            for row in reader:
                if len(row) < 2:
                    continue
                ticker = row[0].strip().upper()
                call_time = row[1].strip().upper()
                if ticker:
                    merged[ticker] = call_time
    except FileNotFoundError:
        print("Warning: Yahoo_Ticker not found")

    # Load Zacks — overwrites only if it has a valid value
    try:
        with open("StockCode - Zacks_AMC_BMO.csv", "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("Ticker"):
                    continue
                parts = line.split(",")
                if len(parts) >= 2:
                    ticker = parts[0].strip().upper()
                    call_time = parts[1].strip().upper()
                    if ticker and call_time:
                        if is_valid(call_time) or ticker not in merged:
                            merged[ticker] = call_time
    except FileNotFoundError:
        print("Warning: StockCode - Zacks_AMC_BMO.csv not found")

    # Return only tickers with confirmed call times
    return {t: ct for t, ct in merged.items() if is_valid(ct)}


def update_master_tickers_sheet(all_tickers):
    """Rewrite Master_Tickers sheet with the full updated ticker list."""
    service = get_sheets_service()
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range="'Master_Tickers'!A:B"
    ).execute()

    values = [["Ticker", "Earnings Call"]]
    for ticker, call_time in sorted(all_tickers.items()):
        values.append([ticker, call_time])

    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range="'Master_Tickers'!A1",
        valueInputOption="RAW",
        body={"values": values}
    ).execute()
    print(f"Updated Master_Tickers with {len(all_tickers)} total tickers")


def generate_url_csvs(tickers):
    """Generate Zacks, Finviz, and Stock Analysis URL CSVs for newly confirmed tickers."""
    sorted_tickers = sorted(tickers)

    with open("zacks.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in sorted_tickers:
            url = f"https://www.zacks.com/stock/quote/{ticker}/detailed-earning-estimates?icid=quote-stock_overview-quote_nav_tracking-zcom-left_subnav_quote_navbar-detailed_earning_estimates"
            f.write(f'"{url}"\n')

    with open("finviz.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in sorted_tickers:
            url = f"https://finviz.com/quote.ashx?t={ticker}&p=d"
            f.write(f'"{url}"\n')

    with open("stock_analysis.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in sorted_tickers:
            url = f"https://stockanalysis.com/stocks/{ticker.lower()}/forecast/"
            f.write(f'"{url}"\n')

    print(f"Generated URL CSVs for {len(sorted_tickers)} newly confirmed tickers")


def main():
    print("Reading existing Master_Tickers from Google Sheets...")
    existing = read_master_tickers_from_sheet()
    print(f"Found {len(existing)} existing tickers in sheet")

    print("Merging freshly scraped Yahoo and Zacks data...")
    scraped = merge_scraped_tickers()
    print(f"Found {len(scraped)} confirmed tickers in fresh scrape")

    # Newly confirmed: was missing or had no valid call time on Saturday
    newly_confirmed = {
        ticker: call_time
        for ticker, call_time in scraped.items()
        if not is_valid(existing.get(ticker, ""))
    }

    print(f"\nNewly confirmed tickers: {len(newly_confirmed)}")
    for ticker, ct in sorted(newly_confirmed.items()):
        print(f"  {ticker}: {ct}")

    # Build updated master: start from existing, apply scraped changes
    updated_master = dict(existing)
    for ticker, call_time in scraped.items():
        existing_ct = existing.get(ticker, "")
        if existing_ct != call_time:
            if not is_valid(existing_ct):
                # New or previously unconfirmed
                updated_master[ticker] = call_time
            else:
                # Call time changed — update in sheet but don't re-send to Browse AI
                print(f"  Call time updated for {ticker}: {existing_ct} → {call_time}")
                updated_master[ticker] = call_time

    # Keep only valid call times in the sheet
    updated_master = {t: ct for t, ct in updated_master.items() if is_valid(ct)}

    print("\nUpdating Master_Tickers sheet...")
    update_master_tickers_sheet(updated_master)

    print("\nGenerating URL CSVs for newly confirmed tickers...")
    generate_url_csvs(newly_confirmed.keys())

    if not newly_confirmed:
        print("\nNo newly confirmed tickers — Browse AI will have nothing to process.")


if __name__ == "__main__":
    main()
