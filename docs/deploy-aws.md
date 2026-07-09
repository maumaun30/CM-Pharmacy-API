# AWS Deployment Runbook — Phase 2

Provisions the AWS foundation for the API with Terraform. **Phase 2a (this doc):
networking + RDS Postgres.** Phase 2b (compute: ECS/ALB/ECR + CI/CD) comes next.

> Terraform authors the infra; **you** run `terraform apply` with your own AWS
> credentials — it creates billable resources in your account.

## 0. Prerequisites (install once)

- **AWS account** + an IAM user/role with admin (or scoped infra) permissions.
- **AWS CLI v2** — configure creds: `aws configure` (set region `ap-southeast-1`).
- **Terraform** ≥ 1.6 — https://developer.hashicorp.com/terraform/install
- **psql** client (to load the schema) — comes with the `postgresql` package.

Verify: `aws sts get-caller-identity`, `terraform version`, `psql --version`.

## 1. Provision network + RDS

```bash
cd CM-Pharmacy-API/infra/terraform
cp terraform.tfvars.example terraform.tfvars   # edit if needed
terraform init
terraform plan      # review — should show ~15 resources to add
terraform apply     # type 'yes'
```

> **AWS "free plan" accounts** cap RDS automated-backup retention and reject the
> default 7-day window with `FreeTierRestrictionError`. Set
> `db_backup_retention_period = 0` in `terraform.tfvars` (backups off). Bump it
> back to 7 once on a paid plan for point-in-time recovery.

Note the outputs (also `terraform output` anytime):
- `rds_endpoint` — host:port
- `rds_master_user_secret_arn` — Secrets Manager ARN with the DB password

## 2. Build DATABASE_URL from the managed secret

RDS generated the master password into Secrets Manager (never in TF state). Fetch it:

```bash
SECRET_ARN=$(terraform output -raw rds_master_user_secret_arn)
aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
  --query SecretString --output text
# → {"username":"cmadmin","password":"........"}
```

Assemble (host = `rds_address`, db = `rds_db_name`, default `cm_pharmacy`):

```
DATABASE_URL=postgres://cmadmin:<password>@<rds_address>:5432/cm_pharmacy
```

## 3. Load the schema into RDS

Same SQL as local — migrations + RPC functions, via psql.

**Linux/macOS (bash):**
```bash
cd CM-Pharmacy-API
DATABASE_URL="postgres://cmadmin:<password>@<rds_address>:5432/cm_pharmacy" \
  bash db/load-schema.sh
```

**Windows (PowerShell):** use the bundled loader — it reads the endpoint + secret
ARN from `terraform output`, pulls the password from Secrets Manager, and applies
everything via `psql` (no bash, password never on the command line):
```powershell
cd CM-Pharmacy-API/infra
.\load-rds-schema.ps1
```

> To reach RDS from your laptop for this step, temporarily set
> `db_publicly_accessible = true` and `my_ip_cidr = "<your-ip>/32"` in
> `terraform.tfvars`, `terraform apply`, load the schema, then set both back and
> apply again. In Phase 2b the ECS task loads/uses it from inside the VPC and no
> public access is needed.

## 4. (Optional) Validate the live API against RDS

With public access temporarily on, point the API at RDS and smoke-test:

```bash
cd CM-Pharmacy-API
DATABASE_URL="postgres://cmadmin:<password>@<rds_address>:5432/cm_pharmacy" \
DB_SSL=true PORT=5099 node server.js
# expect: "Postgres connection established successfully."
```

## 5. Teardown (stop all charges)

```bash
cd CM-Pharmacy-API/infra/terraform
terraform destroy
```

## Rough monthly cost (ap-southeast-1, foundation stage)

| Resource | Est. USD/mo |
|---|---|
| RDS `db.t4g.micro`, single-AZ, 20 GB gp3 | ~15–18 |
| Secrets Manager (1 secret) | ~0.40 |
| VPC / subnets / IGW / route tables | 0 |
| NAT gateway (only if `enable_nat_gateway=true`) | ~32 + data |
| **Foundation total (NAT off)** | **~16–19** |

Multi-AZ roughly doubles the RDS line. Phase 2b adds Fargate + ALB (~small task
+ ~USD 16/mo ALB).

## What's next (Phase 2b — compute)

- ECR repo + `Dockerfile` for the API
- ECS Fargate service + task definition (DATABASE_URL from Secrets Manager)
- Application Load Balancer (+ sticky sessions for Socket.IO)
- Set `enable_nat_gateway = true` so tasks can pull images / reach the internet
- GitHub Actions → ECR → ECS deploy pipeline
