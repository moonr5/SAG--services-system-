import re
from collections import Counter

from sqlalchemy.orm import Session

from .models import Chunk, Client, Document, Industry, Project, Service, Solution

INDUSTRY_TERMS = {
    "data center": "Data Centers",
    "data centre": "Data Centers",
    "datacenter": "Data Centers",
    "battery": "Energy",
    "power": "Energy",
    "energy": "Energy",
    "marine": "Marine",
    "mining": "Mining",
    "government": "Government",
    "esg": "ESG / Sustainability",
    "sustainab": "ESG / Sustainability",
    "manufactur": "Manufacturing",
    "factory": "Manufacturing",
    "infrastructure": "Infrastructure",
    "logistic": "Logistics",
    "automotive": "Automotive",
    "agricultur": "Agriculture",
    "technology": "Technology",
}

REQUIREMENTS = {
    "power": "Energy & Power",
    "mw": "Energy & Power",
    "cooling": "Cooling Systems",
    "government": "Government Relations",
    "stakeholder": "Government Relations",
    "regulatory": "Regulatory Support",
    "permit": "Regulatory Support",
    "esg": "ESG",
    "sustainab": "ESG",
    "market entry": "Market Entry",
    "entering": "Market Entry",
    "marine": "Marine Services",
    "engineering": "Engineering Coordination",
    "investment": "Investment Advisory",
    "data center": "Data Center Infrastructure",
    "data centre": "Data Center Infrastructure",
    "cooling": "Cooling Systems",
    "local coordination": "Project Development",
    "local partner": "Project Development",
    "project development": "Project Development",
    "ai": "AI & Technology",
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _has(text: str, needle: str) -> bool:
    if " " in needle or len(needle) > 3:
        return needle in text
    return re.search(rf"\b{re.escape(needle)}\b", text) is not None


def interpret(query: str, db: Session) -> dict:
    text = query.lower()
    industries = []
    for needle, name in INDUSTRY_TERMS.items():
        if _has(text, needle) and name not in industries:
            industries.append(name)
    requirements = []
    for needle, service in REQUIREMENTS.items():
        if _has(text, needle) and service not in requirements:
            requirements.append(service)
    geos = [name for name in ("indonesia", "china", "singapore", "vietnam", "malaysia") if name in text]
    capacity = None
    match = re.search(r"(\d+)\s*mw", text)
    if match:
        capacity = f"{match.group(1)}MW"
    mentioned_clients = []
    for client in db.query(Client).all():
        if client.name.lower() in text:
            mentioned_clients.append(client.name)
    asked_client = bool(re.search(r"\b(worked with|experience with|projects? with|client)\b", text))
    proper = re.findall(r"\b[A-Z][A-Za-z0-9&.-]{2,}\b", query)
    ignored = {"i", "ai", "esg", "mw", "indonesia", "china", "singapore", "vietnam", "malaysia"}
    unknown_names = [name for name in proper if name.lower() not in ignored and name not in mentioned_clients]
    return {
        "industries": industries,
        "requirements": requirements,
        "geography": geos,
        "capacity": capacity,
        "mentioned_clients": mentioned_clients,
        "asked_about_client": asked_client,
        "unknown_names": unknown_names[:5],
    }


def _score(query: str, blob: str, interpretation: dict) -> float:
    q = Counter(_tokens(query))
    b = Counter(_tokens(blob))
    if not q or not b:
        return 0
    overlap = sum(min(q[t], b[t]) for t in q)
    score = overlap / (sum(q.values()) ** 0.5)
    lowered = blob.lower()
    for name in interpretation["industries"] + interpretation["requirements"] + interpretation["geography"]:
        if name.lower() in lowered:
            score += 1.4
    if interpretation["capacity"] and interpretation["capacity"].lower() in lowered:
        score += 0.4
    return score


def _public_projects(db: Session, user_role: str | None):
    rows = db.query(Project).all()
    if user_role in {"super_admin", "admin", "manager", "employee"}:
        return rows
    return [row for row in rows if not row.confidential]


def _public_clients(db: Session, user_role: str | None):
    rows = db.query(Client).all()
    if user_role in {"super_admin", "admin", "manager", "employee"}:
        return rows
    return [row for row in rows if not row.confidential]


def search(db: Session, query: str, user_role: str | None = None) -> dict:
    interpretation = interpret(query, db)
    services = []
    for row in db.query(Service).all():
        blob = " ".join([row.name, row.category, row.description, row.capabilities, row.industries, row.geography])
        score = _score(query, blob, interpretation)
        if row.name in interpretation["requirements"]:
            score += 3
        if score > 0.8:
            services.append((score, row))
    services.sort(key=lambda item: item[0], reverse=True)

    projects = []
    for row in _public_projects(db, user_role):
        blob = " ".join([row.name, row.client_name, row.industry, row.location, row.description, row.scope, row.services, row.tags])
        score = _score(query, blob, interpretation)
        if score > 0.8:
            projects.append((score, row))
    projects.sort(key=lambda item: item[0], reverse=True)

    clients = []
    for row in _public_clients(db, user_role):
        blob = " ".join([row.name, row.industry, row.country, row.description, row.relationship, row.services, row.tags])
        score = _score(query, blob, interpretation)
        if row.name in interpretation["mentioned_clients"]:
            score += 5
        if score > 0.8:
            clients.append((score, row))
    clients.sort(key=lambda item: item[0], reverse=True)

    industries = []
    for row in db.query(Industry).all():
        blob = " ".join([row.name, row.overview, row.capabilities])
        score = _score(query, blob, interpretation)
        if row.name in interpretation["industries"]:
            score += 3
        if score > 0.8:
            industries.append((score, row))
    industries.sort(key=lambda item: item[0], reverse=True)

    solutions = []
    for row in db.query(Solution).all():
        blob = " ".join([row.name, row.problem, row.summary, row.services])
        score = _score(query, blob, interpretation)
        if score > 0.8:
            solutions.append((score, row))
    solutions.sort(key=lambda item: item[0], reverse=True)
    anchors = [name.lower().rstrip("s") for name in interpretation["industries"][:1]]
    if anchors:
        solutions = [
            item
            for item in solutions
            if any(anchor in f"{item[1].name} {item[1].problem} {item[1].services}".lower() for anchor in anchors)
        ]

    documents = []
    for chunk in db.query(Chunk).all():
        doc = chunk.document
        if doc.permissions == "confidential" and user_role not in {"super_admin", "admin", "manager", "employee"}:
            continue
        score = _score(query, chunk.text, interpretation)
        if score > 1:
            documents.append((score, doc, chunk))
    documents.sort(key=lambda item: item[0], reverse=True)

    gaps = []
    if not projects:
        gaps.append("No verified project in the current knowledge base matches this request.")
    if interpretation["unknown_names"] and not clients:
        gaps.append(
            "No verified client record was found for: " + ", ".join(interpretation["unknown_names"]) + "."
        )
    if not services and not industries and not clients and not projects:
        gaps.append("We couldn't find a directly matching record in the current company knowledge base.")

    answer = _answer(query, interpretation, services, projects, clients, industries, solutions, gaps)
    sources = []
    seen = set()
    for _score_value, doc, chunk in documents[:5]:
        key = (doc.id, chunk.position)
        if key in seen:
            continue
        seen.add(key)
        sources.append(
            {
                "integration": doc.source,
                "document": doc.name,
                "section": chunk.position + 1,
                "document_id": doc.id,
            }
        )
    if services or industries:
        sources.append({"integration": "Internal Database", "document": "Service and industry register", "section": 1, "document_id": None})

    return {
        "query": query,
        "interpretation": interpretation,
        "answer": answer,
        "verified": {
            "services": [_service(row) for _s, row in services[:6]],
            "projects": [_project(row) for _s, row in projects[:6]],
            "clients": [_client(row) for _s, row in clients[:6]],
            "industries": [_industry(row) for _s, row in industries[:6]],
        },
        "recommendations": {
            "solutions": [_solution(row) for _s, row in solutions[:4]],
            "note": "Recommendations combine current services. They are not verified past engagements.",
        },
        "sources": sources,
        "gaps": gaps,
    }


def _answer(query, interpretation, services, projects, clients, industries, solutions, gaps) -> str:
    parts = []
    if interpretation["industries"] or interpretation["requirements"] or interpretation["geography"] or interpretation["capacity"]:
        bits = []
        if interpretation["industries"]:
            bits.append("industry " + ", ".join(interpretation["industries"]))
        if interpretation["geography"]:
            bits.append("location " + ", ".join(name.title() for name in interpretation["geography"]))
        if interpretation["capacity"]:
            bits.append("capacity " + interpretation["capacity"])
        if interpretation["requirements"]:
            bits.append("requested support " + ", ".join(interpretation["requirements"]))
        parts.append("The request was read as " + "; ".join(bits) + ".")
    if services:
        names = ", ".join(row.name for _s, row in services[:5])
        parts.append("Verified company capabilities that match: " + names + ".")
    if projects:
        names = ", ".join(row.name for _s, row in projects[:4])
        parts.append("Verified projects on record: " + names + ".")
    else:
        parts.append("There is no verified project on record for this request.")
    if clients:
        names = ", ".join(row.name for _s, row in clients[:4])
        parts.append("Verified clients on record: " + names + ".")
    elif interpretation["asked_about_client"] or interpretation["unknown_names"]:
        parts.append("There is no verified client record for the name in this request.")
    if solutions:
        names = ", ".join(row.name for _s, row in solutions[:2])
        parts.append("A possible service combination, not a past engagement: " + names + ".")
    if not services and not projects and not clients:
        parts.append("We couldn't find a directly matching record in the current company knowledge base.")
    return " ".join(parts)


def brief(result: dict) -> dict:
    return {
        "requirement": result["query"],
        "interpretation": result["interpretation"],
        "capabilities": [item["name"] for item in result["verified"]["services"]],
        "projects": [item["name"] for item in result["verified"]["projects"]],
        "clients": [item["name"] for item in result["verified"]["clients"]],
        "potential_solution": [item["name"] for item in result["recommendations"]["solutions"]],
        "questions": [
            "What decision does the client need from this meeting?",
            "Which requirement is already confirmed, and which is still being scoped?",
            "Who are the local parties already involved?",
        ],
        "next_steps": [
            "Confirm whether a verified project or client record should be added.",
            "Review the matched services with the delivery team.",
            "Share only client-facing material in presentation mode.",
        ],
        "gaps": result["gaps"],
        "sources": result["sources"],
    }


def index_document(db: Session, document: Document) -> None:
    document.chunks.clear()
    words = document.text.split()
    size = 120
    position = 0
    for start in range(0, max(len(words), 1), size):
        piece = " ".join(words[start : start + size]).strip()
        if not piece:
            continue
        document.chunks.append(Chunk(position=position, text=piece))
        position += 1
    document.index_status = "indexed" if document.text.strip() else "empty"


def _service(row: Service) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "category": row.category,
        "description": row.description,
        "capabilities": row.capabilities,
        "industries": row.industries,
        "geography": row.geography,
        "kind": "capability",
    }


def _project(row: Project) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "client": row.client_name,
        "industry": row.industry,
        "location": row.location,
        "status": row.status,
        "description": row.description,
        "scope": row.scope,
        "services": row.services,
        "kind": "verified_project",
    }


def _client(row: Client) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "industry": row.industry,
        "country": row.country,
        "relationship": row.relationship,
        "services": row.services,
        "description": row.description,
        "kind": "verified_client",
    }


def _industry(row: Industry) -> dict:
    return {"id": row.id, "name": row.name, "overview": row.overview, "kind": "industry"}


def _solution(row: Solution) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "problem": row.problem,
        "summary": row.summary,
        "services": row.services,
        "verified": row.verified,
        "kind": "recommendation",
    }
