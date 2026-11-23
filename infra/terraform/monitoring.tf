resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---- Alarms: API failures, latency, queue depth, Lambda errors, service restarts, auth failures ----
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-api-5xx"
  alarm_description   = "Backend returned 5xx errors"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${var.project}-api-latency"
  alarm_description   = "Average target response time above 1s"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${var.project}-dlq-depth"
  alarm_description   = "Events landed in the dead-letter queue"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.project}-lambda-errors"
  alarm_description   = "Event-processor Lambda failures"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.processor.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Service restarts / outages: fewer running tasks than expected
resource "aws_cloudwatch_metric_alarm" "tasks" {
  for_each            = local.services
  alarm_name          = "${var.project}-${each.key}-running-tasks"
  alarm_description   = "${each.key}-service has no running task (crash loop or restart)"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.svc[each.key].name }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Authentication issues: count HTTP 401 responses found in the structured logs of every service
resource "aws_cloudwatch_log_metric_filter" "auth" {
  for_each       = local.services
  name           = "${var.project}-${each.key}-401"
  log_group_name = aws_cloudwatch_log_group.svc[each.key].name
  pattern        = "{ $.res.statusCode = 401 }"
  metric_transformation {
    name          = "AuthFailures"
    namespace     = "HabitLoop"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "auth" {
  alarm_name          = "${var.project}-auth-failures"
  alarm_description   = "Many rejected logins / invalid tokens"
  namespace           = "HabitLoop"
  metric_name         = "AuthFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project}-ops"
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = {
        title = "ALB requests and 5xx", region = var.region, stat = "Sum", period = 300,
      metrics = [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix], [".", "HTTPCode_Target_5XX_Count", ".", "."]] } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = {
        title = "API latency (avg, s)", region = var.region, stat = "Average", period = 300,
      metrics = [["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix]] } },
      { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = {
        title = "ECS CPU % per service", region = var.region, stat = "Average", period = 300,
      metrics = [for k in keys(local.services) : ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", "${k}-service"]] } },
      { type = "metric", x = 12, y = 6, width = 12, height = 6, properties = {
        title = "Running tasks per service", region = var.region, stat = "Minimum", period = 60,
      metrics = [for k in keys(local.services) : ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", "${k}-service"]] } },
      { type = "metric", x = 0, y = 12, width = 8, height = 6, properties = {
        title = "Lambda invocations / errors", region = var.region, stat = "Sum", period = 300,
      metrics = [["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.processor.function_name], [".", "Errors", ".", "."]] } },
      { type = "metric", x = 8, y = 12, width = 8, height = 6, properties = {
        title = "Dead-letter queue depth", region = var.region, stat = "Maximum", period = 300,
      metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.dlq.name]] } },
      { type = "metric", x = 16, y = 12, width = 8, height = 6, properties = {
        title = "Auth failures (401)", region = var.region, stat = "Sum", period = 300,
      metrics = [["HabitLoop", "AuthFailures"]] } },
      { type = "metric", x = 0, y = 18, width = 12, height = 6, properties = {
        title = "RDS CPU and connections", region = var.region, stat = "Average", period = 300,
      metrics = [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.pg.identifier], [".", "DatabaseConnections", ".", "."]] } },
    ]
  })
}
