terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # State is LOCAL for the first apply (chicken-and-egg: the S3 bucket must
  # exist before it can hold state). Once you've created a state bucket +
  # DynamoDB lock table, uncomment this and run `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket         = "cm-pharmacy-tfstate-<your-account-id>"
  #   key            = "prod/terraform.tfstate"
  #   region         = "ap-southeast-1"
  #   dynamodb_table = "cm-pharmacy-tflock"
  #   encrypt        = true
  # }
}
