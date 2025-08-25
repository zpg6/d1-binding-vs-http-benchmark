import { drizzle as drizzleBinding } from "drizzle-orm/d1";
import { drizzle as drizzleHttp } from "@zpg6-test-pkgs/drizzle-orm/d1-http";
import { sql } from "drizzle-orm";
import { sql as sqlHttp } from "@zpg6-test-pkgs/drizzle-orm/sql";

interface BenchmarkConfig {
    accountId: string;
    databaseId: string;
    token: string;
    binding: any; // D1Database type from Cloudflare Workers
}

interface BenchmarkResult {
    operation: string;
    approach: "binding" | "http";
    duration: number;
    recordsAffected?: number;
    success: boolean;
    error?: string;
}

interface BenchmarkStats {
    avg: number;
    median: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    stdDev: number;
    totalOperations: number;
    successRate: number;
}

interface BenchmarkSummary {
    results: BenchmarkResult[];
    summary: {
        binding: BenchmarkStats;
        http: BenchmarkStats;
        speedupFactor: number;
        medianSpeedup: number;
        p95Speedup: number;
    };
}

export class D1BenchmarkSimple {
    private readonly dbBinding: ReturnType<typeof drizzleBinding>;
    private readonly dbHttp: ReturnType<typeof drizzleHttp>;
    private results: BenchmarkResult[] = [];

    constructor(config: BenchmarkConfig) {
        this.dbBinding = drizzleBinding(config.binding);
        this.dbHttp = drizzleHttp({
            accountId: config.accountId,
            databaseId: config.databaseId,
            token: config.token,
        });
    }

    private async measureTime<T>(
        operation: string,
        approach: "binding" | "http",
        fn: () => Promise<T>
    ): Promise<BenchmarkResult> {
        const start = performance.now();
        try {
            const result = await fn();
            const duration = performance.now() - start;

            let recordsAffected: number | undefined;
            if (Array.isArray(result)) {
                recordsAffected = result.length;
            } else if (result && typeof result === "object" && "changes" in result) {
                recordsAffected = (result as any).changes;
            }

            const benchmarkResult: BenchmarkResult = {
                operation,
                approach,
                duration,
                recordsAffected,
                success: true,
            };

            this.results.push(benchmarkResult);
            return benchmarkResult;
        } catch (error) {
            const duration = performance.now() - start;
            const benchmarkResult: BenchmarkResult = {
                operation,
                approach,
                duration,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };

            this.results.push(benchmarkResult);
            return benchmarkResult;
        }
    }

    async cleanDatabase(): Promise<void> {
        console.log("Cleaning database...");
        await this.dbBinding.run(sql`DELETE FROM sessions`);
        await this.dbBinding.run(sql`DELETE FROM users`);
    }

    async seedData(userCount: number = 1000): Promise<void> {
        console.log(`Seeding ${userCount} users using raw SQL...`);

        // Clean database first
        await this.cleanDatabase();

        // Generate and insert test data using raw SQL for compatibility
        const batchSize = 100;
        for (let i = 0; i < userCount; i += batchSize) {
            const values: string[] = [];
            const endIndex = Math.min(i + batchSize, userCount);

            for (let j = i; j < endIndex; j++) {
                const userId = `user_${j.toString().padStart(6, "0")}`;
                const name = `Test User ${j}`;
                const email = `user${j}@benchmark.test`;
                const emailVerified = j % 3 === 0 ? 1 : 0;
                const image = j % 5 === 0 ? `https://avatar.test/${j}.jpg` : null;
                const createdAt = Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000;
                const updatedAt = Date.now();
                const isAnonymous = j % 10 === 0 ? 1 : 0;

                const imageValue = image ? `'${image}'` : "NULL";
                values.push(
                    `('${userId}', '${name}', '${email}', ${emailVerified}, ${imageValue}, ${Math.floor(createdAt)}, ${Math.floor(updatedAt)}, ${isAnonymous})`
                );
            }

            const insertSql = `INSERT INTO users (id, name, email, email_verified, image, created_at, updated_at, is_anonymous) VALUES ${values.join(", ")}`;
            await this.dbBinding.run(sql.raw(insertSql));

            if (i % 500 === 0) {
                console.log(`Seeded ${endIndex}/${userCount} users...`);
            }
        }

        // Create some sessions
        const sessionCount = Math.floor(userCount * 0.3);
        for (let i = 0; i < sessionCount; i += batchSize) {
            const values: string[] = [];
            const endIndex = Math.min(i + batchSize, sessionCount);

            for (let j = i; j < endIndex; j++) {
                const sessionId = `session_${j.toString().padStart(6, "0")}`;
                const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
                const token = `token_${j}_${Math.random().toString(36).substring(2)}`;
                const createdAt = Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000;
                const updatedAt = Date.now();
                const ipAddress = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
                const userAgent = `BenchmarkAgent/${Math.floor(Math.random() * 100)}`;
                const userId = `user_${j.toString().padStart(6, "0")}`;
                const timezones = ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"];
                const cities = ["New York", "London", "Tokyo", "San Francisco"];
                const countries = ["US", "GB", "JP", "CA"];

                const timezone = timezones[Math.floor(Math.random() * timezones.length)];
                const city = cities[Math.floor(Math.random() * cities.length)];
                const country = countries[Math.floor(Math.random() * countries.length)];

                values.push(
                    `('${sessionId}', ${Math.floor(expiresAt)}, '${token}', ${Math.floor(createdAt)}, ${Math.floor(updatedAt)}, '${ipAddress}', '${userAgent}', '${userId}', '${timezone}', '${city}', '${country}', NULL, NULL, NULL, NULL, NULL)`
                );
            }

            const insertSql = `INSERT INTO sessions (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id, timezone, city, country, region, region_code, colo, latitude, longitude) VALUES ${values.join(", ")}`;
            await this.dbBinding.run(sql.raw(insertSql));
        }

        console.log(`Seeding completed: ${userCount} users, ${sessionCount} sessions`);
    }

