// ============================================
// APK Uploader v1.0
// ============================================
// Public download, private upload (token auth)
// Compatible with curl/wget from Termux
// ============================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || "200") * 1024 * 1024; // default 200MB

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================
// MULTER CONFIG
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Sanitize filename, keep original name
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    // If file exists, add timestamp prefix
    const dest = path.join(UPLOAD_DIR, safe);
    if (fs.existsSync(dest)) {
      const ts = Date.now();
      cb(null, `${ts}_${safe}`);
    } else {
      cb(null, safe);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".apk") {
      return cb(new Error("Only .apk files are allowed"), false);
    }
    cb(null, true);
  },
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
function requireAuth(req, res, next) {
  // Check Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === ADMIN_TOKEN) return next();
  }
  // Check query param (for browser admin page)
  if (req.query.token === ADMIN_TOKEN) return next();
  // Check body token (for form submit)
  if (req.body && req.body.token === ADMIN_TOKEN) return next();

  return res.status(401).json({ error: "Unauthorized. Provide valid ADMIN_TOKEN." });
}

// ============================================
// HELPER: get file list with metadata
// ============================================
function getFileList() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => f.endsWith(".apk"));
  return files.map((f) => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, f));
    return {
      name: f,
      size: stat.size,
      sizeHuman: (stat.size / (1024 * 1024)).toFixed(1) + " MB",
      uploaded: stat.mtime.toISOString(),
      downloadUrl: `/download/${encodeURIComponent(f)}`,
    };
  }).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
}

// ============================================
// ROUTES
// ============================================

