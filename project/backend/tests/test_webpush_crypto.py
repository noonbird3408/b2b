"""Web Push 암호화(RFC 8291)·VAPID(RFC 8292) 검증 — 브라우저 쪽 복호화를 직접 구현해 왕복 확인"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402

import webpush  # noqa: E402


def _browser_keys():
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return key, webpush.b64url(pub), webpush.b64url(os.urandom(16))


def _browser_decrypt(body: bytes, ua_key, ua_public_b64: str, auth_b64: str) -> bytes:
    """수신 기기(브라우저)가 하는 복호화 — RFC 8291 3.4 / RFC 8188"""
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    as_public = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    assert rs == 4096 and idlen == 65
    shared = ua_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ua_public = webpush.b64url_decode(ua_public_b64)
    ikm = webpush._hkdf(webpush.b64url_decode(auth_b64), shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = webpush._hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = webpush._hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


def test_encrypt_roundtrip_korean_payload():
    ua_key, p256dh, auth = _browser_keys()
    data = json.dumps({"title": "이준호 등원", "body": "쑥쑥 수학학원 · 16:02 출석"}, ensure_ascii=False).encode()
    body = webpush.encrypt(data, p256dh, auth)
    assert _browser_decrypt(body, ua_key, p256dh, auth) == data


def test_rfc8291_appendix_a_vector():
    """RFC 8291 부록 A 의 공식 테스트 벡터와 바이트 단위로 같은지"""
    as_private = webpush._private_key("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    body = webpush.encrypt(b"When I grow up, I want to be a watermelon",
                           "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                           "BTBZMqHH6r4Tts7J_aSIgg",
                           salt=webpush.b64url_decode("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_private)
    expected = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_"
                "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
    assert webpush.b64url(body) == expected


def test_vapid_jwt_signature_verifies():
    private, public = webpush.generate_vapid_keys()
    header = webpush.vapid_authorization("https://fcm.googleapis.com/fcm/send/abc", private, "mailto:t@example.com")
    token = header.split("t=")[1].split(",")[0]
    assert header.endswith(f"k={public}")
    h, c, sig = token.split(".")
    claims = json.loads(webpush.b64url_decode(c))
    assert claims["aud"] == "https://fcm.googleapis.com" and claims["sub"] == "mailto:t@example.com"
    raw = webpush.b64url_decode(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), webpush.b64url_decode(public))
    pub.verify(der, f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))   # 예외가 없으면 통과