    async runBasicQueries(): Promise<void> {
        console.log("Running basic query benchmarks...");

        // Simple SELECT queries using raw SQL for compatibility
        await this.measureTime("select_all_users_limit_10", "binding", () =>
            this.dbBinding.run(sql`SELECT * FROM users LIMIT 10`)
        );

        await this.measureTime("select_all_users_limit_10", "http", () =>
            this.dbHttp.run(sqlHttp`SELECT * FROM users LIMIT 10`)
        );

        // COUNT queries
        await this.measureTime("count_users", "binding", () =>
            this.dbBinding.run(sql`SELECT COUNT(*) as count FROM users`)
        );

        await this.measureTime("count_users", "http", () =>
            this.dbHttp.run(sqlHttp`SELECT COUNT(*) as count FROM users`)
        );

        // WHERE queries
        await this.measureTime("select_verified_users", "binding", () =>
            this.dbBinding.run(sql`SELECT * FROM users WHERE email_verified = 1 LIMIT 50`)
        );

        await this.measureTime("select_verified_users", "http", () =>
            this.dbHttp.run(sqlHttp`SELECT * FROM users WHERE email_verified = 1 LIMIT 50`)
        );

        // JOIN queries
        await this.measureTime("join_users_sessions", "binding", () =>
            this.dbBinding.run(sql`
                SELECT u.id as user_id, u.name as user_name, s.id as session_id, s.created_at as session_created
                FROM users u 
                INNER JOIN sessions s ON u.id = s.user_id 
                LIMIT 50
            `)
        );

        await this.measureTime("join_users_sessions", "http", () =>
            this.dbHttp.run(sqlHttp`
                SELECT u.id as user_id, u.name as user_name, s.id as session_id, s.created_at as session_created
                FROM users u 
                INNER JOIN sessions s ON u.id = s.user_id 
                LIMIT 50
            `)
        );

        // ORDER BY queries
        await this.measureTime("select_users_ordered", "binding", () =>
            this.dbBinding.run(sql`SELECT * FROM users ORDER BY created_at DESC LIMIT 100`)
        );

        await this.measureTime("select_users_ordered", "http", () =>
            this.dbHttp.run(sqlHttp`SELECT * FROM users ORDER BY created_at DESC LIMIT 100`)
        );
    }

    async runWriteOperations(): Promise<void> {
        console.log("Running write operation benchmarks...");

        // Single INSERT
        const timestamp = Date.now();
        const userId1 = `bench_user_${timestamp}`;
        const userId2 = `bench_user_http_${timestamp}`;

        await this.measureTime("insert_single_user", "binding", () =>
            this.dbBinding.run(sql`
                INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) 
                VALUES (${userId1}, 'Benchmark User', ${"bench_" + timestamp + "@test.com"}, 1, ${timestamp}, ${timestamp}, 0)
            `)
        );

        await this.measureTime("insert_single_user", "http", () =>
            this.dbHttp.run(sqlHttp`
                INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) 
                VALUES (${userId2}, 'Benchmark User HTTP', ${"bench_http_" + timestamp + "@test.com"}, 1, ${timestamp}, ${timestamp}, 0)
            `)
        );

        // Batch INSERT (using multiple single inserts for simplicity)
        const batchTimestamp = Date.now();
        await this.measureTime("insert_batch_10_users", "binding", async () => {
            for (let i = 0; i < 10; i++) {
                await this.dbBinding.run(sql`
                    INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) 
                    VALUES (${"batch_user_" + batchTimestamp + "_" + i}, ${"Batch User " + i}, ${"batch_" + batchTimestamp + "_" + i + "@test.com"}, ${i % 2}, ${batchTimestamp}, ${batchTimestamp}, 0)
                `);
            }
        });

        await this.measureTime("insert_batch_10_users", "http", async () => {
            for (let i = 0; i < 10; i++) {
                await this.dbHttp.run(sqlHttp`
                    INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) 
                    VALUES (${"batch_user_http_" + batchTimestamp + "_" + i}, ${"Batch User HTTP " + i}, ${"batch_http_" + batchTimestamp + "_" + i + "@test.com"}, ${i % 2}, ${batchTimestamp}, ${batchTimestamp}, 0)
                `);
            }
        });

        // UPDATE operations
        await this.measureTime("update_user_name", "binding", () =>
            this.dbBinding.run(sql`
                UPDATE users 
                SET name = 'Updated Name', updated_at = ${Date.now()}
                WHERE id = ${userId1}
            `)
        );

        await this.measureTime("update_user_name", "http", () =>
            this.dbHttp.run(sqlHttp`
                UPDATE users 
                SET name = 'Updated Name HTTP', updated_at = ${Date.now()}
                WHERE id = ${userId2}
            `)
        );
    }

