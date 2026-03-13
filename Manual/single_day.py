import csv

# Usage:
# python single_day.py


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
                if len(row) >= 3:
                    ticker = row[1].strip().upper()  # Column 2 (Ticker Symbol)
                    earnings_time = row[2].strip().lower()  # Column 3 (Earnings Time)
                    if ticker and ticker != "":
                        results.append((ticker, earnings_time if earnings_time else "--"))
    except FileNotFoundError:
        print("Warning: individual.csv not found")
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return results


def main():
    """
    Read individual.csv, create StockCode - Zacks_AMC_BMO.csv,
    then generate zacks.csv, finviz.csv, and stock_analysis.csv.
    """
    results = parse_csv_file("individual.csv")
    print(f"Found {len(results)} tickers in individual.csv")

    # Write to StockCode - Zacks_AMC_BMO.csv
    with open("StockCode - Zacks_AMC_BMO.csv", "w") as f:
        f.write("Ticker Symbol,Earnings Time\n")
        for ticker, earnings_time in results:
            f.write(f"{ticker},{earnings_time}\n")
    print(f"Created StockCode - Zacks_AMC_BMO.csv with {len(results)} tickers")

    # Deduplicate tickers
    tickers = list(dict.fromkeys(ticker for ticker, _ in results))
    print(f"After deduplication: {len(tickers)} unique tickers")

    # Generate zacks.csv
    with open("zacks.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            url = f"https://www.zacks.com/stock/quote/{ticker}/detailed-earning-estimates?icid=quote-stock_overview-quote_nav_tracking-zcom-left_subnav_quote_navbar-detailed_earning_estimates"
            f.write(f'"{url}"\n')
    print(f"Created zacks.csv with {len(tickers)} links")

    # Generate finviz.csv
    with open("finviz.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            f.write(f'"https://finviz.com/quote.ashx?t={ticker}&p=d"\n')
    print(f"Created finviz.csv with {len(tickers)} links")

    # Generate stock_analysis.csv
    with open("stock_analysis.csv", "w") as f:
        f.write('"Origin URL"\n')
        for ticker in tickers:
            f.write(f'"https://stockanalysis.com/stocks/{ticker.lower()}/forecast/"\n')
    print(f"Created stock_analysis.csv with {len(tickers)} links")


if __name__ == "__main__":
    main()
