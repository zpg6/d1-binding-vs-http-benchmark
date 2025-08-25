import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { D1BenchmarkSimple } from "./benchmark-simple";
import type { CloudflareBindings } from "./env";

type Variables = {
    auth: ReturnType<typeof createAuth>;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// CORS configuration for auth routes
app.use(
    "/api/auth/**",
    cors({
        origin: "*", // In production, replace with your actual domain
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["POST", "GET", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 600,
        credentials: true,
    })
);

// Middleware to initialize auth instance for each request
app.use("*", async (c, next) => {
    const auth = createAuth(c.env, (c.req.raw as any).cf || {});
    c.set("auth", auth);
    await next();
});

// Handle all auth routes
app.all("/api/auth/*", async c => {
    const auth = c.get("auth");
    return auth.handler(c.req.raw);
});

// Redirect home to benchmark
app.get("/", async c => {
    return c.redirect("/benchmark");
});

// Simple health check
app.get("/health", c => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Benchmark route
app.post("/benchmark/run", async c => {
    try {
        const { userCount = 1000, loadIterations = 50 } = await c.req.json().catch(() => ({}));

        const benchmark = new D1BenchmarkSimple({
            accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
            databaseId: c.env.CLOUDFLARE_DATABASE_ID,
            token: c.env.CLOUDFLARE_API_TOKEN,
            binding: c.env.DATABASE,
        });

        const report = await benchmark.runFullBenchmark(userCount, loadIterations);

        return c.json({
            success: true,
            report,
            timestamp: new Date().toISOString(),
            testConfig: {
                userCount,
                loadIterations,
            },
        });
    } catch (error) {
        return c.json(
            {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
});

// Benchmark dashboard
app.get("/benchmark", async c => {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>D1 Binding vs HTTP Benchmark</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 20px 0; }
        .header { text-align: center; margin-bottom: 24px; }
        .title { font-size: 2rem; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 0.875rem; margin: 8px 0 0 0; }
        button { padding: 8px 16px; margin: 8px 4px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; }
        .primary-btn { background: #3b82f6; color: white; border-color: #3b82f6; }
        .success-btn { background: #10b981; color: white; border-color: #10b981; }
        .warning-btn { background: #f59e0b; color: white; border-color: #f59e0b; }
        .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 20px 0; }
        .results { margin-top: 20px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric { padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center; }
        .metric-value { font-size: 1.5rem; font-weight: bold; }
        .metric-label { font-size: 0.875rem; color: #6b7280; }
        .binding { border-left: 4px solid #10b981; }
        .http { border-left: 4px solid #f59e0b; }
        .results-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .results-table th, .results-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .results-table th { background: #f9fafb; font-weight: 600; }
        .success { color: #10b981; }
        .error { color: #ef4444; }
        .loading { text-align: center; padding: 20px; color: #6b7280; }
        .speedup { font-size: 1.2rem; font-weight: bold; padding: 10px; text-align: center; border-radius: 6px; }
        .speedup.positive { background: #dcfce7; color: #166534; }
        .speedup.negative { background: #fef2f2; color: #dc2626; }
        input[type="number"] { padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; width: 80px; }
        label { font-weight: 500; }
        .duration-note { font-size: 0.875rem; color: #6b7280; margin-top: 8px; font-style: italic; }
        #runBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h1 class="title">D1 Binding vs HTTP Benchmark</h1>
            <p class="subtitle">Performance comparison between Drizzle D1 binding and D1-HTTP driver</p>
        </div>
        
        <div class="controls">
            <label>Users to seed: <input type="number" id="userCount" value="1000" min="100" max="10000"></label>
            <label>Load iterations: <input type="number" id="loadIterations" value="50" min="10" max="200"></label>
            <button onclick="runBenchmark()" class="primary-btn" id="runBtn">Run Benchmark</button>
        </div>
        
        <div id="status" class="loading" style="display:none;">
            <div id="progress">Running benchmark...</div>
            <div class="duration-note">This may take up to 30 seconds. Please don't leave the page.</div>
        </div>
        
        <div id="results" class="results" style="display:none;">
            <div id="summary" class="summary"></div>
            <div id="speedup"></div>
            <table id="resultsTable" class="results-table">
                <thead>
                    <tr>
                        <th>Operation</th>
                        <th>Approach</th>
                        <th>Duration (ms)</th>
                        <th>Records</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody id="resultsBody"></tbody>
            </table>
        </div>
    </div>

    <script>
        async function runBenchmark() {
            const userCount = parseInt(document.getElementById('userCount').value);
            const loadIterations = parseInt(document.getElementById('loadIterations').value);
            const runBtn = document.getElementById('runBtn');
            
            // Disable button and show status
            runBtn.disabled = true;
            runBtn.textContent = 'Running...';
            showStatus();
            
            try {
                const response = await fetch('/benchmark/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userCount, loadIterations })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    displayResults(result.report);
                    hideStatus();
                } else {
                    alert('Benchmark failed: ' + result.error);
                    hideStatus();
                }
            } catch (error) {
                alert('Benchmark failed: ' + error.message);
                hideStatus();
            } finally {
                // Re-enable button
                runBtn.disabled = false;
                runBtn.textContent = 'Run Benchmark';
            }
        }

        function showStatus() {
            document.getElementById('status').style.display = 'block';
            document.getElementById('results').style.display = 'none';
        }

        function hideStatus() {
            document.getElementById('status').style.display = 'none';
        }

        function displayResults(report) {
            const { results, summary } = report;
            
            // Display summary
            const summaryDiv = document.getElementById('summary');
            summaryDiv.innerHTML = \`
                <div class="metric binding">
                    <div class="metric-value">\${summary.binding.avg.toFixed(1)}ms</div>
                    <div class="metric-label">Binding Avg</div>
                </div>
                <div class="metric http">
                    <div class="metric-value">\${summary.http.avg.toFixed(1)}ms</div>
                    <div class="metric-label">HTTP Avg</div>
                </div>
                <div class="metric binding">
                    <div class="metric-value">\${summary.binding.median.toFixed(1)}ms</div>
                    <div class="metric-label">Binding Median</div>
                </div>
                <div class="metric http">
                    <div class="metric-value">\${summary.http.median.toFixed(1)}ms</div>
                    <div class="metric-label">HTTP Median</div>
                </div>
                <div class="metric binding">
                    <div class="metric-value">\${summary.binding.p95.toFixed(1)}ms</div>
                    <div class="metric-label">Binding P95</div>
                </div>
                <div class="metric http">
                    <div class="metric-value">\${summary.http.p95.toFixed(1)}ms</div>
                    <div class="metric-label">HTTP P95</div>
                </div>
            \`;
            
            // Display speedup factor
            const speedupDiv = document.getElementById('speedup');
            const avgSpeedup = summary.speedupFactor;
            const medianSpeedup = summary.medianSpeedup;
            const p95Speedup = summary.p95Speedup;
            
            const speedupClass = avgSpeedup > 1 ? 'positive' : 'negative';
            
            speedupDiv.innerHTML = \`
                <div class="speedup \${speedupClass}">
                    <strong>Performance Summary:</strong><br/>
                    Avg: Binding is \${avgSpeedup.toFixed(2)}x faster | 
                    Median: \${medianSpeedup.toFixed(2)}x faster | 
                    P95: \${p95Speedup.toFixed(2)}x faster
                </div>
            \`;
            
            // Display detailed results
            const tbody = document.getElementById('resultsBody');
            tbody.innerHTML = results.map(result => \`
                <tr>
                    <td>\${result.operation}</td>
                    <td><span class="\${result.approach}">\${result.approach}</span></td>
                    <td>\${result.duration.toFixed(2)}</td>
                    <td>\${result.recordsAffected || '-'}</td>
                    <td class="\${result.success ? 'success' : 'error'}">
                        \${result.success ? '✓' : '✗' + (result.error ? ' ' + result.error : '')}
                    </td>
                </tr>
            \`).join('');
            
            document.getElementById('results').style.display = 'block';
        }
    </script>
</body>
</html>
  `;

    return c.html(html);
});

export default app;
