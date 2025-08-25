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
    queryType: string;
    description: string;
    sqlQuery: string;
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
        queryType: string,
        description: string,
        sqlQuery: string,
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
                queryType,
                description,
                sqlQuery,
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
                queryType,
                description,
                sqlQuery,
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

    async runQueryBenchmarks(iterations: number = 10): Promise<void> {
        console.log(`Running query benchmarks with ${iterations} iterations per query type...`);

        // Query Type 1: Simple SELECT - Basic data retrieval
        console.log("Testing Simple SELECT queries...");
        const simpleSelectQuery = "SELECT id, name, email FROM users LIMIT 20";
        for (let i = 0; i < iterations; i++) {
            await this.measureTime(
                `simple_select_${i}`,
                "Simple SELECT",
                "Basic data retrieval with LIMIT - fetches user records",
                simpleSelectQuery,
                "binding",
                () => this.dbBinding.run(sql`SELECT id, name, email FROM users LIMIT 20`)
            );

            await this.measureTime(
                `simple_select_${i}`,
                "Simple SELECT",
                "Basic data retrieval with LIMIT - fetches user records",
                simpleSelectQuery,
                "http",
                () => this.dbHttp.run(sqlHttp`SELECT id, name, email FROM users LIMIT 20`)
            );
        }

        // Query Type 2: Filtered SELECT - WHERE clause performance
        console.log("Testing Filtered SELECT queries...");
        const filteredSelectQuery = "SELECT * FROM users WHERE email_verified = 1 AND is_anonymous = 0 LIMIT 30";
        for (let i = 0; i < iterations; i++) {
            await this.measureTime(
                `filtered_select_${i}`,
                "Filtered SELECT",
                "WHERE clause filtering - finds verified users with conditions",
                filteredSelectQuery,
                "binding",
                () =>
                    this.dbBinding.run(sql`SELECT * FROM users WHERE email_verified = 1 AND is_anonymous = 0 LIMIT 30`)
            );

            await this.measureTime(
                `filtered_select_${i}`,
                "Filtered SELECT",
                "WHERE clause filtering - finds verified users with conditions",
                filteredSelectQuery,
                "http",
                () =>
                    this.dbHttp.run(sqlHttp`SELECT * FROM users WHERE email_verified = 1 AND is_anonymous = 0 LIMIT 30`)
            );
        }

        // Query Type 3: JOIN Operations - Relational data access
        console.log("Testing JOIN queries...");
        const joinQuery = `SELECT u.name, u.email, s.created_at as last_session, s.city, s.country
FROM users u 
INNER JOIN sessions s ON u.id = s.user_id 
WHERE s.created_at > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
ORDER BY s.created_at DESC
LIMIT 25`;
        for (let i = 0; i < iterations; i++) {
            await this.measureTime(
                `join_query_${i}`,
                "JOIN Operations",
                "INNER JOIN between users and sessions - relational data retrieval",
                joinQuery,
                "binding",
                () =>
                    this.dbBinding.run(sql`
                    SELECT u.name, u.email, s.created_at as last_session, s.city, s.country
                    FROM users u 
                    INNER JOIN sessions s ON u.id = s.user_id 
                    WHERE s.created_at > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
                    ORDER BY s.created_at DESC
                    LIMIT 25
                `)
            );

            await this.measureTime(
                `join_query_${i}`,
                "JOIN Operations",
                "INNER JOIN between users and sessions - relational data retrieval",
                joinQuery,
                "http",
                () =>
                    this.dbHttp.run(sqlHttp`
                    SELECT u.name, u.email, s.created_at as last_session, s.city, s.country
                    FROM users u 
                    INNER JOIN sessions s ON u.id = s.user_id 
                    WHERE s.created_at > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
                    ORDER BY s.created_at DESC
                    LIMIT 25
                `)
            );
        }

        // Query Type 4: Aggregation - COUNT, GROUP BY operations
        console.log("Testing Aggregation queries...");
        const aggregationQuery = `SELECT u.is_anonymous, COUNT(*) as user_count, 
       COUNT(s.id) as session_count,
       AVG(LENGTH(u.name)) as avg_name_length
FROM users u
LEFT JOIN sessions s ON u.id = s.user_id
GROUP BY u.is_anonymous
ORDER BY user_count DESC`;
        for (let i = 0; i < iterations; i++) {
            await this.measureTime(
                `aggregation_${i}`,
                "Aggregation",
                "COUNT and GROUP BY operations - analytics-style queries",
                aggregationQuery,
                "binding",
                () =>
                    this.dbBinding.run(sql`
                    SELECT u.is_anonymous, COUNT(*) as user_count, 
                           COUNT(s.id) as session_count,
                           AVG(LENGTH(u.name)) as avg_name_length
                    FROM users u
                    LEFT JOIN sessions s ON u.id = s.user_id
                    GROUP BY u.is_anonymous
                    ORDER BY user_count DESC
                `)
            );

            await this.measureTime(
                `aggregation_${i}`,
                "Aggregation",
                "COUNT and GROUP BY operations - analytics-style queries",
                aggregationQuery,
                "http",
                () =>
                    this.dbHttp.run(sqlHttp`
                    SELECT u.is_anonymous, COUNT(*) as user_count, 
                           COUNT(s.id) as session_count,
                           AVG(LENGTH(u.name)) as avg_name_length
                    FROM users u
                    LEFT JOIN sessions s ON u.id = s.user_id
                    GROUP BY u.is_anonymous
                    ORDER BY user_count DESC
                `)
            );
        }

        // Query Type 5: Bulk INSERT - Writing decent chunk of data
        console.log("Testing Bulk INSERT queries...");
        const bulkInsertQuery = `INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES 
(?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), 
(?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`;
        for (let i = 0; i < iterations; i++) {
            const timestamp = Date.now() + i;

            await this.measureTime(
                `bulk_insert_${i}`,
                "Bulk INSERT",
                "Insert multiple records in single query - writing data efficiently",
                bulkInsertQuery,
                "binding",
                () =>
                    this.dbBinding.run(sql`
                    INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES 
                    (${`bulk_${timestamp}_0`}, ${"Bulk User 0"}, ${`bulk_${timestamp}_0@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_${timestamp}_1`}, ${"Bulk User 1"}, ${`bulk_${timestamp}_1@test.com`}, ${1}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_${timestamp}_2`}, ${"Bulk User 2"}, ${`bulk_${timestamp}_2@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_${timestamp}_3`}, ${"Bulk User 3"}, ${`bulk_${timestamp}_3@test.com`}, ${1}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_${timestamp}_4`}, ${"Bulk User 4"}, ${`bulk_${timestamp}_4@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0})
                `)
            );

            await this.measureTime(
                `bulk_insert_${i}`,
                "Bulk INSERT",
                "Insert multiple records in single query - writing data efficiently",
                bulkInsertQuery,
                "http",
                () =>
                    this.dbHttp.run(sqlHttp`
                    INSERT INTO users (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES 
                    (${`bulk_http_${timestamp}_0`}, ${"Bulk User HTTP 0"}, ${`bulk_http_${timestamp}_0@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_http_${timestamp}_1`}, ${"Bulk User HTTP 1"}, ${`bulk_http_${timestamp}_1@test.com`}, ${1}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_http_${timestamp}_2`}, ${"Bulk User HTTP 2"}, ${`bulk_http_${timestamp}_2@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_http_${timestamp}_3`}, ${"Bulk User HTTP 3"}, ${`bulk_http_${timestamp}_3@test.com`}, ${1}, ${timestamp}, ${timestamp}, ${0}),
                    (${`bulk_http_${timestamp}_4`}, ${"Bulk User HTTP 4"}, ${`bulk_http_${timestamp}_4@test.com`}, ${0}, ${timestamp}, ${timestamp}, ${0})
                `)
            );
        }

        // Query Type 6: Bulk SELECT - Getting decent chunks of data out
        console.log("Testing Bulk SELECT queries...");
        const bulkSelectQuery = `SELECT u.id, u.name, u.email, u.email_verified, u.created_at, 
       s.id as session_id, s.token, s.ip_address, s.user_agent, s.city, s.country
FROM users u 
LEFT JOIN sessions s ON u.id = s.user_id 
ORDER BY u.created_at DESC 
LIMIT 200`;
        for (let i = 0; i < iterations; i++) {
            await this.measureTime(
                `bulk_select_${i}`,
                "Bulk SELECT",
                "Retrieve large dataset with JOIN - getting chunks of data efficiently",
                bulkSelectQuery,
                "binding",
                () =>
                    this.dbBinding.run(sql`
                    SELECT u.id, u.name, u.email, u.email_verified, u.created_at, 
                           s.id as session_id, s.token, s.ip_address, s.user_agent, s.city, s.country
                    FROM users u 
                    LEFT JOIN sessions s ON u.id = s.user_id 
                    ORDER BY u.created_at DESC 
                    LIMIT 200
                `)
            );

            await this.measureTime(
                `bulk_select_${i}`,
                "Bulk SELECT",
                "Retrieve large dataset with JOIN - getting chunks of data efficiently",
                bulkSelectQuery,
                "http",
                () =>
                    this.dbHttp.run(sqlHttp`
                    SELECT u.id, u.name, u.email, u.email_verified, u.created_at, 
                           s.id as session_id, s.token, s.ip_address, s.user_agent, s.city, s.country
                    FROM users u 
                    LEFT JOIN sessions s ON u.id = s.user_id 
                    ORDER BY u.created_at DESC 
                    LIMIT 200
                `)
            );
        }
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

    generateReport(): BenchmarkSummary & {
        queryTypeResults: Record<string, { binding: BenchmarkStats; http: BenchmarkStats; speedup: number }>;
    } {
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

        // Generate per-query-type statistics
        const queryTypes = [...new Set(this.results.map(r => r.queryType))];
        const queryTypeResults: Record<string, { binding: BenchmarkStats; http: BenchmarkStats; speedup: number }> = {};

        for (const queryType of queryTypes) {
            const bindingForType = this.results.filter(
                r => r.queryType === queryType && r.approach === "binding" && r.success
            );
            const httpForType = this.results.filter(
                r => r.queryType === queryType && r.approach === "http" && r.success
            );

            if (bindingForType.length > 0 && httpForType.length > 0) {
                const bindingStatsForType = this.calculateStats(bindingForType.map(r => r.duration));
                const httpStatsForType = this.calculateStats(httpForType.map(r => r.duration));

                queryTypeResults[queryType] = {
                    binding: {
                        ...bindingStatsForType,
                        totalOperations: bindingForType.length,
                        successRate:
                            bindingForType.length /
                            this.results.filter(r => r.queryType === queryType && r.approach === "binding").length,
                    },
                    http: {
                        ...httpStatsForType,
                        totalOperations: httpForType.length,
                        successRate:
                            httpForType.length /
                            this.results.filter(r => r.queryType === queryType && r.approach === "http").length,
                    },
                    speedup: httpStatsForType.avg > 0 ? httpStatsForType.avg / bindingStatsForType.avg : 0,
                };
            }
        }

        return {
            results: this.results,
            queryTypeResults,
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

    async runFullBenchmark(userCount: number = 1000, queryIterations: number = 15): Promise<BenchmarkSummary> {
        console.log("Starting enhanced D1 binding vs HTTP benchmark...");

        // Clear previous results
        this.clearResults();

        // Step 1: Warmup
        console.log("Step 1/4: Warming up connections...");
        await this.runWarmup();

        // Step 2: Seed data
        console.log("Step 2/4: Seeding test data...");
        await this.seedData(userCount);

        // Step 3: Run focused query benchmarks
        console.log("Step 3/4: Running focused query benchmarks...");
        await this.runQueryBenchmarks(queryIterations);

        // Step 4: Cleanup
        console.log("Step 4/4: Cleaning up...");
        await this.cleanDatabase();

        console.log("Benchmark completed!");
        return this.generateReport();
    }

    clearResults(): void {
        this.results = [];
    }
}
