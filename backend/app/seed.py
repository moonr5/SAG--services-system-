from sqlalchemy.orm import Session

from .models import Industry, Integration, Service, Solution

SERVICES = [
    ("Government Relations", "Advisory", "Coordinate engagement with public stakeholders and institutions for a project.", "Stakeholder mapping, briefing support, public-sector coordination", "Government, Infrastructure, Energy", "Indonesia"),
    ("Project Development", "Delivery", "Structure and coordinate a project from early requirement through local execution support.", "Scope definition, partner coordination, workplan", "Infrastructure, Energy, Manufacturing, Data Centers", "Indonesia"),
    ("Investment Advisory", "Advisory", "Support investment questions that sit alongside a real project requirement.", "Investment context, partner introduction", "Energy, Manufacturing, Infrastructure", ""),
    ("ESG", "Advisory", "Coordinate environmental, social, and governance work around a project.", "ESG scoping, reporting coordination", "ESG / Sustainability, Energy, Infrastructure", ""),
    ("Engineering Coordination", "Technical", "Coordinate engineering parties around a defined technical scope.", "Technical interface coordination", "Infrastructure, Energy, Data Centers, Marine", ""),
    ("Data Center Infrastructure", "Technical", "Coordinate infrastructure questions for data-center projects, including site and utility interfaces.", "Data-center requirement framing, utility interface coordination", "Data Centers", "Indonesia"),
    ("Energy & Power", "Technical", "Coordinate power-supply questions for industrial and digital infrastructure.", "Power requirement framing, utility coordination", "Energy, Data Centers, Manufacturing", "Indonesia"),
    ("Cooling Systems", "Technical", "Coordinate cooling requirements for industrial and data-center facilities.", "Cooling requirement framing", "Data Centers, Manufacturing", ""),
    ("Marine Services", "Technical", "Coordinate marine and waterfront project requirements.", "Marine scope coordination", "Marine", ""),
    ("Industrial Solutions", "Delivery", "Coordinate industrial project requirements across local execution.", "Industrial scope coordination", "Manufacturing, Infrastructure", "Indonesia"),
    ("Market Entry", "Advisory", "Support a company assessing how to enter a market alongside a concrete project.", "Market-entry scoping, local coordination", "Manufacturing, Energy, Technology", "Indonesia"),
    ("Regulatory Support", "Advisory", "Coordinate regulatory questions tied to a project or market entry.", "Permit-path coordination", "Government, Infrastructure, Energy", "Indonesia"),
    ("AI & Technology", "Technical", "Coordinate technology requirements that sit inside a larger project.", "Technology requirement framing", "Technology, Data Centers", ""),
    ("Digital Transformation", "Advisory", "Coordinate digital change work for an operating company.", "Digital scope framing", "Technology", ""),
]

INDUSTRIES = [
    ("Data Centers", "Digital infrastructure projects, including power, cooling, and site coordination."),
    ("Energy", "Power generation, batteries, and energy infrastructure."),
    ("Manufacturing", "Industrial facilities and production projects."),
    ("Infrastructure", "Civil and public infrastructure projects."),
    ("Marine", "Ports, vessels, and waterfront projects."),
    ("Mining", "Mining and related industrial projects."),
    ("Agriculture", "Agriculture and food-industry projects."),
    ("Automotive", "Automotive and mobility projects."),
    ("Government", "Public-sector and government-linked projects."),
    ("Technology", "Technology and digital projects."),
    ("ESG / Sustainability", "Environmental, social, and governance work."),
    ("Logistics", "Logistics and supply-chain projects."),
]

SOLUTIONS = [
    (
        "Data center development support",
        "A company needs to develop a data center and requires power, cooling, government, and local coordination.",
        "This is a recommended combination of current services. It is not a record of a completed project.",
        "Data Center Infrastructure, Energy & Power, Cooling Systems, Government Relations, Project Development, ESG",
    ),
    (
        "Manufacturing market entry",
        "A company wants to establish a manufacturing facility and needs market entry, government, regulatory, and local partner support.",
        "This is a recommended combination of current services. It is not a record of a completed project.",
        "Market Entry, Government Relations, Regulatory Support, Industrial Solutions, ESG, Project Development",
    ),
    (
        "Marine project coordination",
        "A marine project needs local coordination and engineering interface support.",
        "This is a recommended combination of current services. It is not a record of a completed project.",
        "Marine Services, Engineering Coordination, Project Development, Regulatory Support",
    ),
]


def seed(db: Session) -> None:
    if db.query(Service).count() == 0:
        for name, category, description, capabilities, industries, geography in SERVICES:
            db.add(
                Service(
                    name=name,
                    category=category,
                    description=description,
                    capabilities=capabilities,
                    industries=industries,
                    geography=geography,
                    team="Delivery",
                    contact="admin@agara.global",
                )
            )
    if db.query(Industry).count() == 0:
        for name, overview in INDUSTRIES:
            db.add(Industry(name=name, overview=overview, capabilities=overview))
    if db.query(Solution).count() == 0:
        for name, problem, summary, services in SOLUTIONS:
            db.add(Solution(name=name, problem=problem, summary=summary, services=services, verified=False))
    if db.query(Integration).filter(Integration.key == "google_drive").count() == 0:
        db.add(
            Integration(
                key="google_drive",
                name="Google Drive",
                status="not_connected",
                detail="Documents, company profiles, project documents, presentations, reports",
            )
        )
    db.commit()
