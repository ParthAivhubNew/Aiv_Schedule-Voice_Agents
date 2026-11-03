"""Towns a person is likely to type, to catch a slip such as "Leds" and offer "Leeds". A fixed list, no database scan."""
from __future__ import annotations

import difflib
from typing import Dict, List

TOWNS = (
    "London,Birmingham,Manchester,Leeds,Glasgow,Liverpool,Newcastle upon Tyne,Sheffield,Bristol,Edinburgh,Leicester,Coventry,Bradford,Cardiff,Belfast,Nottingham,"
    "Kingston upon Hull,Stoke-on-Trent,Southampton,Derby,Portsmouth,Brighton,Plymouth,Northampton,Reading,Luton,Wolverhampton,Bolton,Bournemouth,Norwich,Swindon,"
    "Swansea,Southend-on-Sea,Middlesbrough,Peterborough,Cambridge,Oxford,Ipswich,York,Gloucester,Watford,Exeter,Huddersfield,Slough,Blackpool,Sunderland,Stockport,"
    "Oldham,Rotherham,Telford,Maidstone,Colchester,Chelmsford,Basildon,Crawley,Warrington,Cheltenham,Worcester,Lincoln,Canterbury,Bath,Chester,Carlisle,Durham,"
    "Salford,Wigan,Preston,Blackburn,Burnley,Doncaster,Barnsley,Wakefield,Harrogate,Milton Keynes,Guildford,Woking,Basingstoke,Bracknell,Newbury,Winchester,Salisbury,"
    "Dundee,Aberdeen,Inverness,Stirling,Perth,Newport,Wrexham,Londonderry,Lisburn,Croydon,Bromley,Kingston,Richmond,Harrow,Ealing,Enfield,Barnet,Sutton"
).split(",")
_LOWER: Dict[str, str] = {t.lower(): t for t in TOWNS}


def suggest(typed: List[str]) -> Dict[str, str]:
    """{typed town: the town it was probably meant to be}, only for a town that is not on the list but is very close to one that is."""
    out: Dict[str, str] = {}
    for t in typed or []:
        key = " ".join(str(t).lower().split())
        if len(key) < 3 or key in _LOWER:
            continue
        near = difflib.get_close_matches(key, list(_LOWER), n=1, cutoff=0.8)
        if near:
            out[str(t)] = _LOWER[near[0]]
    return out
