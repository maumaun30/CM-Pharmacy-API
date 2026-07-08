variable "name_prefix" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones (one public + one private subnet per AZ)."
  type        = list(string)
}

variable "enable_nat_gateway" {
  description = "Create a NAT gateway so private subnets (ECS tasks) have outbound internet. ~USD 32/mo. Not needed until compute is deployed."
  type        = bool
  default     = true
}
