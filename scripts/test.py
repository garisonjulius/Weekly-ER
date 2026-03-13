import json
import re
import requests
import time
import csv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

# ==========================
# CONFIG
# ==========================

API_KEY = "fa89bf1d-7d0b-496f-a92e-e03567cb9de5:efde2f3c-78b5-4074-86d7-064a5db1d039"
ROBOT_ID = "019c6a1d-f16b-7a9c-93ca-abf67212cefd"

API_BASE = "https://api.browse.ai/v2"
INPUT_CSV = "yahoo_finance.csv"

POLL_INTERVAL = 10

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}


def extract_from_task(task_result, input_url):
    """Extract ticker and screenshot URL from a completed task."""
    # Extract ticker from the input URL (e.g. /quote/TSLA/)
    match = re.search(r"/quote/([^/]+)", input_url)
    ticker = match.group(1) if match else None

    # Extract screenshot URL from the response
    screenshot_url = None
    screenshots = task_result.get("capturedScreenshots", {})
    if screenshots:
        entry = next(iter(screenshots.values()), None)
        if isinstance(entry, dict):
            screenshot_url = entry.get("src")
        elif isinstance(entry, str):
            screenshot_url = entry
    # Fallback: walk the whole result looking for an S3 URL
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


def bulk_run(urls):
    """Submit all URLs as a bulk run, poll until all tasks finish, then process results."""
    # Start the bulk run
    input_params = [{"originUrl": u} for u in urls]
    resp = requests.post(
        f"{API_BASE}/robots/{ROBOT_ID}/bulk-runs",
        headers=HEADERS,
        json={"title": "Yahoo Finance Bulk Run", "inputParameters": input_params},
    )
    resp.raise_for_status()
    bulk_data = resp.json()
    bulk_run_id = bulk_data["result"]["bulkRun"]["id"]
    total = len(urls)
    print(f"Bulk run started: {bulk_run_id} ({total} URLs)")

    # Poll until all tasks are done
    while True:
        time.sleep(POLL_INTERVAL)
        resp = requests.get(
            f"{API_BASE}/robots/{ROBOT_ID}/bulk-runs/{bulk_run_id}",
            headers=HEADERS,
        )
        resp.raise_for_status()
        bulk_status = resp.json()
        bulk_run_result = bulk_status["result"]["bulkRun"]
        done = bulk_run_result.get("successfulTasks", 0) + bulk_run_result.get("failedTasks", 0)
        print(f"Progress: {done}/{total}")

        if done >= total:
            break

    # Get tasks from the bulk run status response
    tasks = bulk_status["result"].get("robotTasks", {}).get("items", [])

    # Process each completed task
    for task in tasks:
        input_url = task.get("inputParameters", {}).get("originUrl", "")
        ticker, screenshot_url = extract_from_task(task, input_url)

        print(f"\nTicker: {ticker}")
        print(f"Screenshot URL: {screenshot_url}")

        if ticker and screenshot_url:
            append_to_google_sheets(ticker, screenshot_url)


def append_to_google_sheets(ticker, image_url):
    """Append a row to the 'Image_Raw' sheet in Google Sheets."""
    creds_path = "/Users/garisonjulius/Downloads/revised_stock/credentials.json"
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
        body={"values": [[ticker, image_url]]}
    ).execute()

    print(f"Appended {ticker} to Google Sheets 'Image_Raw'")


if __name__ == "__main__":
    urls = []
    with open(INPUT_CSV, "r") as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            if not row:
                continue
            target_url = row[0].strip()
            if target_url:
                urls.append(target_url)
    print(f"Loaded {len(urls)} URLs from {INPUT_CSV}")
    bulk_run(urls)
