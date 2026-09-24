import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import Document, Integration


class GoogleDriveConnector:
    key = "google_drive"
    name = "Google Drive"

    def __init__(self, db: Session):
        self.db = db
        self.row = db.query(Integration).filter(Integration.key == self.key).one()

    def _configured(self) -> bool:
        return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))

    def _token(self) -> str:
        return os.environ.get("GOOGLE_REFRESH_TOKEN", "")

    def status(self) -> dict:
        return {
            "key": self.row.key,
            "name": self.row.name,
            "status": self.row.status,
            "led": _led(self.row.status),
            "last_synced_at": self.row.last_synced_at.isoformat() if self.row.last_synced_at else None,
            "record_count": self.row.record_count,
            "detail": self.row.detail,
            "error": self.row.error,
            "configured": self._configured() and bool(self._token()),
        }

    def connect(self) -> dict:
        if not self._configured():
            self.row.status = "not_connected"
            self.row.error = "Google OAuth credentials are not configured."
            self.db.commit()
            return {
                "status": self.row.status,
                "led": "gray",
                "message": "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN before connecting.",
            }
        if not self._token():
            self.row.status = "not_connected"
            self.row.error = "A refresh token is required."
            self.db.commit()
            params = urllib.parse.urlencode(
                {
                    "client_id": os.environ["GOOGLE_CLIENT_ID"],
                    "redirect_uri": os.environ.get("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/api/integrations/google-drive/callback"),
                    "response_type": "code",
                    "scope": "https://www.googleapis.com/auth/drive.readonly",
                    "access_type": "offline",
                    "prompt": "consent",
                }
            )
            return {
                "status": "not_connected",
                "led": "gray",
                "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?" + params,
            }
        return self.sync()

    def sync(self) -> dict:
        self.row.status = "syncing"
        self.row.error = ""
        self.db.commit()
        try:
            access = _access_token()
            files = _list_files(access)
        except Exception as exc:
            self.row.status = "error"
            self.row.error = str(exc)
            self.db.commit()
            return self.status()
        kept = 0
        for item in files:
            if item.get("mimeType") == "application/vnd.google-apps.folder":
                continue
            existing = (
                self.db.query(Document)
                .filter(Document.source == "Google Drive", Document.external_id == item["id"])
                .one_or_none()
            )
            if existing:
                continue
            self.db.add(
                Document(
                    name=item.get("name", "Untitled"),
                    doc_type="drive",
                    source="Google Drive",
                    external_id=item["id"],
                    permissions="internal",
                    index_status="metadata_only",
                    text=item.get("name", ""),
                )
            )
            kept += 1
        self.row.status = "connected"
        self.row.record_count = (
            self.db.query(Document).filter(Document.source == "Google Drive").count() + kept
        )
        self.row.last_synced_at = datetime.now(timezone.utc)
        self.row.error = ""
        self.db.commit()
        body = self.status()
        body["imported"] = kept
        return body

    def disconnect(self) -> dict:
        self.row.status = "not_connected"
        self.row.error = ""
        self.db.commit()
        return self.status()


def _led(status: str) -> str:
    return {
        "connected": "green",
        "syncing": "yellow",
        "connecting": "yellow",
        "error": "red",
        "not_connected": "gray",
    }.get(status, "gray")


def _access_token() -> str:
    body = urllib.parse.urlencode(
        {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": os.environ["GOOGLE_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode()
    request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    if "access_token" not in payload:
        raise RuntimeError(payload.get("error_description") or "Google token exchange failed")
    return payload["access_token"]


def _list_files(access_token: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {"pageSize": "50", "fields": "files(id,name,mimeType,modifiedTime)", "q": "trashed = false"}
    )
    request = urllib.request.Request(
        "https://www.googleapis.com/drive/v3/files?" + query,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    return payload.get("files", [])
