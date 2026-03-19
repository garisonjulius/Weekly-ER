import subprocess
import sys
from datetime import date, timedelta

# Only run: python weekly/saturday.py from 
# root directory. 

def run(cmd, description):
    """Run a command and exit if it fails."""
    print(f"\n{'='*50}")
    print(f"  {description}")
    print(f"{'='*50}\n")
    result = subprocess.run(cmd, shell=isinstance(cmd, str))
    if result.returncode != 0:
        print(f"\nFailed: {description}")
        sys.exit(1)


def get_monday_two_weeks_ahead():
    """Calculate the Monday two weeks from now (click 'Next Week' twice on Zacks)."""
    today = date.today()
    days_ahead = (7 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return (today + timedelta(days=days_ahead + 7)).strftime("%Y-%m-%d")


def main():
    next_monday = get_monday_two_weeks_ahead()
    print(f"Next Monday: {next_monday}")

    # Step 1: Scrape Zacks earnings calendar
    run([sys.executable, "weekly/next_week_tickers.py"], "Scraping Zacks earnings calendar")

    # Step 2: Scrape Yahoo Finance earnings
    run([sys.executable, "weekly/yahoo.py", next_monday, "5"], f"Scraping Yahoo Finance earnings ({next_monday}, 5 days)")

    # Step 3: Push files to GitHub
    run("git add \"StockCode - Zacks_AMC_BMO.csv\" Yahoo_Ticker", "Staging files")
    run(["git", "commit", "-m", f"Weekly earnings data for {next_monday}"], "Committing")
    run(["git", "push"], "Pushing to GitHub")

    print("\n\nDone! GitHub Actions will run the rest on Sunday 6 AM PST.")


if __name__ == "__main__":
    main()
