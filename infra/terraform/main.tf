module "dns" {
  source = "./modules/dns"

  domain_name = var.domain_name
}

module "network" {
  source = "./modules/network"

  name_prefix = var.name_prefix
  vpc_cidr    = var.vpc_cidr
  azs         = var.azs

  # NAT isn't needed until ECS tasks run in private subnets. Enable it in
  # Phase 2b (compute) — off keeps the foundation cheap.
  enable_nat_gateway = var.enable_nat_gateway
}

module "rds" {
  source = "./modules/rds"

  name_prefix = var.name_prefix
  vpc_id      = module.network.vpc_id
  vpc_cidr    = module.network.vpc_cidr

  # The DB subnet group spans BOTH tiers so toggling public access never has to
  # REMOVE a subnet the running instance sits in (RDS rejects that as "in use").
  # Exposure is controlled by publicly_accessible + the security group, not by
  # which subnets the group contains: with publicly_accessible=false the instance
  # gets no public IP and the SG allows only the VPC CIDR, so it's unreachable
  # from the internet. When true (temporary laptop access) the public subnets in
  # the group give the public IP a route to the internet gateway.
  subnet_ids = concat(module.network.public_subnet_ids, module.network.private_subnet_ids)

  instance_class          = var.db_instance_class
  multi_az                = var.db_multi_az
  publicly_accessible     = var.db_publicly_accessible
  backup_retention_period = var.db_backup_retention_period

  # Only add your IP to the DB ingress when you've opted into public access.
  allowed_ingress_cidrs = var.db_publicly_accessible && var.my_ip_cidr != "" ? [var.my_ip_cidr] : []
}
