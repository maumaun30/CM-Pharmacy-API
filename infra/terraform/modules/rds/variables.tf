variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  description = "VPC CIDR — allowed to reach the DB (ECS tasks live in-VPC)."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "engine_version" {
  description = "Postgres major (or major.minor) version."
  type        = string
  default     = "16"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "max_allocated_storage" {
  description = "Upper bound for storage autoscaling."
  type        = number
  default     = 100
}

variable "db_name" {
  type    = string
  default = "cm_pharmacy"
}

variable "master_username" {
  type    = string
  default = "cmadmin"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "publicly_accessible" {
  type    = bool
  default = false
}

variable "allowed_ingress_cidrs" {
  description = "Extra CIDRs allowed on 5432 (e.g. your laptop IP for initial validation)."
  type        = list(string)
  default     = []
}

variable "backup_retention_period" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  description = "Prevent accidental DB deletion. Keep false while iterating; true for real prod."
  type        = bool
  default     = false
}
