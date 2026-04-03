import csv
import os
import sys
import time
import requests

API_KEY = os.environ.get("BROWSE_AI_API_KEY")
if not API_KEY:
    print("Error: BROWSE_AI_API_KEY environment variable is not set")
    sys.exit(1)
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

        run_bulk(name, robot_id, urls)

        print()
        time.sleep(2)

    print("All bulk runs submitted.")


if __name__ == "__main__":
    main()
