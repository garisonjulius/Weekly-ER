import glob
import csv

# Usage:
# python create_zacks_csv.py


def find_csv_file(day_pattern):
    """Find CSV file matching the day pattern (mon, tue, wed, thur, fri)."""
    pattern = f"*_next_week_{day_pattern}_captured-list_*.csv"
    matches = glob.glob(pattern)
    if matches:
        return matches[0]
    return None


def parse_csv_file(filepath):
    """
    Parse a CSV file and extract ticker (column 3) and earnings time (column 5).

    Returns:
        List of tuples (ticker, earnings_time)
    """
    results = []
    try:
        with open(filepath, "r") as f:
            reader = csv.reader(f)
            next(reader)  # Skip header row
            for row in reader:
                if len(row) >= 5:
                    ticker = row[2].strip().upper()  # Column 3 (0-indexed: 2)
                    earnings_time = row[4].strip().lower()  # Column 5 (0-indexed: 4)
                    if ticker and ticker != "":
                        results.append((ticker, earnings_time if earnings_time else "--"))
    except FileNotFoundError:
        print(f"Warning: {filepath} not found")
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return results


def create_zacks_csv():
    """
    Read 5 daily CSV files (mon, tue, wed, thur, fri) and create StockCode - Zacks_AMC_BMO.csv.
    """
    days = ["mon", "tue", "wed", "thur", "fri"]
    all_data = []

    for day in days:
        filepath = find_csv_file(day)
        if filepath:
            print(f"Reading {filepath}...")
            results = parse_csv_file(filepath)
            all_data.append(results)
            print(f"  Found {len(results)} tickers for {day}")
        else:
            print(f"Warning: No CSV file found for {day}")
            all_data.append([])

    # Write to StockCode - Zacks_AMC_BMO.csv
    with open("StockCode - Zacks_AMC_BMO.csv", "w") as f:
        for i, day_data in enumerate(all_data):
            # Write header for this day's section
            if i == 0:
                f.write("Ticker Symbol,Earnings Time\n")
            else:
                f.write(f"Ticker Symbol-{i + 1},Earnings Time-{i + 1}\n")

            # Write tickers for this day
            for ticker, earnings_time in day_data:
                f.write(f"{ticker},{earnings_time}\n")

    total_tickers = sum(len(d) for d in all_data)
    print(f"\nCreated StockCode - Zacks_AMC_BMO.csv with {total_tickers} total tickers")


if __name__ == "__main__":
    create_zacks_csv()
