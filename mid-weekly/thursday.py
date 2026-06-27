import subprocess
import sys
from datetime import date, timedelta

# Run from project root: python mid-weekly/thursday.py


def run(cmd, description):
    """Run a command and exit if it fails."""
    print(f"\n{'='*50}")
    print(f"  {description}")
    print(f"{'='*50}\n")
    result = subprocess.run(cmd, shell=isinstance(cmd, str))
    if result.returncode != 0:
        print(f"\nFailed: {description}")
        sys.exit(1)


def get_next_monday():
    """Calculate the upcoming Monday from Thursday."""
    today = date.today()
    days_ahead = (7 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return (today + timedelta(days=days_ahead)).strftime("%Y-%m-%d")


def main():
    next_monday = get_next_monday()
    print(f"Upcoming Monday: {next_monday}")

    # Step 1: Re-scrape Zacks (one week ahead click)
    run([sys.executable, "mid-weekly/next_week_tickers.py"], "Scraping Zacks earnings calendar")

    # Step 2: Re-scrape Yahoo Finance (5 days from next Monday)
    run(
        [sys.executable, "mid-weekly/yahoo.py", next_monday, "5"],
        f"Scraping Yahoo Finance earnings ({next_monday}, 5 days)"
    )

    # Step 3: Compare against Master_Tickers sheet, find newly confirmed, update sheet, generate URL CSVs
    run([sys.executable, "mid-weekly/update_tickers.py"], "Updating Master_Tickers and generating URL CSVs")

    # Step 4: Fire Browse AI bulk runs for newly confirmed tickers
    run([sys.executable, "mid-weekly/run_robots.py"], "Running Browse AI bulk scrapes")

    print("\n\nDone! Browse AI will write results to the ER tab.")


if __name__ == "__main__":
    main()
