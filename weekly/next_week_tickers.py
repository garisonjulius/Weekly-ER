import sys
import time
import csv
from datetime import datetime, timedelta

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, StaleElementReferenceException
except ImportError:
    print("Selenium is required. Install with: pip install selenium")
    sys.exit(1)

ZACKS_URL = (
    "https://www.zacks.com/earnings/earnings-calendar"
    "?icid=earnings-earnings_calendar-nav_tracking-zcom-main_menu_wrapper-earnings_calendar"
)


def setup_driver():
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(options=options)


def scrape_day_table(driver):
    """Scrape all ticker rows from the currently displayed earnings table."""
    tickers = []
    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "#earnings_rel_data_all_table tbody tr"))
        )
        time.sleep(2)

        # Click "All" in the "entries per page" dropdown to show every row
        try:
            from selenium.webdriver.support.ui import Select
            dropdown = driver.find_element(
                By.CSS_SELECTOR, "select[aria-controls='earnings_rel_data_all_table']"
            )
            Select(dropdown).select_by_value("-1")
            time.sleep(3)
        except Exception as e:
            print(f"      Dropdown fallback: {e}")

        rows = driver.find_elements(By.CSS_SELECTOR, "#earnings_rel_data_all_table tbody tr")
        for row in rows:
            try:
                # Symbol is in the first <th> with class q-ticker
                symbol_el = row.find_element(By.CSS_SELECTOR, "th.q-ticker a span.hoverquote-symbol")
                symbol = symbol_el.text.strip()

                cells = row.find_elements(By.CSS_SELECTOR, "td")
                # Time is the 3rd <td> (index 2) — bmo, amc, or --
                earnings_time = cells[2].text.strip() if len(cells) > 2 else "--"

                if symbol:
                    tickers.append((symbol, earnings_time))
            except Exception:
                continue
    except TimeoutException:
        pass

    return tickers


def scrape_next_week(driver):
    """Navigate to next week and scrape all 5 days."""
    driver.set_page_load_timeout(60)

    print("Loading Zacks earnings calendar...")
    for attempt in range(1, 4):
        try:
            driver.get(ZACKS_URL)
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "#prev_next"))
            )
            break
        except Exception as e:
            print(f"  Load attempt {attempt}/3 failed: {e}")
            if attempt == 3:
                raise
            time.sleep(10)
    time.sleep(3)

    # Click "Next Week" button twice to go 2 weeks ahead
    for i in range(2):
        print(f"Navigating to next week ({i+1}/2)...")
        next_week_btn = driver.find_element(
            By.CSS_SELECTOR, "#prev_next button.scroll-right"
        )
        next_week_btn.click()
        time.sleep(3)

    # Wait for the day cards to update
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, ".cal_link"))
    )

    # Get the week title to confirm
    try:
        week_title = driver.find_element(By.ID, "WeeklyEventsTitle").text
        print(f"  {week_title}")
    except Exception:
        pass

    all_results = {}  # date_label -> [(symbol, time)]

    # Click each day card (Mon-Fri: cal_link_0 through cal_link_4)
    for day_idx in range(5):
        btn_id = f"cal_link_{day_idx}"
        try:
            day_btn = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.ID, btn_id))
            )

            # Extract the day label from the card
            try:
                day_name = day_btn.find_element(By.CSS_SELECTOR, ".day").text.strip()
                month_el = day_btn.find_element(By.CSS_SELECTOR, ".month")
                date_text = month_el.text.strip().replace("\n", " ")
                day_label = f"{day_name} {date_text}"
            except Exception:
                day_label = f"Day {day_idx + 1}"

            print(f"  Scraping {day_label}...")
            # Scroll to top and use JS click to avoid "element not clickable" overlay issues
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(0.5)
            driver.execute_script("arguments[0].click();", day_btn)
            time.sleep(3)

            tickers = scrape_day_table(driver)
            all_results[day_label] = tickers
            print(f"    Found {len(tickers)} tickers")

        except Exception as e:
            print(f"    Error on day {day_idx}: {e}")
            all_results[f"Day {day_idx + 1}"] = []

    return all_results


def write_output(results):
    """Write results to StockCode CSV format and a summary."""
    # Flatten all tickers with their day and time info
    all_tickers = []
    for day_label, tickers in results.items():
        for symbol, earnings_time in tickers:
            all_tickers.append((symbol, earnings_time, day_label))

    # Deduplicate by symbol (keep first occurrence)
    seen = set()
    unique_tickers = []
    for symbol, earnings_time, day_label in all_tickers:
        if symbol not in seen:
            seen.add(symbol)
            unique_tickers.append((symbol, earnings_time, day_label))

    # Write StockCode CSV (compatible with generate_csv_from_stockcode.js)
    outfile = "StockCode - Zacks_AMC_BMO.csv"
    with open(outfile, "w", newline="") as f:
        writer = csv.writer(f)
        for symbol, earnings_time, day_label in unique_tickers:
            writer.writerow([symbol, earnings_time])

    print(f"\nWrote {len(unique_tickers)} unique tickers to '{outfile}'")

    # Print summary
    print("\nSummary by day:")
    for day_label, tickers in results.items():
        bmo = sum(1 for _, t in tickers if t.lower() == "bmo")
        amc = sum(1 for _, t in tickers if t.lower() == "amc")
        other = len(tickers) - bmo - amc
        print(f"  {day_label}: {len(tickers)} total (BMO: {bmo}, AMC: {amc}, Other: {other})")

    return unique_tickers


def main():
    driver = setup_driver()
    try:
        results = scrape_next_week(driver)
        write_output(results)
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
