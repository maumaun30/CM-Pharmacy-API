output "endpoint" {
  description = "RDS host:port endpoint."
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "RDS hostname (no port)."
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "security_group_id" {
  description = "DB security group — reference it from the ECS task SG later."
  value       = aws_security_group.db.id
}

output "master_user_secret_arn" {
  description = "Secrets Manager ARN holding the RDS master username/password JSON."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
