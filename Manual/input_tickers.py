import csv
import json

# Usage:
# python input_tickers.py


def parse_csv_file(filepath):
    """
    Parse individual.csv and extract ticker (column 2) and earnings time (column 3).

    Returns:
        List of tuples (ticker, earnings_time)
    """
    results = []
    try:
        with open(filepath, "r") as f:
            reader = csv.reader(f)
            next(reader)  # Skip header row
            for row in reader:
                if len(row) >= 3:
                    ticker = row[1].strip().upper()
                    earnings_time = row[2].strip().lower()
                    if ticker and ticker != "":
                        results.append((ticker, earnings_time if earnings_time else "--"))
    except FileNotFoundError:
        print("Warning: individual.csv not found")
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return results


def upload_to_google_sheets(data):
    """
    Upload ticker data to Google Sheets 'Master_Tickers' sheet.
    Clears existing data and writes tickers in column A, earnings times in column B.
    """
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        print("Error: Google API libraries not installed. Run: pip install google-api-python-client google-auth")
        return False

    try:
        creds_path = "/Users/garisonjulius/Downloads/revised_stock/credentials.json"
        with open(creds_path, "r") as f:
            creds_data = json.load(f)

        credentials = Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )

        service = build("sheets", "v4", credentials=credentials)
        spreadsheet_id = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ"
        sheet_name = "Master_Tickers"

        # Clear existing data in columns A and B
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_name}'!A:B"
        ).execute()

        # Prepare data with headers
        values = [["Ticker", "Earnings Call"]]
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


def main():
    results = parse_csv_file("individual.csv")
    print(f"Found {len(results)} tickers in individual.csv")

    if results:
        upload_to_google_sheets(results)
    else:
        print("No tickers to upload.")


if __name__ == "__main__":
    main()
