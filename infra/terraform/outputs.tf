output "app_url" {
  value = "https://${aws_cloudfront_distribution.cdn.domain_name}"
}
output "alb_dns" {
  value = aws_lb.main.dns_name
}
output "frontend_bucket" {
  value = aws_s3_bucket.site.bucket
}
output "cloudfront_id" {
  value = aws_cloudfront_distribution.cdn.id
}
output "ecr_registry" {
  value = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}
output "rds_endpoint" {
  value = aws_db_instance.pg.address
}
output "dlq_url" {
  value = aws_sqs_queue.dlq.id
}
