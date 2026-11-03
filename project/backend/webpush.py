"""Web Push 발송 (순수 모듈) — 휴대폰·PC 브라우저에 '진짜' 알림을 보냅니다.

표준만 구현합니다 (별도 푸시 서비스 계정 불필요 — FCM/APNs 키 없이 브라우저가 알려 준 주소로 바로 보냄):
  - RFC 8291  Message Encryption for Web Push   (aes128gcm, 수신 기기 공개키로 암호화 → 푸시 서버도 내용을 못 봄)
  - RFC 8292  VAPID                              (ES256 JWT 서명 → 이 서버가 보낸 알림임을 증명)

대안 비교 (보고서용):
  - pywebpush: 같은 표준 구현이지만 aiohttp 등 의존성이 늘어 서버리스 함수가 무거워짐 → 표준 80줄만 직접 구현
  - FCM 직접 사용: 안드로이드/크롬은 되지만 아이폰(Safari) 웹 푸시는 APNs 경유라 Web Push 표준이 더 범용적

의존성: cryptography (requests 는 이미 사용 중)
"""
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional, Tuple
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

RECORD_SIZE = 4096


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(value: str) -> bytes:
    value = value.strip()
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


# ---------------------------------------------------------------------
# VAPID 키
# ---------------------------------------------------------------------
def generate_vapid_keys() -> Tuple[str, str]:
    """(비공개키 32바이트 base64url, 공개키 65바이트 uncompressed base64url)"""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    return b64url(private), public_key_of(b64url(private))


def _private_key(private_b64: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(b64url_decode(private_b64), "big"), ec.SECP256R1())


def public_key_of(private_b64: str) -> str:
    pub = _private_key(private_b64).public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64url(pub)


def vapid_authorization(endpoint: str, private_b64: str, subject: str, ttl_seconds: int = 12 * 3600) -> str:
    """Authorization 헤더 값: 'vapid t=<JWT>, k=<공개키>'"""
    parsed = urlparse(endpoint)
    header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64url(json.dumps({"aud": f"{parsed.scheme}://{parsed.netloc}", "exp": int(time.time()) + ttl_seconds,
                                "sub": subject}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    r, s = decode_dss_signature(_private_key(private_b64).sign(signing_input, ec.ECDSA(hashes.SHA256())))
    token = f"{header}.{claims}.{b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    return f"vapid t={token}, k={public_key_of(private_b64)}"


# ---------------------------------------------------------------------
# RFC 8291 암호화
# ---------------------------------------------------------------------
def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()                    # Extract
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]  # Expand (32바이트 이하 = 1블록)


def encrypt(payload: bytes, p256dh_b64: str, auth_b64: str, *, salt: Optional[bytes] = None,
            server_key: Optional[ec.EllipticCurvePrivateKey] = None) -> bytes:
    """aes128gcm 본문(헤더 포함). salt·server_key 는 테스트에서만 지정"""
    ua_public = b64url_decode(p256dh_b64)
    auth_secret = b64url_decode(auth_b64)
    if len(ua_public) != 65 or len(auth_secret) != 16:
        raise ValueError("구독 키 형식이 올바르지 않습니다.")
    if len(payload) > RECORD_SIZE - 17 - 86:
        raise ValueError("알림 내용이 너무 깁니다.")
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = server_key.public_key().public_bytes(serialization.Encoding.X962,
                                                     serialization.PublicFormat.UncompressedPoint)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = server_key.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)     # 0x02 = 마지막 레코드 구분자
    return salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public + ciphertext


def send(subscription: dict, data: dict, private_b64: str, subject: str, ttl: int = 86400,
         urgency: str = "high", timeout: float = 5.0) -> int:
    """알림 1건 발송 → HTTP 상태 코드 (201 성공, 404/410 = 구독 만료 → 삭제 대상)"""
    endpoint = subscription["endpoint"]
    body = encrypt(json.dumps(data, ensure_ascii=False).encode(), subscription["p256dh"], subscription["auth"])
    response = requests.post(endpoint, data=body, timeout=timeout, headers={
        "Authorization": vapid_authorization(endpoint, private_b64, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": urgency,
    })
    return response.status_code
