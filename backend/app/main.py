import time
from collections import defaultdict
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .connectors import GoogleDriveConnector
from .db import Base, engine, get_db
from .engine import brief, index_document, search
from .models import AuditLog, Client, Document, Industry, Integration, Project, SearchHistory, Service, Solution, User
from .security import current_user, ensure_admin, make_token, require_admin, verify_password
from .seed import seed

app = FastAPI(title="Agara Company Intelligence")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
hits: dict[str, list[float]] = defaultdict(list)


class LoginBody(BaseModel):
    email: str
    password: str


class SearchBody(BaseModel):
    query: str


class ContactBody(BaseModel):
    name: str
    email: str
    message: str


class ServiceBody(BaseModel):
    name: str
    category: str = ""
    description: str = ""
    capabilities: str = ""
    industries: str = ""
    geography: str = ""
    team: str = ""
    contact: str = ""


class ClientBody(BaseModel):
    name: str
    industry: str = ""
    country: str = ""
    description: str = ""
    relationship: str = ""
    services: str = ""
    tags: str = ""
    confidential: bool = False


class ProjectBody(BaseModel):
    name: str
    client_name: str = ""
    industry: str = ""
    location: str = ""
    project_type: str = ""
    description: str = ""
    scope: str = ""
    services: str = ""
    partners: str = ""
    status: str = "Opportunity"
    start_date: str = ""
    end_date: str = ""
    team: str = ""
    tags: str = ""
    confidential: bool = False


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    db = next(get_db())
    try:
        seed(db)
        ensure_admin(db)
    finally:
        db.close()


def _audit(db: Session, actor: str, action: str, detail: str = "") -> None:
    db.add(AuditLog(actor=actor, action=action, detail=detail))
    db.commit()


def _limit(request: Request) -> None:
    now = time.time()
    ip = request.client.host if request.client else "local"
    hits[ip] = [stamp for stamp in hits[ip] if now - stamp < 60]
    if len(hits[ip]) > 60:
        raise HTTPException(status_code=429, detail="Too many requests")
    hits[ip].append(now)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    drive = db.query(Integration).filter(Integration.key == "google_drive").one()
    return {
        "status": "operational",
        "components": [
            {"name": "AI Engine", "status": "operational"},
            {"name": "Database", "status": "operational"},
            {"name": "Search", "status": "operational"},
            {"name": "Google Drive", "status": drive.status},
            {"name": "Vector Index", "status": "operational"},
            {"name": "Background Sync", "status": drive.status if drive.status == "syncing" else "operational"},
        ],
    }


@app.post("/api/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    _audit(db, user.email, "login")
    return {"token": make_token(user), "role": user.role, "name": user.name}


@app.post("/api/search")
def run_search(body: SearchBody, request: Request, db: Session = Depends(get_db), user=Depends(current_user)):
    _limit(request)
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Enter a request")
    if len(query) > 2000:
        raise HTTPException(status_code=400, detail="Request is too long")
    result = search(db, query, user.role if user else None)
    actor = user.email if user else "guest"
    db.add(SearchHistory(query=query, actor=actor))
    _audit(db, actor, "ai_search", query[:500])
    return result


@app.post("/api/contact")
def contact(body: ContactBody, db: Session = Depends(get_db)):
    name = body.name.strip()
    email = body.email.strip()
    message = body.message.strip()
    if not name or not email or "@" not in email or len(message) < 8:
        raise HTTPException(status_code=400, detail="Name, a valid email, and a message are required")
    _audit(db, email, "contact", f"{name}: {message[:500]}")
    return {"ok": True}


@app.post("/api/briefs")
def meeting_brief(body: SearchBody, request: Request, db: Session = Depends(get_db), user=Depends(current_user)):
    _limit(request)
    result = search(db, body.query.strip(), user.role if user else None)
    _audit(db, user.email if user else "guest", "meeting_brief", body.query[:500])
    return brief(result)


@app.get("/api/services")
def list_services(db: Session = Depends(get_db)):
    return [
        {"id": row.id, "name": row.name, "category": row.category, "description": row.description, "industries": row.industries}
        for row in db.query(Service).order_by(Service.name).all()
    ]


@app.post("/api/services")
def create_service(body: ServiceBody, db: Session = Depends(get_db), user=Depends(require_admin)):
    if db.query(Service).filter(Service.name == body.name).first():
        raise HTTPException(status_code=409, detail="That service already exists")
    row = Service(**body.model_dump())
    db.add(row)
    _audit(db, user.email, "create_service", body.name)
    db.refresh(row)
    return {"id": row.id}


@app.get("/api/clients")
def list_clients(db: Session = Depends(get_db), user=Depends(current_user)):
    rows = db.query(Client).order_by(Client.name).all()
    if not user or user.role not in {"super_admin", "admin", "manager", "employee"}:
        rows = [row for row in rows if not row.confidential]
    return [
        {"id": row.id, "name": row.name, "industry": row.industry, "country": row.country, "relationship": row.relationship, "services": row.services}
        for row in rows
    ]


@app.post("/api/clients")
def create_client(body: ClientBody, db: Session = Depends(get_db), user=Depends(require_admin)):
    row = Client(**body.model_dump())
    db.add(row)
    _audit(db, user.email, "create_client", body.name)
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db), user=Depends(current_user)):
    rows = db.query(Project).order_by(Project.name).all()
    if not user or user.role not in {"super_admin", "admin", "manager", "employee"}:
        rows = [row for row in rows if not row.confidential]
    return [
        {
            "id": row.id,
            "name": row.name,
            "client": row.client_name,
            "industry": row.industry,
            "location": row.location,
            "status": row.status,
            "description": row.description,
        }
        for row in rows
    ]


