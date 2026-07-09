output "route53_name_servers" {
  description = "Set these 4 nameservers at your registrar (Hostinger) for the domain."
  value       = module.dns.name_servers
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "rds_endpoint" {
  description = "host:port for the Postgres instance."
  value       = module.rds.endpoint
}

output "rds_address" {
  value = module.rds.address
}

output "rds_db_name" {
  value = module.rds.db_name
}

output "rds_security_group_id" {
  value = module.rds.security_group_id
}

output "rds_master_user_secret_arn" {
  description = "Secrets Manager ARN with the DB master username/password. Fetch it to build DATABASE_URL."
  value       = module.rds.master_user_secret_arn
}
