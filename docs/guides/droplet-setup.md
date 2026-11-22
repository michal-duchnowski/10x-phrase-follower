# Setup DigitalOcean Droplet - Przed pierwszym deployem

## Checklist: Co trzeba zrobić na droplecie przed uruchomieniem GitHub Actions

### 1. Zainstaluj Docker + docker-compose

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install docker-compose (plugin)
apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### 2. Przygotuj katalog aplikacji

```bash
mkdir -p /opt/phrase-follower
cd /opt/phrase-follower
```

### 3. Skopiuj docker-compose.yml

Możesz to zrobić na kilka sposobów:

**Opcja A: Bezpośrednio z repo (jeśli masz dostęp przez git)**

```bash
cd /opt/phrase-follower
git clone https://github.com/michal-duchnowski/10x-phrase-follower.git .
# lub tylko docker-compose.yml:
curl -o docker-compose.yml https://raw.githubusercontent.com/michal-duchnowski/10x-phrase-follower/master/docker-compose.yml
```

**Opcja B: Ręcznie przez WinSCP/SSH**

- Skopiuj `docker-compose.yml` z repo do `/opt/phrase-follower/`

### 4. Stwórz plik .env z sekretami produkcyjnymi

```bash
cd /opt/phrase-follower
nano .env
```

Wklej następujące zmienne (wartości z GitHub Secrets lub z Twojego środowiska):

```env
# Docker image (opcjonalne - fallback w docker-compose.yml działa)
DOCKER_IMAGE=ghcr.io/michal-duchnowski/10x-phrase-follower:latest

# Supabase
SUPABASE_URL=twoja_supabase_url
SUPABASE_KEY=twoj_supabase_key
SUPABASE_SERVICE_ROLE_KEY=twoj_service_role_key
PUBLIC_SUPABASE_URL=twoja_public_supabase_url
PUBLIC_SUPABASE_KEY=twoj_public_supabase_key

# TTS Encryption
PHRASE_TTS_ENCRYPTION_KEY=twoj_64_znakowy_hex_key
```

Zapisz: `CTRL+O, Enter, CTRL+X`

**Ważne:** Ustaw odpowiednie uprawnienia:

```bash
chmod 600 .env
```

### 5. (Opcjonalnie) Zaloguj się do GitHub Container Registry (GHCR)

**WAŻNE:** Najprostsze rozwiązanie to ustawić obraz jako **publiczny** w GitHub — wtedy ten krok możesz **pominąć**.

#### Opcja A: Ustaw obraz jako publiczny (ZALECANE) ✅

Po pierwszym pushu obrazu przez GitHub Actions:

1. Idź do: `https://github.com/michal-duchnowski/10x-phrase-follower/pkgs/container/10x-phrase-follower`
2. Kliknij na obraz (np. `latest`)
3. Kliknij **"Package settings"** (po prawej stronie)
4. Przewiń w dół do sekcji **"Danger Zone"**
5. Kliknij **"Change visibility"** → wybierz **"Public"**
6. Potwierdź

Teraz droplet może pobrać obraz **bez logowania** — możesz pominąć Opcję B.

#### Opcja B: Zostaw obraz prywatny i zaloguj się na droplecie

Jeśli chcesz zostawić obraz prywatny, musisz się zalogować na droplecie:

```bash
# 1. Wygeneruj Personal Access Token w GitHub:
#    Settings → Developer settings → Personal access tokens → Tokens (classic)
#    Scope: read:packages (tylko do odczytu obrazów)

# 2. Zaloguj się na droplecie:
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u michal-duchnowski --password-stdin

# 3. (Opcjonalnie) Zapisz token w pliku, żeby nie wygasał po restarcie:
#    Możesz użyć docker-credential-helper lub po prostu ponownie się zalogować przy każdym deployu
```

**Rekomendacja:** Użyj Opcji A (publiczny obraz) — prostsze i nie wymaga zarządzania tokenami.

### 6. (Opcjonalnie) Skonfiguruj nginx + HTTPS

Jeśli chcesz mieć HTTPS bez domeny (self-signed certificate):

#### Krok 1: Instalacja nginx

```bash
# Install nginx
apt install nginx -y

# Sprawdź status
systemctl status nginx
```

#### Krok 2: Generowanie self-signed certificate

```bash
# Stwórz katalog na certyfikaty
mkdir -p /etc/nginx/ssl

# Wygeneruj self-signed certificate (ważny 365 dni)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nginx-selfsigned.key \
  -out /etc/nginx/ssl/nginx-selfsigned.crt \
  -subj "/C=PL/ST=State/L=City/O=Organization/CN=IP_DROPLETA"

# Ustaw odpowiednie uprawnienia
chmod 600 /etc/nginx/ssl/nginx-selfsigned.key
chmod 644 /etc/nginx/ssl/nginx-selfsigned.crt
```

**Uwaga:** Zamień `IP_DROPLETA` na rzeczywisty IP Twojego dropleta (np. `167.99.123.45`).

#### Krok 3: Konfiguracja nginx

```bash
# Stwórz konfigurację
nano /etc/nginx/sites-available/phrase-follower
```