@app.post("/api/projects")
def create_project(body: ProjectBody, db: Session = Depends(get_db), user=Depends(require_admin)):
    allowed = {"Opportunity", "In Discussion", "Active", "Completed", "On Hold", "Confidential"}
    if body.status not in allowed:
        raise HTTPException(status_code=400, detail="Unknown project status")
    row = Project(**body.model_dump())
    db.add(row)
    _audit(db, user.email, "create_project", body.name)
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@app.get("/api/industries")
def list_industries(db: Session = Depends(get_db)):
    return [{"id": row.id, "name": row.name, "overview": row.overview} for row in db.query(Industry).order_by(Industry.name).all()]


@app.get("/api/solutions")
def list_solutions(db: Session = Depends(get_db)):
    return [
        {"id": row.id, "name": row.name, "problem": row.problem, "summary": row.summary, "services": row.services, "verified": row.verified}
        for row in db.query(Solution).order_by(Solution.name).all()
    ]


@app.get("/api/integrations")
def list_integrations(db: Session = Depends(get_db)):
    return [GoogleDriveConnector(db).status()]


@app.post("/api/integrations/google-drive/connect")
def connect_drive(db: Session = Depends(get_db), user=Depends(require_admin)):
    result = GoogleDriveConnector(db).connect()
    _audit(db, user.email, "connect_google_drive", result.get("status", ""))
    return result


@app.post("/api/integrations/google-drive/sync")
def sync_drive(db: Session = Depends(get_db), user=Depends(require_admin)):
    result = GoogleDriveConnector(db).sync()
    _audit(db, user.email, "sync_google_drive", result.get("status", ""))
    return result


@app.post("/api/integrations/google-drive/disconnect")
def disconnect_drive(db: Session = Depends(get_db), user=Depends(require_admin)):
    result = GoogleDriveConnector(db).disconnect()
    _audit(db, user.email, "disconnect_google_drive")
    return result


@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=400, detail="File is larger than 5 MB")
    name = file.filename or "document.txt"
    suffix = Path(name).suffix.lower()
    if suffix not in {".txt", ".csv", ".md"}:
        raise HTTPException(status_code=400, detail="Upload a .txt, .csv, or .md file. Other formats stay unindexed until a parser is added.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 text")
    row = Document(name=name, doc_type=suffix.lstrip("."), source="Internal Database", owner=user.email, permissions="internal", text=text)
    db.add(row)
    db.flush()
    index_document(db, row)
    _audit(db, user.email, "upload_document", name)
    db.commit()
    return {"id": row.id, "index_status": row.index_status, "chunks": len(row.chunks)}


@app.get("/api/admin/summary")
def admin_summary(db: Session = Depends(get_db), user=Depends(require_admin)):
    drive = db.query(Integration).filter(Integration.key == "google_drive").one()
    return {
        "services": db.query(Service).count(),
        "clients": db.query(Client).count(),
        "projects": db.query(Project).count(),
        "documents": db.query(Document).count(),
        "searches": db.query(SearchHistory).count(),
        "google_drive": drive.status,
        "actor": user.email,
    }


@app.get("/api/audit")
def audit(db: Session = Depends(get_db), user=Depends(require_admin)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(50).all()
    return [{"actor": row.actor, "action": row.action, "detail": row.detail, "at": row.created_at.isoformat()} for row in rows]

