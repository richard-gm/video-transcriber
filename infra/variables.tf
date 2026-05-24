variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "supabase_url" {
  description = "Supabase project URL"
  type        = string
  sensitive   = true
}

variable "supabase_anon_key" {
  description = "Supabase anon key"
  type        = string
  sensitive   = true
}

variable "supabase_table" {
  description = "Supabase table name"
  type        = string
  default     = "videos"
}

variable "telegram_bot_token" {
  description = "Telegram bot token (from @BotFather)"
  type        = string
  sensitive   = true
}

variable "telegram_secret_token" {
  description = "Secret token to verify Telegram webhook requests"
  type        = string
  sensitive   = true
}

variable "whisper_model" {
  description = "Whisper model size: tiny, base, small, medium, large"
  type        = string
  default     = "small"
}

variable "worker_cpu" {
  description = "CPU for the Cloud Run Job worker"
  type        = string
  default     = "2"
}

variable "worker_memory" {
  description = "Memory for the Cloud Run Job worker"
  type        = string
  default     = "4Gi"
}
