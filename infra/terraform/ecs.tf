resource "aws_ecs_cluster" "main" {
  name = "${var.project}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Service discovery: services reach each other at <name>-service.habitloop.local without leaving the VPC
resource "aws_service_discovery_private_dns_namespace" "ns" {
  name = local.ns
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "svc" {
  for_each = local.services
  name     = "${each.key}-service"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.ns.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config { failure_threshold = 1 }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = local.services
  name              = "/ecs/${var.project}/${each.key}-service"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "svc" {
  for_each                 = local.services
  family                   = "${var.project}-${each.key}-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "${each.key}-service"
    image        = "${aws_ecr_repository.svc[each.key].repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment  = [for k, v in local.task_env[each.key] : { name = k, value = v }]
    secrets = concat(
      [
        { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:jwt_secret::" },
        { name = "INTERNAL_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:internal_api_key::" },
      ],
      each.value.db != null ? [
        { name = "DB_USER", valueFrom = "${aws_secretsmanager_secret.db.arn}:username::" },
        { name = "DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
      ] : []
    )
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "svc" {
  for_each        = local.services
  name            = "${each.key}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.svc[each.key].arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.app[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.svc[each.key].arn
    container_name   = "${each.key}-service"
    container_port   = 3000
  }
  service_registries {
    registry_arn = aws_service_discovery_service.svc[each.key].arn
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  health_check_grace_period_seconds = 90

  lifecycle { ignore_changes = [desired_count] } # owned by auto scaling
  depends_on = [aws_lb_listener_rule.svc, aws_db_instance.pg]
}

# Auto Scaling: 1..3 tasks per service, target 60% CPU
resource "aws_appautoscaling_target" "svc" {
  for_each           = local.services
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.svc[each.key].name}"
  min_capacity       = 1
  max_capacity       = 3
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.services
  name               = "${var.project}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.svc[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.svc[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.svc[each.key].resource_id
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}
