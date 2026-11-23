# Wearable event pipeline: Integration Service -> EventBridge -> Lambda (-> Activity Service). Failures -> SQS DLQ.
resource "aws_cloudwatch_event_bus" "main" {
  name = "${var.project}-bus"
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.project}-events-dlq"
  message_retention_seconds = 1209600
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.project}-event-processor"
  retention_in_days = 7
}

resource "aws_iam_role" "lambda" {
  name = "${var.project}-event-processor"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}
resource "aws_iam_role_policy" "lambda_secret" {
  name = "read-app-secret"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.app.arn }]
  })
}

# Build first:  (cd lambdas/event-processor && npm run bundle)
data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../../lambdas/event-processor/bundle/index.js"
  output_path = "${path.module}/event-processor.zip"
}

resource "aws_lambda_function" "processor" {
  function_name    = "${var.project}-event-processor"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 15
  memory_size      = 256

  vpc_config {
    subnet_ids         = aws_subnet.app[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }
  environment {
    variables = {
      ACTIVITY_URL    = local.common_env.ACTIVITY_URL
      INTEGRATION_URL = local.common_env.INTEGRATION_URL
      APP_SECRET_ARN  = aws_secretsmanager_secret.app.arn
    }
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }
  depends_on = [aws_iam_role_policy_attachment.lambda_vpc]
}

resource "aws_cloudwatch_event_rule" "partner" {
  name           = "${var.project}-partner-events"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern = jsonencode({
    source        = ["habitloop.integration"]
    "detail-type" = ["PartnerEventReceived"]
  })
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule           = aws_cloudwatch_event_rule.partner.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_lambda_function.processor.arn
  retry_policy {
    maximum_retry_attempts       = 3
    maximum_event_age_in_seconds = 3600
  }
  dead_letter_config { arn = aws_sqs_queue.dlq.arn }
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.processor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.partner.arn
}

resource "aws_sqs_queue_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.dlq.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.partner.arn } }
    }]
  })
}
