# ---------------- Secrets Manager ----------------
resource "random_password" "db" {
  length  = 24
  special = false
}
resource "random_password" "jwt" {
  length  = 48
  special = false
}
resource "random_password" "internal" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.project}/db"
  recovery_window_in_days = 0 # delete immediately on destroy (demo environment)
}
resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({ username = "habitadmin", password = random_password.db.result })
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project}/app"
  recovery_window_in_days = 0
}
resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ jwt_secret = random_password.jwt.result, internal_api_key = random_password.internal.result })
}

# ---------------- RDS PostgreSQL (private data subnets) ----------------
resource "aws_db_subnet_group" "pg" {
  name       = "${var.project}-db-subnets"
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_instance" "pg" {
  identifier              = "${var.project}-pg"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  storage_type            = "gp3"
  storage_encrypted       = true
  username                = "habitadmin"
  password                = random_password.db.result
  db_subnet_group_name    = aws_db_subnet_group.pg.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true
}

# ---------------- DynamoDB (analytics aggregates) ----------------
resource "aws_dynamodb_table" "analytics" {
  name         = "${var.project}-analytics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  point_in_time_recovery { enabled = true }
}

# ---------------- ECR (one private repository per service) ----------------
resource "aws_ecr_repository" "svc" {
  for_each             = local.services
  name                 = "${var.project}/${each.key}-service"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}
