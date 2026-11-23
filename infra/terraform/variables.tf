variable "region" {
  type    = string
  default = "ap-south-1"
}
variable "project" {
  type    = string
  default = "habitloop"
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}
variable "desired_count" {
  type    = number
  default = 1
}
variable "alert_email" {
  description = "Email for CloudWatch alarm notifications (leave empty to skip)"
  type        = string
  default     = ""
}
variable "restrict_alb_to_cloudfront" {
  description = "Only CloudFront may reach the ALB (recommended)"
  type        = bool
  default     = true
}
