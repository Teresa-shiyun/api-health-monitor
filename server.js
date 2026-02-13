require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const db = new sqlite3.Database("./data/monitor.db");

// 初始化数据库
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      success INTEGER,
      status_code INTEGER,
      latency INTEGER,
      error TEXT
    )
  `);
});

function loadEndpoints() {
  const file = path.join(__dirname, "endpoints.json");
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

async function checkEndpoint(url) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: 5000,
      headers: { "User-Agent": "api-health-monitor" }
    });
    const latency = Date.now() - start;

    db.run(
      "INSERT INTO checks (url, success, status_code, latency) VALUES (?, ?, ?, ?)",
      [url, 1, res.status, latency]
    );

    console.log(`✔ ${url} OK (${latency}ms)`);
  } catch (err) {
    const latency = Date.now() - start;
    const status = err.response?.status || 0;
    const msg = err.message;

    db.run(
      "INSERT INTO checks (url, success, status_code, latency, error) VALUES (?, ?, ?, ?, ?)",
      [url, 0, status, latency, msg]
    );

    console.log(`✘ ${url} FAIL (${status})`);
  }
}

// 每分钟运行一次
cron.schedule("* * * * *", () => {
  console.log("Running health check...");
  const endpoints = loadEndpoints();
  endpoints.forEach(e => checkEndpoint(e.url));
});

app.get("/api/metrics", (req, res) => {
  db.all(
    "SELECT * FROM checks ORDER BY timestamp DESC LIMIT 100",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get("/api/status", (req, res) => {
  const endpoints = loadEndpoints();

  // 对每个 endpoint，取最新一条记录
  const tasks = endpoints.map((ep) => {
    return new Promise((resolve) => {
      db.get(
        "SELECT * FROM checks WHERE url = ? ORDER BY timestamp DESC LIMIT 1",
        [ep.url],
        (err, row) => {
          resolve({
            name: ep.name,
            url: ep.url,
            last: row || null
          });
        }
      );
    });
  });

  Promise.all(tasks).then((result) => res.json(result));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
