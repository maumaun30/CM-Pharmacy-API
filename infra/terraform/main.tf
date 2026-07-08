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

  # RDS lives in PRIVATE subnets normally. For temporary laptop validation
  # (db_publicly_accessible=true) it must sit in PUBLIC subnets so a public IP
  # is routable via the internet gateway. Flip the flag back off once ECS runs.
  subnet_ids = var.db_publicly_accessible ? module.network.public_subnet_ids : module.network.private_subnet_ids

  instance_class      = var.db_instance_class
  multi_az            = var.db_multi_az
  publicly_accessible = var.db_publicly_accessible

  # Only add your IP to the DB ingress when you've opted into public access.
  allowed_ingress_cidrs = var.db_publicly_accessible && var.my_ip_cidr != "" ? [var.my_ip_cidr] : []
}
