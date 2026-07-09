# Route 53 hosted zone for the domain. Creating the zone does NOT change how the
# domain resolves — that only happens once you point the registrar's nameservers
# (output below) at this zone. Records (ACM validation, the api alias) get added
# in later steps.
resource "aws_route53_zone" "this" {
  name = var.domain_name

  tags = { Name = var.domain_name }
}
