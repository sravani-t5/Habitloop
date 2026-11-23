terraform {
  required_version = ">= 1.5"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.60" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "me" {}
data "aws_availability_zones" "az" { state = "available" }

locals {
  account_id = data.aws_caller_identity.me.account_id
  azs        = slice(data.aws_availability_zones.az.names, 0, 2)
  ns         = "habitloop.local" # Cloud Map private DNS: <service>-service.habitloop.local

  # One entry per microservice: ALB path rule, database name (null = no RDS) and rule priority
  services = {
    user           = { path = "/api/users*", db = "users", priority = 10 }
    activity       = { path = "/api/activities*", db = "activities", priority = 20 }
    challenge      = { path = "/api/challenges*", db = "challenges", priority = 30 }
    integration    = { path = "/api/integrations*", db = "integrations", priority = 40 }
    analytics      = { path = "/api/analytics*", db = null, priority = 50 }
    recommendation = { path = "/api/recommendations*", db = "recommendations", priority = 60 }
  }

  common_env = {
    PORT            = "3000"
    NODE_ENV        = "production"
    APP_TZ          = "Asia/Kolkata"
    ACTIVITY_URL    = "http://activity-service.${local.ns}:3000"
    ANALYTICS_URL   = "http://analytics-service.${local.ns}:3000"
    INTEGRATION_URL = "http://integration-service.${local.ns}:3000"
  }

  task_env = {
    for k, v in local.services : k => merge(
      local.common_env,
      v.db != null ? tomap({ DB_HOST = aws_db_instance.pg.address, DB_PORT = "5432", DB_NAME = v.db, DB_SSL = "true", DB_AUTO_CREATE = "true" }) : tomap({}),
      k == "analytics" ? tomap({ DDB_TABLE = aws_dynamodb_table.analytics.name, AWS_REGION = var.region }) : tomap({}),
      k == "integration" ? tomap({ EVENT_BUS = "eventbridge", EVENT_BUS_NAME = aws_cloudwatch_event_bus.main.name, AWS_REGION = var.region }) : tomap({}),
    )
  }
}
