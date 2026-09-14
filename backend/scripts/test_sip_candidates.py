import socket
import re
import hashlib

candidates = [
    "qURdlqn99mBV",
    "qURd1qn99mBV",
    "qURdIqn99mBV",
    "qURdLqn99mBV",
    "qURdlqn99mbv",
    "qURd1qn99mbv",
]

SERVER = "sipconnect.sipgate.co.uk"
USER = "4032431t0"

for pwd in candidates:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3.0)
    
    # 1. Probe
    p = f"REGISTER sip:{SERVER} SIP/2.0\r\nVia: SIP/2.0/UDP 1.1.1.1:5060;branch=z9hG4bK-1\r\nFrom: <sip:{USER}@{SERVER}>\r\nTo: <sip:{USER}@{SERVER}>\r\nCall-ID: test1\r\nCSeq: 1 REGISTER\r\nContent-Length: 0\r\n\r\n"
    sock.sendto(p.encode(), (SERVER, 5060))
    d, _ = sock.recvfrom(2048)
    resp = d.decode("utf-8", errors="replace")
    
    realm = re.search(r'realm="([^"]+)"', resp).group(1)
    nonce = re.search(r'nonce="([^"]+)"', resp).group(1)
    
    ha1 = hashlib.md5(f"{USER}:{realm}:{pwd}".encode()).hexdigest()
    ha2 = hashlib.md5(f"REGISTER:sip:{SERVER}".encode()).hexdigest()
    digest_resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
    
    auth = f'Digest username="{USER}", realm="{realm}", nonce="{nonce}", uri="sip:{SERVER}", response="{digest_resp}", algorithm=MD5'
    p2 = f"REGISTER sip:{SERVER} SIP/2.0\r\nVia: SIP/2.0/UDP 1.1.1.1:5060;branch=z9hG4bK-2\r\nFrom: <sip:{USER}@{SERVER}>\r\nTo: <sip:{USER}@{SERVER}>\r\nCall-ID: test1\r\nCSeq: 2 REGISTER\r\nAuthorization: {auth}\r\nExpires: 300\r\nContent-Length: 0\r\n\r\n"
    
    sock.sendto(p2.encode(), (SERVER, 5060))
    d2, _ = sock.recvfrom(2048)
    status = d2.decode("utf-8", errors="replace").splitlines()[0]
    print(f"Password '{pwd}' -> Result: {status}")
    sock.close()
    if "200 OK" in status:
        print(f"===> SUCCESS! The correct password is: {pwd}")
        break