    async runWarmup(): Promise<void> {
        console.log("Running warmup phase...");

        // Warmup both connections with simple queries
        for (let i = 0; i < 5; i++) {
            await this.dbBinding.run(sql`SELECT 1`);
            await this.dbHttp.run(sqlHttp`SELECT 1`);
        }

        console.log("Warmup completed");
    }

    async runConcurrentTest(concurrency: number = 5, iterations: number = 20): Promise<void> {
        console.log(`Running concurrent test: ${concurrency} concurrent requests, ${iterations} iterations each`);

        const bindingOp = () => this.dbBinding.run(sql`SELECT COUNT(*) FROM users WHERE email_verified = 1`);
        const httpOp = () => this.dbHttp.run(sqlHttp`SELECT COUNT(*) FROM users WHERE email_verified = 1`);

        // Test binding concurrency
        console.log("Testing binding concurrency...");
        const bindingPromises: Promise<void>[] = [];
        for (let c = 0; c < concurrency; c++) {
            bindingPromises.push(
                (async () => {
                    for (let i = 0; i < iterations; i++) {
                        await this.measureTime(`concurrent_binding_${c}_${i}`, "binding", bindingOp);
                    }
                })()
            );
        }
        await Promise.all(bindingPromises);

        // Test HTTP concurrency
        console.log("Testing HTTP concurrency...");
        const httpPromises: Promise<void>[] = [];
        for (let c = 0; c < concurrency; c++) {
            httpPromises.push(
                (async () => {
                    for (let i = 0; i < iterations; i++) {
                        await this.measureTime(`concurrent_http_${c}_${i}`, "http", httpOp);
                    }
                })()
            );
        }
        await Promise.all(httpPromises);
    }

    async runLoadTest(iterations: number = 50): Promise<void> {
        console.log(`Running sequential load test with ${iterations} iterations per approach...`);

        // Define realistic operations for load testing
        const operations = [
            {
                name: "simple_select",
                binding: () => this.dbBinding.run(sql`SELECT * FROM users LIMIT 10`),
                http: () => this.dbHttp.run(sqlHttp`SELECT * FROM users LIMIT 10`),
            },
            {
                name: "count_query",
                binding: () => this.dbBinding.run(sql`SELECT COUNT(*) FROM sessions`),
                http: () => this.dbHttp.run(sqlHttp`SELECT COUNT(*) FROM sessions`),
            },
            {
                name: "filtered_select",
                binding: () => this.dbBinding.run(sql`SELECT * FROM users WHERE email_verified = 1 LIMIT 10`),
                http: () => this.dbHttp.run(sqlHttp`SELECT * FROM users WHERE email_verified = 1 LIMIT 10`),
            },
            {
                name: "join_query",
                binding: () =>
                    this.dbBinding.run(
                        sql`SELECT u.name, s.created_at FROM users u JOIN sessions s ON u.id = s.user_id LIMIT 5`
                    ),
                http: () =>
                    this.dbHttp.run(
                        sqlHttp`SELECT u.name, s.created_at FROM users u JOIN sessions s ON u.id = s.user_id LIMIT 5`
                    ),
            },
        ];

        // Test each operation type multiple times
        for (const op of operations) {
            for (let i = 0; i < Math.floor(iterations / operations.length); i++) {
                await this.measureTime(`${op.name}_binding_${i}`, "binding", op.binding);
                await this.measureTime(`${op.name}_http_${i}`, "http", op.http);
            }
        }
    }

