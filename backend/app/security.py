import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import DATA, get_db
from .models import User

SECRET = os.environ.get("AGARA_SECRET", "agara-local-dev-secret")
bearer = HTTPBearer(auto_error=False)
PRIVILEGED = {"super_admin", "admin", "manager"}


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(check, digest)


def _sign(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def make_token(user: User) -> str:
    return _sign({"sub": user.id, "role": user.role, "email": user.email, "exp": int(time.time()) + 60 * 60 * 12})


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except (ValueError, json.JSONDecodeError):
        return None


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if not credentials:
        return None
    payload = read_token(credentials.credentials)
    if not payload:
        return None
    return db.get(User, payload["sub"])


def require_user(user: User | None = Depends(current_user)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role not in PRIVILEGED:
        raise HTTPException(status_code=403, detail="You do not have permission for this action")
    return user


def ensure_admin(db: Session) -> None:
    if db.query(User).filter(User.role == "super_admin").first():
        return
    secret_path = DATA / "admin_password.txt"
    password = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(18)
    secret_path.write_text(password, encoding="utf-8")
    db.add(
        User(
            email=os.environ.get("ADMIN_EMAIL", "admin@agara.global"),
            name="Agara Admin",
            password_hash=hash_password(password),
            role="super_admin",
        )
    )
    db.commit()
    print(f"Admin password written to {secret_path}")
