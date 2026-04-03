import csv
import json
import os

# Useage: 
# python merge_tickers.py 
def upload_to_google_sheets(data):
    """
    Upload ticker data to Google Sheets 'Master_Tickers' sheet.
    Clears existing data and writes new data.

    Args:
        data: List of tuples (ticker, earnings_time)
    """
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        print("Warning: Google API libraries not installed. Run: pip install google-api-python-client google-auth")
        return False

    try:
        # Load credentials
        creds_path = os.environ.get(
            "GOOGLE_CREDENTIALS_PATH",
            "/Users/garisonjulius/Downloads/revised_stock/credentials.json",
        )
        with open(creds_path, "r") as f:
            creds_data = json.load(f)

        credentials = Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )

        service = build("sheets", "v4", credentials=credentials)
        spreadsheet_id = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ"
        sheet_name = "Master_Tickers"

        # Clear existing data in the sheet
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_name}'!A:B"
        ).execute()

        # Prepare data with headers
        values = [["Ticker", "Earnings Call"]]  # Header row
        for ticker, earnings_time in data:
            values.append([ticker, earnings_time])

        # Write data to sheet
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_name}'!A1",
            valueInputOption="RAW",
            body={"values": values}
        ).execute()

        print(f"Successfully uploaded {len(data)} tickers to Google Sheets 'Master_Tickers'")
        return True

    except FileNotFoundError:
        print(f"Warning: Credentials file not found at {creds_path}")
        return False
    except Exception as e:
        print(f"Error uploading to Google Sheets: {e}")
        return False


def merge_tickers():
    """
    Merge tickers from Yahoo_Ticker and Zacks CSV into a master list.
    Creates Master_Tickers file and generates links for zacks.csv, finviz.csv, stock_analysis.csv
    Also uploads to Google Sheets.
    """
    master = {}  # ticker -> earnings_time

    # Parse Yahoo_Ticker file (CSV format: ticker, call_time, date)
    try:
        with open("Yahoo_Ticker", "r") as f:
            reader = csv.reader(f)
            next(reader, None)  # skip header row
            for row in reader:
                if len(row) < 2:
                    continue
                ticker = row[0].strip().upper()
                call_time = row[1].strip().upper()
                if ticker and ticker not in master:
                    master[ticker] = call_time
    except FileNotFoundError:
        print("Warning: Yahoo_Ticker not found")

    # Parse Zacks CSV file
    try:
        with open("StockCode - Zacks_AMC_BMO.csv", "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                # Skip header rows (start with "Ticker")
                if line.startswith("Ticker"):
                    continue
                # Parse CSV format: NFLX,amc
                parts = line.split(",")
                if len(parts) >= 2:
                    ticker = parts[0].strip().upper()
                    call_time = parts[1].strip().upper()
                    if ticker and call_time:
                        # Zacks values take priority over Yahoo
                        master[ticker] = call_time
    except FileNotFoundError:
        print("Warning: StockCode - Zacks_AMC_BMO.csv not found")

    # Write master list to file
    with open("Master_Tickers", "w") as f:
        for ticker, call_time in sorted(master.items()):
            f.write(f"('{ticker}', '{call_time}')\n")

    print(f"Created Master_Tickers with {len(master)} unique stocks")

    # Get sorted list of tickers
    tickers = sorted(master.keys())

    # Generate zacks.csv
    with open("zacks.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            url = f"https://www.zacks.com/stock/quote/{ticker}/detailed-earning-estimates?icid=quote-stock_overview-quote_nav_tracking-zcom-left_subnav_quote_navbar-detailed_earning_estimates"
            f.write(f'"{url}"\n')
    print(f"Created zacks.csv with {len(tickers)} links")

    # Generate finviz.csv
    with open("finviz.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            url = f"https://finviz.com/quote.ashx?t={ticker}&p=d"
            f.write(f'"{url}"\n')
    print(f"Created finviz.csv with {len(tickers)} links")

    # Generate stock_analysis.csv
    with open("stock_analysis.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            url = f"https://stockanalysis.com/stocks/{ticker.lower()}/forecast/"
            f.write(f'"{url}"\n')
    print(f"Created stock_analysis.csv with {len(tickers)} links")

    # Upload to Google Sheets
    sheet_data = [(ticker, master[ticker]) for ticker in tickers]
    upload_to_google_sheets(sheet_data)


if __name__ == "__main__":
    merge_tickers()
