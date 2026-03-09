import sys
import time
from datetime import datetime, timedelta

# example usage: year-month-day num_days
# python yahoo.py 2026-01-30 5
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


def get_earnings_for_date(driver, date: str) -> list[tuple[str, str, str]]:
    """
    Scrape earnings data for a single date using an existing driver.

    Returns:
        List of tuples (ticker, call_time, date)
    """
    results = []
    offset = 0
    page_size = 100

    while True:
        url = f"https://finance.yahoo.com/calendar/earnings?day={date}&offset={offset}&size={page_size}"
        driver.get(url)

        wait = WebDriverWait(driver, 15)
        try:
            wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "table tbody tr"))
            )
        except TimeoutException:
            break

        time.sleep(2)

        page_results = []
        try:
            table = driver.find_element(By.CSS_SELECTOR, "table")
            rows = table.find_elements(By.CSS_SELECTOR, "tbody tr")

            for row in rows:
                try:
                    cells = row.find_elements(By.CSS_SELECTOR, "td")
                    if len(cells) >= 4:
                        ticker = cells[0].text.strip()
                        call_time = cells[3].text.strip() or "-"

                        if ticker and "%" not in ticker:
                            if not any(t[0] == ticker for t in results + page_results):
                                page_results.append((ticker, call_time, date))
                except:
                    continue
        except:
            break

        if not page_results:
            break

        results.extend(page_results)
        offset += page_size

        if offset > 2000:
            break

    return results


def get_earnings_tickers(start_date: str, num_days: int = 1) -> list[tuple[str, str, str]]:
    """
    Scrape stock ticker codes and earnings call times for multiple consecutive days.

    Args:
        start_date: Start date in format 'YYYY-MM-DD'
        num_days: Number of consecutive days (1-5)

    Returns:
        List of tuples (ticker_symbol, earnings_call_time, date)
    """
    if not SELENIUM_AVAILABLE:
        raise ImportError(
            "Selenium is required. Install with: pip install selenium\n"
            "Also ensure Chrome/Chromium and chromedriver are installed."
        )

    # Validate date format
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError:
        raise ValueError("Date must be in YYYY-MM-DD format")

    # Validate num_days
    if not 1 <= num_days <= 5:
        raise ValueError("Number of days must be between 1 and 5")

    # Generate list of dates
    dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(num_days)]

    # Setup headless Chrome
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    )

    driver = webdriver.Chrome(options=options)
    all_results = []

    try:
        for date in dates:
            print(f"Fetching {date}...")
            results = get_earnings_for_date(driver, date)
            all_results.extend(results)
    finally:
        driver.quit()

    return all_results


def main():
    if len(sys.argv) < 2:
        print("Usage: python yahoo.py YYYY-MM-DD [num_days]")
        print("Example: python yahoo.py 2026-01-30 5")
        print("  (fetches 5 consecutive days starting from 2026-01-30)")
        sys.exit(1)

    start_date = sys.argv[1]
    num_days = int(sys.argv[2]) if len(sys.argv) > 2 else 1

    if num_days < 1 or num_days > 5:
        print("Error: num_days must be between 1 and 5")
        sys.exit(1)

    try:
        results = get_earnings_tickers(start_date, num_days)

        # Write results to file (overwrites if exists)
        with open("Yahoo_Ticker", "w") as f:
            for ticker, call_time, date in results:
                f.write(f"('{ticker}', '{call_time}', '{date}')\n")

        print(f"Found {len(results)} tickers. Written to Yahoo_Ticker")
    except ImportError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
