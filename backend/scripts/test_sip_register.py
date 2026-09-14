import socket
import re
import hashlib

SERVER_IP = "sipconnect.sipgate.co.uk"
SERVER_PORT = 5060
SIP_USER = "4032431t0"
SIP_PASS = "qURdlqn99mBV"
LOCAL_IP = socket.gethostbyname(socket.gethostname())
LOCAL_PORT = 5062

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(5.0)
sock.bind(("0.0.0.0", LOCAL_PORT))

call_id = "test_sip_register_callid_123"
cseq = 1

# Step 1: Send initial REGISTER (no auth)
msg1 = (
    f"REGISTER sip:{SERVER_IP} SIP/2.0\r\n"
    f"Via: SIP/2.0/UDP {LOCAL_IP}:{LOCAL_PORT};rport;branch=z9hG4bK-78901\r\n"
    f"From: <sip:{SIP_USER}@{SERVER_IP}>;tag=tag12345\r\n"
    f"To: <sip:{SIP_USER}@{SERVER_IP}>\r\n"
    f"Call-ID: {call_id}\r\n"
    f"CSeq: {cseq} REGISTER\r\n"
    f"Contact: <sip:{SIP_USER}@{LOCAL_IP}:{LOCAL_PORT}>\r\n"
    f"Max-Forwards: 70\r\n"
    f"User-Agent: AIVHub-SIP-Client\r\n"
    f"Expires: 300\r\n"
    f"Content-Length: 0\r\n\r\n"
)

print("[1] Sending initial REGISTER to Sipgate...")
sock.sendto(msg1.encode(), (SERVER_IP, SERVER_PORT))

try:
    data, addr = sock.recvfrom(4096)
    resp1 = data.decode("utf-8", errors="replace")
    first_line = resp1.splitlines()[0]
    print(f"[2] Sipgate responded: {first_line}")
    
    if "401" in first_line or "407" in first_line:
        # Extract realm and nonce
        realm_m = re.search(r'realm="([^"]+)"', resp1)
        nonce_m = re.search(r'nonce="([^"]+)"', resp1)
        if realm_m and nonce_m:
            realm = realm_m.group(1)
            nonce = nonce_m.group(1)
            print(f"[3] Digest Challenge received! Realm: {realm}, Nonce: {nonce[:12]}...")
            
            # Compute MD5 digest auth
            # HA1 = MD5(username:realm:password)
            # HA2 = MD5(method:uri)
            # response = MD5(HA1:nonce:HA2)
            ha1 = hashlib.md5(f"{SIP_USER}:{realm}:{SIP_PASS}".encode()).hexdigest()
            ha2 = hashlib.md5(f"REGISTER:sip:{SERVER_IP}".encode()).hexdigest()
            digest_resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
            
            cseq += 1
            auth_header = (
                f'Authorization: Digest username="{SIP_USER}", realm="{realm}", '
                f'nonce="{nonce}", uri="sip:{SERVER_IP}", response="{digest_resp}", algorithm=MD5\r\n'
            )
            
            msg2 = (
                f"REGISTER sip:{SERVER_IP} SIP/2.0\r\n"
                f"Via: SIP/2.0/UDP {LOCAL_IP}:{LOCAL_PORT};rport;branch=z9hG4bK-78902\r\n"
                f"From: <sip:{SIP_USER}@{SERVER_IP}>;tag=tag12345\r\n"
                f"To: <sip:{SIP_USER}@{SERVER_IP}>\r\n"
                f"Call-ID: {call_id}\r\n"
                f"CSeq: {cseq} REGISTER\r\n"
                f"Contact: <sip:{SIP_USER}@{LOCAL_IP}:{LOCAL_PORT}>\r\n"
                f"{auth_header}"
                f"Max-Forwards: 70\r\n"
                f"User-Agent: AIVHub-SIP-Client\r\n"
                f"Expires: 300\r\n"
                f"Content-Length: 0\r\n\r\n"
            )
            
            print("[4] Sending REGISTER with Digest response...")
            sock.sendto(msg2.encode(), (SERVER_IP, SERVER_PORT))
            
            data2, addr2 = sock.recvfrom(4096)
            resp2 = data2.decode("utf-8", errors="replace")
            print(f"[5] Final response from Sipgate:\n{resp2[:400]}")
    else:
        print("Response:\n", resp1[:300])

except socket.timeout:
    print("[!] Timeout: No UDP response received from sipconnect.sipgate.co.uk within 5s.")
finally:
    sock.close()
