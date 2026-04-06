from config import SPREADSHEET_ID
from sheets_auth import get_sheets_service

# Sheets to delete everything
FULL_CLEAR_SHEETS = ["Mon", "Tue", "Wed", "Thur", "Fri", "Master_Tickers"]

# Sheets with "_Robot" suffix: delete row 3 onwards (keep header + row 2)
ROW3_CLEAR_SHEETS = ["Zacks_Robot", "Finviz_Robot", "Stock_Analysis_Robot", "Image_Raw"]


def main():
    service = get_sheets_service()
    sheets = service.spreadsheets()

    # Full clear: delete all content
    for name in FULL_CLEAR_SHEETS:
        try:
            sheets.values().clear(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{name}'!A:ZZ",
            ).execute()
            print(f"Cleared all data in '{name}'")
        except Exception as e:
            print(f"Error clearing '{name}': {e}")

    # Row 3 onwards: keep header + row 2
    for name in ROW3_CLEAR_SHEETS:
        try:
            sheets.values().clear(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{name}'!A3:ZZ",
            ).execute()
            print(f"Cleared '{name}' from row 3 onwards")
        except Exception as e:
            print(f"Error clearing '{name}': {e}")

    print("\nReset complete.")


if __name__ == "__main__":
    main()
