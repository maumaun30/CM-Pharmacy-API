output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "The 4 AWS nameservers to set at your registrar (Hostinger)."
  value       = aws_route53_zone.this.name_servers
}
