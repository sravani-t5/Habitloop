data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: lets ECS pull images, write logs and inject the two secrets (not used by app code)
resource "aws_iam_role" "execution" {
  name               = "${var.project}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.db.arn] }]
  })
}

# Task roles: one per service, least privilege. Most services need no AWS API access at all.
resource "aws_iam_role" "task" {
  for_each           = local.services
  name               = "${var.project}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "analytics_dynamodb" {
  name = "dynamodb-analytics-table-only"
  role = aws_iam_role.task["analytics"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:DescribeTable"]
      Resource = aws_dynamodb_table.analytics.arn
    }]
  })
}

resource "aws_iam_role_policy" "integration_events" {
  name = "eventbridge-put-events-on-habitloop-bus"
  role = aws_iam_role.task["integration"].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["events:PutEvents"], Resource = aws_cloudwatch_event_bus.main.arn }]
  })
}
