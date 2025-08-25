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
        const { userCount = 1000, queryIterations = 50 } = await c.req.json().catch(() => ({}));

        const benchmark = new D1BenchmarkSimple({
            accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
            databaseId: c.env.CLOUDFLARE_DATABASE_ID,
            token: c.env.CLOUDFLARE_API_TOKEN,
            binding: c.env.DATABASE,
        });

        const report = await benchmark.runFullBenchmark(userCount, queryIterations);

        return c.json({
            success: true,
            report,
            timestamp: new Date().toISOString(),
            testConfig: {
                userCount,
                queryIterations,
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
            <p class="subtitle">Compares Drizzle D1 binding vs D1-HTTP driver across 6 query types</p>
        </div>
        
        <div class="controls">
            <label>Users to seed: <input type="number" id="userCount" value="1000" min="100" max="10000"></label>
            <label>Query iterations: <input type="number" id="queryIterations" value="15" min="5" max="50"></label>
            <button onclick="runBenchmark()" class="primary-btn" id="runBtn">Run Benchmark</button>
        </div>
        
        <div class="test-info card" style="background: #f8fafc; margin: 20px 0;">
            <h3>What This Tests:</h3>
            <p style="margin: 10px 0;">Runs 6 different SQL query patterns N times each using both D1 binding and HTTP approaches to measure performance differences.</p>
            
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; font-weight: 600; padding: 5px 0;">📋 View Query Types & SQL</summary>
                <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 20px;">
                    
                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>1. Simple SELECT</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">Basic data retrieval - fetches a small set of user records with specific columns</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">SELECT id, name, email FROM users LIMIT 20</pre>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>2. Filtered SELECT</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">WHERE clause filtering - finds users matching specific conditions (verified and not anonymous)</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">SELECT * FROM users 
WHERE email_verified = 1 AND is_anonymous = 0 
LIMIT 30</pre>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>3. JOIN Operations</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">Relational data retrieval - combines user and session data with filtering and ordering</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">SELECT u.name, u.email, s.created_at as last_session, 
       s.city, s.country
FROM users u 
INNER JOIN sessions s ON u.id = s.user_id 
WHERE s.created_at > [recent_timestamp]
ORDER BY s.created_at DESC
LIMIT 25</pre>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>4. Aggregation</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">COUNT and GROUP BY operations - analytics-style queries with aggregation functions</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">SELECT u.is_anonymous, COUNT(*) as user_count, 
       COUNT(s.id) as session_count,
       AVG(LENGTH(u.name)) as avg_name_length
FROM users u
LEFT JOIN sessions s ON u.id = s.user_id
GROUP BY u.is_anonymous
ORDER BY user_count DESC</pre>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>5. Bulk INSERT</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">Writing chunks of data - inserts multiple user records in a single query for efficiency</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES 
(?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), 
(?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)</pre>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 6px;">
                        <div style="max-width: 300px;">
                            <strong>6. Bulk SELECT</strong>
                            <p style="font-size: 0.875rem; color: #6b7280; margin: 5px 0 0 0;">Reading chunks of data - retrieves large dataset with JOIN for bulk data operations</p>
                        </div>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin: 0; max-width: 600px; overflow-x: auto; border: 1px solid #d1d5db;">SELECT u.id, u.name, u.email, u.email_verified, u.created_at, 
       s.id as session_id, s.token, s.ip_address, s.user_agent, s.city, s.country
FROM users u 
LEFT JOIN sessions s ON u.id = s.user_id 
ORDER BY u.created_at DESC 
LIMIT 200</pre>
                    </div>

                </div>
            </details>
        </div>
        
        <div id="status" class="loading" style="display:none;">
            <div id="progress">Running benchmark...</div>
            <div class="duration-note">This may take up to 5min for 200 iterations. Please don't leave the page.</div>
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
            const queryIterations = parseInt(document.getElementById('queryIterations').value);
            const runBtn = document.getElementById('runBtn');
            
            // Disable button and show status
            runBtn.disabled = true;
            runBtn.textContent = 'Running...';
            showStatus();
            
            try {
                const response = await fetch('/benchmark/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userCount, queryIterations })
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
            const { results, summary, queryTypeResults } = report;
            
            // Display overall summary
            const summaryDiv = document.getElementById('summary');
            summaryDiv.innerHTML = \`
                <div class="metric binding">
                    <div class="metric-value">\${summary.binding.avg.toFixed(1)}ms</div>
                    <div class="metric-label">Overall Binding Avg</div>
                </div>
                <div class="metric http">
                    <div class="metric-value">\${summary.http.avg.toFixed(1)}ms</div>
                    <div class="metric-label">Overall HTTP Avg</div>
                </div>
                <div class="metric binding">
                    <div class="metric-value">\${summary.binding.totalOperations}</div>
                    <div class="metric-label">Binding Operations</div>
                </div>
                <div class="metric http">
                    <div class="metric-value">\${summary.http.totalOperations}</div>
                    <div class="metric-label">HTTP Operations</div>
                </div>
            \`;
            
            // Display overall speedup factor
            const speedupDiv = document.getElementById('speedup');
            const avgSpeedup = summary.speedupFactor;
            const speedupClass = avgSpeedup > 1 ? 'positive' : 'negative';
            
            speedupDiv.innerHTML = \`
                <div class="speedup \${speedupClass}">
                    <strong>Overall Performance:</strong> 
                    Binding is \${avgSpeedup.toFixed(2)}x \${avgSpeedup > 1 ? 'faster' : 'slower'} than HTTP on average
                </div>
            \`;
            
            // Display query type breakdown
            const resultsDiv = document.getElementById('results');
            let queryTypeHtml = '<h3 style="margin-top: 30px;">Results by Query Type:</h3>';
            
            Object.entries(queryTypeResults).forEach(([queryType, stats]) => {
                const speedup = stats.speedup;
                const speedupClass = speedup > 1 ? 'positive' : 'negative';
                const description = results.find(r => r.queryType === queryType)?.description || '';
                
                const sqlQuery = results.find(r => r.queryType === queryType)?.sqlQuery || '';
                
                queryTypeHtml += \`
                    <div class="card" style="margin: 15px 0; border-left: 4px solid \${speedup > 1 ? '#10b981' : '#f59e0b'};">
                        <h4 style="margin: 0 0 10px 0;">\${queryType}</h4>
                        <p style="font-size: 0.875rem; color: #6b7280; margin: 0 0 15px 0;">\${description}</p>
                        
                        <details style="margin: 10px 0;">
                            <summary style="cursor: pointer; font-size: 0.875rem; color: #3b82f6;">🔍 View SQL Query</summary>
                            <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 0.8rem; margin-top: 8px; overflow-x: auto; border: 1px solid #e5e7eb;">\${sqlQuery}</pre>
                        </details>
                        
                        <div class="summary" style="margin: 15px 0;">
                            <div class="metric binding">
                                <div class="metric-value">\${stats.binding.avg.toFixed(1)}ms</div>
                                <div class="metric-label">Binding Avg</div>
                            </div>
                            <div class="metric http">
                                <div class="metric-value">\${stats.http.avg.toFixed(1)}ms</div>
                                <div class="metric-label">HTTP Avg</div>
                            </div>
                            <div class="metric binding">
                                <div class="metric-value">\${stats.binding.median.toFixed(1)}ms</div>
                                <div class="metric-label">Binding Median</div>
                            </div>
                            <div class="metric http">
                                <div class="metric-value">\${stats.http.median.toFixed(1)}ms</div>
                                <div class="metric-label">HTTP Median</div>
                            </div>
                        </div>
                        
                        <div class="speedup \${speedupClass}" style="margin: 10px 0;">
                            Binding is <strong>\${speedup.toFixed(2)}x \${speedup > 1 ? 'faster' : 'slower'}</strong> for this query type
                        </div>
                    </div>
                \`;
            });
            
            // Display detailed results table
            queryTypeHtml += \`
                <details style="margin-top: 30px;">
                    <summary style="cursor: pointer; font-weight: 600; padding: 5px 0;">📊 View Detailed Results</summary>
                    <table class="results-table" style="margin-top: 15px;">
                        <thead>
                            <tr>
                                <th>Query Type</th>
                                <th>Approach</th>
                                <th>Duration (ms)</th>
                                <th>Records</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${results.map(result => \`
                                <tr>
                                    <td>\${result.queryType}</td>
                                    <td><span class="\${result.approach}">\${result.approach}</span></td>
                                    <td>\${result.duration.toFixed(2)}</td>
                                    <td>\${result.recordsAffected || '-'}</td>
                                    <td class="\${result.success ? 'success' : 'error'}">
                                        \${result.success ? '✓' : '✗' + (result.error ? ' ' + result.error : '')}
                                    </td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                </details>
            \`;
            
            resultsDiv.innerHTML = summaryDiv.outerHTML + speedupDiv.outerHTML + queryTypeHtml;
            resultsDiv.style.display = 'block';
        }
    </script>
</body>
</html>
  `;

    return c.html(html);
});

export default app;
