#!/data/data/com.termux/files/usr/bin/bash
# ============================================
# APK Downloader for Termux
# Downloads all APK files from APK Uploader server
# ============================================

# === CONFIG ===
# Ganti URL ini dengan URL server kamu (tunnel / railway domain)
SERVER_URL="${APK_SERVER_URL:-https://midlands-critical-irrigation-champion.trycloudflare.com}"
DEST_DIR="${APK_DEST_DIR:-/sdcard/Download}"
MAX_RETRY=3

# Warna
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${YELLOW}============================================${NC}"
echo -e "${YELLOW}   APK Downloader — Termux                  ${NC}"
echo -e "${YELLOW}============================================${NC}"
echo -e "Server: ${BLUE}${SERVER_URL}${NC}"
echo -e "Dest:   ${BLUE}${DEST_DIR}${NC}"
echo ""

# Pastikan dest dir ada
mkdir -p "$DEST_DIR" 2>/dev/null

# Fetch file list dari API
echo -e "${YELLOW}[*] Fetching file list...${NC}"
API_RESPONSE=$(curl -s --max-time 15 "${SERVER_URL}/api/files")

if [ -z "$API_RESPONSE" ]; then
  echo -e "${RED}[!] Gagal connect ke server. Cek URL atau koneksi internet.${NC}"
  exit 1
fi

# Parse file names dan download URLs menggunakan grep/sed
# Format: "downloadUrl":"https://..."
URLS=$(echo "$API_RESPONSE" | grep -oE '"downloadUrl":"[^"]+"' | sed 's/"downloadUrl":"//;s/"$//')
NAMES=$(echo "$API_RESPONSE" | grep -oE '"name":"[^"]+"' | sed 's/"name":"//;s/"$//')

if [ -z "$URLS" ]; then
  echo -e "${RED}[!] Tidak ada file APK di server.${NC}"
  exit 1
fi

# Hitung total
TOTAL=$(echo "$URLS" | wc -l)
echo -e "${GREEN}[✓] Ditemukan ${TOTAL} file APK${NC}"
echo ""

# Download satu per satu
COUNT=0
SUCCESS=0
FAILED=0

while IFS= read -r url; do
  COUNT=$((COUNT + 1))
  # Extract filename dari URL
  FILENAME=$(basename "$url")
  # Decode %20 etc
  FILENAME=$(echo "$FILENAME" | sed 's/%20/ /g; s/%28/(/g; s/%29/)/g')
  
  echo -e "${BLUE}[${COUNT}/${TOTAL}]${NC} ${FILENAME}"
  
  # Download dengan retry
  DOWNLOADED=0
  for ATTEMPT in $(seq 1 $MAX_RETRY); do
    if curl -L -f --progress-bar -o "${DEST_DIR}/${FILENAME}" "$url"; then
      DOWNLOADED=1
      break
    else
      if [ $ATTEMPT -lt $MAX_RETRY ]; then
        echo -e "${YELLOW}  [i] Retry (attempt $((ATTEMPT+1))/${MAX_RETRY})...${NC}"
        sleep 2
      fi
    fi
  done
  
  if [ $DOWNLOADED -eq 1 ]; then
    SIZE=$(du -h "${DEST_DIR}/${FILENAME}" 2>/dev/null | cut -f1)
    echo -e "  ${GREEN}[✓] OK (${SIZE})${NC}"
    SUCCESS=$((SUCCESS + 1))
  else
    echo -e "  ${RED}[✗] FAILED after ${MAX_RETRY} attempts${NC}"
    rm -f "${DEST_DIR}/${FILENAME}" 2>/dev/null
    FAILED=$((FAILED + 1))
  fi
  echo ""
done <<< "$URLS"

# Summary
echo -e "${YELLOW}============================================${NC}"
echo -e "  Download selesai!"
echo -e "  ${GREEN}Success: ${SUCCESS}/${TOTAL}${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "  ${RED}Failed:  ${FAILED}/${TOTAL}${NC}"
fi
echo -e "  Files: ${BLUE}${DEST_DIR}/${NC}"
echo -e "${YELLOW}============================================${NC}"
