import csv
import json
import os
import re
import time
import requests
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

API_KEY = os.environ.get(
    "BROWSE_AI_API_KEY",
    "fa89bf1d-7d0b-496f-a92e-e03567cb9de5:efde2f3c-78b5-4074-86d7-064a5db1d039",
)
API_BASE = "https://api.browse.ai/v2"

ROBOTS = {
    "Zacks": {
        "id": "019a7014-62da-78b6-b8cb-0920bdf49bf4",
        "csv": "zacks.csv",
    },
    "Finviz": {
        "id": "019be2dd-2a39-72db-93f0-bb010063d312",
        "csv": "finviz.csv",
    },
    "Stock Analysis": {
        "id": "019a60d7-5de1-797c-bd45-dce2036939a3",
        "csv": "stock_analysis.csv",
    },
    "Yahoo Finance": {
        "id": "019c6a1d-f16b-7a9c-93ca-abf67212cefd",
        "csv": "yahoo_finance.csv",
    },
}

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

CHUNK_SIZE = 1000  # Max URLs per bulk-run request
POLL_INTERVAL = 30  # Seconds between status checks


def read_urls(csv_path):
    """Read URLs from a CSV file with an 'Origin URL' header."""
    urls = []
    with open(csv_path, "r") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            url = row[0].strip().strip('"')
            if url and url != "Origin URL":
                urls.append(url)
    return urls


def run_bulk(robot_name, robot_id, urls):
    """Send a bulk run request to Browse AI for a list of URLs (fire and forget)."""
    for i in range(0, len(urls), CHUNK_SIZE):
        chunk = urls[i : i + CHUNK_SIZE]
        chunk_num = (i // CHUNK_SIZE) + 1
        total_chunks = (len(urls) + CHUNK_SIZE - 1) // CHUNK_SIZE

        payload = {
            "title": f"{robot_name} Bulk Run",
            "inputParameters": [{"originUrl": url} for url in chunk],
        }

        label = f"{robot_name}"
        if total_chunks > 1:
            label += f" (chunk {chunk_num}/{total_chunks})"

        print(f"  Sending {label}: {len(chunk)} URLs...")

        resp = requests.post(
            f"{API_BASE}/robots/{robot_id}/bulk-runs",
            headers=HEADERS,
            json=payload,
        )

        if resp.status_code == 200:
            data = resp.json()
            bulk_run_id = data.get("result", {}).get("id", "unknown")
            print(f"    Started bulk run: {bulk_run_id}")
        else:
            print(f"    Error {resp.status_code}: {resp.text}")

        # Small delay between requests to avoid rate limiting
        if i + CHUNK_SIZE < len(urls):
            time.sleep(2)


# ==========================
# Yahoo Finance specific
# ==========================

YAHOO_POLL_INTERVAL = 60 


def extract_from_task(task_result, input_url):
    """Extract ticker and screenshot URL from a completed task."""
    match = re.search(r"/quote/([^/]+)", input_url)
    ticker = match.group(1) if match else None

    screenshot_url = None
    screenshots = task_result.get("capturedScreenshots", {})
    if screenshots:
        entry = next(iter(screenshots.values()), None)
        if isinstance(entry, dict):
            screenshot_url = entry.get("src")
        elif isinstance(entry, str):
            screenshot_url = entry
    if not screenshot_url:
        def find_s3_url(obj):
            if isinstance(obj, str) and "browseai-captured-data.s3" in obj:
                return obj
            if isinstance(obj, dict):
                for v in obj.values():
                    found = find_s3_url(v)
                    if found:
                        return found
            if isinstance(obj, list):
                for v in obj:
                    found = find_s3_url(v)
                    if found:
                        return found
            return None
        screenshot_url = find_s3_url(task_result)

    return ticker, screenshot_url


def append_to_google_sheets(rows):
    """Append rows to the 'Image_Raw' sheet in Google Sheets in a single batch."""
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

    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range="'Image_Raw'!A:B",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows}
    ).execute()

    print(f"Appended {len(rows)} rows to Google Sheets 'Image_Raw'")


def run_yahoo_finance(robot_id, urls):
    """Submit Yahoo Finance URLs as a bulk run, poll, extract tickers/screenshots, and push to Google Sheets."""
    input_params = [{"originUrl": u} for u in urls]
    resp = requests.post(
        f"{API_BASE}/robots/{robot_id}/bulk-runs",
        headers=HEADERS,
        json={"title": "Yahoo Finance Bulk Run", "inputParameters": input_params},
    )
    resp.raise_for_status()
    bulk_data = resp.json()
    bulk_run_id = bulk_data["result"]["bulkRun"]["id"]
    total = len(urls)
    print(f"Bulk run started: {bulk_run_id} ({total} URLs)")

    while True:
        time.sleep(YAHOO_POLL_INTERVAL)
        resp = requests.get(
            f"{API_BASE}/robots/{robot_id}/bulk-runs/{bulk_run_id}",
            headers=HEADERS,
        )
        resp.raise_for_status()
        bulk_status = resp.json()
        bulk_run_result = bulk_status["result"]["bulkRun"]
        done = bulk_run_result.get("successfulTasks", 0) + bulk_run_result.get("failedTasks", 0)
        print(f"Progress: {done}/{total}")

        if done >= total:
            break

    tasks = bulk_status["result"].get("robotTasks", {}).get("items", [])

    rows = []
    for task in tasks:
        input_url = task.get("inputParameters", {}).get("originUrl", "")
        ticker, screenshot_url = extract_from_task(task, input_url)

        print(f"\nTicker: {ticker}")
        print(f"Screenshot URL: {screenshot_url}")

        if ticker and screenshot_url:
            rows.append([ticker, screenshot_url])

    if rows:
        append_to_google_sheets(rows)


def main():
    print("Starting Browse AI bulk runs...\n")

    for name, config in ROBOTS.items():
        csv_path = config["csv"]
        robot_id = config["id"]

        try:
            urls = read_urls(csv_path)
        except FileNotFoundError:
            print(f"  Skipping {name}: {csv_path} not found")
            continue

        if not urls:
            print(f"  Skipping {name}: no URLs in {csv_path}")
            continue

        print(f"{name} ({len(urls)} URLs from {csv_path})")

        if name == "Yahoo Finance":
            run_yahoo_finance(robot_id, urls)
        else:
            run_bulk(name, robot_id, urls)

        print()
        time.sleep(2)

    print("All bulk runs submitted.")


if __name__ == "__main__":
    main()
