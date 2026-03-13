import json
import time
import requests
from bs4 import BeautifulSoup
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

# 1) Update Tickers
# 2) Click on "Terminal"
# 3) Type "python finviz.py" and press Enter

# Example
# Tickers = ['AAPL', 'MSFT', 'GOOGL']
Tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN']
Data = ['P/E', 'Forward P/E', 'PEG', 'ROE', 'ROIC', 'Profit Margin', 'EPS Y/Y TTM', 'Sales Y/Y TTM', 'RSI (14)', 'Perf Quarter', 'Perf Year', 'Recom', 'Debt/Eq', 'Ticker']

HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
BATCH_SIZE = 10

# Set up Google Sheets
creds_path = "/Users/garisonjulius/Downloads/revised_stock/credentials.json"
with open(creds_path, "r") as f:
    creds_data = json.load(f)

credentials = Credentials.from_service_account_info(
    creds_data,
    scopes=["https://www.googleapis.com/auth/spreadsheets"]
)

service = build("sheets", "v4", credentials=credentials)
spreadsheet_id = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ"
sheet_name = "Individual"

# Scrape data and upload every 10 stocks
rows = []
next_row = 2  # row 1 is the header
for ticker in Tickers:
    url = f'https://finviz.com/quote.ashx?t={ticker}'
    resp = requests.get(url, headers=HEADERS)
    soup = BeautifulSoup(resp.text, 'html.parser')

    snapshot = {}
    table = soup.find('table', class_='snapshot-table2')
    if table:
        tds = table.find_all('td')
        for i in range(0, len(tds) - 1, 2):
            label = tds[i].text.strip()
            value = tds[i + 1].text.strip()
            snapshot[label] = value

    snapshot['Ticker'] = ticker
    row = [snapshot.get(field, 'N/A') for field in Data]
    rows.append(row)
    print(f'Scraped {ticker}')
    time.sleep(3)

    if len(rows) == BATCH_SIZE:
        range_name = f"'{sheet_name}'!A{next_row}"
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="RAW",
            body={"values": rows}
        ).execute()
        print(f'Uploaded batch of {len(rows)} rows (rows {next_row}-{next_row + len(rows) - 1})')
        next_row += len(rows)
        rows = []

# Upload remaining rows
if rows:
    range_name = f"'{sheet_name}'!A{next_row}"
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="RAW",
        body={"values": rows}
    ).execute()
    print(f'Uploaded final batch of {len(rows)} rows (rows {next_row}-{next_row + len(rows) - 1})')

print(f'Done. Uploaded {len(Tickers)} total rows to Google Sheets "{sheet_name}"')