Wklej następującą konfigurację (zamień `IP_DROPLETA` na IP Twojego dropleta):

```nginx
# HTTP - przekierowanie na HTTPS
server {
    listen 80;
    server_name IP_DROPLETA;  # np. 167.99.123.45

    # Przekieruj wszystkie żądania HTTP na HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name IP_DROPLETA;  # np. 167.99.123.45

    # Upload zdjęć do 5 MiB; limit proxy z niewielkim zapasem
    client_max_body_size 6m;

    # SSL certificates
    ssl_certificate /etc/nginx/ssl/nginx-selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/nginx-selfsigned.key;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Logs
    access_log /var/log/nginx/phrase-follower-access.log;
    error_log /var/log/nginx/phrase-follower-error.log;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Cache bypass
        proxy_cache_bypass $http_upgrade;
    }
}
```

Zapisz: `CTRL+O, Enter, CTRL+X`

#### Krok 4: Aktywacja konfiguracji

```bash
# Utwórz link symboliczny
ln -s /etc/nginx/sites-available/phrase-follower /etc/nginx/sites-enabled/

# Usuń domyślną konfigurację (opcjonalnie)
rm -f /etc/nginx/sites-enabled/default

# Sprawdź konfigurację (ważne!)
nginx -t
```

Jeśli widzisz `syntax is ok` i `test is successful`, przeładuj nginx:

```bash
systemctl reload nginx
```

#### Krok 5: Konfiguracja firewall (opcjonalnie, ale zalecane)

```bash
# Sprawdź czy ufw jest zainstalowany
which ufw || apt install ufw -y

# Zezwól na HTTP i HTTPS
ufw allow 'Nginx Full'
# lub osobno:
ufw allow 80/tcp
ufw allow 443/tcp

# Zezwól na SSH (ważne!)
ufw allow 22/tcp

# Włącz firewall
ufw enable

# Sprawdź status
ufw status
```

#### Krok 6: Testowanie

```bash
# Z dropleta
curl -k https://localhost

# Z zewnątrz (z Twojego komputera Windows PowerShell)
Invoke-WebRequest -Uri "https://IP_DROPLETA" -SkipCertificateCheck
```

**⚠️ Ważne:** Self-signed certificate powoduje, że przeglądarki pokażą ostrzeżenie o niezaufanym certyfikacie. To normalne — możesz kliknąć "Zaawansowane" → "Kontynuuj" aby uzyskać dostęp. Połączenie jest szyfrowane, ale certyfikat nie jest podpisany przez zaufany urząd certyfikacji.

**Alternatywa:** Jeśli chcesz darmowy, zaufany certyfikat, możesz kupić domenę w Digital Ocean (~1 USD/rok dla `.xyz`) i użyć Let's Encrypt (certbot).

### 7. Przetestuj ręcznie (opcjonalnie)

Przed pierwszym deployem z GitHub Actions możesz przetestować ręcznie:

```bash
cd /opt/phrase-follower

# Pull image
docker compose pull

# Start container
docker compose up -d

# Check logs
docker compose logs -f

# Check status
docker compose ps
```

Jeśli wszystko działa, możesz zatrzymać:

```bash
docker compose down
```

---

## Podsumowanie - co jest wymagane przed pierwszym deployem

✅ **Wymagane:**

1. Docker + docker-compose zainstalowane
2. Katalog `/opt/phrase-follower` utworzony
3. `docker-compose.yml` w `/opt/phrase-follower/`
4. `.env` z sekretami w `/opt/phrase-follower/`
5. (Jeśli obraz prywatny) Zalogowanie do GHCR

⏭️ **Opcjonalne (można zrobić później):**

- nginx + HTTPS
- Domena

---

## Po pierwszym deployem z GitHub Actions

GitHub Actions automatycznie:

1. Zbuduje obraz Dockera
2. Wypchnie do GHCR
3. Połączy się przez SSH z dropletem
4. Dostarczy `docker-compose.yml` z wdrażanego commita, sprawdzi jego składnię i pobierze obrazy
5. Zachowa poprzedni Compose jako `docker-compose.yml.bak`, podmieni konfigurację i wykona `docker compose up -d`
6. Sprawdzi `UPLOADS_DIR` i możliwość zapisu w katalogu zdjęć

Katalog `/srv/phrase-follower/uploads` trzeba przygotować jednorazowo przed wdrożeniem uploadu. Plik `.env` i zdjęcia pozostają na serwerze. Szczegóły opisuje [instrukcja zdjęć fiszek](phrase-image-uploads.md).

Konfigurację Nginx aktualizuje się osobno na serwerze. Dla już działającej instalacji dopisz `client_max_body_size 6m;` w bloku HTTPS w `/etc/nginx/sites-available/phrase-follower`, a potem wykonaj `nginx -t && systemctl reload nginx`. Sam deploy kontenera nie zmienia konfiguracji Nginx.

**Uwaga:** Upewnij się, że:

- Sekrety w GitHub (`DROPLET_HOST`, `DROPLET_USER`, `DROPLET_SSH_KEY`) są ustawione
- SSH key jest dodany do `authorized_keys` na droplecie
- `.env` na droplecie ma wszystkie potrzebne zmienne
