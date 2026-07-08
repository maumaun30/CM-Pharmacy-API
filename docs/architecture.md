# Target Architecture (AWS)

Right-sized for a 1→3 branch pharmacy but built the idiomatic, horizontally
scalable way.

```
          ┌─ Next.js admin  ── S3 + CloudFront (or Amplify Hosting)
 Clients ─┤
          └─ Expo POS app   ── EAS build, talks to the API over HTTPS
                                    │
                                    ▼
                            Application Load Balancer (ALB)   [public subnets]
                                    │  (sticky sessions for Socket.IO)
                                    ▼
                            ECS Fargate service — Express API
                            1..N tasks, auto-scaling             [private subnets]
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                 ▼
        RDS PostgreSQL (Multi-AZ)          ElastiCache Redis (Phase 2b)
        [private subnets]                  - Socket.IO adapter (multi-task fanout)
                                           - hot-path caching

  Region: ap-southeast-1 (Singapore) — nearest mature AWS region to the Philippines.
  Everything in ONE VPC. DB + API colocated → sub-ms query latency.
  Provisioned via Terraform (or AWS CDK). Deployed via GitHub Actions → ECR → ECS.
```

## Why each piece

| Component | Choice | Notes |
|---|---|---|
| **DB** | RDS for PostgreSQL, Multi-AZ | Managed backups/patching/failover. Start `db.t4g.micro`, Single-AZ, scale up + enable Multi-AZ when branches 2 & 3 join. |
| **API** | ECS Fargate behind ALB | Stateless JWT API = trivially horizontal. No servers to patch. |
| **Realtime** | Socket.IO | Needs session affinity. Start with ALB **sticky sessions** + 1 task. When scaling to N tasks, add the **Redis adapter** (ElastiCache) so events fan out across tasks. |
| **Admin UI** | S3 + CloudFront or Amplify | Static Next.js export or SSR via Amplify. |
| **POS app** | Expo / EAS | Add an **offline sales queue** (see below). |
| **Secrets** | AWS Secrets Manager / SSM Parameter Store | `DATABASE_URL`, `JWT_SECRET` injected into the task definition. |
| **IaC** | Terraform or CDK | The resume artifact — reproducible infra. |
| **CI/CD** | GitHub Actions → ECR → ECS deploy | Build image, push, roll the service. |

## Scaling notes (the interesting tradeoffs)

- **Stateless API** scales horizontally by raising the Fargate desired count;
  the ALB spreads load. No code change needed *except* realtime (below).
- **Socket.IO is the one stateful edge.** A client's socket lives on one task.
  With >1 task you must either pin clients (sticky sessions) or, better, use the
  `@socket.io/redis-adapter` so any task can emit to any room. Our rooms are
  `branch-${id}` and `admin-all`, so the adapter is a clean drop-in.
- **DB connections**: Fargate tasks × pool size must stay under RDS
  `max_connections`. Keep the `pg` pool small (e.g. 10) or front RDS with
  **RDS Proxy** when task count grows.
- **Read scaling** (much later): RDS read replicas for dashboard/analytics
  queries, since those are read-heavy and branch-consolidated.

## POS resilience — do not skip

A cloud-central DB means a dropped internet link at the counter stops sales.
The multi-branch data model *wants* a central DB (admins view consolidated data
across branches), so cloud-central is correct — but the Expo POS app should
**queue sales locally and sync on reconnect** so a flaky link never blocks a
sale. This is the single most important POS resilience decision.
