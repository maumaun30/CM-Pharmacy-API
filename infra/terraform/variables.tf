variable "aws_region" {
  description = "AWS region. Singapore is the nearest mature region to the Philippines."
  type        = string
  default     = "ap-southeast-1"
}

variable "name_prefix" {
  description = "Prefix for all resource names/tags."
  type        = string
  default     = "cm-pharmacy"
}

variable "environment" {
  description = "Deployment environment (prod/staging/dev)."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones to spread subnets across (>=2 required for RDS/ALB)."
  type        = list(string)
  default     = ["ap-southeast-1a", "ap-southeast-1b"]
}

variable "enable_nat_gateway" {
  description = "NAT gateway for private-subnet egress. Not needed until ECS lands (Phase 2b); off saves ~USD 32/mo."
  type        = bool
  default     = false
}

# ── RDS ──────────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class. t4g.micro is ARM/cheap; scale up as branches grow."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Enable RDS Multi-AZ standby. Start false (1 branch); flip true for HA."
  type        = bool
  default     = false
}

variable "db_backup_retention_period" {
  description = <<-EOT
    Days of automated RDS backups. 0 disables them (required on the AWS free
    plan, which caps retention). Set to 7 once on a paid plan for point-in-time
    recovery.
  EOT
  type        = number
  default     = 7
}

variable "db_publicly_accessible" {
  description = <<-EOT
    Whether RDS gets a public endpoint. Keep FALSE in production. Set true ONLY
    for initial validation from your laptop, together with my_ip_cidr, then turn
    it back off once ECS is deployed inside the VPC.
  EOT
  type        = bool
  default     = false
}

variable "my_ip_cidr" {
  description = "Your public IP as a /32 CIDR (e.g. 203.0.113.4/32) for temporary DB access when db_publicly_accessible=true. Leave empty otherwise."
  type        = string
  default     = ""
}
