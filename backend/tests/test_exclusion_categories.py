"""The exclusion box and the Leave out box take directory-style categories ("Places of Worship", "Hospitals", "Schools (Special)").
Postgres regexes use \\m and \\M for word edges; Python has \\b, which is the same for these patterns."""
import re

from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import exclusion_categories as XC

PASTED = (
    "Adoption and Fostering Services,Air Ambulance Services,Airports,Ambulance and Medical Transportation Services,Armed Forces,Banks and Financial "
    "Institutions,Birth Marriage & Deaths Registration Offices,Blood Donor Services,Blood Stock Agents,Bureau De Change,Casinos,Central Government,"
    "Certification and Accreditation Bodies,Chambers of Commerce,Charities and Charitable Organisations,Coastguard,Colleges (Higher Education),"
    "Colleges (Technical and Agricultural),Company Registrar,Consular Services,Courts,Credit and Discount Cards,Credit and Finance Companies,"
    "Credit Reference Agencies,Credit Related Institutions,Credit Unions,Data Protection Registrar,Debt Collection Agencies,Department of Transport,"
    "Development Agencies,Directory Enquiries Services,DSS,Dyslexia Advice and Support Organisations,Education Agencies and Authorities,"
    "Education Services,Embassies,Ferry Operators,Fire Stations,Fund Raising Services Charitable and Non Charitable,"
    "Further Education Schools and Colleges,Handicraft Schools,Health Authorities,Health Centres,Healthcare Companies,HM Prisons,Hospitals,"
    "Inland Revenue,Insurance - Caravan,Libraries,Loans & Debt - Management,Local Government,Members of Parliaments,Mental Health Centres,"
    "Merchants Banks,Ministry of Defence,Moneylenders,NHS Clinics,Nursery Schools,Oil Companies,Oil Refineries,Passport Services,Places of Worship,"
    "Police Forces,Police Support Services,Political Parties,Post Offices,Power Boat and Motor Cruising Schools,Pregnancy Testing and Help Centres,"
    "Primary and Junior Schools (Foundation),Primary and Junior Schools (Local Authority),Primary Care Trusts,Probate Registries,Probation Services,"
    "Railways Operators of,Recruitment (Armed Forces),Religious Organisations and Places of Worship,River Authorities,Schools (Independent),"
    "Schools (Leisure Based Activities),Schools (Special),Schools and Colleges (Art),Schools of Music,Secondary Schools (Foundation),"
    "Secondary Schools (Local Authority),Shopping Centres,Sixth Form Colleges,Technical and Industrial Schools,Tourist Information Offices,"
    "Trade and Business Organisations,Trade Assoc & Regulatory Bodies,Trade Unions Activities of,Trading Standards,Train Information Services,"
    "Train Stations,University Activities of,Water Authorities,Water Companies,Waterways,Weather Service Providers,Weighbridges - Public,"
    "X-Ray Facilities and Services"
)
ITEMS = [s.strip() for s in PASTED.split(",") if s.strip()]


def hits(name: str, *labels: str) -> bool:
    """True when a company called `name` would be left out by these labels (same words, same word edges as the SQL)."""
    words = [w for lab in labels for w in XC.expand(lab)[0]]
    rx = "(" + "|".join(XC.word_regex(w) for w in words) + ")"
    return re.search(rx.replace(r"\m", r"\b").replace(r"\M", r"\b"), name, re.I) is not None


def test_every_pasted_category_is_known():
    assert len(ITEMS) == 101
    unknown = [i for i in ITEMS if XC.key(i) not in XC.CATEGORIES]
    assert unknown == []


def test_churches_and_places_of_worship_are_left_out():
    for name in ("ST MARY'S PARISH CHURCH", "Brighton Mosque Trust", "Hove Synagogue", "Holy Trinity Church Hall", "Elim Churches Ltd"):
        assert hits(name, "Places of Worship"), name
        assert hits(name, "Religious Organisations and Places of Worship"), name


def test_plurals_both_ways():
    assert hits("Royal Sussex Hospital", "Hospitals")
    assert hits("Hove Libraries Service", "Libraries")
    assert hits("Brighton Library", "Libraries")
    assert hits("Sussex Casino", "Casinos")


def test_ordinary_businesses_stay():
    assert not hits("Hospitality Solutions Ltd", "Hospitals")
    assert not hits("Churchill Consulting Ltd", "Places of Worship")
    assert not hits("Elm Court Management Ltd", "Courts")
    assert not hits("Green Fingers Garden Nursery", "Nursery Schools")
    assert not hits("Smith Accountancy Ltd", *ITEMS)
    assert not hits("Brighton Plumbing Services", *ITEMS)
    assert not hits("Harbour Bakery Ltd", *ITEMS)


def test_category_labels_become_sic_codes():
    assert "94910" in XC.expand("Places of Worship")[1]
    assert "86101" in XC.expand("Hospitals")[1]
    assert XC.expand("Schools (Special)")[0] == ["school"]
    assert XC.expand("church") == (["church"], [])  # an unknown label is the typed word


def test_the_whole_list_compiles_in_both_boxes():
    for f in ({"exclude_items": ITEMS}, {"not_keyword": ITEMS}):
        conds = BR._filter_conditions(BR.normalize_filters(f))
        sql = " ".join(str(c.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for c in conds)
        assert "~*" in sql and "church" in sql and "94910" in sql
    assert len(BR.normalize_filters({"exclude_items": ITEMS})["exclude_items"]) == len(ITEMS)  # nothing cut off
