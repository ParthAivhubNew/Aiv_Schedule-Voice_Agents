"""A company name that is too long for the phone line is refused with a plain message; we never shorten it for the user."""
from app.services.telnyx_provisioning import CALL_APP_NAME_MAX, MAX_COMPANY_NAME, company_name_problem


def test_the_longest_name_still_fits_the_carrier_limit():
    longest_app_name = "Outreach calls: " + "x" * MAX_COMPANY_NAME + " (org_1a2b3c4d5e6f)"
    assert len(longest_app_name) == CALL_APP_NAME_MAX


def test_short_names_pass_and_long_names_get_a_plain_message():
    assert company_name_problem("AIVHub") == ""
    assert company_name_problem("x" * MAX_COMPANY_NAME) == ""
    msg = company_name_problem("Harshvardhan Singh Sisodiya's company")
    assert "37 characters" in msg and str(MAX_COMPANY_NAME) in msg and "Shorten" in msg


def test_google_sign_up_default_name_fits_the_phone_line():
    from app.api.signup import default_company_name

    assert default_company_name("Harshvardhan Singh Sisodiya", "gmail.com") == "Harshvardhan Singh Sisodiya"
    assert default_company_name("Harshvardhan Pratap Singh Sisodiya Rathore", "gmail.com") == "Harshvardhan Rathore"
    assert default_company_name("Harshvardhanakumaraswamyvenkateshwara Singh", "outlook.com") == "Harshvardhanakumaraswamyvenkat"[:29]
    assert default_company_name("Asha Rao", "globaldatabase.co.uk") == "Globaldatabase"
    for name in ("A" * 80, "Jo Ann Mary Beth Smith-Jones-Williams-Taylor"):
        assert len(default_company_name(name, "gmail.com")) <= 29
