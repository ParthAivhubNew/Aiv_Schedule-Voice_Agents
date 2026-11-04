from app.api.lead_assistant import save_proposal


def _found(n, total, asked=0):
    top = [{"id": f"c{i}", "name": f"Co {i}", "website": "", "phone": "", "email": "", "industry": "", "region": "RG2",
            "registration_number": "", "status": "", "sic_text": "", "postcode": "RG2 0AA", "extra": "x"} for i in range(n)]
    return {"top": top, "total": total, "asked": asked, "filters": {"keyword": "accountants"}}


def test_saves_exactly_the_companies_that_were_listed():
    p = save_proposal("p0", "RG2", {"keyword": "accountants"}, _found(20, 312, asked=20))
    assert p["params"]["how_many"] == 20
    assert [c["id"] for c in p["params"]["companies"]] == [f"c{i}" for i in range(20)]
    assert "extra" not in p["params"]["companies"][0]
    assert p["title"].startswith("Save these 20")
    assert "292 more match" in p["detail"]


def test_asking_for_fewer_than_listed_takes_the_first_ones():
    p = save_proposal("p0", "L", {}, _found(20, 312, asked=20), asked_for=5)
    assert [c["id"] for c in p["params"]["companies"]] == [f"c{i}" for i in range(5)]


def test_asking_for_more_than_listed_reruns_the_search_and_says_so():
    p = save_proposal("p0", "L", {"keyword": "accountants"}, _found(20, 312, asked=20), asked_for=100)
    assert "companies" not in p["params"]
    assert p["params"]["how_many"] == 100
    assert p["title"].startswith("Save the top 100")


def test_never_offers_more_than_match():
    p = save_proposal("p0", "L", {}, _found(2, 30), asked_for=500)
    assert p["params"]["how_many"] == 30


def test_no_search_yet_still_gives_a_sensible_default():
    p = save_proposal("p0", "L", {"keyword": "x"}, None)
    assert p["params"]["how_many"] == 25
