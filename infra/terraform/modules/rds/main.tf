resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.subnet_ids
  tags       = { Name = "${var.name_prefix}-db-subnets" }
}

# Security group: Postgres reachable from inside the VPC (ECS tasks) plus any
# explicitly allowed CIDRs (e.g. your laptop during initial validation).
resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "Allow Postgres access to RDS"
  vpc_id      = var.vpc_id

  ingress {
    description = "Postgres from within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = concat([var.vpc_cidr], var.allowed_ingress_cidrs)
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-db-sg" }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.master_username

  # Let RDS generate + store (and rotate) the master password in Secrets Manager.
  # No plaintext password ever touches Terraform state.
  manage_master_user_password = true

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  multi_az               = var.multi_az
  publicly_accessible    = var.publicly_accessible

  backup_retention_period = var.backup_retention_period
  deletion_protection     = var.deletion_protection

  # Dev-friendly: don't force a final snapshot on destroy. Set skip=false for prod.
  skip_final_snapshot       = true
  final_snapshot_identifier = null

  apply_immediately = true

  tags = { Name = "${var.name_prefix}-db" }
}
