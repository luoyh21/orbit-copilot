from __future__ import annotations

import ipaddress
import os
import socket
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ALLOWED_HOSTS = {
    item.strip().lower()
    for item in os.getenv(
        "COPILOT_ALLOWED_HOSTS",
        "111.200.37.148,127.0.0.1,localhost",
    ).split(",")
    if item.strip()
}
MAX_RESPONSE_BYTES = int(os.getenv("COPILOT_MAX_RESPONSE_BYTES", "5242880"))

app = FastAPI(
    title="Orbit Copilot Web Bridge",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class BridgeRequest(BaseModel):
    url: str = Field(max_length=2048)
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any | None = None
    timeoutSeconds: int = Field(default=30, ge=1, le=180)
    allowInvalidCerts: bool = False


def _validate_target(raw_url: str) -> str:
    target = urlsplit(raw_url)
    if target.scheme not in {"http", "https"} or not target.hostname:
        raise HTTPException(400, "只允许完整的 HTTP/HTTPS 地址")
    if target.username or target.password:
        raise HTTPException(400, "地址中不能包含用户名或密码")

    hostname = target.hostname.lower()
    explicitly_allowed = hostname in ALLOWED_HOSTS
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, target.port or 80)}
    except socket.gaierror as exc:
        raise HTTPException(400, f"目标主机无法解析: {hostname}") from exc

    for address in addresses:
        ip = ipaddress.ip_address(address)
        forbidden = ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved
        private = ip.is_private or ip.is_loopback
        if forbidden or (private and not explicitly_allowed):
            raise HTTPException(403, f"目标地址被 Web 网关策略拒绝: {hostname}")
    return raw_url


@app.get("/healthz")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "orbit-copilot", "allowed_hosts": sorted(ALLOWED_HOSTS)}


@app.post("/bridge/request")
async def bridge(payload: BridgeRequest) -> dict[str, Any]:
    url = _validate_target(payload.url)
    headers = {
        key: value
        for key, value in payload.headers.items()
        if key.lower() not in {"host", "content-length", "connection", "cookie", "x-forwarded-for"}
    }
    try:
        async with httpx.AsyncClient(
            verify=not payload.allowInvalidCerts,
            follow_redirects=False,
            timeout=payload.timeoutSeconds,
        ) as client:
            response = await client.request(
                payload.method,
                url,
                headers=headers,
                json=payload.body if payload.body is not None else None,
            )
            content = await response.aread()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"上游连接失败: {type(exc).__name__}") from exc
    if len(content) > MAX_RESPONSE_BYTES:
        raise HTTPException(413, "上游响应超过网关限制")
    content_type = response.headers.get("content-type", "")
    if "json" in content_type:
        try:
            body: Any = response.json()
        except ValueError:
            body = content.decode("utf-8", errors="replace")
    else:
        body = content.decode("utf-8", errors="replace")
    return {
        "status": response.status_code,
        "headers": {"content-type": content_type},
        "body": body,
    }


if DIST.exists():
    assets = DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (DIST / path).resolve()
        if path and candidate.is_relative_to(DIST) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