// --- PUBLIC: File listing page ---
app.get("/", (req, res) => {
  const files = getFileList();
  const rows = files
    .map(
      (f) => `
    <tr>
      <td><a href="${f.downloadUrl}" title="Download ${f.name}">${f.name}</a></td>
      <td>${f.sizeHuman}</td>
      <td>${new Date(f.uploaded).toLocaleString()}</td>
      <td><code>wget ${req.protocol}://${req.get("host")}${f.downloadUrl}</code></td>
    </tr>`
    )
    .join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>APK Downloads</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    h1 { color: #58a6ff; margin-bottom: 8px; }
    .subtitle { color: #8b949e; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #161b22; color: #58a6ff; padding: 12px 10px; text-align: left; border-bottom: 1px solid #30363d; }
    td { padding: 10px; border-bottom: 1px solid #21262d; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #7ee787; }
    .empty { color: #8b949e; padding: 40px; text-align: center; }
    .count { color: #8b949e; font-size: 14px; }
  </style>
</head>
<body>
  <h1>📦 APK Downloads</h1>
  <p class="subtitle">Public download page — compatible with wget/curl from Termux</p>
  <p class="count">${files.length} file(s) available</p>
  ${
    files.length === 0
      ? '<div class="empty">No APK files uploaded yet.</div>'
      : `<table>
    <thead><tr><th>Filename</th><th>Size</th><th>Uploaded</th><th>Termux Command</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  }
</body>
</html>`);
});

// --- PUBLIC: Direct file download (curl/wget friendly) ---
app.get("/download/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const safe = path.basename(filename); // prevent path traversal
  const filePath = path.join(UPLOAD_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, safe);
});

// --- PUBLIC: API file list (JSON) ---
app.get("/api/files", (req, res) => {
  res.json({ files: getFileList() });
});

// --- PRIVATE: Admin upload page ---
app.get("/admin", requireAuth, (req, res) => {
  const token = req.query.token || "";
  const files = getFileList();
  const rows = files
    .map(
      (f) => `
    <tr>
      <td>${f.name}</td>
      <td>${f.sizeHuman}</td>
      <td>${new Date(f.uploaded).toLocaleString()}</td>
      <td><button onclick="deleteFile('${f.name}')" class="btn-del">🗑 Delete</button></td>
    </tr>`
    )
    .join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>APK Upload — Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    h1 { color: #f0883e; margin-bottom: 8px; }
    .subtitle { color: #8b949e; margin-bottom: 20px; }
    .upload-box { background: #161b22; border: 2px dashed #30363d; border-radius: 8px; padding: 30px; text-align: center; margin-bottom: 20px; }
    .upload-box:hover { border-color: #58a6ff; }
    input[type="file"] { margin: 10px 0; }
    .btn { background: #238636; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; }
    .btn:hover { background: #2ea043; }
    .btn-del { background: #da3633; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
    .btn-del:hover { background: #f85149; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #161b22; color: #f0883e; padding: 12px 10px; text-align: left; border-bottom: 1px solid #30363d; }
    td { padding: 10px; border-bottom: 1px solid #21262d; }
    .msg { padding: 10px; border-radius: 6px; margin: 10px 0; }
    .msg-ok { background: #1b4332; color: #7ee787; }
    .msg-err { background: #3d1f1f; color: #f85149; }
    #status { margin-top: 10px; }
    .progress { width: 100%; height: 20px; background: #21262d; border-radius: 10px; overflow: hidden; margin-top: 10px; display: none; }
    .progress-bar { height: 100%; background: #238636; transition: width 0.3s; }
    .file-row { margin: 6px 0; display: flex; align-items: center; gap: 8px; }
    .file-num { color: #f0883e; font-weight: bold; min-width: 20px; }
    .apk-input { flex: 1; }
    .btn-add { background: #30363d; color: #58a6ff; border: 1px solid #58a6ff; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-top: 8px; }
    .btn-add:hover { background: #161b22; }
  </style>
</head>
<body>
  <h1>🔒 APK Upload — Admin</h1>
  <p class="subtitle">Upload .apk files (max ${MAX_FILE_SIZE / 1024 / 1024}MB)</p>

  <div class="upload-box">
    <form id="uploadForm" enctype="multipart/form-data">
      <div id="fileInputs">
        <div class="file-row"><span class="file-num">1.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
        <div class="file-row"><span class="file-num">2.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
        <div class="file-row"><span class="file-num">3.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
        <div class="file-row"><span class="file-num">4.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
        <div class="file-row"><span class="file-num">5.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
        <div class="file-row"><span class="file-num">6.</span> <input type="file" name="apk" accept=".apk" class="apk-input" /></div>
      </div>
      <button type="button" id="addMoreBtn" class="btn-add" onclick="addFileInput()">➕ Add more</button>
      <br><br>
      <button type="submit" class="btn">⬆️ Upload All APK</button>
    </form>
    <div class="progress" id="progressWrap">
      <div class="progress-bar" id="progressBar" style="width:0%"></div>
    </div>
    <div id="status"></div>
  </div>

  <h2 style="color:#f0883e; margin-bottom:10px;">Uploaded Files (${files.length})</h2>
  ${
    files.length === 0
      ? '<p style="color:#8b949e">No files yet.</p>'
      : `<table>
    <thead><tr><th>Filename</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  }

  <script>
    const TOKEN = "${token}";

    let inputCount = 6;
    function addFileInput() {
      if (inputCount >= 10) { alert("Max 10 files"); return; }
      inputCount++;
      const div = document.createElement("div");
      div.className = "file-row";
      div.innerHTML = '<span class="file-num">' + inputCount + '.</span> <input type="file" name="apk" accept=".apk" class="apk-input" />';
      document.getElementById("fileInputs").appendChild(div);
    }

    document.getElementById("uploadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const inputs = document.querySelectorAll(".apk-input");
      const formData = new FormData();
      let count = 0;
      inputs.forEach(inp => {
        if (inp.files && inp.files.length > 0) {
          formData.append("apk", inp.files[0]);
          count++;
        }
      });
      if (count === 0) { alert("Pilih minimal 1 file .apk"); return; }

      const statusEl = document.getElementById("status");
      const progressWrap = document.getElementById("progressWrap");
      const progressBar = document.getElementById("progressBar");

      statusEl.innerHTML = '<div class="msg" style="background:#1c2333;color:#58a6ff;">⏳ Uploading ' + count + ' file(s)...</div>';
      progressWrap.style.display = "block";
      progressBar.style.width = "0%";

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/upload");
      xhr.setRequestHeader("Authorization", "Bearer " + TOKEN);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progressBar.style.width = pct + "%";
        }
      };

      xhr.onload = () => {
        progressWrap.style.display = "none";
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          if (data.files) {
            const list = data.files.map(f => '✅ ' + f.name + ' (' + f.sizeHuman + ')').join('<br>');
            statusEl.innerHTML = '<div class="msg msg-ok">' + list + '</div>';
          } else if (data.file) {
            statusEl.innerHTML = '<div class="msg msg-ok">✅ ' + data.file.name + ' (' + data.file.sizeHuman + ')</div>';
          }
          setTimeout(() => location.reload(), 2000);
        } else {
          let msg = "Upload failed";
          try { msg = JSON.parse(xhr.responseText).error; } catch(e) {}
          statusEl.innerHTML = '<div class="msg msg-err">❌ ' + msg + '</div>';
        }
      };

      xhr.onerror = () => {
        progressWrap.style.display = "none";
        statusEl.innerHTML = '<div class="msg msg-err">❌ Network error</div>';
      };

      xhr.send(formData);
    });

    async function deleteFile(name) {
      if (!confirm("Delete " + name + "?")) return;
      const res = await fetch("/delete/" + encodeURIComponent(name), {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + TOKEN }
      });
      if (res.ok) {
        location.reload();
      } else {
        alert("Delete failed");
      }
    }
  </script>
</body>
</html>`);
});

// --- PRIVATE: Upload endpoint (API) — supports single & multi-file ---
app.post("/upload", requireAuth, (req, res, next) => {
  upload.array("apk", 10)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({ error: "Max 10 files per upload" });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    const uploadedFiles = req.files || [];
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const results = uploadedFiles.map((f) => {
      const stat = fs.statSync(f.path);
      console.log(`📦 Uploaded: ${f.filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return {
        name: f.filename,
        size: stat.size,
        sizeHuman: (stat.size / (1024 * 1024)).toFixed(1) + " MB",
        downloadUrl: `/download/${encodeURIComponent(f.filename)}`,
      };
    });

    // Backward compatible: single file returns "file", multi returns "files"
    if (results.length === 1) {
      res.json({ success: true, file: results[0] });
    } else {
      res.json({ success: true, count: results.length, files: results });
    }
  });
});

// --- PRIVATE: Delete endpoint ---
app.delete("/delete/:filename", requireAuth, (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const safe = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlinkSync(filePath);
  console.log(`🗑 Deleted: ${safe}`);
  res.json({ success: true, deleted: safe });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => {
  console.log("============================================");
  console.log("  APK Uploader v1.0");
  console.log("============================================");
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📁 Upload directory: ${path.resolve(UPLOAD_DIR)}`);
  console.log(`🔒 Admin token: ${ADMIN_TOKEN === "changeme" ? "⚠️  DEFAULT (change ADMIN_TOKEN env!)" : "✅ Set"}`);
  console.log(`📏 Max file size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  console.log("");
  console.log(`Public download:  http://localhost:${PORT}/`);
  console.log(`Admin upload:     http://localhost:${PORT}/admin?token=YOUR_TOKEN`);
  console.log(`API file list:    http://localhost:${PORT}/api/files`);
  console.log(`Curl upload:      curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -F "apk=@file.apk" http://localhost:${PORT}/upload`);
  console.log("============================================");
});
