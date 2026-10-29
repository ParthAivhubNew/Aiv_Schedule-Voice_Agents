"""Adds Outreach to your Flask app. In your app file add these two lines:

    from outreach_flask import outreach
    app.register_blueprint(outreach)

It adds two addresses: /outreach-start (hands your page a short-lived pass) and /outreach-test.html (the test page).
To make the pass for whoever is signed in, change get_user_id() below. While testing it is one fixed test person.
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from flask import Blueprint, Response, jsonify, request

OUTREACH = "{{HOST}}/api/embed"
HERE = Path(__file__).resolve().parent
outreach = Blueprint("outreach", __name__)


def _load_env():
    try:
        for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() and key.strip() not in os.environ:
                os.environ[key.strip()] = value.strip().strip("\"'")
    except OSError:
        pass  # no .env file: the key has to be in the environment


_load_env()


def get_user_id():
    # TESTING ONLY. Before real users, return the id of whoever is signed in, and refuse (401) when nobody is.
    return os.environ.get("TEST_USER_ID", "test-user-1")


def _call(path, body):
    req = urllib.request.Request(
        OUTREACH + path, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + os.environ.get("OUTREACH_SECRET", ""), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read() or b"{}").get("detail")
        except ValueError:
            detail = None
        raise RuntimeError(detail or "Outreach answered %s" % err.code)


@outreach.get("/outreach-start")
def outreach_start():
    if not os.environ.get("OUTREACH_SECRET", "").startswith("psk_"):
        return jsonify(error="The secret key is missing. Copy .env.example to .env and paste your secret key after OUTREACH_SECRET="), 500
    try:
        user, component = str(get_user_id()), request.args.get("component", "leads")
        info = _call("/connect-sessions", {"external_id": user, "component": component})
        if not info.get("linked"):
            answer = {"connect_token": info.get("connect_token")}
        else:
            answer = {"token": _call("/sessions", {"external_id": user, "component": component})["token"]}
        resp = jsonify(answer)
    except Exception as err:  # noqa: BLE001 - whatever went wrong is shown to the developer, not hidden
        resp = jsonify(error=str(err))
        resp.status_code = 502
    resp.headers["Cache-Control"] = "no-store"
    return resp


@outreach.get("/outreach-test.html")
def outreach_test():
    return Response((HERE / "outreach-test.html").read_text(encoding="utf-8"), mimetype="text/html")
