import json
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from config import CREDENTIALS_PATH


def get_sheets_service():
    with open(CREDENTIALS_PATH) as f:
        creds_data = json.load(f)
    creds = Credentials.from_service_account_info(
        creds_data,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds)
