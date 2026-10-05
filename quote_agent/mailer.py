"""Real email delivery for approved quotes, off unless configured.

    QUOTE_DESK_SMTP_USER=you@gmail.com          sender, also the SMTP login
    QUOTE_DESK_SEND_TO=you@gmail.com,other@x    allowlist: the only addresses that get real email
    password: macOS Keychain item "quote-desk-gmail" (account = SMTP user), or QUOTE_DESK_SMTP_PASSWORD

The demo inbox is full of fictional customers. The allowlist means a click on Approve can only
ever email an address you listed; everyone else gets the same PDF and email recorded in the
outbox, marked as not delivered.
"""
from __future__ import annotations

import os
import smtplib
import subprocess
from email.message import EmailMessage

KEYCHAIN_SERVICE = "quote-desk-gmail"


class SmtpMailer:
    def __init__(self, user: str, password: str, allowlist: set[str], host: str = "smtp.gmail.com", port: int = 465,
                 sender_name: str = "Calder Bay Industrial Supply") -> None:
        self.user, self._password = user, password
        self.allowlist = {a.strip().lower() for a in allowlist if a.strip()}
        self.host, self.port, self.sender_name = host, port, sender_name

    def allowed(self, to: str | None) -> bool:
        return bool(to) and to.strip().lower() in self.allowlist

    def send(self, to: str, subject: str, body: str, pdf: bytes, filename: str) -> None:
        msg = EmailMessage()
        msg["From"] = f"{self.sender_name} <{self.user}>"
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        msg.add_attachment(pdf, maintype="application", subtype="pdf", filename=filename)
        with smtplib.SMTP_SSL(self.host, self.port, timeout=20) as smtp:
            smtp.login(self.user, self._password)
            smtp.send_message(msg)


def _keychain_password(user: str) -> str | None:
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", user, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return "".join(out.stdout.split()) or None if out.returncode == 0 else None


def from_env() -> SmtpMailer | None:
    user = os.environ.get("QUOTE_DESK_SMTP_USER", "").strip()
    allow = {a for a in os.environ.get("QUOTE_DESK_SEND_TO", "").split(",") if a.strip()}
    if not user or not allow:
        return None
    password = os.environ.get("QUOTE_DESK_SMTP_PASSWORD") or _keychain_password(user)
    if not password:
        return None
    return SmtpMailer(user, password, allow)