    async runRawSqlTest(): Promise<void> {
        console.log("Running raw SQL benchmarks...");

        // Raw SQL queries
        await this.measureTime("raw_sql_count", "binding", () =>
            this.dbBinding.run(sql`SELECT COUNT(*) as count FROM users WHERE email_verified = 1`)
        );

        await this.measureTime("raw_sql_count", "http", () =>
            this.dbHttp.run(sqlHttp`SELECT COUNT(*) as count FROM users WHERE email_verified = 1`)
        );

        await this.measureTime("raw_sql_complex", "binding", () =>
            this.dbBinding.run(sql`
                SELECT u.name, COUNT(s.id) as session_count 
                FROM users u 
                LEFT JOIN sessions s ON u.id = s.user_id 
                GROUP BY u.id, u.name 
                HAVING session_count > 0 
                ORDER BY session_count DESC 
                LIMIT 20
            `)
        );

        await this.measureTime("raw_sql_complex", "http", () =>
            this.dbHttp.run(sqlHttp`
                SELECT u.name, COUNT(s.id) as session_count 
                FROM users u 
                LEFT JOIN sessions s ON u.id = s.user_id 
                GROUP BY u.id, u.name 
                HAVING session_count > 0 
                ORDER BY session_count DESC 
                LIMIT 20
            `)
        );
    }

    private calculateStats(durations: number[]): Omit<BenchmarkStats, "totalOperations" | "successRate"> {
        if (durations.length === 0) {
            return { avg: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0 };
        }

        const sorted = [...durations].sort((a, b) => a - b);
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;

        const median =
            sorted.length % 2 === 0
                ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                : sorted[Math.floor(sorted.length / 2)];

        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);

        const variance = durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / durations.length;
        const stdDev = Math.sqrt(variance);

        return {
            avg,
            median,
            p95: sorted[p95Index] || sorted[sorted.length - 1],
            p99: sorted[p99Index] || sorted[sorted.length - 1],
            min: sorted[0],
            max: sorted[sorted.length - 1],
            stdDev,
        };
    }

    generateReport(): BenchmarkSummary {
        const bindingResults = this.results.filter(r => r.approach === "binding" && r.success);
        const httpResults = this.results.filter(r => r.approach === "http" && r.success);

        const bindingDurations = bindingResults.map(r => r.duration);
        const httpDurations = httpResults.map(r => r.duration);

        const bindingStats = this.calculateStats(bindingDurations);
        const httpStats = this.calculateStats(httpDurations);

        const bindingSuccessRate =
            this.results.filter(r => r.approach === "binding").length > 0
                ? bindingResults.length / this.results.filter(r => r.approach === "binding").length
                : 0;

        const httpSuccessRate =
            this.results.filter(r => r.approach === "http").length > 0
                ? httpResults.length / this.results.filter(r => r.approach === "http").length
                : 0;

        return {
            results: this.results,
            summary: {
                binding: {
                    ...bindingStats,
                    totalOperations: this.results.filter(r => r.approach === "binding").length,
                    successRate: bindingSuccessRate,
                },
                http: {
                    ...httpStats,
                    totalOperations: this.results.filter(r => r.approach === "http").length,
                    successRate: httpSuccessRate,
                },
                speedupFactor: httpStats.avg > 0 ? httpStats.avg / bindingStats.avg : 0,
                medianSpeedup: httpStats.median > 0 ? httpStats.median / bindingStats.median : 0,
                p95Speedup: httpStats.p95 > 0 ? httpStats.p95 / bindingStats.p95 : 0,
            },
        };
    }

    async runFullBenchmark(userCount: number = 1000, loadIterations: number = 50): Promise<BenchmarkSummary> {
        console.log("Starting enhanced D1 binding vs HTTP benchmark...");

        // Clear previous results
        this.clearResults();

        // Step 1: Warmup
        console.log("Step 1/7: Warming up connections...");
        await this.runWarmup();

        // Step 2: Seed data
        console.log("Step 2/7: Seeding test data...");
        await this.seedData(userCount);

        // Step 3: Basic queries
        console.log("Step 3/7: Running basic queries...");
        await this.runBasicQueries();

        // Step 4: Write operations
        console.log("Step 4/7: Running write operations...");
        await this.runWriteOperations();

        // Step 5: Sequential load testing
        console.log("Step 5/7: Running sequential load test...");
        await this.runLoadTest(loadIterations);

        // Step 6: Concurrent testing
        console.log("Step 6/7: Running concurrent test...");
        await this.runConcurrentTest(3, 15);

        // Step 7: Raw SQL tests
        console.log("Step 7/7: Running raw SQL tests...");
        await this.runRawSqlTest();

        // Final cleanup
        console.log("Cleaning up...");
        await this.cleanDatabase();

        console.log("Benchmark completed!");
        return this.generateReport();
    }

    clearResults(): void {
        this.results = [];
    }
}
