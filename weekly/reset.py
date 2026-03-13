import json
import os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

CREDENTIALS_PATH = os.environ.get(
    "GOOGLE_CREDENTIALS_PATH",
    "/Users/garisonjulius/Downloads/revised_stock/credentials.json",
)
SPREADSHEET_ID = "1v5FbfCuueVbqhKU74Nyd9DKXheI5uXTJ9oIYwX6_-mQ"

# Sheets to delete everything
FULL_CLEAR_SHEETS = ["Mon", "Tue", "Wed", "Thur", "Fri", "Master_Tickers"]

# Sheets to delete row 2 onwards (keep header row)
# ROW2_CLEAR_SHEETS = ["Image_Raw"]

# Sheets with "_Robot" suffix: delete row 3 onwards (keep header + row 2)
ROW3_CLEAR_SHEETS = ["Zacks_Robot", "Finviz_Robot", "Stock_Analysis_Robot", "Image_Raw"]


def get_sheets_service():
    with open(CREDENTIALS_PATH) as f:
        creds_data = json.load(f)

    creds = Credentials.from_service_account_info(
        creds_data,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds)


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

    # Row 2 onwards: keep header row
    # for name in ROW2_CLEAR_SHEETS:
    #     try:
    #         sheets.values().clear(
    #             spreadsheetId=SPREADSHEET_ID,
    #             range=f"'{name}'!A2:ZZ",
    #         ).execute()
    #         print(f"Cleared '{name}' from row 2 onwards")
    #     except Exception as e:
    #         print(f"Error clearing '{name}': {e}")

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
