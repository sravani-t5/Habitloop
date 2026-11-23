resource "aws_lb" "main" {
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "svc" {
  for_each             = local.services
  name                 = "${var.project}-${each.key}"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not found\"}"
      status_code  = "404"
    }
  }
}

# Service-to-service "internal" endpoints are never reachable from the internet
resource "aws_lb_listener_rule" "block_internal" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1
  action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Forbidden\"}"
      status_code  = "403"
    }
  }
  condition {
    path_pattern { values = ["/api/*/internal/*"] }
  }
}

resource "aws_lb_listener_rule" "svc" {
  for_each     = local.services
  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.svc[each.key].arn
  }
  condition {
    path_pattern { values = [each.value.path] }
  }
}
