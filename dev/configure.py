#!/usr/bin/env python3
from pathlib import Path
import json
import os
import secrets
import shutil
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent
source = root / "canvas-lms"
if not (source / "Gemfile").exists():
    raise SystemExit("Canvas source checkout is not ready.")

state = root / ".state"
state.mkdir(exist_ok=True)
env = root / ".env"
if not env.exists():
    values = {
        "POSTGRES_PASSWORD": secrets.token_hex(24),
        "ENCRYPTION_KEY": secrets.token_hex(32),
        "CANVAS_LMS_ADMIN_EMAIL": "admin@canvasdoc.invalid",
        "CANVAS_LMS_ADMIN_PASSWORD": secrets.token_urlsafe(24),
        "CANVAS_LMS_ACCOUNT_NAME": "Canvasdoc Development",
        "CANVAS_LMS_STATS_COLLECTION": "opt_out",
        "CANVASDOC_STUDENT_PASSWORD": secrets.token_urlsafe(24),
        "CANVASDOC_TEACHER_PASSWORD": secrets.token_urlsafe(24),
    }
    env.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
env.chmod(0o600)
if "CANVASDOC_UID=" not in env.read_text():
    with env.open("a") as stream:
        stream.write(f"CANVASDOC_UID={os.getuid()}\n")
for key in ("CANVASDOC_RCE_SECRET", "CANVASDOC_RCE_CIPHER"):
    if f"{key}=" not in env.read_text():
        with env.open("a") as stream:
            stream.write(f"{key}={secrets.token_hex(16)}\n")

config = source / "config"
for file in (source / "docker-compose/config").glob("*.yml"):
    shutil.copyfile(file, config / file.name)

values = dict(line.split("=", 1) for line in env.read_text().splitlines() if "=" in line)
origin = values.get("CANVASDOC_ORIGIN", "http://localhost:3210").rstrip("/")
url = urlsplit(origin)
if (
    url.scheme not in ("http", "https")
    or not url.hostname
    or url.username
    or url.password
    or url.path
):
    raise SystemExit("CANVASDOC_ORIGIN must be an HTTP(S) origin.")
(config / "domain.yml").write_text(f"""development:
  domain: {json.dumps(url.netloc)}
  ssl: {str(url.scheme == 'https').lower()}
test:
  domain: localhost
""")
(config / "security.yml").write_text("""development:
  encryption_key: <%= ENV.fetch('ENCRYPTION_KEY') %>
  jwt_encryption_keys:
    - <%= ENV.fetch('ENCRYPTION_KEY') %>
  lti_iss: ORIGIN_PLACEHOLDER
""".replace("ORIGIN_PLACEHOLDER", json.dumps(origin)))
(config / "outgoing_mail.yml").write_text("""development:
  delivery_method: test
  perform_deliveries: false
  domain: canvasdoc.invalid
  outgoing_address: notifications@canvasdoc.invalid
  default_name: Canvasdoc Development
""")
rce_origin = values.get("CANVASDOC_RCE_ORIGIN", "http://localhost:3212")
dynamic = config / "dynamic_settings.yml"
dynamic.write_text(dynamic.read_text().replace("http://rce.canvas.docker:3000", rce_origin))
(config / "vault_contents.yml").write_text("""development:
  'app-canvas/data/secrets':
    data:
      canvas_security:
        encryption_secret: <%= ENV.fetch('CANVASDOC_RCE_SECRET') %>
        signing_secret: <%= ENV.fetch('CANVASDOC_RCE_SECRET') %>
""")
print("Configured isolated Canvas development instance; outgoing email disabled.")
